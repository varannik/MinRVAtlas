"""
V&V Document Analysis Agent
Reads uploaded project documents and maps findings to methodology checkpoints.
Populates ai_finding, ai_confidence, ai_evidence on VVCheckpoint records.
"""
import json
import logging
from typing import Any, Dict, List

from .claude_client import call_claude_json
import app.engines.ai.claude_client as _cc

logger = logging.getLogger("datasentinel.vv_agent")

SYSTEM = """You are a senior carbon project verification specialist with expertise in:
- Puro.Earth GSC (CO2 mineralisation) and Biochar methodologies
- Verra VCS and Gold Standard verification frameworks
- EBC / IBI biochar certification
- UNFCCC CDM documentation standards

Your task: analyse uploaded project documents and assess whether they satisfy
each verification checkpoint. Be precise and cite specific evidence.
Respond with VALID JSON ONLY — no markdown, no prose outside the JSON."""


async def analyse_project(
    project: Any,
    documents: List[Any],
    checkpoints: List[Any],
) -> Dict:
    """
    Analyse all uploaded documents against methodology checkpoints.
    Returns structured findings for each checkpoint.
    """
    if not documents:
        return {"error": "No documents uploaded — upload project documents first"}
    if not checkpoints:
        return {"error": "No checkpoints found — run verification setup first"}

    # Build document context — use real extracted content, not just filenames
    doc_ctx = []
    for d in documents[:20]:   # cap at 20 docs; each gets up to 1 200 chars of content
        extracted = getattr(d, "extracted_data", None) or {}
        entry: dict = {
            "id": str(d.id),
            "name": d.name,
            "type": d.document_type,
        }

        # Prefer actual extracted text over extraction_summary
        actual_text = (
            extracted.get("text") or
            extracted.get("preview") or
            extracted.get("text_preview") or    # from VerificationEngine path
            ""
        )
        if actual_text and len(str(actual_text)) > 50:
            entry["content"] = str(actual_text)[:1200]
        elif extracted.get("sheets"):
            # Excel: describe structure + key column names
            sheet_lines = []
            for sheet_name, sd in list(extracted["sheets"].items())[:4]:
                if isinstance(sd, dict):
                    cols = [str(c) for c in sd.get("columns", [])[:8]]
                    rows = sd.get("row_count", 0)
                    sheet_lines.append(f"Sheet '{sheet_name}' ({rows} rows): {', '.join(cols)}")
            entry["content"] = "\n".join(sheet_lines) or "(Excel data present)"
        elif extracted.get("columns"):
            # CSV
            cols = [str(c) for c in extracted.get("columns", [])[:12]]
            rows = extracted.get("row_count", 0)
            entry["content"] = f"CSV: {rows} rows. Columns: {', '.join(cols)}"
        elif d.extraction_summary:
            entry["content"] = str(d.extraction_summary)[:400]
        else:
            entry["content"] = "(content not yet extracted — base assessment on document name/type)"

        # Attach extracted key figures if present
        key_terms = extracted.get("key_terms", {})
        if key_terms:
            entry["key_figures"] = {k: v for k, v in list(key_terms.items())[:8]}

        doc_ctx.append(entry)

    # Build checkpoint context (limit to 15 to keep response within max_tokens)
    cp_ctx = [
        {
            "id": str(c.id),
            "checkpoint_id": c.checkpoint_id,
            "category": c.category,
            "name": c.name,
            "requirement": str(c.requirement or c.description or "")[:150],
        }
        for c in checkpoints[:15]
    ]

    user_msg = f"""Analyse this carbon project for verification.

PROJECT
-------
Name: {project.name}
Developer: {project.project_developer or "N/A"}
Location: {project.location or "N/A"}
Vintage year: {project.vintage_year or "N/A"}
Status: {project.status}

UPLOADED DOCUMENTS ({len(documents)}) — actual extracted content shown
-----------------------------------------------------------------------
{json.dumps(doc_ctx, indent=2)}

CHECKPOINTS TO ASSESS ({len(cp_ctx)})
--------------------------------------
{json.dumps(cp_ctx, indent=2)}

For EVERY checkpoint, determine if the documents satisfy the requirement.
Assign status: "passed" | "failed" | "warning" | "na" | "pending"

Also assign finding_severity using ISO 14064-3 / accredited verification standards:
- "major_nc"   — Critical non-conformity that BLOCKS credit issuance. Use when: mandatory document missing, methodology deviation, data integrity risk, failed checkpoint with confidence > 0.6
- "minor_nc"   — Non-conformity requiring correction but allows conditional issuance. Use when: incomplete records, minor data gaps, format deviations, failed/warning with confidence 0.4-0.75
- "observation" — Noted finding, not a non-conformity. Use when: something warrants monitoring but doesn't breach requirements (status = warning with low impact)
- "ofi"        — Opportunity for Improvement. No non-conformity, just a recommendation (status = passed with a process note)
- "none"       — Checkpoint satisfied fully, no findings (status = passed cleanly)

Return exactly this JSON (no other text, no markdown):
{{
  "checkpoint_findings": [
    {{
      "id": "<checkpoint UUID>",
      "checkpoint_id": "<e.g. PURO-B-01>",
      "status": "passed|failed|warning|na|pending",
      "ai_confidence": <0.0-1.0>,
      "ai_finding": "One sentence finding.",
      "ai_evidence": [],
      "finding_severity": "major_nc|minor_nc|observation|ofi|none"
    }}
  ],
  "overall_assessment": "2-3 sentence project summary.",
  "critical_gaps": ["gap 1", "gap 2"],
  "recommended_actions": ["action 1", "action 2"],
  "estimated_credit_risk": "low|medium|high|critical"
}}"""

    result = await call_claude_json(SYSTEM, user_msg, max_tokens=4000)
    if not result:
        detail = _cc._last_call_error or "check ECS logs for details"
        return {"error": f"AI analysis failed — {detail}"}
    return result


