"""Checks: rules with a threshold. A failed check can block a submission.

Ported from Sentinel's DQA engine where Sentinel had the check (the rule id is
kept: C01, I01, …), new where MRV needs one Sentinel never had (totaliser
resets, a meter stuck at zero, lab-result coverage, losses against deliveries).
Each function takes the dataset (and the intraday notes) and returns findings
with facts only; text.py words them.
"""

from . import catalog
from .data import add_days, day_range
from .findings import BLOCKS, INFO, LOOK, Finding, windows
from .rules import threshold


def rule(rules, rule_id, name, origin, value=None, unit=""):
    out = {"id": rule_id, "name": name, "origin": origin, "version": rules.version}
    if value is not None:
        out["threshold"] = threshold(rules, value, unit)
    return out


def tonnes(dataset, metric_id, days):
    """CO₂ tonnes a mass metric carries on these days, or None when it is not a CO₂ mass."""
    info = catalog.metric(metric_id)
    if info.to_tonnes is None:
        return None
    total = 0.0
    for day in days:
        cell = dataset.days.get(day, {}).get(metric_id)
        if cell:
            total += cell.sum * info.to_tonnes
    return round(total, 3)


# ── Completeness ────────────────────────────────────────────────────────────


def missing_days(dataset, rules):
    """Whole days inside the monitoring range with no rows for any meter (Sentinel C01)."""
    empty = [day for day in dataset.span() if day not in dataset.days]
    found = []
    for start, end, days in windows(empty):
        found.append(
            Finding(
                kind="missing_days",
                severity=BLOCKS if len(days) >= rules.missing_days_block else LOOK,
                rule=rule(rules, "C01", "Missing days", "Sentinel C01, ported", rules.missing_days_block, "days in a row block"),
                start=start,
                end=end,
                observed={"days": len(days), "before": add_days(start, -1), "after": add_days(end, 1)},
                expected={"what": "at least one reading every day"},
            )
        )
    return found


def metric_gaps(dataset, rules):
    """A meter that reports every day is missing on days the rest of the stream reported (Sentinel C03)."""
    found = []
    for metric_id in dataset.metrics():
        info = catalog.metric(metric_id)
        if info.kind == "event":
            continue  # no delivery on a day is normal
        present = [day for day, cells in dataset.days.items() if metric_id in cells]
        first, last = min(present), max(present)
        absent = [day for day in day_range(first, last) if day in dataset.days and metric_id not in dataset.days[day]]
        for start, end, days in windows(absent):
            found.append(
                Finding(
                    kind="metric_gap",
                    severity=BLOCKS if len(days) >= rules.missing_days_block else LOOK,
                    rule=rule(rules, "C03", "Meter missing", "Sentinel C03, ported", rules.missing_days_block, "days in a row block"),
                    start=start,
                    end=end,
                    metric=metric_id,
                    observed={"days": len(days)},
                    expected={"what": "a reading every day the stream reports"},
                )
            )
    return found


# ── Validity ────────────────────────────────────────────────────────────────


def out_of_range(dataset, rules):
    """Readings a meter cannot physically give (Sentinel I02)."""
    found = []
    for metric_id in dataset.metrics():
        info = catalog.metric(metric_id)
        if info.low is None and info.high is None:
            continue
        bad = {}
        for day, cells in dataset.days.items():
            cell = cells.get(metric_id)
            if not cell:
                continue
            if info.low is not None and cell.min < info.low:
                bad[day] = cell.min
            elif info.high is not None and cell.max > info.high:
                bad[day] = cell.max
        for start, end, days in windows(bad):
            worst = max((bad[day] for day in days), key=lambda value: abs(value))
            found.append(
                Finding(
                    kind="out_of_range",
                    severity=BLOCKS,
                    rule=rule(rules, "I02", "Out of range", "Sentinel I02, ported"),
                    start=start,
                    end=end,
                    metric=metric_id,
                    observed={"days": len(days), "worst": worst},
                    expected={"low": info.low, "high": info.high, "unit": info.unit},
                    impact=_impact(dataset, metric_id, days),
                )
            )
    return found


