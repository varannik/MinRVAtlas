"""
Violation Clustering Agent — groups related violations by common root cause.
Reduces operator cognitive load from individual violations to systemic issues.
"""
import json
import logging
from typing import Any, Dict, List

from .claude_client import call_claude_json

logger = logging.getLogger("datasentinel.clustering_agent")

SYSTEM = """You are a root cause analyst for carbon project sensor pipelines.
Group violations that share a common underlying cause — sensor failure, network outage, calibration drift,
operational change, or data pipeline issue.
Be specific about timing, affected fields, and likely mechanisms.
Respond with VALID JSON ONLY."""


async def cluster_violations(violations: List[Any], dataset_name: str = "") -> Dict:
    """
    Identify clusters of violations with shared root causes.
    Returns groups with a root cause hypothesis and suggested single action per group.
    """
    if not violations:
        return {"clusters": [], "singleton_count": 0, "summary": "No violations to cluster."}

    viol_list = [
        {
            "id": str(v.id) if hasattr(v, 'id') else str(v.get("id", "")),
            "rule_id": v.rule_id if hasattr(v, 'rule_id') else v.get("rule_id"),
            "rule_name": v.rule_name if hasattr(v, 'rule_name') else v.get("rule_name"),
            "dimension": v.dimension if hasattr(v, 'dimension') else v.get("dimension"),
            "severity": v.severity if hasattr(v, 'severity') else v.get("severity"),
            "field": v.affected_field if hasattr(v, 'affected_field') else v.get("affected_field"),
            "record_count": v.record_count if hasattr(v, 'record_count') else v.get("record_count", 0),
            "detail": (v.violation_detail if hasattr(v, 'violation_detail') else v.get("violation_detail")) or {},
        }
        for v in violations[:30]
    ]

    user_msg = f"""Cluster these DQA violations by root cause.

DATASET: {dataset_name}
VIOLATIONS ({len(viol_list)}):
{json.dumps(viol_list, indent=2, default=str)}

Group violations that share a common root cause (sensor fault, data pipeline, operational change, calibration, etc.).
Each cluster should have a clear hypothesis and a single recommended action.

Return this exact JSON:
{{
  "clusters": [
    {{
      "cluster_id": 1,
      "label": "Short descriptive label",
      "root_cause_hypothesis": "Specific explanation of what likely caused this group of violations",
      "root_cause_type": "sensor_fault|data_pipeline|operational_change|calibration_drift|network_outage|process_anomaly|unknown",
      "confidence": "high|medium|low",
      "violation_ids": ["<UUID>", "<UUID>"],
      "affected_fields": ["FIELD_A", "FIELD_B"],
      "severity": "critical|high|medium|low",
      "record_overlap": "Do these violations affect the same rows/time window?",
      "recommended_action": "Single specific action to resolve this cluster",
      "credit_impact": "none|minor|moderate|significant"
    }}
  ],
  "singleton_count": 2,
  "summary": "2-sentence summary: how many clusters found and the dominant root cause pattern"
}}"""

    result = await call_claude_json(SYSTEM, user_msg, max_tokens=3000)
    if not result:
        return {
            "clusters": [],
            "singleton_count": len(violations),
            "summary": "AI clustering unavailable — configure LLM_PROVIDER and API key.",
        }
    return result
