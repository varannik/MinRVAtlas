"""
AI Remediation Playbook Generator — generates step-by-step operator instructions for a specific violation.
Cites knowledge base entries, estimates time-to-fix, and quantifies credit impact.
"""
import json
import logging
from typing import Any, Dict, List, Optional

from .claude_client import call_claude_json

logger = logging.getLogger("datasentinel.playbook_agent")

SYSTEM = """You are a senior operations engineer for a carbon sequestration facility.
Generate precise, actionable operator playbooks for data quality violations.
Include specific technical steps, tools to use, people to contact, and verification checks.
Cite relevant knowledge base entries where applicable.
Respond with VALID JSON ONLY."""


async def generate_playbook(
    violation: Any,
    knowledge_base_entries: Optional[List[Dict]] = None,
    project_name: str = "",
) -> Dict:
    """Generate a step-by-step remediation playbook for a single violation."""
    kb_context = ""
    if knowledge_base_entries:
        relevant = [e for e in knowledge_base_entries if
                    (e.get("parameter") == violation.affected_field if hasattr(violation, 'affected_field') else e.get("parameter") == violation.get("affected_field")) or
                    not e.get("parameter")][:5]
        if relevant:
            kb_context = f"\nRELEVANT KNOWLEDGE BASE:\n{json.dumps(relevant, indent=2)}"

    field = violation.affected_field if hasattr(violation, 'affected_field') else violation.get("affected_field")
    rule_id = violation.rule_id if hasattr(violation, 'rule_id') else violation.get("rule_id")
    rule_name = violation.rule_name if hasattr(violation, 'rule_name') else violation.get("rule_name")
    severity = violation.severity if hasattr(violation, 'severity') else violation.get("severity")
    record_count = violation.record_count if hasattr(violation, 'record_count') else violation.get("record_count", 0)
    detail = (violation.violation_detail if hasattr(violation, 'violation_detail') else violation.get("violation_detail")) or {}
    dimension = violation.dimension if hasattr(violation, 'dimension') else violation.get("dimension")

    user_msg = f"""Generate an operator remediation playbook for this violation.

PROJECT: {project_name}
VIOLATION:
  Rule: {rule_id} — {rule_name}
  Dimension: {dimension}
  Severity: {severity}
  Field: {field}
  Affected records: {record_count}
  Detail: {json.dumps(detail, default=str)}
{kb_context}

Create a practical, step-by-step playbook an operator can follow immediately.

Return this exact JSON:
{{
  "title": "Remediation Playbook: {rule_name} on {field}",
  "priority": "immediate|24h|scheduled",
  "estimated_time": "e.g. 30 minutes",
  "responsible_role": "Field Engineer|Data Analyst|Operations Manager|IT Support",
  "steps": [
    {{
      "step": 1,
      "action": "Specific action the operator must take",
      "tool_or_system": "SCADA system, calibration kit, etc.",
      "expected_outcome": "What success looks like",
      "verification": "How to confirm this step is complete"
    }}
  ],
  "escalation_path": "If unresolved in X hours, contact Y",
  "root_cause_checklist": ["Possible cause 1 to investigate", "Possible cause 2"],
  "credit_impact": "Specific impact on carbon credits if not resolved",
  "prevention": "How to prevent this violation in future",
  "kb_references": ["Knowledge base entry titles referenced"]
}}"""

    result = await call_claude_json(SYSTEM, user_msg, max_tokens=2000)
    if not result:
        return {
            "title": f"Playbook: {rule_name}",
            "priority": severity if severity in ("immediate", "24h", "scheduled") else "24h",
            "estimated_time": "Unknown",
            "responsible_role": "Operations Engineer",
            "steps": [{"step": 1, "action": "AI playbook unavailable — configure LLM_PROVIDER and API key.", "tool_or_system": "", "expected_outcome": "", "verification": ""}],
            "escalation_path": "",
            "root_cause_checklist": [],
            "credit_impact": "",
            "prevention": "",
            "kb_references": [],
        }
    return result
