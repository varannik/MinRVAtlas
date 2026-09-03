"""
PDF Protocol Ingestion Engine
Extracts checkpoint definitions from uploaded registry PDF documents using Claude AI.
Compares extracted checkpoints against current DB version and proposes a diff for admin review.
"""
import hashlib
import logging

logger = logging.getLogger("datasentinel.vv.pdf_ingestion")


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Extract full text from PDF bytes using pypdf."""
    try:
        import io

        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
        pages = []
        for page in reader.pages:
            text = page.extract_text()
            if text:
                pages.append(text)
        return "\n\n".join(pages)
    except Exception as e:
        logger.error(f"PDF text extraction failed: {e}")
        return ""


async def extract_checkpoints_from_text(text: str, protocol_code: str, protocol_name: str) -> list:
    """
    Use Claude AI to extract structured checkpoint definitions from PDF text.
    Falls back to a keyword-based heuristic if LLM is not configured.
    """
    try:
        from app.engines.ai.claude_client import call_claude_json
        prompt = f"""You are a carbon credit methodology analyst. Extract all verification checkpoints from the following protocol document text.

Protocol: {protocol_name} ({protocol_code})

For each checkpoint/requirement found, return a JSON object with:
- id: a short unique ID like "{protocol_code[:6]}-XX-01" (category letter + sequence)
- category: the section/category name (e.g. "Additionality", "Monitoring", "Documentation")
- name: short checkpoint name (3-8 words)
- requirement: full requirement text (1-3 sentences, specific and actionable)
- critical: true if it is a mandatory/critical requirement, false if advisory
- evidence_types: list of document types that would satisfy this checkpoint

Return a JSON array of checkpoint objects. Extract 5-30 checkpoints depending on document length.
Only include actual verifiable requirements, not general descriptions.

DOCUMENT TEXT (first 8000 chars):
{text[:8000]}

Respond with ONLY the JSON array, no other text."""

        result = await call_claude_json(prompt)
        if isinstance(result, list):
            return result
        if isinstance(result, dict) and "checkpoints" in result:
            return result["checkpoints"]
        return []
    except Exception as e:
        logger.warning(f"AI extraction failed, using keyword fallback: {e}")
        return _keyword_fallback_extract(text, protocol_code)


def _keyword_fallback_extract(text: str, protocol_code: str) -> list:
    """Heuristic checkpoint extraction when AI is unavailable."""
    checkpoints = []
    lines = text.split("\n")
    categories = ["Additionality", "Monitoring", "Documentation", "Measurement",
                  "Eligibility", "Baseline", "Quality", "Permanence", "Leakage"]
    current_cat = "General"
    seq = 1

    for line in lines:
        line = line.strip()
        if not line or len(line) < 20:
            continue
        for cat in categories:
            if cat.lower() in line.lower() and len(line) < 80:
                current_cat = cat
                break
        # Lines with "shall", "must", "required", "documented" are requirements
        triggers = ["shall", "must", "required", "mandatory", "documented", "verified", "demonstrated"]
        if any(t in line.lower() for t in triggers) and len(line) > 40:
            cp_id = f"{protocol_code[:6]}-EX-{seq:02d}"
            checkpoints.append({
                "id": cp_id,
                "category": current_cat,
                "name": f"Extracted Requirement {seq}",
                "requirement": line[:300],
                "critical": "must" in line.lower() or "mandatory" in line.lower(),
                "evidence_types": ["supporting_documentation"],
            })
            seq += 1
            if seq > 30:
                break

    return checkpoints


async def generate_checkpoint_diff(
    existing_checkpoints: list,
    extracted_checkpoints: list,
    protocol_code: str
) -> list:
    """
    Compare extracted checkpoints from PDF against current DB checkpoints.
    Returns a list of proposed changes for admin review.
    Each change: {change_type, checkpoint_id_affected, old_value, new_value, notes}
    """
    try:
        from app.engines.ai.claude_client import call_claude_json
        existing_json = [
            {"id": cp.checkpoint_id, "name": cp.name, "requirement": cp.requirement}
            for cp in existing_checkpoints
        ]
        prompt = f"""Compare these two lists of verification checkpoints for protocol {protocol_code}.