def stuck(dataset, rules):
    """A meter that should move reads exactly zero (new, ZR-01), or exactly one value all day (Sentinel I01)."""
    found = []
    for metric_id in dataset.metrics():
        info = catalog.metric(metric_id)
        if info.kind in ("event", "counter"):
            continue
        present = sorted(day for day, cells in dataset.days.items() if metric_id in cells)
        zero = [d for d in present if dataset.days[d][metric_id].max == 0 and dataset.days[d][metric_id].min == 0]
        if not info.zero_ok:
            for start, end, days in windows(zero):
                if len(days) < rules.zero_days:
                    continue
                found.append(
                    Finding(
                        kind="stuck_zero",
                        severity=BLOCKS,
                        rule=rule(rules, "ZR-01", "Stuck at zero", "new", rules.zero_days, "days in a row"),
                        start=start,
                        end=end,
                        metric=metric_id,
                        observed={"days": len(days), "whole_range": len(days) == len(present)},
                        expected={"what": "a meter that reads above zero when the plant runs"},
                    )
                )
        if info.kind != "rate":
            continue
        flat = [
            d
            for d in present
            if dataset.days[d][metric_id].count >= rules.flatline_min_readings
            and dataset.days[d][metric_id].min == dataset.days[d][metric_id].max
            and dataset.days[d][metric_id].max != 0
        ]
        for start, end, days in windows(flat):
            found.append(
                Finding(
                    kind="stuck_day",
                    severity=BLOCKS,
                    rule=rule(rules, "I01", "Flatline", "Sentinel I01, ported"),
                    start=start,
                    end=end,
                    metric=metric_id,
                    observed={"days": len(days), "value": dataset.days[start][metric_id].max, "readings": dataset.days[start][metric_id].count},
                    expected={"what": "readings that vary as the plant runs"},
                )
            )
    return found


# ── Balance ─────────────────────────────────────────────────────────────────


def counter_resets(dataset, notes, rules):
    """A totaliser fell between two readings: it was reset or replaced (new, TR-01)."""
    found = []
    for note in notes:
        if note["kind"] == "counter_reset":
            found.append(_reset(dataset, rules, note["metric"], note["day"], note.get("at"), note["observed"]))
    # Across midnight: a day that starts below where the day before ended.
    for metric_id in dataset.metrics():
        if catalog.metric(metric_id).kind != "counter":
            continue
        days = sorted(day for day, cells in dataset.days.items() if metric_id in cells)
        for before, after in zip(days, days[1:]):
            first = dataset.days[after][metric_id].first
            last = dataset.days[before][metric_id].last
            if first is not None and first < last:
                found.append(_reset(dataset, rules, metric_id, after, None, {"before": last, "after": first}))
    return found


def _reset(dataset, rules, metric_id, day, at, observed):
    info = catalog.metric(metric_id)
    # What counting from the reset only would leave out: the rise before it that day.
    cell = dataset.days.get(day, {}).get(metric_id)
    missed = None
    if cell and cell.first is not None and observed["before"] >= cell.first:
        missed = observed["before"] - cell.first
    impact = None
    if missed is not None and info.to_tonnes is not None:
        impact = {"t_co2_missed": round(missed * info.to_tonnes, 3)}
    return Finding(
        kind="counter_reset",
        severity=BLOCKS,
        rule=rule(rules, "TR-01", "Totaliser reset", "new"),
        start=day,
        end=day,
        metric=metric_id,
        at=at,
        observed={**observed, "rise_before_reset": missed},
        expected={"what": "a cumulative counter never falls"},
        impact=impact,
    )


