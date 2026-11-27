"""Detectors: patterns over time. They advise and never block on their own.

A detector compares a day with the meter's own recent history. It raises
"needs a look"; a person confirms it (then it counts like a failed check) or
dismisses it with a reason, and the dismissed days stay out of the baseline
next time. Isolation Forest across meters comes later, in a container image.
"""

from . import catalog
from .data import add_days
from .findings import LOOK, Finding, windows
from .intraday import median, robust_scale
from .rules import threshold


def daily_values(dataset, metric_id, how=None):
    """day → the metric's value for the day, as the calculation folds it (or by `how`)."""
    how = how or catalog.metric(metric_id).daily
    return {day: cells[metric_id].value(how) for day, cells in dataset.days.items() if metric_id in cells}


def _percentile(values, share):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, int(round(share * (len(ordered) - 1)))))]


def spikes(dataset, rules, excluded=None):
    """A day far from the meter's previous four weeks (Sentinel CON07, robust z).

    It must also be far from the same weekday in those weeks, so a plant that
    runs lower every Friday is not flagged every Friday, and the change must be
    material (a share of the usual level), not just many spreads on a very
    steady meter. A day's deliveries come and go with the trips, so for counted
    amounts the detector compares the day's largest single reading instead.
    """
    excluded = excluded or {}
    found = []
    for metric_id in dataset.metrics():
        measure = "largest" if catalog.metric(metric_id).kind == "event" else "day"
        values = daily_values(dataset, metric_id, "max" if measure == "largest" else None)
        skip = excluded.get(metric_id, set())
        flagged = {}
        for day in sorted(values):
            # Robust statistics shrug off a few odd days, so only days a person dismissed leave the baseline.
            usable = lambda d: d in values and d not in skip  # noqa: E731
            baseline = [values[d] for offset in range(1, rules.baseline_days + 1) if usable(d := add_days(day, -offset))]
            if len(baseline) < rules.baseline_min_days:
                continue
            center = median(baseline)
            scale = robust_scale(baseline, center)
            if scale <= 0:
                continue
            score = (values[day] - center) / scale
            if abs(score) <= rules.spike_sigma:
                continue
            if abs(values[day] - center) < rules.spike_min_share * max(abs(center), 1e-9):
                continue
            weekday = [values[d] for weeks in range(1, 6) if usable(d := add_days(day, -7 * weeks))]
            if len(weekday) >= 2 and abs(values[day] - median(weekday)) / scale <= rules.spike_sigma:
                continue
            flagged[day] = (values[day], center, _percentile(baseline, 0.1), _percentile(baseline, 0.9), score)
        for start, end, days in windows(flagged):
            worst = max(days, key=lambda d: abs(flagged[d][4]))
            value, center, low, high, score = flagged[worst]
            found.append(
                Finding(
                    kind="spike",
                    severity=LOOK,
                    advisory=True,
                    rule={
                        "id": "CON07",
                        "name": "Unusual day",
                        "origin": "Sentinel CON07, ported",
                        "version": rules.version,
                        "threshold": threshold(rules, rules.spike_sigma, "robust standard deviations"),
                    },
                    start=start,
                    end=end,
                    metric=metric_id,
                    observed={"days": len(days), "day": worst, "value": value, "score": round(score, 1), "measure": measure},
                    expected={"median": center, "low": low, "high": high, "baseline_days": rules.baseline_days},
                )
            )
    return found


def level_shifts(dataset, rules, excluded=None):
    """A meter that moved to a new level and stayed there: a plant stopping, a meter swapped (new, LS-01)."""
    excluded = excluded or {}
    found = []
    for metric_id in dataset.metrics():
        info = catalog.metric(metric_id)
        if info.kind == "event":
            continue  # deliveries come and go
        values = daily_values(dataset, metric_id)
        skip = excluded.get(metric_id, set())
        onsets = {}
        for day in sorted(values):
            before = [
                values[d]
                for offset in range(1, rules.shift_before_days + 1)
                if (d := add_days(day, -offset)) in values and d not in skip
            ]
            after = [values[d] for offset in range(rules.shift_after_days) if (d := add_days(day, offset)) in values]
            if len(before) < rules.baseline_min_days or len(after) < rules.shift_after_days - 2:
                continue
            was, now = median(before), median(after)
            base = max(abs(was), 1e-9)
            change = (now - was) / base
            same_side = all(v > was for v in after) or all(v < was for v in after)
            if abs(change) >= rules.shift_share and same_side:
                onsets[day] = (was, now, change)
        # Each run of days that start a qualifying week is a shift. A meter that wobbles as it
        # steps can start a qualifying week, miss the next day, and start one again: runs on
        # one meter that move the same way and whose weeks overlap are one shift, told from
        # the first day it showed.
        shifts = []
        for start, end, _days in windows(onsets):
            last = min(add_days(end, rules.shift_after_days - 1), dataset.end)
            falling = onsets[start][2] < 0
            if shifts and shifts[-1]["falling"] == falling and start <= shifts[-1]["end"]:
                shifts[-1]["end"] = max(shifts[-1]["end"], last)
                continue
            shifts.append({"start": start, "end": last, "falling": falling})
        for shift in shifts:
            start = shift["start"]
            was, now, change = onsets[start]
            found.append(
                Finding(
                    kind="level_shift",
                    severity=LOOK,
                    advisory=True,
                    rule={
                        "id": "LS-01",
                        "name": "Level shift",
                        "origin": "new",
                        "version": rules.version,
                        "threshold": threshold(rules, rules.shift_share, "share of the earlier level"),
                    },
                    start=start,
                    end=shift["end"],
                    metric=metric_id,
                    observed={"onset": start, "before": was, "after": now, "change": round(change, 3)},
                    expected={"before_days": rules.shift_before_days, "after_days": rules.shift_after_days},
                )
            )
    return found


def run_all(dataset, rules, excluded=None):
    return [*spikes(dataset, rules, excluded), *level_shifts(dataset, rules, excluded)]
