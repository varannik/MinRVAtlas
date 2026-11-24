"""A project's monitoring data as the checks see it: one cell per metric per day.

Two sources, the same two the web's calculation reads (apps/web/src/lib/mrv/data):
  stream   <tenant>/<registry>/<project>/dt=YYYY-MM-DD/observations.csv, folded here
  seeded   the demo history in the Atlas bucket (mrv/<tenant>/<registry>/<project>.json),
           already folded by day
Day keys are UTC calendar days, YYYY-MM-DD.
"""

from dataclasses import dataclass, field
from datetime import date, timedelta


@dataclass
class Cell:
    sum: float
    mean: float
    min: float
    max: float
    last: float
    count: int
    first: float | None = None

    def value(self, how):
        return {"sum": self.sum, "mean": self.mean, "last": self.last, "max": self.max, "min": self.min}.get(how, self.mean)

    def to_json(self):
        out = {"sum": self.sum, "mean": self.mean, "min": self.min, "max": self.max, "last": self.last, "count": self.count}
        if self.first is not None:
            out["first"] = self.first
        return out

    @classmethod
    def from_json(cls, raw):
        return cls(
            sum=float(raw["sum"]),
            mean=float(raw["mean"]),
            min=float(raw["min"]),
            max=float(raw["max"]),
            last=float(raw["last"]),
            count=int(raw["count"]),
            first=float(raw["first"]) if raw.get("first") is not None else None,
        )


@dataclass
class Dataset:
    source: str
    # day → metric → cell
    days: dict = field(default_factory=dict)
    # dated values: {key, value, validFrom, validTo, source, unit}
    fixed: list = field(default_factory=list)
    start: str | None = None
    end: str | None = None

    def metrics(self):
        seen = set()
        for cells in self.days.values():
            seen.update(cells)
        return sorted(seen)

    def span(self):
        """Every day from the first to the last day with data."""
        if not self.start or not self.end:
            return []
        return day_range(self.start, self.end)


def parse_day(day):
    return date.fromisoformat(day)


def day_range(start, end):
    first, last = parse_day(start), parse_day(end)
    return [(first + timedelta(days=offset)).isoformat() for offset in range((last - first).days + 1)]


def add_days(day, count):
    return (parse_day(day) + timedelta(days=count)).isoformat()


def from_mrv_json(raw, source="seeded"):
    """The seeded history (the web's MrvDataset shape)."""
    days = {}
    for row in raw.get("days") or []:
        cells = {metric: Cell.from_json(cell) for metric, cell in (row.get("metrics") or {}).items() if cell.get("count")}
        if cells:
            days[row["day"]] = cells
    return finish(Dataset(source=source, days=days, fixed=list(raw.get("fixed") or [])))


def finish(dataset):
    """Set the range from the days with data."""
    if dataset.days:
        ordered = sorted(dataset.days)
        dataset.start, dataset.end = ordered[0], ordered[-1]
    return dataset


def fixed_from_attributes(raw):
    """Dated values from a stream project's attributes.json (valid for its period)."""
    values = (raw or {}).get("values") or {}
    out = []
    for key, value in values.items():
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        out.append(
            {
                "key": key,
                "value": number,
                "validFrom": raw.get("periodStart"),
                "validTo": raw.get("periodEnd"),
                "source": "attributes.json",
            }
        )
    return out
