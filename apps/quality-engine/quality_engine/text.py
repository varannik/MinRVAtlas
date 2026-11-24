"""Plain English for every finding: one template per kind, filled from its facts.

Four parts a person reads (headline, what we saw, why it matters, what to do)
and one for whoever checks the method (how we found it). Statistics words
stay in "how". Deterministic: the same facts always give the same words, so
an auditor can replay a run and read what the operator read.

Rules for the words: name the meter the way the site does, then its tag;
dates in full; what we saw next to what we expected, with units; what it does
to the credit; one thing a person can do. A detector says the data is
unusual, not that it is wrong.
"""

from datetime import date, datetime

from . import catalog

MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


# ── Formatting ──────────────────────────────────────────────────────────────


def day(key):
    value = date.fromisoformat(key)
    return f"{value.day} {MONTHS[value.month - 1]} {value.year}"


def window(start, end):
    """3 Aug 2026, 3–8 Aug 2026, 28 Jul – 2 Aug 2026, 30 Dec 2025 – 2 Jan 2026."""
    if start == end:
        return day(start)
    a, b = date.fromisoformat(start), date.fromisoformat(end)
    if a.year == b.year and a.month == b.month:
        return f"{a.day}–{b.day} {MONTHS[b.month - 1]} {b.year}"
    if a.year == b.year:
        return f"{a.day} {MONTHS[a.month - 1]} – {b.day} {MONTHS[b.month - 1]} {b.year}"
    return f"{day(start)} – {day(end)}"


def num(value):
    if value is None:
        return "—"
    value = float(value)
    if value == 0:
        return "0"
    size = abs(value)
    if size >= 1000:
        return f"{value:,.0f}"
    if size >= 10:
        return f"{value:,.1f}".rstrip("0").rstrip(".")
    if size >= 1:
        return f"{value:.2f}".rstrip("0").rstrip(".")
    return f"{value:.3g}"


def qty(value, unit):
    return f"{num(value)} {unit}".strip()


def pct(share):
    return f"{share * 100:.1f}%".replace(".0%", "%")


def cap(text):
    return text[:1].upper() + text[1:]


def plural(count, word, many=None):
    return f"{count} {word if count == 1 else (many or word + 's')}"


def duration(minutes):
    minutes = int(round(minutes))
    hours, rest = divmod(minutes, 60)
    if not hours:
        return f"{rest} min"
    return f"{hours} h" if not rest else f"{hours} h {rest} min"


def clock(iso, site_tz=None):
    """17:03 site time (13:03 UTC), or 13:03 UTC when the site's time zone is not known."""
    if not iso:
        return ""
    moment = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    utc = moment.strftime("%H:%M")
    if site_tz:
        try:
            from zoneinfo import ZoneInfo

            local = moment.astimezone(ZoneInfo(site_tz)).strftime("%H:%M")
            return f"{local} site time ({utc} UTC)"
        except Exception:  # noqa: BLE001 — no zone data: UTC is still right
            pass
    return f"{utc} UTC"


def when(finding):
    return f"on {day(finding.start)}" if finding.start == finding.end else f"over {plural(finding.days, 'day')}, {window(finding.start, finding.end)}"


def threshold_note(rule):
    limit = rule.get("threshold")
    if not limit:
        return ""
    if limit.get("source") == "approved":
        return " Approved threshold."
    return " Built-in threshold, not yet approved."


def feeds_sentence(info):
    return f"It feeds {info.feeds}." if info.feeds else ""


def tonnes_sentence(impact, lead="These days carry"):
    if not impact or impact.get("t_co2") in (None, 0):
        return ""
    return f" {lead} {qty(impact['t_co2'], 't')} of CO₂."


# ── Templates ───────────────────────────────────────────────────────────────