def losses(dataset, rules):
    """Transit and venting losses against the CO₂ delivered the same day (new, BL-01 and BL-02)."""
    delivered_id, loss_ids = "LCO2_DELIVERED_t", ("CO2_TRANSIT_LOSS_kg", "CO2_VENTED_SITE_kg")
    over, high = {}, {}
    for day, cells in dataset.days.items():
        delivered = cells.get(delivered_id)
        if not delivered or delivered.sum <= 0:
            continue
        lost = sum(cells[m].sum * catalog.metric(m).to_tonnes for m in loss_ids if m in cells)
        if lost > delivered.sum:
            over[day] = (lost, delivered.sum)
        elif lost / delivered.sum > rules.loss_share_look:
            high[day] = (lost, delivered.sum)
    found = []
    for kind, severity, rule_id, name, picked, value in (
        ("losses_exceed", BLOCKS, "BL-01", "Losses above deliveries", over, None),
        ("loss_share", LOOK, "BL-02", "High loss share", high, rules.loss_share_look),
    ):
        for start, end, days in windows(picked):
            lost = sum(picked[d][0] for d in days)
            delivered = sum(picked[d][1] for d in days)
            found.append(
                Finding(
                    kind=kind,
                    severity=severity,
                    rule=rule(rules, rule_id, name, "new", value, "share of delivered" if value is not None else ""),
                    start=start,
                    end=end,
                    metric=delivered_id,
                    observed={"days": len(days), "lost_t": round(lost, 3), "delivered_t": round(delivered, 3), "share": round(lost / delivered, 4)},
                    expected={"what": "losses well below the CO₂ delivered"},
                    impact={"t_co2": round(lost, 3)},
                )
            )
    return found


def agreement(dataset, rules, pairs=()):
    """Two meters on the same quantity disagree (Sentinel CON01). Pairs come from the project's tag map."""
    found = []
    for first_id, second_id in pairs:
        first_info = catalog.metric(first_id)
        off = {}
        for day, cells in dataset.days.items():
            a, b = cells.get(first_id), cells.get(second_id)
            if not a or not b:
                continue
            va, vb = a.value(first_info.daily), b.value(first_info.daily)
            larger = max(abs(va), abs(vb))
            if larger > 0 and abs(va - vb) / larger > rules.agreement_share:
                off[day] = (va, vb)
        for start, end, days in windows(off):
            va = sum(off[d][0] for d in days)
            vb = sum(off[d][1] for d in days)
            found.append(
                Finding(
                    kind="meter_agreement",
                    severity=BLOCKS,
                    rule=rule(rules, "CON01", "Meters disagree", "Sentinel CON01, ported", rules.agreement_share, "share of the larger"),
                    start=start,
                    end=end,
                    metric=first_id,
                    observed={"days": len(days), "first": va, "second": vb, "other_metric": second_id, "share": round(abs(va - vb) / max(abs(va), abs(vb)), 4)},
                    expected={"what": "both meters within the tolerance"},
                )
            )
    return found


# ── Dated values ────────────────────────────────────────────────────────────


def fixed_coverage(dataset, rules):
    """Days of monitoring no dated value of a key covers: no lab result, no factor (new, LC-01)."""
    found = []
    if not dataset.start:
        return found
    by_key = {}
    for row in dataset.fixed:
        by_key.setdefault(row["key"], []).append(row)
    span = dataset.span()
    for key, rows in sorted(by_key.items()):
        covered = set()
        for row in rows:
            start = max(row.get("validFrom") or dataset.start, dataset.start)
            end = min(row.get("validTo") or dataset.end, dataset.end)
            if start <= end:
                covered.update(day_range(start, end))
        uncovered = [day for day in span if day not in covered]
        latest = max((row.get("validTo") or "" for row in rows), default="")
        for start, end, days in windows(uncovered):
            found.append(
                Finding(
                    kind="fixed_coverage",
                    severity=BLOCKS,
                    rule=rule(rules, "LC-01", "Dated value coverage", "new"),
                    start=start,
                    end=end,
                    fixed_key=key,
                    observed={"days": len(days), "values": len(rows), "latest_valid_to": latest or None},
                    expected={"what": "a dated value covering every monitored day"},
                )
            )
    return found


# ── Intraday notes ──────────────────────────────────────────────────────────

