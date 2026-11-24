"""One day of raw readings: fold to daily cells, and note what is wrong inside the day.

Reads the stream's long CSV (timestamp_utc, metric, value, unit, quality) the
same way the web folds it (apps/web/src/lib/mrv/data/stream.ts): readings with
quality "missing" or a value that is not a number are left out of the cell.

Notes are facts, not findings. The judge step joins the same note on
consecutive days into one finding and words it.
"""

import csv
import io
import math
from datetime import datetime, timezone

from . import catalog
from .data import Cell
from .rules import DEFAULT_RULES


def parse_time(text):
    """Seconds since the epoch for an ISO timestamp, UTC when no zone is given; None if unreadable."""
    value = (text or "").strip().replace(" ", "T", 1)
    if value.endswith("Z") or value.endswith("z"):
        value = value[:-1] + "+00:00"
    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.timestamp()


def iso(seconds):
    return datetime.fromtimestamp(seconds, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def read_rows(text):
    """(timestamp text, metric, value text, quality) for each row, in file order."""
    reader = csv.reader(io.StringIO(text))
    header = next(reader, None)
    if not header:
        return []
    names = [name.strip().lower() for name in header]

    def column(name):
        return names.index(name) if name in names else -1

    ts, metric, value, quality = column("timestamp_utc"), column("metric"), column("value"), column("quality")
    if ts < 0 or metric < 0 or value < 0:
        return []
    rows = []
    for row in reader:
        if len(row) <= max(ts, metric, value):
            continue
        stamp, name = row[ts].strip(), row[metric].strip()
        if not stamp or not name:
            continue
        flag = row[quality].strip().lower() if 0 <= quality < len(row) else "ok"
        rows.append((stamp, name, row[value].strip(), flag or "ok"))
    return rows


def median(values):
    ordered = sorted(values)
    middle = len(ordered) // 2
    if not ordered:
        return math.nan
    return ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2


def robust_scale(values, center):
    """Robust standard deviation: MAD / 0.6745, or IQR / 1.349 when most values are equal."""
    mad = median([abs(value - center) for value in values])
    if mad > 1e-12:
        return mad / 0.6745
    ordered = sorted(values)
    q1 = ordered[len(ordered) // 4]
    q3 = ordered[(3 * len(ordered)) // 4]
    return (q3 - q1) / 1.349 if q3 - q1 > 1e-12 else 0.0


def fold_day(day, text, rules=DEFAULT_RULES):
    """Cells per metric and notes for one day's file."""
    by_metric = {}
    for stamp, name, raw, flag in read_rows(text):
        by_metric.setdefault(name, []).append((stamp, raw, flag))

    cells = {}
    notes = []
    for name, rows in by_metric.items():
        info = catalog.metric(name)
        readings = []  # (seconds or None, value)
        bad = estimated = 0
        for stamp, raw, flag in rows:
            if flag == "estimated":
                estimated += 1
            try:
                value = float(raw)
            except ValueError:
                value = math.nan
            if flag == "missing" or not math.isfinite(value):
                bad += 1
                continue
            readings.append((parse_time(stamp), value))

        if bad:
            notes.append(
                {"kind": "bad_readings", "metric": name, "day": day, "observed": {"bad": bad, "estimated": estimated, "rows": len(rows)}}
            )
        if not readings:
            continue

        values = [value for _, value in readings]
        total = sum(values)
        cells[name] = Cell(
            sum=total,
            mean=total / len(values),
            min=min(values),
            max=max(values),
            last=values[-1],
            count=len(values),
            first=values[0],
        ).to_json()
        notes.extend(_sequence_notes(day, name, readings))
        if info.continuous:
            notes.extend(_continuous_notes(day, info, readings, rules))
        if info.kind == "counter":
            in_time = sorted(readings, key=lambda reading: (reading[0] is None, reading[0] or 0))
            notes.extend(_reset_notes(day, name, in_time))
    return cells, notes


def _sequence_notes(day, name, readings):
    """Readings out of time order, and the same timestamp twice (Sentinel I03, U01)."""
    stamps = [seconds for seconds, _ in readings if seconds is not None]
    backwards = sum(1 for before, after in zip(stamps, stamps[1:]) if after < before)
    seen, repeated = set(), 0
    for stamp in stamps:
        if stamp in seen:
            repeated += 1
        seen.add(stamp)
    notes = []
    if backwards:
        notes.append({"kind": "out_of_order", "metric": name, "day": day, "observed": {"readings": backwards}})
    if repeated:
        notes.append({"kind": "duplicates", "metric": name, "day": day, "observed": {"readings": repeated}})
    return notes


def _continuous_notes(day, info, readings, rules):
    """A meter's day: too few readings, long gaps, stuck values and single wild readings."""
    notes = []
    timed = sorted((seconds, value) for seconds, value in readings if seconds is not None)
    if info.cadence_minutes:
        interval = info.cadence_minutes * 60
        expected = int(round(24 * 60 / info.cadence_minutes))
        distinct = len({seconds for seconds, _ in timed})
        if distinct < expected * rules.min_day_share:
            notes.append(
                {"kind": "incomplete_day", "metric": info.id, "day": day, "observed": {"readings": distinct, "expected": expected}}
            )
        longest = max(
            ((after[0] - before[0], before[0], after[0]) for before, after in zip(timed, timed[1:])),
            default=None,
        )
        if longest and longest[0] > rules.gap_intervals * interval:
            notes.append(
                {
                    "kind": "gap",
                    "metric": info.id,
                    "day": day,
                    "at": iso(longest[1]),
                    "observed": {"from": iso(longest[1]), "to": iso(longest[2]), "minutes": round(longest[0] / 60)},
                }
            )

    # Stuck: the longest run of exactly the same reading (Sentinel I01).
    best = None
    run_start = 0
    for index in range(1, len(timed) + 1):
        if index < len(timed) and timed[index][1] == timed[run_start][1]:
            continue
        length = index - run_start
        if length >= rules.flatline_min_readings:
            minutes = (timed[index - 1][0] - timed[run_start][0]) / 60
            if minutes >= rules.flatline_minutes and (best is None or minutes > best[0]):
                best = (minutes, timed[run_start][0], timed[index - 1][0], timed[run_start][1], length)
        run_start = index
    if best and not (best[3] == 0 and info.zero_ok):
        notes.append(
            {
                "kind": "flatline",
                "metric": info.id,
                "day": day,
                "at": iso(best[1]),
                "observed": {"from": iso(best[1]), "to": iso(best[2]), "value": best[3], "readings": best[4], "minutes": round(best[0])},
            }
        )

    # One wild reading against the rest of the day (Sentinel I04, MAD based).
    values = [value for _, value in readings]
    if len(values) >= 20:
        center = median(values)
        scale = robust_scale(values, center)
        if scale > 0:
            wild = [(abs(value - center) / scale, seconds, value) for seconds, value in readings if abs(value - center) / scale > rules.reading_spike_sigma]
            if wild:
                worst = max(wild, key=lambda item: item[0])
                notes.append(
                    {
                        "kind": "reading_spike",
                        "metric": info.id,
                        "day": day,
                        "at": iso(worst[1]) if worst[1] is not None else None,
                        "observed": {"readings": len(wild), "worst": worst[2], "median": center, "spread": scale, "score": round(worst[0], 1)},
                    }
                )
    return notes


def _reset_notes(day, name, readings):
    """A totaliser that fell: it was reset or replaced (new check, TR-01)."""
    notes = []
    previous = None
    for seconds, value in readings:
        if previous is not None and value < previous[1] - max(1e-9, abs(previous[1]) * 1e-6):
            notes.append(
                {
                    "kind": "counter_reset",
                    "metric": name,
                    "day": day,
                    "at": iso(seconds) if seconds is not None else None,
                    "observed": {"before": previous[1], "after": value},
                }
            )
        previous = (seconds, value)
    return notes