def word(finding, site_tz=None):
    """The finding's four plain-English parts and how it was found."""
    info = catalog.metric(finding.metric) if finding.metric else None
    write = TEMPLATES.get(finding.kind, _generic)
    text = write(finding, info, site_tz)
    rule = finding.rule
    text["how"] = f"{rule['name']} ({rule['origin']}, rule {rule['id']} v{rule['version']}). {text['how']}{threshold_note(rule)}"
    if finding.advisory:
        text["how"] += " A detector: it advises and never blocks on its own."
    return text


def _missing_days(f, _info, _tz):
    o = f.observed
    return {
        "headline": f"No readings at all on {day(f.start)}." if f.days == 1 else f"No readings at all for {f.days} days, {window(f.start, f.end)}.",
        "saw": f"The stream has no rows for any meter {when(f)}. It has readings on {day(o['before'])} and on {day(o['after'])}.",
        "matters": "Nothing on these days reaches the calculation: deliveries, losses, energy and reversals for them are not counted."
        + (" Three or more days in a row needs a documented substitute before the period can be submitted." if f.severity == "blocks" else ""),
        "todo": "Ask the site for the missing export, or record why the stream stopped and how these days are filled.",
        "how": "Days inside the monitoring range with no rows for any meter.",
    }


def _metric_gap(f, info, _tz):
    return {
        "headline": f"The {info.meter} sent nothing {when(f)}.",
        "saw": f"Other meters reported on {'that day' if f.days == 1 else 'those days'}, but {f.metric} has no readings.",
        "matters": f"{feeds_sentence(info)} {'That day is' if f.days == 1 else 'Those days are'} missing from it.".strip(),
        "todo": "Check the meter's link to the PLC for those days, and ask the site for its own log.",
        "how": "A meter that reports every day has no readings on days the rest of the stream reported.",
    }


def _out_of_range(f, info, _tz):
    o, e = f.observed, f.expected
    if e.get("low") is not None and e.get("high") is not None:
        limit = f"Readings must stay between {num(e['low'])} and {qty(e['high'], info.unit)}."
    elif e.get("low") is not None:
        limit = f"Readings can't go below {qty(e['low'], info.unit)}."
    else:
        limit = f"Readings can't go above {qty(e['high'], info.unit)}."
    return {
        "headline": f"Impossible {info.name} readings {when(f)}.",
        "saw": f"The most extreme was {qty(o['worst'], info.unit)}. {limit}",
        "matters": f"{feeds_sentence(info)} An impossible reading changes that term.{tonnes_sentence(f.impact)}".strip(),
        "todo": "Check the meter's scaling and units, then correct the readings or exclude them with a note.",
        "how": "Any reading outside the meter's physical limits.",
    }


def _stuck_zero(f, info, _tz):
    whole = f.observed.get("whole_range")
    return {
        "headline": f"The {info.meter} reads 0 in every file." if whole else f"The {info.meter} read exactly 0 for {f.days} days, {window(f.start, f.end)}.",
        "saw": f"Every reading from {f.metric} {'in the data' if whole else 'on those days'} is 0.",
        "matters": f"{feeds_sentence(info)} A working meter on a running plant doesn't read zero for days, so that term is probably too low.".strip(),
        "todo": "Check the meter is connected and whether the plant ran. If it was stopped, dismiss this with the operations log.",
        "how": "A meter that should move reads exactly 0 for days in a row.",
    }


def _stuck_day(f, info, _tz):
    o = f.observed
    return {
        "headline": f"The {info.meter} repeated exactly {qty(o['value'], info.unit)} all day {when(f)}.",
        "saw": f"All {o['readings']} readings on {'that day' if f.days == 1 else 'the first of those days'} are {qty(o['value'], info.unit)}. A working meter almost never repeats the same value.",
        "matters": f"This usually means the sensor or its PLC link froze. {feeds_sentence(info)} Those days' values can't be trusted.".strip(),
        "todo": "Check the PLC log for the meter on those days, and compare with a backup meter if there is one.",
        "how": "Every reading of the day is identical.",
    }


