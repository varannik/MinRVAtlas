"""
Multi-Run AI Comparison Agent — explains what changed between two DQA runs.
Identifies improvements, regressions, new violations, and resolved issues.
"""
import json
import logging
from typing import Dict, List

from .claude_client import call_claude_json

logger = logging.getLogger("datasentinel.comparison_agent")

SYSTEM = """You are a DQA analyst specialising in carbon project data quality trends.
Compare two DQA runs and explain what changed, why it matters, and what to do next.
Be specific about field names, rule IDs, dimension scores and credit implications.
Respond with VALID JSON ONLY."""


async def compare_runs(run_a: Dict, run_b: Dict, violations_a: List, violations_b: List) -> Dict:
    """
    Compare two completed DQA runs.
    run_a = older/baseline, run_b = newer/current.
    """
    # Compute dimension deltas
    dims_a = run_a.get("dimension_scores", {})
    dims_b = run_b.get("dimension_scores", {})
    all_dims = set(dims_a) | set(dims_b)
    dim_deltas = {
        d: round(((dims_b.get(d, 0) - dims_a.get(d, 0)) * 100), 1)
        for d in all_dims
    }

    # Field-level violation diff
    fields_a = {}
    for v in violations_a:
        f = v.get("affected_field") or "unknown"
        fields_a[f] = fields_a.get(f, 0) + 1
    fields_b = {}
    for v in violations_b:
        f = v.get("affected_field") or "unknown"
        fields_b[f] = fields_b.get(f, 0) + 1

    user_msg = f"""Compare these two DQA runs for a carbon project.

RUN A (baseline / older):
  ID: {run_a.get('id','')}
  Date: {run_a.get('triggered_at','')}
  Readiness: {round((run_a.get('readiness_score',0) or 0)*100,1)}%
  Gate: {"PASSED" if run_a.get('gate_passed') else "FAILED"}
  Violations: {run_a.get('total_violations',0)}
  Dimension scores: {json.dumps({k: round(v*100,1) for k,v in dims_a.items()}, indent=2)}

RUN B (current / newer):
  ID: {run_b.get('id','')}
  Date: {run_b.get('triggered_at','')}
  Readiness: {round((run_b.get('readiness_score',0) or 0)*100,1)}%
  Gate: {"PASSED" if run_b.get('gate_passed') else "FAILED"}
  Violations: {run_b.get('total_violations',0)}
  Dimension scores: {json.dumps({k: round(v*100,1) for k,v in dims_b.items()}, indent=2)}

DIMENSION CHANGES (pp):
{json.dumps(dim_deltas, indent=2)}

VIOLATIONS BY FIELD — Run A: {json.dumps(fields_a)}
VIOLATIONS BY FIELD — Run B: {json.dumps(fields_b)}

Analyse what changed between the runs and explain the business impact.

Return this exact JSON:
{{
  "headline": "One punchy sentence: net result of the comparison",
  "readiness_change": {{"from": 81.2, "to": 89.4, "delta": 8.2, "direction": "improved|declined|stable"}},
  "gate_change": "passed→passed|failed→passed|passed→failed|failed→failed",
  "improved_dimensions": [{{"name": "Consistency", "delta_pp": 12.1, "reason": "CON-04 violations resolved after correction"}}],
  "declined_dimensions": [{{"name": "Timeliness", "delta_pp": -4.0, "reason": "3 new T-02 batch timing violations"}}],
  "new_violations": ["field: rule_id — description"],
  "resolved_violations": ["field: rule_id — description"],
  "credit_impact": "Impact on carbon credit issuance from these changes",
  "root_cause_summary": "What primarily drove the change between these two runs",
  "recommended_actions": ["Action 1", "Action 2"]
}}"""

    result = await call_claude_json(SYSTEM, user_msg, max_tokens=2000)
    if not result:
        return {
            "headline": "Comparison unavailable — configure LLM_PROVIDER and API key.",
            "readiness_change": {},
            "gate_change": "",
            "improved_dimensions": [],
            "declined_dimensions": [],
            "new_violations": [],
            "resolved_violations": [],
            "credit_impact": "",
            "root_cause_summary": "",
            "recommended_actions": [],
        }
    return result
