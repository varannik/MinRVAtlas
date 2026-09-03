"""
AI Chat Agent — context-aware Q&A over project DQA data.
Receives project context (recent runs, violations, scores) and answers operator questions.
"""
import json
import logging
from typing import Dict, List, Optional

from .claude_client import call_claude_json

logger = logging.getLogger("datasentinel.chat_agent")

SYSTEM = """You are DataSentinel AI, an expert data quality analyst for carbon sequestration projects.
You have direct access to the project's DQA run history, violation data, dimension scores and correction records.
Answer questions clearly and concisely. Cite specific run IDs, dates, field names and scores from the provided context.
When you don't know something from the context, say so — never fabricate data.
Respond with VALID JSON ONLY."""


async def answer(
    message: str,
    project_context: Dict,
    conversation_history: Optional[List[Dict]] = None,
) -> Dict:
    """
    Answer a natural-language question about a project's DQA data.

    project_context should include:
      - project_name, domain
      - recent_runs: list of {id, date, readiness, violations, gate_passed, dimension_scores}
      - top_violations: list of {rule_id, rule_name, dimension, severity, field, count}
      - correction_summary: {approved, pending, applied}
      - trend: {7_day_avg, direction, latest_readiness}
    """
    history_text = ""
    if conversation_history:
        for turn in conversation_history[-6:]:  # last 3 exchanges
            role = turn.get("role", "user")
            content = turn.get("content", "")
            history_text += f"\n{role.upper()}: {content}"

    user_msg = f"""PROJECT CONTEXT
===============
{json.dumps(project_context, indent=2, default=str)}

CONVERSATION HISTORY{history_text if history_text else " (none)"}

CURRENT QUESTION
================
{message}

Answer the question using the project context above. Be specific — cite run IDs, dates, exact scores, field names.
If the answer isn't determinable from the context, say so clearly.

Respond with this JSON:
{{
  "answer": "Your clear, specific answer citing real data",
  "confidence": "high|medium|low",
  "cited_data": ["run abc123 — 89% readiness on Mar 15", "field CO2_FLOW_RATE — 3 violations"],
  "follow_up_suggestions": ["What caused the Consistency drop?", "Show me the worst violations"]
}}"""

    result = await call_claude_json(SYSTEM, user_msg, max_tokens=1200)
    if not result:
        return {
            "answer": "AI chat is temporarily unavailable — check LLM_PROVIDER and API key configuration.",
            "confidence": "low",
            "cited_data": [],
            "follow_up_suggestions": [],
        }
    return result