def _flatline(f, info, tz):
    o = f.observed
    return {
        "headline": f"The {info.meter} was stuck at {qty(o['value'], info.unit)} for {duration(o['minutes'])} {when(f)}.",
        "saw": f"It repeated exactly the same reading {o['readings']} times, from {clock(o['from'], tz)} to {clock(o['to'], tz)}"
        + (f" on {day(o['from'][:10])}." if f.days > 1 else "."),
        "matters": "A working meter almost never repeats a value this long. The sensor or its PLC link may have frozen, and the day's average includes the frozen readings.",
        "todo": "Check the PLC log for that time and whether the plant was running.",
        "how": "The same reading repeated for a long stretch of the day.",
    }


def _counter_reset(f, info, tz):
    o = f.observed
    at = f" at {clock(f.at, tz)}" if f.at else ""
    to_zero = o["after"] == 0
    matters = "A total worked out as end minus start is wrong across a reset."
    if o.get("rise_before_reset"):
        lost = qty(o["rise_before_reset"], info.unit)
        tonnes = f" ({qty(f.impact['t_co2_missed'], 't')} of CO₂)" if f.impact and f.impact.get("t_co2_missed") else ""
        matters = f"Counting from the reset only leaves out the {lost}{tonnes} counted earlier that day."
    return {
        "headline": f"The {info.meter} reset to zero on {day(f.start)}{at}." if to_zero else f"The {info.meter} dropped back on {day(f.start)}{at}.",
        "saw": f"It read {qty(o['before'], info.unit)} just before and {qty(o['after'], info.unit)} just after.",
        "matters": matters,
        "todo": "Add the count from before the reset, or start every stream at the reset so they line up. Record why it was reset.",
        "how": "A cumulative counter fell between two readings.",
    }


def _losses_exceed(f, _info, _tz):
    o = f.observed
    return {
        "headline": f"Losses were larger than the CO₂ delivered {when(f)}.",
        "saw": f"Transit and venting losses add up to {qty(o['lost_t'], 't')} against {qty(o['delivered_t'], 't')} delivered.",
        "matters": "CO₂ stored would come out negative for those days. A loss meter is misreading, or a delivery is booked to the wrong day.",
        "todo": "Compare the loss figures with the weighbridge tickets for those days.",
        "how": "Transit and venting losses above the CO₂ delivered the same day.",
    }


def _loss_share(f, _info, _tz):
    o = f.observed
    limit = f.rule.get("threshold", {}).get("value")
    return {
        "headline": f"Losses were {pct(o['share'])} of the CO₂ delivered {when(f)}.",
        "saw": f"Transit and venting losses add up to {qty(o['lost_t'], 't')} against {qty(o['delivered_t'], 't')} delivered. Losses above {pct(limit)} need a reason.",
        "matters": f"Losses come straight off CO₂ stored, so a high figure lowers the credit by {qty(o['lost_t'], 't')}.",
        "todo": "Check the transport provider's loss estimate and the venting log for those days.",
        "how": "Losses above a share of the CO₂ delivered on a day.",
    }


def _meter_agreement(f, info, _tz):
    o = f.observed
    other = catalog.metric(o["other_metric"])
    tolerance = f.rule.get("threshold", {}).get("value")
    return {
        "headline": f"The {info.meter} and the {other.meter} disagree by {pct(o['share'])} {when(f)}.",
        "saw": f"{f.metric} counts {qty(o['first'], info.unit)} and {o['other_metric']} counts {qty(o['second'], other.unit)}. The tolerance is {pct(tolerance)}.",
        "matters": f"{feeds_sentence(info)} Until the difference is explained, the conservative figure is the lower one.".strip(),
        "todo": "Confirm which meter the monitoring plan names as the point of measurement, and explain the difference.",
        "how": "Two meters on the same quantity, compared day by day.",
    }


