"""
AI Narrative Report Generator — writes a full compliance-ready narrative from DQA results.
Output is structured for Puro.Earth / Verra / Gold Standard reviewer consumption.
"""
import json
import logging
from typing import Any, Dict, List, Union

from .claude_client import call_claude_json

logger = logging.getLogger("datasentinel.narrative_agent")


def _g(obj, key, default=None):
    """Get a field from either an ORM model or a plain dict."""
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


SYSTEM = """You are a senior carbon project compliance officer writing a formal Data Quality Assessment report.
Write clearly, precisely, and in a professional tone suitable for registry reviewers.
Use specific numbers, percentages, field names and rule IDs.
Do not fabricate data — only report what is in the provided context.
Respond with VALID JSON ONLY."""


async def generate_narrative(
    run: Dict,
    violations: List[Dict],
    corrections,          # int (count) or list — both handled
    project: Dict,
    dataset_name: str,
    methodology: str = "Puro.Earth GSC",
) -> Dict:
    """Generate a full narrative compliance report for a completed DQA run."""
    score_pct = round((_g(run, "readiness_score") or 0) * 100, 1)
    correction_count = corrections if isinstance(corrections, int) else len(corrections)

    by_sev: Dict[str, list] = {"critical": [], "high": [], "medium": [], "low": []}
    for v in violations:
        sev = str(_g(v, "severity", "medium") or "medium")
        if sev in by_sev:
            by_sev[sev].append(v)

    # Build JSON-serialisable structures before the f-string
    raw_dim = _g(run, 'dimension_scores') or {}
    dim_scores = {}
    for k, val in raw_dim.items():
        try:
            dim_scores[str(k)] = f"{round(float(val) * 100, 1)}%"
        except (TypeError, ValueError):
            dim_scores[str(k)] = "N/A"

    top_violations = [
        {
            "rule":     str(_g(v, 'rule_id') or ""),
            "name":     str(_g(v, 'rule_name') or ""),
            "field":    str(_g(v, 'affected_field') or ""),
            "severity": str(_g(v, 'severity') or ""),
            "records":  int(_g(v, 'record_count') or 0),
        }
        for v in violations[:10]
    ]

    user_msg = f"""Generate a formal compliance report narrative for this DQA assessment.

PROJECT: {_g(project, 'name', 'Unknown')}
METHODOLOGY: {methodology}
DATASET: {dataset_name}
ASSESSMENT DATE: {_g(run, 'triggered_at', 'Unknown')}

RESULTS SUMMARY:
- Readiness Score: {score_pct}% ({'Gate PASSED' if _g(run, 'gate_passed') else 'Gate FAILED — below 85% threshold'})
- Rules Executed: {_g(run, 'rules_executed', 0)} across 8 quality dimensions
- Total Violations: {_g(run, 'total_violations', 0)}
  Critical: {len(by_sev['critical'])} | High: {len(by_sev['high'])} | Medium: {len(by_sev['medium'])} | Low: {len(by_sev['low'])}
- Dimension Scores: {json.dumps(dim_scores, indent=2)}

TOP VIOLATIONS:
{json.dumps(top_violations, indent=2)}

CORRECTIONS APPLIED: {correction_count} approved corrections

Write a professional compliance report narrative.

Return this exact JSON:
{{
  "report_title": "Data Quality Assessment Report — [Project] — [Date]",
  "executive_summary": "3-4 sentence non-technical summary for executive reviewers",
  "methodology_compliance": "How this assessment aligns with {methodology} requirements",
  "data_quality_narrative": "Full paragraph describing data quality findings across all dimensions",
  "violation_analysis": "Paragraph analysing top violations, their root causes and business impact",
  "correction_summary": "Paragraph describing corrections applied and their effectiveness",
  "gate_determination": "Formal statement on gate pass/fail with justification",
  "credit_implications": "Paragraph on carbon credit issuance implications",
  "recommendations": ["Specific recommendation 1", "Specific recommendation 2", "..."],
  "auditor_notes": "Notes for the third-party verifier reviewing this report",
  "certification_statement": "Formal certification statement for the record"
}}"""

    result = await call_claude_json(SYSTEM, user_msg, max_tokens=3000)
    if not result:
        return {
            "report_title": f"DQA Report — {_g(project, 'name', 'Unknown')} — Score {score_pct}%",
            "executive_summary": "AI narrative unavailable — configure LLM_PROVIDER and API key.",
            "methodology_compliance": "",
            "data_quality_narrative": "",
            "violation_analysis": "",
            "correction_summary": "",
            "gate_determination": f"{'Gate PASSED' if _g(run, 'gate_passed') else 'Gate FAILED'} — {score_pct}% readiness",
            "credit_implications": "",
            "recommendations": [],
            "auditor_notes": "",
            "certification_statement": "",
        }
    return result