# kind → (severity, rule id, name, origin)
NOTE_RULES = {
    "bad_readings": (LOOK, "C02", "Empty readings", "Sentinel C02, ported"),
    "incomplete_day": (LOOK, "C04", "Incomplete day", "Sentinel C04, ported"),
    "gap": (LOOK, "C01", "Gap in the day", "Sentinel C01, ported"),
    "flatline": (LOOK, "I01", "Flatline", "Sentinel I01, ported"),
    "out_of_order": (INFO, "I03", "Out of order", "Sentinel I03, ported"),
    "reading_spike": (LOOK, "I04", "Spike", "Sentinel I04, ported"),
    "duplicates": (LOOK, "U01", "Duplicate readings", "Sentinel U01, ported"),
}


def from_notes(dataset, notes, rules):
    """Join the same note on consecutive days into one finding."""
    last_day = dataset.end
    grouped = {}
    for note in notes:
        kind = note["kind"]
        if kind not in NOTE_RULES:
            continue
        # The newest day is usually still being written; a short day there is not a fault.
        if kind in ("incomplete_day", "gap") and note["day"] == last_day:
            continue
        grouped.setdefault((kind, note["metric"]), {})[note["day"]] = note
    found = []
    for (kind, metric_id), by_day in sorted(grouped.items()):
        if kind == "gap":
            # A gap on a day already reported as incomplete says the same thing twice.
            short = grouped.get(("incomplete_day", metric_id), {})
            by_day = {day: note for day, note in by_day.items() if day not in short}
        severity, rule_id, name, origin = NOTE_RULES[kind]
        if kind == "duplicates" and catalog.metric(metric_id).kind in ("event", "total"):
            severity = BLOCKS  # a counted amount read twice is counted twice
        for start, end, days in windows(by_day):
            first = by_day[days[0]]
            observed = _merge_observed([by_day[day]["observed"] for day in days])
            observed["days"] = len(days)
            found.append(
                Finding(
                    kind=kind,
                    severity=severity,
                    rule=rule(rules, rule_id, name, origin, *_note_threshold(kind, rules)),
                    start=start,
                    end=end,
                    metric=metric_id,
                    at=first.get("at"),
                    observed=observed,
                    expected=_note_expected(kind, metric_id),
                    impact=_impact(dataset, metric_id, days) if kind in ("duplicates", "reading_spike") else None,
                )
            )
    return found


def _merge_observed(observed):
    """Sum counts across days; keep the first day's other facts."""
    merged = dict(observed[0])
    for extra in observed[1:]:
        for key in ("bad", "estimated", "rows", "readings"):
            if key in extra and isinstance(extra[key], (int, float)) and key in merged:
                merged[key] += extra[key]
        if "minutes" in extra and extra["minutes"] > merged.get("minutes", 0):
            merged.update({k: extra[k] for k in ("from", "to", "minutes", "value") if k in extra})
    return merged


def _note_threshold(kind, rules):
    return {
        "incomplete_day": (rules.min_day_share, "share of expected readings"),
        "gap": (rules.gap_intervals, "reading intervals"),
        "flatline": (rules.flatline_minutes, "minutes"),
        "reading_spike": (rules.reading_spike_sigma, "robust standard deviations"),
    }.get(kind, (None, ""))


def _note_expected(kind, metric_id):
    info = catalog.metric(metric_id)
    if kind in ("incomplete_day", "gap") and info.cadence_minutes:
        return {"cadence_minutes": info.cadence_minutes, "per_day": int(round(24 * 60 / info.cadence_minutes))}
    return {}


def _impact(dataset, metric_id, days):
    t = tonnes(dataset, metric_id, days)
    return {"t_co2": t} if t is not None else None


def run_all(dataset, notes, rules, pairs=()):
    return [
        *missing_days(dataset, rules),
        *metric_gaps(dataset, rules),
        *out_of_range(dataset, rules),
        *stuck(dataset, rules),
        *counter_resets(dataset, notes, rules),
        *losses(dataset, rules),
        *agreement(dataset, rules, pairs),
        *fixed_coverage(dataset, rules),
        *from_notes(dataset, notes, rules),
    ]