def _fixed_coverage(f, _info, _tz):
    name = catalog.fixed_name(f.fixed_key)
    latest = f.observed.get("latest_valid_to")
    saw = (
        f"The latest one on file is valid to {day(latest)}, and monitoring runs to {day(f.end)}."
        if latest and latest < f.start
        else f"There {'is' if f.observed['values'] == 1 else 'are'} {plural(f.observed['values'], 'value')} on file, but none is valid for {'that day' if f.days == 1 else f'those {f.days} days'}."
    )
    return {
        "headline": f"No {name} covers {window(f.start, f.end)}.",
        "saw": saw,
        "matters": f"Every term that uses the {name} ({f.fixed_key}) has no value for those days, so the credit can't be worked out for them.",
        "todo": f"Upload the {name} that covers {window(f.start, f.end)}, with its sampling or validity dates.",
        "how": "Every monitored day needs a dated value that covers it.",
    }


def _bad_readings(f, info, _tz):
    o = f.observed
    estimated = f" {plural(o['estimated'], 'reading')} {'was' if o['estimated'] == 1 else 'were'} marked estimated." if o.get("estimated") else ""
    return {
        "headline": f"{plural(o['bad'], 'reading')} from the {info.meter} {'was' if o['bad'] == 1 else 'were'} empty or unreadable {when(f)}.",
        "saw": f"{num(o['bad'])} of {num(o['rows'])} rows had no number or were marked missing.{estimated}",
        "matters": "They are left out of the day's figures, so those days rest on fewer readings.",
        "todo": "Ask the site why the readings are empty, and whether the PLC kept them.",
        "how": "Rows with no number, or marked missing.",
    }


def _incomplete_day(f, info, _tz):
    o, e = f.observed, f.expected
    per_day = e.get("per_day")
    every = f" (one every {num(e['cadence_minutes'])} minutes)" if e.get("cadence_minutes") else ""
    saw = (
        f"It sent {num(o['readings'])} readings against {num(per_day)} expected{every}."
        if f.days == 1
        else f"It sent {num(o['readings'])} readings over the {f.days} days, against {num(per_day)} expected each day{every}."
    )
    return {
        "headline": f"The {info.meter} sent too few readings {when(f)}.",
        "saw": saw,
        "matters": "The day's average rests on part of the day only, so it may not represent the day.",
        "todo": "Check the PLC export for those days and whether the meter was offline.",
        "how": "Fewer readings in a day than the meter's cadence gives.",
    }


def _gap(f, info, tz):
    o = f.observed
    return {
        "headline": f"The {info.meter} sent nothing for {duration(o['minutes'])} {when(f) if f.days > 1 else 'on ' + day(f.start)}.",
        "saw": f"Readings stop at {clock(o['from'], tz)} and start again at {clock(o['to'], tz)}" + (f" on {day(o['from'][:10])}." if f.days > 1 else "."),
        "matters": "The day's average leaves those hours out.",
        "todo": "Ask the site for the missing readings, or record why the meter was offline.",
        "how": "A gap between readings much longer than the meter's cadence.",
    }


def _out_of_order(f, info, _tz):
    return {
        "headline": f"Readings from the {info.meter} arrived out of time order {when(f)}.",
        "saw": f"{plural(f.observed['readings'], 'reading')} came after a later one in the file.",
        "matters": "The day's totals are not affected, but the day's last reading may be the wrong one.",
        "todo": "Ask whoever builds the export to sort it by time.",
        "how": "Timestamps that go backwards in the file.",
    }


def _duplicates(f, info, _tz):
    counted = info.kind in ("event", "total")
    return {
        "headline": f"Some readings from the {info.meter} appear twice {when(f)}.",
        "saw": f"{plural(f.observed['readings'], 'reading')} share a timestamp with another reading.",
        "matters": (f"{feeds_sentence(info)} A counted amount read twice is counted twice.{tonnes_sentence(f.impact)}" if counted else "The day's average barely moves, but the export is writing readings twice.").strip(),
        "todo": "Remove the duplicates in the source export, then run the checks again.",
        "how": "The same timestamp more than once for one meter.",
    }


