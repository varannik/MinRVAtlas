"""
DQA Explanation Agent
Explains DQA run results in plain English with prioritised, actionable guidance.
"""
import json
import logging
from typing import Any, Dict, List

from .claude_client import call_claude_json

logger = logging.getLogger("datasentinel.dqa_agent")

SYSTEM = """You are a senior data quality engineer specialising in carbon project sensor pipelines.
You translate DQA results into clear, actionable guidance for project operators.
Focus on business impact: what does this mean for carbon credit issuance?
Respond with VALID JSON ONLY — no markdown, no prose outside the JSON."""


async def explain_run(
    run: Any,
    violations: List[Any],
    dataset_name: str,
    project_name: str,
) -> Dict:
    """
    Generate a plain-English explanation of a completed DQA run.
    """
    score_pct = round((run.readiness_score or 0) * 100, 1)
    dim_scores = {k: f"{round(v * 100, 1)}%" for k, v in (run.dimension_scores or {}).items()}

    # Group violations
    by_severity: Dict[str, List] = {"critical": [], "high": [], "medium": [], "low": []}
    by_dimension: Dict[str, int] = {}
    for v in violations:
        sev = v.severity
        if sev in by_severity:
            by_severity[sev].append({
                "rule": v.rule_name,
                "field": v.affected_field,
                "records": v.record_count,
                "detail": v.violation_detail,
            })
        dim = v.dimension
        by_dimension[dim] = by_dimension.get(dim, 0) + 1

    top_violations = (by_severity["critical"] + by_severity["high"])[:8]

    user_msg = f"""Explain these DQA results to a carbon project operator.

PROJECT: {project_name}
DATASET: {dataset_name}
READINESS SCORE: {score_pct}%  {"✓ GATE PASSED" if run.gate_passed else "✗ GATE FAILED"}
RULES EXECUTED: {run.rules_executed}
TOTAL VIOLATIONS: {run.total_violations}

DIMENSION SCORES:
{json.dumps(dim_scores, indent=2)}

VIOLATIONS BY SEVERITY:
- Critical: {len(by_severity["critical"])}
- High:     {len(by_severity["high"])}
- Medium:   {len(by_severity["medium"])}
- Low:      {len(by_severity["low"])}

TOP VIOLATIONS (critical + high):
{json.dumps(top_violations, indent=2)}

Return this exact JSON:
{{
  "headline": "One punchy sentence summarising the result",
  "readiness_interpretation": "What {score_pct}% means for carbon credit issuance",
  "gate_status_explanation": "Why the gate {'passed' if run.gate_passed else 'failed'} and what it means",
  "top_issues": [
    {{
      "issue": "Clear description of the problem",
      "impact": "Why this matters for credits or compliance",
      "action": "Specific remediation step",
      "priority": "immediate|24h|scheduled"
    }}
  ],
  "winning_dimensions": ["dimension names that scored well"],
  "dimensions_summary": "2 sentences on which dimensions failed and why",
  "credit_impact": "Assessment of impact on carbon credit issuance",
  "next_steps": ["Step 1", "Step 2", "Step 3"]
}}"""

    result = await call_claude_json(SYSTEM, user_msg, max_tokens=1800)
    if not result:
        return {
            "headline": f"DQA completed — {score_pct}% readiness, {'gate passed' if run.gate_passed else 'gate failed'}.",
            "readiness_interpretation": "AI explanation unavailable. Configure LLM_PROVIDER and the matching API key in your environment.",
            "gate_status_explanation": "",
            "top_issues": [],
            "winning_dimensions": [],
            "dimensions_summary": "",
            "credit_impact": "Manual review required.",
            "next_steps": [],
        }
    return result