async def summarise_document(doc: Any) -> Dict:
    """
    Summarise a single document using its actual extracted content.
    Called after the document has been processed (extraction_data populated).
    """
    extracted = getattr(doc, "extracted_data", None) or {}

    # Build a content block from whatever was extracted
    content_section = ""
    actual_text = (
        extracted.get("text") or
        extracted.get("preview") or
        extracted.get("text_preview") or
        ""
    )
    if actual_text and len(str(actual_text)) > 50:
        content_section = f"\n\nExtracted text (first 2 000 chars):\n{str(actual_text)[:2000]}"
    elif extracted.get("sheets"):
        sheet_lines = []
        for name, sd in list(extracted["sheets"].items())[:4]:
            if isinstance(sd, dict):
                cols = [str(c) for c in sd.get("columns", [])[:10]]
                rows = sd.get("row_count", 0)
                sheet_lines.append(f"Sheet '{name}' ({rows} rows): {', '.join(cols)}")
        content_section = "\n\nSpreadsheet structure:\n" + "\n".join(sheet_lines)
    elif extracted.get("columns"):
        cols = [str(c) for c in extracted.get("columns", [])[:14]]
        rows = extracted.get("row_count", 0)
        content_section = f"\n\nCSV: {rows} rows. Columns: {', '.join(cols)}"

    # Key figures if available
    key_terms = extracted.get("key_terms", {})
    if key_terms:
        kf_str = ", ".join(f"{k}={v}" for k, v in list(key_terms.items())[:6])
        content_section += f"\n\nKey figures: {kf_str}"

    source_note = "actual extracted content" if content_section else "document name and type"
    user_msg = f"""Analyse this carbon project document and extract key information.

Document name: {doc.name}
Document type: {doc.document_type}
File format: {doc.file_type}{content_section}

Based on the {source_note}:
1. What this document contains
2. Key data points it contains (or should contain, if content is unavailable)
3. Which verification checkpoints it is relevant to

Return JSON only:
{{
  "extraction_summary": "2-3 sentence description of document contents and purpose",
  "key_data_points": {{"field": "value or description"}},
  "relevant_checkpoints": ["checkpoint category or ID"],
  "data_quality": "good|acceptable|poor|unknown"
}}"""

    result = await call_claude_json(
        "You are a carbon project document analyst. Extract structured information from the provided content. Return valid JSON only.",
        user_msg,
        max_tokens=800,
    )
    return result or {}