def _reading_spike(f, info, tz):
    o = f.observed
    at = f" at {clock(f.at, tz)}" if f.at else ""
    return {
        "headline": f"The {info.meter} jumped to {qty(o['worst'], info.unit)} on {day(f.start)}{at}." if f.days == 1 else f"The {info.meter} gave wild readings {when(f)}.",
        "saw": f"{plural(o['readings'], 'reading')} {'was' if o['readings'] == 1 else 'were'} far from the day's usual level of about {qty(o['median'], info.unit)}.",
        "matters": "One wild reading can pull a day's average. It's usually a sensor glitch, but it can be a real event.",
        "todo": "Check the PLC log at that time. If it's a glitch, exclude the reading with a note.",
        "how": "A reading far from the day's median, measured in the day's usual spread.",
    }


def _spike(f, info, _tz):
    o, e = f.observed, f.expected
    return {
        "headline": f"{cap(info.name)} looked unusual on {day(o['day'])}." if f.days == 1 else f"{cap(info.name)} looked unusual {when(f)}.",
        "saw": (
            f"Its largest single reading was {qty(o['value'], info.unit)} on {day(o['day'])}, against a usual largest reading of {num(e['low'])}–{qty(e['high'], info.unit)} (about {qty(e['median'], info.unit)}) over the four weeks before."
            if o.get("measure") == "largest"
            else f"It came to {qty(o['value'], info.unit)} on {day(o['day'])}, against a usual {num(e['low'])}–{qty(e['high'], info.unit)} (about {qty(e['median'], info.unit)}) over the four weeks before."
        ),
        "matters": f"This is unusual, not necessarily wrong. A change in how the plant ran would explain it, and so would a meter fault. {feeds_sentence(info)}".strip(),
        "todo": "Check what happened at the plant that day, then confirm it or dismiss it with the reason.",
        "how": (
            "The day's largest single reading against those of the previous 28 days, measured in their usual spread, and against the same weekday."
            if o.get("measure") == "largest"
            else "The day's value against the previous 28 days, measured in their usual day-to-day spread, and against the same weekday."
        ),
    }


def _level_shift(f, info, _tz):
    o = f.observed
    before, after = o["before"], o["after"]
    if abs(after) < abs(before) * 0.05:
        moved = f"fell to near zero on {day(o['onset'])}"
    elif after < before:
        moved = f"dropped from about {qty(before, info.unit)} to about {qty(after, info.unit)} on {day(o['onset'])}"
    else:
        moved = f"rose from about {qty(before, info.unit)} to about {qty(after, info.unit)} on {day(o['onset'])}"
    return {
        "headline": f"{cap(info.name)} {moved} and stayed there.",
        "saw": f"Over the four weeks before it was about {qty(before, info.unit)} a day; over the next week, about {qty(after, info.unit)}.",
        "matters": "This is unusual, not necessarily wrong. A planned stop or a change in operation would explain it. If the plant ran as before, the meter may have failed.",
        "todo": "Confirm what changed and attach the operations log. Once it's dismissed with that reason, these days stay out of the baseline.",
        "how": "The median of the following week against the median of the four weeks before.",
    }


def _generic(f, info, _tz):
    subject = info.name if info else (catalog.fixed_name(f.fixed_key) if f.fixed_key else "stream")
    return {
        "headline": f"{f.rule['name']} on the {subject} {when(f)}.",
        "saw": "",
        "matters": "",
        "todo": "Look at the readings for those days.",
        "how": "",
    }


TEMPLATES = {
    "missing_days": _missing_days,
    "metric_gap": _metric_gap,
    "out_of_range": _out_of_range,
    "stuck_zero": _stuck_zero,
    "stuck_day": _stuck_day,
    "flatline": _flatline,
    "counter_reset": _counter_reset,
    "losses_exceed": _losses_exceed,
    "loss_share": _loss_share,
    "meter_agreement": _meter_agreement,
    "fixed_coverage": _fixed_coverage,
    "bad_readings": _bad_readings,
    "incomplete_day": _incomplete_day,
    "gap": _gap,
    "out_of_order": _out_of_order,
    "duplicates": _duplicates,
    "reading_spike": _reading_spike,
    "spike": _spike,
    "level_shift": _level_shift,
}
