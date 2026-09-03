"""
AI Rule Gap Detector — analyses dataset schema against active rules and identifies coverage gaps.
Suggests specific new rules for uncovered fields and common patterns.
"""
import json
import logging
from typing import Any, Dict, List

from .claude_client import call_claude_json

logger = logging.getLogger("datasentinel.rule_gap_agent")

SYSTEM = """You are a DQA rule engineering expert for carbon project sensor pipelines.
You review dataset schemas and existing rule coverage to find gaps and suggest new rules.
Focus on: completeness checks, range bounds, rate-of-change, cross-sensor consistency.
Be specific — name the exact fields and the exact rule types needed.
Respond with VALID JSON ONLY."""


def _safe_str(val: Any) -> str:
    """Return val if it's a non-empty string, else empty string."""
    return val if isinstance(val, str) and val else ""


def _build_prompt(
    project_name: str,
    domain_context: str,
    columns: List[Any],
    rules_for_prompt: List[Dict],
    uncovered_names: List[str],
) -> str:
    """
    Build the LLM prompt using plain string concatenation — no f-string
    dict literals with {{ }} which create unhashable set-of-dict in Python.
    """
    cols_json   = json.dumps(columns[:40], indent=2)
    rules_json  = json.dumps(rules_for_prompt, indent=2)
    uncov_json  = json.dumps(uncovered_names)

    return (
        "Analyse rule coverage gaps for this carbon project dataset.\n\n"
        "PROJECT: " + project_name + "\n"
        "DOMAIN: "  + domain_context + "\n\n"
        "DATASET COLUMNS (" + str(len(columns)) + " total):\n"
        + cols_json + "\n\n"
        "ACTIVE RULES (" + str(len(rules_for_prompt)) + "):\n"
        + rules_json + "\n\n"
        "FIELDS WITH NO RULE COVERAGE: " + uncov_json + "\n\n"
        "For each uncovered field and any other gaps you identify, "
        "suggest specific new DQA rules.\n\n"
        'Respond with exactly this JSON:\n'
        '{\n'
        '  "gaps_found": [\n'
        '    {\n'
        '      "field": "FIELD_NAME",\n'
        '      "gap_type": "no_null_check|no_range_bound|no_rate_check|no_cross_sensor",\n'
        '      "suggested_rule": {\n'
        '        "rule_id": "C-05",\n'
        '        "rule_name": "descriptive_name",\n'
        '        "dimension": "Completeness|Integrity|Consistency|Accuracy",\n'
        '        "severity": "critical|high|medium|low",\n'
        '        "description": "What it checks",\n'
        '        "parameters": {"key": "value"}\n'
        '      },\n'
        '      "justification": "Why this matters for carbon credit integrity"\n'
        '    }\n'
        '  ],\n'
        '  "coverage_score": 72,\n'
        '  "summary": "2-sentence overview of coverage quality and most critical gaps",\n'
        '  "priority_action": "The single most important rule to add first"\n'
        '}'
    )


async def detect_gaps(
    columns: List[Dict],
    active_rules: List[Dict],
    domain: str = "ccs",
    project_name: str = "",
) -> Dict:
    """
    Identify uncovered fields and suggest new DQA rules.

    columns:      list of {name, dtype, null_pct, min, max, mean}
    active_rules: list of {rule_id, rule_name, dimension, parameters}
    """
    # ── 1. Normalise inputs ───────────────────────────────────────────────────
    safe_columns: List[Dict] = [c for c in (columns or []) if isinstance(c, dict)]

    # ── 2. Build covered_fields set (strings only — dicts are unhashable) ─────
    covered_fields: set = set()
    for r in (active_rules or []):
        if not isinstance(r, dict):
            continue
        params = r.get("parameters") or {}
        if not isinstance(params, dict):
            params = {}
        for key in ["tag", "tag_a", "tag_b", "flowrate_col", "totaliser_col",
                    "rate_tag", "pressure_tag"]:
            val = params.get(key)
            if isinstance(val, str) and val:
                covered_fields.add(val)
        for t in (params.get("mandatory_tags") or []):
            if isinstance(t, str) and t:
                covered_fields.add(t)

    # ── 3. Find uncovered numeric columns ─────────────────────────────────────
    numeric_cols = [
        c for c in safe_columns
        if isinstance(c.get("dtype"), str) and c["dtype"].startswith(("float", "int"))
    ]
    uncovered = [
        c for c in numeric_cols
        if isinstance(c.get("name"), str) and c["name"] not in covered_fields
    ]
    uncovered_names = [c["name"] for c in uncovered]

    # ── 4. Build slim rule list for prompt ───────────────────────────────────
    # Exclude full parameters dict — it bloats the prompt enormously and
    # causes 400/413 errors on Azure OpenAI.  rule_id + name + dimension
    # is sufficient for gap analysis.
    rules_for_prompt: List[Dict] = []
    for r in (active_rules or [])[:20]:
        if not isinstance(r, dict):
            continue
        rules_for_prompt.append({
            "rule_id":   _safe_str(r.get("rule_id")),
            "rule_name": _safe_str(r.get("rule_name")),
            "dimension": _safe_str(r.get("dimension")),
            "severity":  _safe_str(r.get("severity")),
        })

    # ── 5. Sanitise columns for JSON serialisation (cap at 20) ───────────────
    # Keep only name + dtype to minimise prompt size.
    safe_cols_for_prompt: List[Any] = []
    for c in safe_columns[:20]:
        safe_cols_for_prompt.append({
            "name":  _safe_str(c.get("name")),
            "dtype": _safe_str(c.get("dtype")),
        })

    # ── 6. Domain context ─────────────────────────────────────────────────────
    domain_context = {
        "ccs":     "CO2 injection/mineralisation — flow rate, pressure, CO2 purity, water flow, temperature",
        "biochar": "Pyrolysis — temperature, residence time, feedstock moisture, output weight",
        "general": "Industrial sensor pipeline",
    }.get(domain, "Industrial sensor pipeline")

    # ── 7. Build and send prompt ──────────────────────────────────────────────
    user_msg = _build_prompt(
        project_name    = project_name,
        domain_context  = domain_context,
        columns         = safe_cols_for_prompt,
        rules_for_prompt= rules_for_prompt,
        uncovered_names = uncovered_names,
    )

    # 25 s per-attempt timeout — fits within the endpoint's 40 s hard cap
    # with room for one retry + backoff (25 + 2 + 25 = 52 s > 40 s outer cap
    # which will cancel via asyncio.wait_for before the third attempt)
    result = await call_claude_json(SYSTEM, user_msg, max_tokens=1500, timeout=25)
    if not result:
        # Surface the actual LLM error so the user can see what went wrong
        from app.engines.ai.claude_client import _last_call_error
        detail = _last_call_error or "LLM returned no result"
        logger.warning("detect_gaps: LLM call failed — %s", detail)
        return {
            "gaps_found":      [],
            "coverage_score":  0,
            "summary":         f"AI gap detection failed: {detail}. Check System Status → LLM card for connection details.",
            "priority_action": "",
        }
    return result
