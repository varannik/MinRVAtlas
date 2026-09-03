"""
Auto-Correction Agent
Analyses DQA violations and generates specific, technically sound correction suggestions.
Conservative by design — flags ambiguous cases for human review.
"""
import json
import logging
from typing import Any, Dict, List

from .claude_client import call_claude_json

logger = logging.getLogger("datasentinel.correction_agent")

SYSTEM = """You are a data quality correction specialist for carbon project sensor pipelines.
You review violations and suggest specific corrections — conservative and traceable.
Carbon credit data requires high integrity: when in doubt, flag for human review.
Corrections must preserve data provenance and never fabricate values.
Respond with VALID JSON ONLY."""


async def suggest_corrections(
    violations: List[Any],
    dataset_sample: List[Dict],
    project_name: str,
    domain: str = "ccs",
) -> Dict:
    """
    Generate AI correction suggestions for a set of DQA violations.
    Returns structured suggestions that map to CorrectionSuggestion records.
    """
    if not violations:
        return {"suggestions": [], "summary": "No violations to correct", "high_risk_count": 0}

    # Build violation payload (cap at 25 to manage tokens)
    v_list = []
    for v in violations[:25]:
        v_list.append({
            "violation_id": str(v.id),
            "rule_id": v.rule_id,
            "rule_name": v.rule_name,
            "dimension": v.dimension,
            "severity": v.severity,
            "field": v.affected_field,
            "affected_rows": (v.affected_rows or [])[:10],
            "record_count": v.record_count,
            "detail": v.violation_detail,
        })

    domain_context = {
        "ccs": "CO2 injection/mineralisation sensors — parameters like flow rate, injection pressure, CO2 purity",
        "biochar": "Pyrolysis sensors — parameters like temperature, residence time, feedstock moisture",
        "general": "Industrial sensor data pipeline",
    }.get(domain, "Industrial sensor data")

    user_msg = f"""Generate correction suggestions for these DQA violations.

PROJECT: {project_name}
DOMAIN: {domain_context}

DATASET SAMPLE (representative rows):
{json.dumps(dataset_sample[:5], indent=2, default=str)}

VIOLATIONS ({len(v_list)} to correct):
{json.dumps(v_list, indent=2)}

For each violation, determine the best correction strategy:
- "null_fill"       → set affected cells to null (safest for missing/invalid data)
- "forward_fill"    → propagate last known valid value
- "mean_fill"       → replace with column mean (only for isolated outliers)
- "flag_exclude"    → mark record as excluded from credit calculation
- "value_clamp"     → clamp to valid min/max range
- "no_action"       → informational only, no data change needed
- "manual_review"   → too ambiguous for automated correction

Return this exact JSON:
{{
  "suggestions": [
    {{
      "violation_id": "<UUID>",
      "field": "<field_name>",
      "correction_type": "null_fill|forward_fill|mean_fill|flag_exclude|value_clamp|no_action|manual_review",
      "suggested_value": null,
      "affected_rows": [0, 1, 2],
      "reasoning": "Why this correction is appropriate for carbon data integrity",
      "confidence": "high|medium|low",
      "requires_human_review": false,
      "credit_impact": "none|minor|moderate|significant"
    }}
  ],
  "summary": "Overall summary — how many corrections, estimated impact on readiness score",
  "high_risk_count": 0,
  "auto_approvable_count": 0
}}"""

    result = await call_claude_json(SYSTEM, user_msg, max_tokens=4000)
    if not result:
        return {
            "suggestions": [],
            "summary": "AI correction agent unavailable — configure LLM_PROVIDER and the matching API key",
            "high_risk_count": 0,
            "auto_approvable_count": 0,
        }
    return result
