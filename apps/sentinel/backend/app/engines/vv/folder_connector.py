"""
Smart Folder Connector — Phase 1 (Local), Phase 2 (SharePoint/Graph API), Phase 3 (S3)
Handles AI document classification, remote folder scanning, and file download+store.
"""
import base64
import logging
import os
import re
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger("datasentinel.folder_connector")

# Document type catalogue — mirrors DOC_TYPES in VVProject.tsx
VALID_DOC_TYPES = [
    {"value": "co2_offtake_agreement",        "label": "CO2 Offtake Agreement",           "keywords": ["offtake", "agreement", "holcim", "co2", "contract"]},
    {"value": "company_registration",         "label": "Company Registration",             "keywords": ["company", "registration", "certificate", "incorporation", "coi"]},
    {"value": "noc_regulatory",               "label": "Regulatory NOC / Approval",        "keywords": ["noc", "regulatory", "approval", "permit"]},
    {"value": "additionality_assessment",     "label": "Additionality Assessment",         "keywords": ["additionality", "additional"]},
    {"value": "cost_analysis",                "label": "Cost / Financial Analysis",        "keywords": ["cost", "financial", "budget"]},
    {"value": "stakeholder_engagement",       "label": "Stakeholder Engagement",           "keywords": ["stakeholder", "engagement", "consultation"]},
    {"value": "ess_framework",                "label": "ESS Framework",                    "keywords": ["ess", "environmental", "social", "hr", "policy"]},
    {"value": "risk_register",                "label": "Risk Register",                    "keywords": ["risk", "uncertainty", "register"]},
    {"value": "chemical_management",          "label": "Chemical Management",              "keywords": ["chemical", "msds", "material", "safety"]},
    {"value": "eia_sia",                      "label": "EIA / SIA",                        "keywords": ["eia", "sia", "impact", "assessment"]},
    {"value": "storage_site_overview",        "label": "Storage Site Overview",            "keywords": ["storage", "site", "satellite", "logistic"]},
    {"value": "noc_fnrc_fea",                "label": "NOC from FNRC / FEA",              "keywords": ["fnrc", "fea", "noc", "objection"]},
    {"value": "reservoir_modelling",          "label": "Reservoir Modelling",              "keywords": ["reservoir", "modelling", "model", "geological"]},
    {"value": "legal_framework",              "label": "Legal Framework",                  "keywords": ["legal", "framework", "storage", "rights"]},
    {"value": "capture_transport_monitoring", "label": "Capture & Transport Monitoring",   "keywords": ["capture", "transport", "monitoring", "program"]},
    {"value": "ace_monitoring_plan",          "label": "GSC Monitoring Plan",              "keywords": ["gsc", "ace", "monitoring", "plan"]},
    {"value": "data_systems",                "label": "Data Systems",                      "keywords": ["data", "systems", "digitalization", "scada"]},
    {"value": "uncertainty_quantification",   "label": "Uncertainty Quantification",       "keywords": ["uncertainty", "quantification"]},
    {"value": "leakage_determination",        "label": "GHG Leakage Determination",       "keywords": ["leakage", "ghg", "determination"]},
    {"value": "energy_procurement",           "label": "Energy Procurement",               "keywords": ["energy", "procurement", "guidance"]},
    {"value": "lca_spreadsheet",              "label": "LCA Spreadsheet",                  "keywords": ["lca", "lifecycle", "spreadsheet"]},
    {"value": "lca_report",                   "label": "LCA Report",                       "keywords": ["lca", "lifecycle", "report"]},
    {"value": "project_description",          "label": "Project Description",              "keywords": ["project", "description", "pdd"]},
    {"value": "production_logs",              "label": "Production / Batch Logs",          "keywords": ["production", "batch", "log", "pyrolysis"]},
    {"value": "lab_report",                   "label": "Lab Report",                       "keywords": ["lab", "laboratory", "hcorg", "toc", "pah"]},
    {"value": "temperature_time_series",      "label": "Temperature Time-Series",          "keywords": ["temperature", "time-series", "timeseries", "thermal"]},
    {"value": "chain_of_custody",             "label": "Chain of Custody",                 "keywords": ["chain", "custody", "coc"]},
    {"value": "application_records",          "label": "Application Records",              "keywords": ["application", "field", "biochar", "records"]},
    {"value": "monitoring_data",              "label": "Monitoring Data",                  "keywords": ["monitoring", "data", "csv", "sensor"]},
]

