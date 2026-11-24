"""One run's findings: every check and detector, people's decisions, and the words.

Pure: a dataset, the intraday notes and the decisions in; worded findings,
counts and a verdict out. The Lambda handlers do the reading and writing.
"""

from . import ENGINE_VERSION, checks, detectors, text
from .catalog import TAG_MAP_VERSION
from .data import day_range
from .findings import BLOCKS, CONFIRMED, DISMISSED, INFO, LOOK, counts, verdict
from .rules import DEFAULT_RULES

SEVERITY_ORDER = {BLOCKS: 0, LOOK: 1, INFO: 2}


def dismissed_days(reviews):
    """metric → days people dismissed, kept out of detector baselines."""
    out = {}
    for review in reviews:
        if review.get("decision") == DISMISSED and review.get("metric") and review.get("start") and review.get("end"):
            out.setdefault(review["metric"], set()).update(day_range(review["start"], review["end"]))
    return out


def judge(dataset, notes=(), reviews=(), rules=DEFAULT_RULES, pairs=(), site_tz=None):
    """Worded findings, most severe first."""
    reviews = list(reviews)
    found = [
        *checks.run_all(dataset, list(notes), rules, pairs),
        *detectors.run_all(dataset, rules, dismissed_days(reviews)),
    ]
    by_id = {}
    for finding in found:
        by_id.setdefault(finding.id, finding)
    decided = {review["finding_id"]: review for review in reviews if review.get("finding_id")}
    for finding in by_id.values():
        review = decided.get(finding.id)
        if review and review.get("decision") in (CONFIRMED, DISMISSED):
            finding.status = review["decision"]
            finding.review = {key: review.get(key) for key in ("decision", "reason", "by", "at")}
        finding.text = text.word(finding, site_tz)
    return sorted(by_id.values(), key=lambda f: (f.status == DISMISSED, SEVERITY_ORDER[f.severity], f.start, f.subject, f.kind))


def summary(dataset, findings, rules=DEFAULT_RULES):
    """What the run record keeps about a run's result."""
    return {
        "verdict": verdict(findings),
        "counts": counts(findings),
        "range": {"start": dataset.start, "end": dataset.end} if dataset.start else None,
        "metrics": dataset.metrics(),
        "versions": {"engine": ENGINE_VERSION, "rules": rules.version, "rules_source": rules.source, "tag_map": TAG_MAP_VERSION},
    }
