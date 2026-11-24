"""Thresholds the checks use, versioned with the engine.

Every number here is a built-in default. A finding records the rule id, this
version and where its threshold came from, so a run can be replayed and an
auditor can see which thresholds nobody has approved yet. Approved values (the
same flow as registry values) replace these once a platform admin approves them.
"""

from dataclasses import dataclass, replace

RULES_VERSION = 1


@dataclass(frozen=True)
class Rules:
    version: int = RULES_VERSION
    source: str = "built-in"

    # Whole days with no rows at all: a look from 1 day, a block from this many in a row.
    missing_days_block: int = 3
    # A continuous meter needs at least this share of its expected readings in a day.
    min_day_share: float = 0.9
    # A gap inside a day longer than this many reading intervals is reported.
    gap_intervals: int = 15
    # A meter repeating exactly the same reading for this long is stuck.
    flatline_minutes: int = 120
    flatline_min_readings: int = 10
    # Days in a row a meter that should move reads exactly zero.
    zero_days: int = 3
    # One reading this many robust standard deviations from the day's median.
    reading_spike_sigma: float = 8.0
    # Losses (transit and venting) above this share of the CO₂ delivered on a day.
    loss_share_look: float = 0.05
    # Two meters on the same quantity may differ by this share of the larger.
    agreement_share: float = 0.02
    # Detectors (advise only).
    spike_sigma: float = 5.0
    # A flagged day must also differ from the usual level by this share of it.
    spike_min_share: float = 0.1
    baseline_days: int = 28
    baseline_min_days: int = 14
    shift_before_days: int = 28
    shift_after_days: int = 7
    shift_share: float = 0.5


DEFAULT_RULES = Rules()


def threshold(rules, value, unit=""):
    """The facts a finding records about the threshold it used."""
    return {"value": value, "unit": unit, "source": rules.source, "rules_version": rules.version}


def with_overrides(overrides):
    """Rules with approved values in place of the built-in ones (unknown names are ignored)."""
    known = {name: value for name, value in (overrides or {}).items() if name in Rules.__dataclass_fields__}
    if not known:
        return DEFAULT_RULES
    return replace(DEFAULT_RULES, source="approved", **known)