SUPPORTED_EXTENSIONS = {"pdf", "xlsx", "xls", "xlsm", "docx", "doc", "csv", "json"}


# ── AI Classification ─────────────────────────────────────────────────────────

async def classify_documents_with_ai(files: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    AI-classify a list of files. Each file: {filename, extension, content_preview (optional base64)}.
    Returns: [{filename, suggested_type, confidence_pct, reasoning}]
    Falls back to keyword matching if AI unavailable.
    """
    from app.engines.ai.claude_client import call_claude_json

    doc_types_str = "\n".join(
        f'  - {dt["value"]}: {dt["label"]} (keywords: {", ".join(dt["keywords"][:5])})'
        for dt in VALID_DOC_TYPES
    )
    files_str = "\n".join(
        f'  {i+1}. Filename: "{f["filename"]}" | Extension: {f.get("extension","?")}'
        + (f' | Content preview: {_safe_preview(f["content_preview"])}' if f.get("content_preview") else "")
        for i, f in enumerate(files)
    )
    system = "You are a carbon registry document classifier. Respond with valid JSON only — no markdown, no explanation."
    prompt = f"""Classify each of the following {len(files)} files into one of the provided document types.

VALID DOCUMENT TYPES:
{doc_types_str}

FILES TO CLASSIFY:
{files_str}

Return a JSON array (exactly {len(files)} objects, same order as input):
[
  {{
    "filename": "exact filename from input",
    "suggested_type": "value from the valid types list, or null if unrecognised",
    "confidence_pct": 0-100,
    "reasoning": "1 sentence explanation based on filename and content"
  }}
]

Rules:
- Use filename as primary signal (most reliable)
- Content preview as secondary signal
- Prefer null + low confidence over a wrong classification
- Return exactly one object per input file in the same order"""

    try:
        # Hard outer cap of 40 s for the entire AI call.
        # call_claude retries up to 3 times (25 s each + backoff = up to 81 s total)
        # which still exceeds the ALB 60 s idle timeout on slow Azure days.
        # asyncio.wait_for cancels the coroutine if it hasn't returned within 40 s,
        # guaranteeing the keyword fallback always runs well under the 60 s ALB limit.
        import asyncio as _asyncio
        result = await _asyncio.wait_for(
            call_claude_json(system, prompt, max_tokens=2000, timeout=25),
            timeout=40,
        )
        if isinstance(result, list) and len(result) == len(files):
            return result
        # Sometimes AI wraps the array in a dict key
        if isinstance(result, dict):
            for v in result.values():
                if isinstance(v, list) and len(v) == len(files):
                    return v
        logger.warning("AI classification returned unexpected shape, falling back to keywords")
    except Exception as e:
        logger.warning(f"AI classification timed out or failed: {e} — using keyword fallback")

    # Keyword-based fallback
    results = []
    for f in files:
        name_lower = f["filename"].lower()
        best_type, best_score = None, 0
        for dt in VALID_DOC_TYPES:
            score = sum(1 for kw in dt["keywords"] if kw in name_lower)
            if score > best_score:
                best_score, best_type = score, dt["value"]
        results.append({
            "filename": f["filename"],
            "suggested_type": best_type if best_score > 0 else None,
            "confidence_pct": min(best_score * 22, 65) if best_score > 0 else 0,
            "reasoning": (
                f"Keyword match ({best_score} hit(s)) on filename"
                if best_score > 0
                else "No matching keywords — please assign manually"
            ),
        })
    return results


def _safe_preview(b64: str) -> str:
    """Decode base64 content preview → first 300 printable chars."""
    try:
        raw = base64.b64decode(b64 + "==").decode("utf-8", errors="replace")
        return raw[:300].replace("\n", " ").replace("\r", "")
    except Exception:
        return ""


# ── Phase 2: SharePoint via Microsoft Graph API ───────────────────────────────

async def fetch_sharepoint_files(folder_url: str, graph_token: str) -> List[Dict[str, Any]]:
    """
    Fetch file list from a SharePoint folder using Microsoft Graph API.
    folder_url: e.g. https://tenant.sharepoint.com/sites/Finance/Shared Documents/VV-Docs
    graph_token: Bearer token with Files.Read.All or Sites.Read.All scope.
    Returns: [{name, size, download_url, web_url, extension, source}]
         or: [{"error": "..."}] on failure.
    """
    from urllib.parse import unquote, urlparse

    try:
        parsed = urlparse(folder_url)
        host = f"{parsed.scheme}://{parsed.netloc}"
        path = unquote(parsed.path)

        # Detect site path: /sites/{name} or /personal/{user}
        site_match = re.match(r'^(/(?:sites|personal)/[^/]+)', path)
        if not site_match:
            return [{"error": (
                "Cannot parse SharePoint site from URL. "
                "Expected format: https://tenant.sharepoint.com/sites/SiteName/Shared Documents/FolderName"
            )}]

        site_relative = site_match.group(1)
        remaining = path[len(site_relative):].lstrip("/")
        # Strip "Shared Documents/" or "Documents/" prefix
        remaining = re.sub(r'^[Ss]hared\s[Dd]ocuments/', '', remaining)
        remaining = re.sub(r'^[Dd]ocuments/', '', remaining)
        folder_path = remaining.strip("/")

        headers = {"Authorization": f"Bearer {graph_token}", "Accept": "application/json"}

        async with httpx.AsyncClient(timeout=30.0) as client:
            # Step 1: resolve site ID
            site_api = f"https://graph.microsoft.com/v1.0/sites/{parsed.netloc}:{site_relative}"
            sr = await client.get(site_api, headers=headers)
            if sr.status_code == 401:
                return [{"error": "Authentication failed. Token may be expired or missing Sites.Read.All scope."}]
            if sr.status_code != 200:
                return [{"error": (
                    f"Cannot access SharePoint site (HTTP {sr.status_code}). "
                    "Check the URL and token permissions."
                )}]

            site_id = sr.json().get("id")

            # Step 2: list files in folder
            if folder_path:
                files_api = (
                    f"https://graph.microsoft.com/v1.0/sites/{site_id}"
                    f"/drive/root:/{folder_path}:/children"
                )
            else:
                files_api = f"https://graph.microsoft.com/v1.0/sites/{site_id}/drive/root/children"

            fr = await client.get(files_api, headers=headers, params={"$top": 200})
            if fr.status_code != 200:
                return [{"error": (
                    f"Cannot list files in folder (HTTP {fr.status_code}). "
                    "Check the folder path and that the token has Files.Read.All permission."
                )}]

            items = fr.json().get("value", [])
            result = []
            for item in items:
                if not item.get("file"):  # skip sub-folders
                    continue
                name = item.get("name", "")
                ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
                if ext not in SUPPORTED_EXTENSIONS:
                    continue
                result.append({
                    "name": name,
                    "size": item.get("size", 0),
                    "download_url": (
                        item.get("@microsoft.graph.downloadUrl")
                        or item.get("webUrl", "")
                    ),
                    "web_url": item.get("webUrl", ""),
                    "extension": ext,
                    "source": "sharepoint",
                })
            return result

    except Exception as e:
        logger.error(f"SharePoint fetch error: {e}")
        return [{"error": str(e)}]


# ── Phase 3: S3 Prefix ────────────────────────────────────────────────────────

def fetch_s3_files(bucket: str, prefix: str) -> List[Dict[str, Any]]:
    """
    List supported files in an S3 bucket under the given prefix.
    Uses the ECS task role (no explicit credentials needed).
    Returns: [{name, size, s3_key, download_url (presigned 1h), extension, source}]
         or: [{"error": "..."}] on failure.
    """
    import boto3
    from botocore.exceptions import ClientError

    try:
        s3 = boto3.client("s3")
        normalized_prefix = (prefix.rstrip("/") + "/") if prefix else ""
        paginator = s3.get_paginator("list_objects_v2")
        result = []

        for page in paginator.paginate(Bucket=bucket, Prefix=normalized_prefix):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                name = key.rsplit("/", 1)[-1]
                if not name:
                    continue  # skip "folder" marker keys
                ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
                if ext not in SUPPORTED_EXTENSIONS:
                    continue
                presigned = s3.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": bucket, "Key": key},
                    ExpiresIn=3600,
                )
                result.append({
                    "name": name,
                    "size": obj["Size"],
                    "s3_key": key,
                    "download_url": presigned,
                    "extension": ext,
                    "source": "s3",
                })
        return result

    except ClientError as e:
        err = e.response["Error"]
        return [{"error": f"S3 {err.get('Code', 'Error')}: {err.get('Message', 'Unknown')}"}]
    except Exception as e:
        return [{"error": str(e)}]


# ── Content-based reclassification (sync, called from background thread) ─────

def reclassify_with_content(text_snippet: str, filename: str) -> tuple:
    """
    Synchronous second-pass classifier for files that landed as 'other'.
    Reads the first 1500 chars of extracted text and asks the LLM to identify
    the document type.  Called from _process_document (background thread).

    Returns: (suggested_type: str | None, confidence_pct: int)
    Confidence ≥ 70 is required before the caller auto-updates the type.
    """
    import json as _json
    import httpx as _httpx
    from app.core.config import settings

    doc_types_str = "\n".join(
        f'  - {dt["value"]}: {dt["label"]} (keywords: {", ".join(dt["keywords"][:5])})'
        for dt in VALID_DOC_TYPES
        if dt["value"] != "other"
    )

    system = (
        "You are a carbon registry document classifier. "
        "Respond with valid JSON only — no markdown, no explanation."
    )
    prompt = (
        f'A document named "{filename}" was uploaded but could not be classified '
        f"by filename alone.\n\n"
        f"Here is an excerpt of its text content:\n---\n{text_snippet[:1500]}\n---\n\n"
        f"Based on the content, classify this document into one of these types:\n"
        f"{doc_types_str}\n\n"
        f"Return ONLY a JSON object:\n"
        f'{{"suggested_type": "value_from_list_or_null", "confidence_pct": 0_to_100, '
        f'"reasoning": "one sentence"}}\n\n'
        f"Rules:\n"
        f"- confidence_pct ≥ 70 means you are sure based on the content\n"
        f"- Return null if the content is too generic or ambiguous"
    )

    try:
        provider = (getattr(settings, "LLM_PROVIDER", None) or "azure_openai").lower().strip()

        if provider == "anthropic":
            api_key = getattr(settings, "ANTHROPIC_API_KEY", None)
            if not api_key:
                return None, 0
            model = (getattr(settings, "LLM_MODEL", None) or "").strip() or "claude-opus-4-5"
            url = "https://api.anthropic.com/v1/messages"
            payload = {
                "model": model, "max_tokens": 300, "system": system,
                "messages": [{"role": "user", "content": prompt}],
            }
            headers = {
                "x-api-key": api_key, "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
            def _extract(d): return d["content"][0]["text"]

        elif provider == "openai":
            api_key = getattr(settings, "OPENAI_API_KEY", None)
            if not api_key:
                return None, 0
            model = (getattr(settings, "LLM_MODEL", None) or "").strip() or "gpt-4o"
            url = "https://api.openai.com/v1/chat/completions"
            payload = {
                "model": model, "max_tokens": 300,
                "messages": [{"role": "system", "content": system},
                             {"role": "user",   "content": prompt}],
            }
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            def _extract(d): return d["choices"][0]["message"]["content"]

        else:  # azure_openai (default)
            api_key  = getattr(settings, "AZURE_OPENAI_API_KEY", None)
            endpoint = getattr(settings, "AZURE_OPENAI_ENDPOINT", None)
            if not api_key or not endpoint:
                return None, 0
            deployment = (
                (getattr(settings, "LLM_MODEL", None) or "").strip()
                or getattr(settings, "AZURE_OPENAI_DEPLOYMENT", None)
                or "gpt-4o"
            )
            version = getattr(settings, "AZURE_OPENAI_API_VERSION", None) or "2024-02-15-preview"
            url = f"{endpoint.rstrip('/')}/openai/deployments/{deployment}/chat/completions?api-version={version}"
            payload = {
                "max_tokens": 300,
                "messages": [{"role": "system", "content": system},
                             {"role": "user",   "content": prompt}],
            }
            headers = {"api-key": api_key, "Content-Type": "application/json"}
            def _extract(d): return d["choices"][0]["message"]["content"]

        with _httpx.Client(timeout=30) as client:
            resp = client.post(url, headers=headers, json=payload)

        if resp.status_code != 200:
            logger.warning("Content reclassify: API returned %s for %s", resp.status_code, filename)
            return None, 0

        raw = _extract(resp.json()).strip()
        # Strip markdown fences if the model added them
        if "```json" in raw:
            raw = raw.split("```json")[1].split("```")[0].strip()
        elif "```" in raw:
            raw = raw.split("```")[1].split("```")[0].strip()

        result = _json.loads(raw)
        suggested  = result.get("suggested_type")
        confidence = int(result.get("confidence_pct", 0))

        # Validate against the catalogue (never accept "other")
        valid_values = {dt["value"] for dt in VALID_DOC_TYPES if dt["value"] != "other"}
        if suggested not in valid_values:
            return None, 0

        logger.info(
            "Content reclassify: %s → %s (%d%%) — %s",
            filename, suggested, confidence, result.get("reasoning", ""),
        )
        return suggested, confidence

    except Exception as exc:
        logger.warning("Content reclassify failed for %s: %s", filename, exc)
        return None, 0


# ── Remote File Download & Store ──────────────────────────────────────────────

async def download_and_store(
    download_url: str,
    filename: str,
    project_id: str,
    document_type: str,
    user_id: str,
    graph_token: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Download a remote file (SharePoint or S3 presigned URL) and persist it as a VVDocument.
    Returns {"doc_id": str, "name": str} or {"error": str}.
    Background processing (_process_document) is started by the caller (folder_ingest endpoint).
    """
    import uuid as _uuid

    from app.core import storage
    from app.core.database import SessionLocal
    from app.models.vv_models import VVDocument

    headers = {}
    if graph_token:
        headers["Authorization"] = f"Bearer {graph_token}"

    try:
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            resp = await client.get(download_url, headers=headers)
            if resp.status_code != 200:
                return {"error": f"Download failed (HTTP {resp.status_code})"}
            content = resp.content
    except Exception as e:
        return {"error": f"Download error: {e}"}

    ext = os.path.splitext(filename)[-1].lower() or ".pdf"
    file_id = str(_uuid.uuid4())
    upload_dir = os.environ.get("UPLOAD_DIR", "/app/uploads")
    os.makedirs(upload_dir, exist_ok=True)
    tmp_path = os.path.join(upload_dir, f"{file_id}{ext}")

    with open(tmp_path, "wb") as fh:
        fh.write(content)

    stored_path = storage.save(tmp_path, f"vv-docs/{file_id}{ext}")

    db = SessionLocal()
    try:
        doc = VVDocument(
            project_id=_uuid.UUID(project_id),
            name=filename,
            file_type=ext.lstrip("."),
            document_type=document_type,
            storage_path=stored_path,
            file_size=len(content),
            status="uploaded",
            uploaded_by=_uuid.UUID(user_id),
        )
        db.add(doc)
        db.commit()
        db.refresh(doc)
        return {"doc_id": str(doc.id), "name": filename}
    except Exception as e:
        return {"error": f"DB error: {e}"}
    finally:
        db.close()
