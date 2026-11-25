"""The optional summary of one run, written by Claude for the project's operators.

Claude reads the run's findings as facts and the engine's own sentences, never
the raw data. It groups findings that look like one problem and says what to fix
first. It never sets the verdict: the run is finished and its verdict recorded
before Claude is asked, and a run whose summary fails is still a finished run.

Pure: facts in, a prompt and a schema out, and a check of Claude's answer that
keeps only the finding ids the run has. The call itself is in handlers.summarise.
"""

import json

# Findings Claude reads, most severe first; the rest are counted.
MAX_FINDINGS = 60
MAX_TOKENS = 1500

SEVERITY = {"blocks": "Blocks submission", "look": "Needs a look", "info": "For information"}

SYSTEM = """You summarise one data quality run for the operators of a carbon removal project.

You get the run's findings: facts the checks recorded and the sentences they wrote. You never see the raw readings.

Write for an operator who has to fix things today:
- Group findings that look like one problem: the same days on several meters, the same meter again and again, or one record that feeds several terms. Give each group a short title and say what probably caused it. Say "probably" or "may" unless the facts show the cause.
- Say which findings to fix first and why. Findings that block submission come first, then the ones that move the most CO₂.
- Use only the numbers, dates and meter names in the findings. Do not work out new numbers.
- Cite findings only by the ids given. Every finding you mention must be cited.
- The checks have already set the run's verdict; it is given to you. Do not say whether the period passes or can be submitted, and do not say a finding is harmless or can be dismissed. Only a person decides that.
- Plain British English, short sentences. No statistics words: say "unusual", not "z-score" or "outlier"."""

SCHEMA = {
    "type": "object",
    "properties": {
        "overview": {"type": "string", "description": "At most two sentences: what this run found, in plain words."},
        "groups": {
            "type": "array",
            "description": "Findings that look like one problem.",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "A few words naming the problem."},
                    "cause": {"type": "string", "description": "One or two sentences on the likely cause."},
                    "finding_ids": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["title", "cause", "finding_ids"],
                "additionalProperties": False,
            },
        },
        "first": {
            "type": "object",
            "description": "What to fix first.",
            "properties": {
                "finding_ids": {"type": "array", "items": {"type": "string"}},
                "why": {"type": "string", "description": "One or two sentences."},
            },
            "required": ["finding_ids", "why"],
            "additionalProperties": False,
        },
    },
    "required": ["overview", "groups", "first"],
    "additionalProperties": False,
}

ORDER = {"blocks": 0, "look": 1, "info": 2}


def needs_summary(findings):
    """A summary helps only when something is open to fix."""
    return any(f.get("status") != "dismissed" and f.get("severity") in ("blocks", "look") for f in findings)


def facts(verdict, findings):
    """What Claude reads about a run: the verdict and each finding's facts and sentences."""
    kept = sorted(
        (f for f in findings if f.get("status") != "dismissed"),
        key=lambda f: (ORDER.get(f.get("severity"), 3), f.get("start") or "", f.get("id") or ""),
    )
    text = lambda f, part: ((f.get("text") or {}).get(part) or "").strip()  # noqa: E731
    return {
        "verdict": verdict,
        "findings_total": len(kept),
        "findings": [
            {
                "id": f["id"],
                "severity": SEVERITY.get(f.get("severity"), f.get("severity")),
                "decision": f.get("status") or "open",
                "kind": f.get("kind"),
                "meter": f.get("metric") or f.get("fixedKey") or "",
                "journey_task": f.get("task") or "",
                "days": f"{f.get('start')} to {f.get('end')}",
                "what": text(f, "headline"),
                "saw": text(f, "saw"),
                "matters": text(f, "matters"),
                "todo": text(f, "todo"),
            }
            for f in kept[:MAX_FINDINGS]
        ],
    }


def prompt(asked):
    shown = len(asked["findings"])
    more = asked["findings_total"] - shown
    return (
        f"The checks set this run's verdict to: {asked['verdict']}.\n"
        f"Findings ({shown}{f', and {more} more not shown' if more > 0 else ''}):\n"
        f"{json.dumps(asked['findings'], ensure_ascii=False, indent=1)}"
    )


def checked(answer, known_ids):
    """Claude's answer with only the run's own finding ids; None when nothing usable is left."""
    if not isinstance(answer, dict):
        return None
    overview = str(answer.get("overview") or "").strip()
    if not overview:
        return None

    def ids(raw):
        seen = []
        for item in raw if isinstance(raw, list) else []:
            if isinstance(item, str) and item in known_ids and item not in seen:
                seen.append(item)
        return seen

    groups = []
    for group in answer.get("groups") or []:
        if not isinstance(group, dict):
            continue
        cited = ids(group.get("finding_ids"))
        title = str(group.get("title") or "").strip()
        if cited and title:
            groups.append({"title": title[:120], "cause": str(group.get("cause") or "").strip()[:600], "finding_ids": cited})
    first_raw = answer.get("first") if isinstance(answer.get("first"), dict) else {}
    first_ids = ids(first_raw.get("finding_ids"))
    first = {"finding_ids": first_ids, "why": str(first_raw.get("why") or "").strip()[:600]} if first_ids else None
    return {"overview": overview[:600], "groups": groups[:12], "first": first}
