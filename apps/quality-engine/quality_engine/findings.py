"""Findings: what a check found, as facts, before and after it is worded.

A finding's id is a fingerprint of what it is about (kind, metric or dated
value, first and last day), so the same problem in the same data keeps its id
from run to run, and a person's decision on it (confirm, dismiss) carries over.
"""

import hashlib
from dataclasses import dataclass, field

from .data import add_days

# What a finding may do to a submission.
BLOCKS = "blocks"  # a check with a threshold failed: the period cannot be submitted
LOOK = "look"  # a person confirms or dismisses it
INFO = "info"  # worth knowing, no action needed
SEVERITIES = (BLOCKS, LOOK, INFO)

# A person's decision.
OPEN, CONFIRMED, DISMISSED = "open", "confirmed", "dismissed"


@dataclass
class Finding:
    kind: str
    severity: str
    rule: dict
    start: str
    end: str
    metric: str | None = None
    fixed_key: str | None = None
    # A detector advises only: it never blocks unless a person confirms it.
    advisory: bool = False
    at: str | None = None
    observed: dict = field(default_factory=dict)
    expected: dict = field(default_factory=dict)
    impact: dict | None = None
    status: str = OPEN
    review: dict | None = None
    text: dict | None = None

    @property
    def subject(self):
        return self.metric or self.fixed_key or "stream"

    @property
    def id(self):
        raw = f"{self.kind}|{self.subject}|{self.start}|{self.end}".encode()
        return "F-" + hashlib.sha256(raw).hexdigest()[:16]

    @property
    def days(self):
        from .data import day_range

        return len(day_range(self.start, self.end))

    def blocking(self):
        """Counts against the verdict: an open or confirmed block, or a confirmed detector finding."""
        if self.status == DISMISSED:
            return False
        if self.advisory:
            return self.status == CONFIRMED
        return self.severity == BLOCKS

    def to_json(self):
        return {
            "id": self.id,
            "kind": self.kind,
            "severity": self.severity,
            "advisory": self.advisory,
            "metric": self.metric,
            "fixedKey": self.fixed_key,
            "start": self.start,
            "end": self.end,
            "at": self.at,
            "observed": self.observed,
            "expected": self.expected,
            "impact": self.impact,
            "rule": self.rule,
            "status": self.status,
            "review": self.review,
            "text": self.text,
            "blocking": self.blocking(),
        }


def windows(days):
    """Consecutive runs in a sorted list of day keys: [(first, last, [days])]."""
    runs = []
    for day in sorted(days):
        if runs and add_days(runs[-1][1], 1) == day:
            runs[-1] = (runs[-1][0], day, runs[-1][2] + [day])
        else:
            runs.append((day, day, [day]))
    return runs


def verdict(findings, start=None, end=None):
    """blocked, needs_look or clear for the findings that touch [start, end] (all when not given)."""
    touching = [f for f in findings if (start is None or f.end >= start) and (end is None or f.start <= end)]
    if any(f.blocking() for f in touching):
        return "blocked"
    if any(f.status == OPEN and f.severity == LOOK for f in touching) or any(
        f.status == OPEN and f.advisory for f in touching
    ):
        return "needs_look"
    return "clear"


def counts(findings):
    out = {BLOCKS: 0, LOOK: 0, INFO: 0, DISMISSED: 0}
    for finding in findings:
        if finding.status == DISMISSED:
            out[DISMISSED] += 1
        else:
            out[finding.severity] += 1
    return out