CURRENT CHECKPOINTS (in database):
{existing_json}

EXTRACTED FROM PDF:
{extracted_checkpoints}

Identify all meaningful differences. For each difference, return a JSON object with:
- change_type: one of "add_checkpoint", "update_checkpoint", "remove_checkpoint", "version_bump"
- checkpoint_id_affected: the checkpoint ID (use existing ID if updating, new ID if adding)
- old_value: the current value (null for additions)
- new_value: the proposed new value (null for removals)
- notes: brief explanation of why this change is proposed

Return a JSON array of change proposals. Only include real substantive changes, not trivial wording differences.
If checkpoints are essentially equivalent, do NOT include them.

Respond with ONLY the JSON array."""

        changes = await call_claude_json(prompt)
        if isinstance(changes, list):
            return changes
        return []
    except Exception as e:
        logger.warning(f"AI diff generation failed, using simple diff: {e}")
        return _simple_diff(existing_checkpoints, extracted_checkpoints, protocol_code)


def _simple_diff(existing_checkpoints, extracted_checkpoints, protocol_code):
    """Simple set-based diff when AI is unavailable."""
    changes = []
    existing_ids = {cp.checkpoint_id for cp in existing_checkpoints}
    extracted_ids = {cp.get("id") for cp in extracted_checkpoints if cp.get("id")}

    # New checkpoints in extracted but not in DB
    for cp in extracted_checkpoints:
        if cp.get("id") not in existing_ids:
            changes.append({
                "change_type": "add_checkpoint",
                "checkpoint_id_affected": cp.get("id"),
                "old_value": None,
                "new_value": cp,
                "notes": "New checkpoint found in uploaded PDF document",
            })

    # Checkpoints in DB but not in extracted — possible removal
    for cp in existing_checkpoints:
        if cp.checkpoint_id not in extracted_ids:
            changes.append({
                "change_type": "remove_checkpoint",
                "checkpoint_id_affected": cp.checkpoint_id,
                "old_value": {"id": cp.checkpoint_id, "name": cp.name, "requirement": cp.requirement},
                "new_value": None,
                "notes": "Checkpoint not found in uploaded PDF — may have been removed or renamed",
            })

    return changes


async def ingest_pdf(
    pdf_bytes: bytes,
    filename: str,
    protocol_id: str,
    protocol_code: str,
    protocol_name: str,
    existing_checkpoints: list,
    proposed_by: str,
    db
) -> dict:
    """
    Full PDF ingestion pipeline:
    1. Extract text from PDF
    2. Extract checkpoints using AI
    3. Generate diff against current DB checkpoints
    4. Store all proposals in vv_protocol_update_log with status=pending
    Returns summary dict with counts.
    """
    import uuid as _uuid

    from app.models import VVProtocolUpdateLog

    pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()[:16]
    text = extract_text_from_pdf(pdf_bytes)
    if not text:
        return {"error": "Could not extract text from PDF", "proposals": 0}

    extracted = await extract_checkpoints_from_text(text, protocol_code, protocol_name)
    if not extracted:
        return {"error": "No checkpoints extracted from PDF", "proposals": 0}

    changes = await generate_checkpoint_diff(existing_checkpoints, extracted, protocol_code)

    proposals_created = 0
    for change in changes:
        try:
            entry = VVProtocolUpdateLog(
                id=_uuid.uuid4(),
                protocol_id=_uuid.UUID(str(protocol_id)),
                proposed_by=proposed_by,
                change_type=change.get("change_type", "update_checkpoint"),
                checkpoint_id_affected=change.get("checkpoint_id_affected"),
                old_value=change.get("old_value"),
                new_value=change.get("new_value"),
                status="pending",
                notes=change.get("notes"),
                source=f"PDF:{filename}:{pdf_hash}",
            )
            db.add(entry)
            proposals_created += 1
        except Exception as e:
            logger.warning(f"Failed to create proposal: {e}")

    db.commit()
    logger.info(f"PDF ingestion complete: {proposals_created} proposals from {filename}")
    return {
        "filename": filename,
        "pages_extracted": len(text.split("\n\n")),
        "checkpoints_found": len(extracted),
        "proposals_created": proposals_created,
        "pdf_hash": pdf_hash,
    }
