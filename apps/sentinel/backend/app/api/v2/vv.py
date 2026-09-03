"""
V&V API — Third-Party Verification & Validation endpoints
"""
import contextlib
import io
import logging
import os
import zipfile
from collections import defaultdict
from datetime import datetime, timedelta
from uuid import UUID

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
)
from sqlalchemy.orm import Session, object_session

from app.core import storage
from app.core.database import SessionLocal, get_db
from app.core.security import get_current_user
from app.engines.vv.registry_rulesets import (
    get_ruleset,
)
from app.engines.vv.verification_engine import VerificationEngine
from app.models.vv_models import (
    VVAuditLog,
    VVCar,
    VVCheckpoint,
    VVDecision,
    VVDocument,
    VVDocumentComment,
    VVNotificationPreference,
    VVProject,
    VVRegistrySubmission,
    VVRegistrySync,
    VVReport,
    VVRfi,
)
from app.models import VVProtocol, VVCheckpointDef

router = APIRouter()
logger = logging.getLogger("datasentinel.vv")


def _as_date(val):
    """Return a datetime.date from either a datetime.datetime or a datetime.date.

    startup.py creates submission_deadline and expiry_date as PostgreSQL DATE columns;
    the ORM model declares them DateTime(timezone=True).  psycopg2 returns datetime.date
    for DATE columns, so .date() would raise AttributeError.  This helper handles both.
    """
    if val is None:
        return None
    return val.date() if isinstance(val, datetime) else val


# F004: Allowlist for V&V document uploads
ALLOWED_VV_EXTENSIONS = {
    ".csv", ".xlsx", ".xls", ".xlsm",  # data files (xlsm = macro-enabled workbook)
    ".pdf",                             # reports / certificates
    ".docx", ".doc",                    # Word documents
    ".txt",                             # plain text logs / export files
    ".html",                            # HTML reports / web exports
    ".pptx",                            # PowerPoint presentations
    ".json",                            # structured data
    ".png", ".jpg", ".jpeg",            # images / scans
}

# ── Registries ──────────────────────────────────────────────────────────────
@router.get("/registries")
def list_registries(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """List all supported registries and their methodologies."""
    built_in = [
        {
            "id": "puro_earth", "name": "Puro.Earth", "slug": "puro_earth",
            "logo": "🌱", "description": "Leading registry for engineered carbon removal",
            "methodologies": [
                {"code":"PURO-CCS-GSC","name":"Carbon Capture & Storage (GSC)","slug":"puro_earth_ccs","checkpoints":23},
                {"code":"PURO-BIOCHAR-V2","name":"Biochar Carbon Removal","slug":"puro_earth_biochar","checkpoints":10},
            ]
        },
        {
            "id": "isometric", "name": "Isometric", "slug": "isometric",
            "logo": "⬡", "description": "Science-based carbon removal verification",
            "methodologies": [
                {"code":"ISO-BIOCHAR-V1","name":"Biochar Permanence Protocol","slug":"isometric_biochar","checkpoints":5},
            ]
        },
        {
            "id": "gold_standard", "name": "Gold Standard", "slug": "gold_standard",
            "logo": "⭐", "description": "UN-endorsed carbon standard",
            "methodologies": [
                {"code":"GS-ICS-V3","name":"Improved Cookstoves","slug":"gold_standard_cookstoves","checkpoints":5},
            ]
        },
        {
            "id": "verra", "name": "Verra (VCS)", "slug": "verra",
            "logo": "🔷", "description": "Verified Carbon Standard",
            "methodologies": [
                {"code":"VM0044-V1","name":"Biochar Methodology VM0044","slug":"verra_biochar","checkpoints":4},
            ]
        },
    ]
    return built_in

# ── Projects ────────────────────────────────────────────────────────────────
@router.get("/projects")
def list_vv_projects(db: Session = Depends(get_db), user=Depends(get_current_user)):
    from sqlalchemy import func, or_
    role = getattr(user, "role", "analyst")
    q = db.query(VVProject)
    if role not in ("admin", "super_admin"):
        # Non-admins see only projects they created or are assigned as verifier
        q = q.filter(
            or_(
                VVProject.created_by == user.id,
                VVProject.assigned_verifier == user.id,
            )
        )
    projects = q.order_by(VVProject.created_at.desc()).all()
    if not projects:
        return []
    project_ids = [p.id for p in projects]
    # Single aggregate queries instead of N+1
    doc_counts = dict(db.query(VVDocument.project_id, func.count(VVDocument.id))
                      .filter(VVDocument.project_id.in_(project_ids))
                      .group_by(VVDocument.project_id).all())
    cp_stats = {}
    for cp in db.query(VVCheckpoint).filter(VVCheckpoint.project_id.in_(project_ids)).all():
        pid = cp.project_id
        if pid not in cp_stats:
            cp_stats[pid] = {'total':0,'passed':0,'failed':0,'warnings':0}
        cp_stats[pid]['total'] += 1
        if cp.status == 'passed': cp_stats[pid]['passed'] += 1
        elif cp.status == 'failed': cp_stats[pid]['failed'] += 1
        elif cp.status == 'warning': cp_stats[pid]['warnings'] += 1
    # Pass an empty dict (not None) for projects with no checkpoints so _project_out
    # uses the pre-fetched stats and avoids N+1 queries.
    return [_project_out(p, db, _doc_count=doc_counts.get(p.id,0), _cp_stats=cp_stats.get(p.id, {})) for p in projects]

@router.post("/projects")
def create_vv_project(data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Project name is required")
    registry_slug    = data.get("registry_slug")    or "puro_earth_ccs"
    methodology_code = data.get("methodology_code") or "PURO-CCS-GSC"
    user_description = data.get("description") or ""

    # Feature toggles — caller can pass a dict; missing keys default to True.
    # All-None means all features enabled (backward compatible).
    raw_features = data.get("features_enabled")
    if raw_features and isinstance(raw_features, dict):
        all_features = ["cars", "rfis", "ai_deep_analysis", "consistency_check", "decision", "registry_sync"]
        features_enabled = {f: raw_features.get(f, True) for f in all_features}
    else:
        features_enabled = None  # NULL = all enabled (existing projects unaffected)

    project = VVProject(
        name=name,
        description=f"REGISTRY:{registry_slug}|METHODOLOGY:{methodology_code}|{user_description}",
        registry_id=None, methodology_id=None,
        project_developer=(data.get("project_developer") or "").strip(),
        location=(data.get("location") or "").strip(),
        vintage_year=data.get("vintage_year") or 2024,
        status="submitted",
        created_by=user.id,
        features_enabled=features_enabled,
    )
    db.add(project); db.commit(); db.refresh(project)
    return _project_out(project, db)

@router.get("/projects/{project_id}")
def get_vv_project(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p: raise HTTPException(404, "Project not found")
    return _project_out(p, db)

@router.patch("/projects/{project_id}")
def update_vv_project(project_id: UUID, data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p: raise HTTPException(404, "Project not found")
    # Fix (IDOR): PATCH lacked the ownership check that DELETE already enforced
    role = getattr(user, "role", "")
    if role not in ("admin", "super_admin") and str(p.created_by) != str(user.id):
        raise HTTPException(403, "Only admins or the project owner can update this project")
    for f in ["name","status","project_developer","location","vintage_year"]:
        if f in data: setattr(p, f, data[f])
    # Submission deadline — accept ISO date string or null
    if "submission_deadline" in data:
        raw = data["submission_deadline"]
        if raw is None:
            p.submission_deadline = None
        else:
            try:
                from datetime import datetime as dt
                p.submission_deadline = dt.fromisoformat(str(raw).replace("Z", "+00:00"))
            except ValueError:
                raise HTTPException(400, f"submission_deadline must be an ISO date string, got: {raw!r}")
    db.commit(); db.refresh(p)
    _log_action(db, project_id=str(project_id), actor_id=str(user.id),
                actor_name=getattr(user, 'full_name', '') or getattr(user, 'email', ''),
                action='project_updated', metadata={k: data[k] for k in data if k != 'description'})
    return _project_out(p, db)

@router.delete("/projects/{project_id}", status_code=204)
def delete_vv_project(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p: raise HTTPException(404, "Project not found")
    # Only admins or the project owner can delete
    role = getattr(user, "role", "")
    if role not in ("admin", "super_admin") and str(p.created_by) != str(user.id):
        raise HTTPException(403, "Only admins or the project owner can delete this project")
    db.delete(p)
    db.commit()

# ── Documents ───────────────────────────────────────────────────────────────
@router.post("/projects/{project_id}/documents")
async def upload_vv_document(
    project_id: UUID,
    file: UploadFile = File(...),
    document_type: str = Form("monitoring_data"),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p: raise HTTPException(404, "Project not found")

    # F004: Validate file extension against allowlist
    ext = os.path.splitext(file.filename or "")[1].lower() or ".csv"
    if ext not in ALLOWED_VV_EXTENSIONS:
        raise HTTPException(
            400,
            f"File type '{ext}' is not permitted. Allowed types: {', '.join(sorted(ALLOWED_VV_EXTENSIONS))}"
        )

    # F013: Enforce upload size limit (100 MB for V&V documents)
    MAX_VV_UPLOAD_BYTES = 100 * 1024 * 1024
    content = await file.read()
    if len(content) > MAX_VV_UPLOAD_BYTES:
        raise HTTPException(400, f"File exceeds the 100 MB upload limit ({len(content) // (1024*1024)} MB received)")

    upload_dir = os.environ.get("UPLOAD_DIR", "/app/uploads")
    os.makedirs(upload_dir, exist_ok=True)
    import uuid as uuid_mod
    file_id = str(uuid_mod.uuid4())
    tmp_path = os.path.join(upload_dir, f"{file_id}{ext}")

    with open(tmp_path, "wb") as f_out:
        f_out.write(content)

    file_type = ext.lstrip(".")
    file_size = os.path.getsize(tmp_path)

    # Persist to S3 (production) or keep local (dev)
    stored_path = storage.save(tmp_path, f"vv-docs/{file_id}{ext}")

    doc = VVDocument(
        project_id=project_id,
        name=file.filename,
        file_type=file_type,
        document_type=document_type,
        storage_path=stored_path,
        file_size=file_size,
        status="uploaded",
        uploaded_by=user.id,
    )
    db.add(doc); db.commit(); db.refresh(doc)

    _log_action(db, project_id=str(project_id), document_id=str(doc.id),
                actor_id=str(user.id), actor_name=getattr(user, 'full_name', '') or getattr(user, 'email', ''),
                action='document_uploaded', metadata={'document_type': document_type, 'filename': file.filename})
    # Non-blocking SES notification (F012)
    background_tasks.add_task(
        _send_notification_bg, str(project_id), 'on_document_uploaded',
        f"New Document Uploaded — {file.filename}",
        f"A new document '{file.filename}' ({document_type}) was uploaded to project '{p.name}'.",
    )

    # Auto-process — BackgroundTasks replaces daemon thread (F012)
    background_tasks.add_task(_process_document, str(doc.id))

    return _doc_out(doc)


@router.post("/projects/{project_id}/documents/{doc_id}/re-extract")
def re_extract_document(
    project_id: UUID, doc_id: UUID,
    db: Session = Depends(get_db), user=Depends(get_current_user),
):
    """Re-trigger content extraction for a document stuck in 'processing' or 'error' state."""
    import threading
    doc = db.query(VVDocument).filter(VVDocument.id == doc_id, VVDocument.project_id == project_id).first()
    if not doc:
        raise HTTPException(404, "Document not found")
    doc.status = "uploaded"   # reset so _process_document picks it up cleanly
    doc.extracted_data = {}
    doc.extraction_summary = None
    doc.row_count = None
    doc.column_count = None
    db.commit()
    # Use a daemon thread instead of BackgroundTasks — more reliable under gunicorn workers
    threading.Thread(target=_process_document, args=(str(doc.id),), daemon=True).start()
    _log_action(db, project_id=str(project_id), document_id=str(doc_id),
                actor_id=str(user.id), actor_name=getattr(user, 'full_name', '') or getattr(user, 'email', ''),
                action='document_re_extracted', metadata={'filename': doc.name})
    return {"status": "queued", "doc_id": str(doc.id)}


@router.post("/projects/{project_id}/documents/{doc_id}/replace")
async def replace_vv_document(
    project_id: UUID,
    doc_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Replace the file content of an existing document in-place.

    Preserves the document ID (so all audit log entries, comments and
    checkpoint references remain intact) but swaps out the stored file,
    resets extraction state and clears the previous validation / review result
    so the new content is processed fresh.
    """
    import threading

    doc = db.query(VVDocument).filter(
        VVDocument.id == doc_id,
        VVDocument.project_id == project_id,
    ).first()
    if not doc:
        raise HTTPException(404, "Document not found")

    # --- Validate new file extension ---
    ext = os.path.splitext(file.filename or "")[1].lower() or ".csv"
    if ext not in ALLOWED_VV_EXTENSIONS:
        raise HTTPException(
            400,
            f"File type '{ext}' is not permitted. Allowed types: {', '.join(sorted(ALLOWED_VV_EXTENSIONS))}",
        )

    # --- Read & size-check ---
    MAX_VV_UPLOAD_BYTES = 100 * 1024 * 1024
    content = await file.read()
    if len(content) > MAX_VV_UPLOAD_BYTES:
        raise HTTPException(
            400,
            f"File exceeds the 100 MB upload limit ({len(content) // (1024 * 1024)} MB received)",
        )

    import traceback as _tb

    # --- Save new file to storage ---
    upload_dir = os.environ.get("UPLOAD_DIR", "/app/uploads")
    os.makedirs(upload_dir, exist_ok=True)
    import uuid as uuid_mod
    file_id = str(uuid_mod.uuid4())
    tmp_path = os.path.join(upload_dir, f"{file_id}{ext}")
    try:
        with open(tmp_path, "wb") as f_out:
            f_out.write(content)
    except Exception as e:
        logger.error(f"Replace: could not write temp file: {e}\n{_tb.format_exc()}")
        raise HTTPException(500, f"Could not write temp file: {type(e).__name__}: {str(e)}")

    try:
        new_stored_path = storage.save(tmp_path, f"vv-docs/{file_id}{ext}")
    except Exception as e:
        logger.error(f"Replace: S3 upload failed for doc {doc_id}: {e}\n{_tb.format_exc()}")
        raise HTTPException(500, f"File storage failed: {type(e).__name__}: {str(e)}")

    # --- Capture metadata for audit log and new record ---
    old_filename = doc.name
    actor_name = getattr(user, "full_name", "") or getattr(user, "email", "")

    # Determine the uploaded_at anchor for ordering: the replacement will sort
    # immediately after the original by using original.uploaded_at + 1 second.
    original_uploaded_at = doc.uploaded_at or datetime.utcnow()

    # --- Rename original doc to "[name] (Original)" so it stays in position ---
    try:
        # Only add the suffix once (idempotent if Replace is called twice)
        if not doc.name.endswith(" (Original)"):
            doc.name = f"{doc.name} (Original)"
        db.commit()
    except Exception as e:
        logger.error(f"Replace: could not rename original doc {doc_id}: {e}\n{_tb.format_exc()}")
        try:
            db.rollback()
        except Exception:
            pass
        raise HTTPException(500, f"Database update failed: {type(e).__name__}: {str(e)}")

    # --- Create a NEW document record for the replacement ---
    # Inherit the folder path prefix from the original so the replacement
    # lands in the same section group in the UI.
    # e.g. original "01. Admin/2. Contracts/old.pdf (Original)"
    #   → replacement "01. Admin/2. Contracts/new.pdf"
    original_parts = old_filename.split('/')
    if len(original_parts) > 1:
        path_prefix = '/'.join(original_parts[:-1])
        replacement_name = f"{path_prefix}/{file.filename}"
    else:
        replacement_name = file.filename

    import uuid as uuid_mod
    new_doc = VVDocument(
        id=uuid_mod.uuid4(),
        project_id=project_id,
        name=replacement_name,
        file_type=ext.lstrip("."),
        document_type=doc.document_type,   # same section as the original
        storage_path=new_stored_path,
        file_size=len(content),
        status="uploaded",
        extracted_data={},
        extraction_summary=None,
        row_count=None,
        column_count=None,
        uploaded_by=user.id,
        # Sort immediately after the original within the same group
        uploaded_at=original_uploaded_at + timedelta(seconds=1),
        review_status="draft",
        review_notes="Replacement upload — review required.",
    )
    try:
        db.add(new_doc)
        db.commit()
        db.refresh(new_doc)
    except Exception as e:
        logger.error(f"Replace: could not create replacement doc: {e}\n{_tb.format_exc()}")
        try:
            db.rollback()
        except Exception:
            pass
        raise HTTPException(500, f"Database insert failed: {type(e).__name__}: {str(e)}")

    _log_action(
        db,
        project_id=str(project_id),
        document_id=str(new_doc.id),
        actor_id=str(user.id),
        actor_name=actor_name,
        action="document_replaced",
        metadata={"original_doc_id": str(doc_id), "original_filename": old_filename,
                  "new_filename": file.filename, "replaced_by": actor_name},
    )

    # Trigger extraction for the new replacement document
    threading.Thread(target=_process_document, args=(str(new_doc.id),), daemon=True).start()

    return {"status": "replaced", "original_doc_id": str(doc_id),
            "new_doc_id": str(new_doc.id), "new_filename": file.filename}


@router.get("/projects/{project_id}/documents")
def list_vv_documents(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    docs = db.query(VVDocument).filter(
        VVDocument.project_id == project_id,
        (VVDocument.is_deleted == False) | (VVDocument.is_deleted == None)
    ).order_by(VVDocument.uploaded_at.asc()).all()
    return [_doc_out(d) for d in docs]

def _mime_for(file_type: str | None) -> str:
    """Return the MIME type for a given file extension."""
    return {
        "pdf":  "application/pdf",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xls":  "application/vnd.ms-excel",
        "xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "doc":  "application/msword",
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "csv":  "text/csv",
        "json": "application/json",
        "txt":  "text/plain",
        "html": "text/html",
    }.get((file_type or "").lower(), "application/octet-stream")


@router.get("/projects/{project_id}/documents/{doc_id}/download")
def download_vv_document(
    project_id: UUID,
    doc_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Download or inline-view a VV document.
    - S3 storage: returns a 302 redirect to a 5-minute presigned URL.
    - Local storage (dev): streams the file directly.
    PDFs are served with Content-Disposition: inline so the browser renders
    them in-tab; all other types use attachment so they download.
    """
    from app.core import storage as _storage
    doc = db.query(VVDocument).filter(
        VVDocument.id == doc_id,
        VVDocument.project_id == project_id,
        (VVDocument.is_deleted == False) | (VVDocument.is_deleted == None),
    ).first()
    if not doc:
        raise HTTPException(404, "Document not found")

    filename = doc.name or f"document.{doc.file_type or 'bin'}"
    is_inline = (doc.file_type or "").lower() == "pdf"
    disposition = "inline" if is_inline else f'attachment; filename="{filename}"'
    mime = _mime_for(doc.file_type)

    if _storage.use_s3():
        from app.core.config import settings
        import boto3
        s3 = boto3.client("s3", region_name=settings.AWS_REGION)
        presigned = s3.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": settings.AWS_S3_BUCKET,
                "Key":    doc.storage_path,
                "ResponseContentDisposition": disposition,
                "ResponseContentType": mime,
            },
            ExpiresIn=300,  # 5 minutes — plenty of time to open in the browser
        )
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=presigned, status_code=302)

    else:
        import os
        from fastapi.responses import FileResponse
        if not doc.storage_path or not os.path.exists(doc.storage_path):
            raise HTTPException(404, "File not found on server")
        return FileResponse(
            path=doc.storage_path,
            media_type=mime,
            filename=filename,
            headers={"Content-Disposition": disposition},
        )


@router.delete("/projects/{project_id}/documents/{doc_id}")
def delete_vv_document(project_id: UUID, doc_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    doc = db.query(VVDocument).filter(VVDocument.id == doc_id, VVDocument.project_id == project_id).first()
    if not doc: raise HTTPException(404, "Document not found")
    # V6: Soft-delete — admin can permanently delete, others soft-delete
    if getattr(user, 'role', 'analyst') == 'admin':
        # Admin: soft-delete (preserve for audit trail)
        doc.is_deleted = True
        doc.deleted_at = datetime.utcnow()
        doc.deleted_by_name = getattr(user, 'full_name', None) or getattr(user, 'email', 'unknown')
        db.commit()
        _log_action(db, project_id=str(project_id), document_id=str(doc_id),
                    actor_id=str(user.id), actor_name=getattr(user, 'full_name', '') or getattr(user, 'email', ''),
                    action='document_deleted', metadata={'document_name': doc.name})
    else:
        # Non-admin: soft-delete only
        doc.is_deleted = True
        doc.deleted_at = datetime.utcnow()
        doc.deleted_by_name = getattr(user, 'full_name', None) or getattr(user, 'email', 'unknown')
        db.commit()
        _log_action(db, project_id=str(project_id), document_id=str(doc_id),
                    actor_id=str(user.id), actor_name=getattr(user, 'full_name', '') or getattr(user, 'email', ''),
                    action='document_deleted', metadata={'document_name': doc.name})
    return {"deleted": str(doc_id)}


@router.post("/projects/{project_id}/clear-documents")
def clear_all_documents(
    project_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Soft-delete all documents for a project and record a single audit event."""
    docs = (
        db.query(VVDocument)
        .filter(VVDocument.project_id == project_id, VVDocument.is_deleted == False)
        .all()
    )
    count = len(docs)
    actor_name = getattr(user, 'full_name', '') or getattr(user, 'email', '')
    now = datetime.utcnow()
    for doc in docs:
        doc.is_deleted = True
        doc.deleted_at = now
        doc.deleted_by_name = actor_name
    db.commit()
    _log_action(
        db,
        project_id=str(project_id),
        actor_id=str(user.id),
        actor_name=actor_name,
        action='documents_cleared',
        metadata={'count': count, 'cleared_by': actor_name},
    )
    return {"cleared": count}


@router.post("/projects/{project_id}/reset")
def reset_project(
    project_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Super-admin only: permanently delete all documents, checkpoints, reports,
    comments, and audit log entries, then reset project status to 'submitted'.
    This is irreversible.
    """
    if getattr(user, 'role', '') not in ('super_admin', 'admin'):
        raise HTTPException(403, "Only Admins can reset a project")

    project = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")

    actor_name = getattr(user, 'full_name', '') or getattr(user, 'email', '')

    # Hard-delete comments first (FK → documents)
    doc_ids = [str(d.id) for d in db.query(VVDocument.id).filter(VVDocument.project_id == project_id).all()]
    if doc_ids:
        db.query(VVDocumentComment).filter(VVDocumentComment.document_id.in_(doc_ids)).delete(synchronize_session=False)

    # Hard-delete documents
    db.query(VVDocument).filter(VVDocument.project_id == project_id).delete(synchronize_session=False)

    # Hard-delete checkpoints
    db.query(VVCheckpoint).filter(VVCheckpoint.project_id == project_id).delete(synchronize_session=False)

    # Hard-delete reports
    db.query(VVReport).filter(VVReport.project_id == project_id).delete(synchronize_session=False)

    # Hard-delete audit log
    db.query(VVAuditLog).filter(VVAuditLog.project_id == str(project_id)).delete(synchronize_session=False)

    # Hard-delete RFIs (table added in startup migration; guard for safety)
    try:
        db.query(VVRfi).filter(VVRfi.project_id == project_id).delete(synchronize_session=False)
    except Exception:
        db.rollback()

    # Hard-delete registry sync records (table added in startup migration; guard for safety)
    try:
        db.query(VVRegistrySync).filter(VVRegistrySync.project_id == project_id).delete(synchronize_session=False)
    except Exception:
        db.rollback()

    # Reset project to initial state — including cached consistency result
    project.status = 'submitted'
    project.updated_at = datetime.utcnow()
    # Clear the deferred consistency-check cache so the tab shows empty after reset
    try:
        project.last_consistency_result = None
        project.last_consistency_run_at = None
    except Exception:
        pass  # columns may not exist yet in very old deployments

    db.commit()

    logger.info(
        "Project %s fully reset by super_admin %s",
        project_id, actor_name,
    )
    return {"reset": True, "project_id": str(project_id)}


# ── Smart Folder Connector ─────────────────────────────────────────────────────

@router.post("/projects/{project_id}/classify-documents")
async def classify_documents_endpoint(
    project_id: UUID,
    data: dict,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Phase 1 (Local) — AI-classify a list of files from filename + optional content preview.
    Input:  {files: [{filename, extension, content_preview}]}
    Output: [{filename, suggested_type, confidence_pct, reasoning}]
    """
    from app.engines.vv.folder_connector import classify_documents_with_ai
    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")
    files = data.get("files", [])
    if not files:
        return []
    try:
        return await classify_documents_with_ai(files)
    except Exception as exc:
        # classify_documents_with_ai always falls back to keywords — this path
        # should be unreachable, but guard it so callers never see a bare 500.
        logger.warning("classify_documents_with_ai raised unexpectedly: %s", exc)
        raise HTTPException(503, "Document classification temporarily unavailable — please retry")


@router.post("/projects/{project_id}/connect-sharepoint")
async def connect_sharepoint_endpoint(
    project_id: UUID,
    data: dict,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Phase 2 (SharePoint) — Scan a SharePoint folder via Microsoft Graph API, classify with AI.
    Input:  {folder_url, graph_token}
    Output: {files: [{name, size, download_url, suggested_type, confidence_pct, reasoning}], total}
    """
    from app.engines.vv.folder_connector import (
        classify_documents_with_ai,
        fetch_sharepoint_files,
    )
    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")

    folder_url = (data.get("folder_url") or "").strip()
    graph_token = (data.get("graph_token") or "").strip()
    if not folder_url or not graph_token:
        raise HTTPException(400, "folder_url and graph_token are required")

    raw_files = await fetch_sharepoint_files(folder_url, graph_token)
    if raw_files and "error" in raw_files[0]:
        raise HTTPException(400, raw_files[0]["error"])
    if not raw_files:
        return {"files": [], "total": 0, "message": "No supported files found in this SharePoint folder"}

    file_inputs = [{"filename": f["name"], "extension": f.get("extension", "")} for f in raw_files]
    classifications = await classify_documents_with_ai(file_inputs)
    class_map = {c["filename"]: c for c in classifications}

    result = []
    for f in raw_files:
        cl = class_map.get(f["name"], {})
        result.append({
            **f,
            "suggested_type": cl.get("suggested_type"),
            "confidence_pct": cl.get("confidence_pct", 0),
            "reasoning": cl.get("reasoning", ""),
        })
    return {"files": result, "total": len(result)}


@router.post("/projects/{project_id}/connect-s3")
async def connect_s3_endpoint(
    project_id: UUID,
    data: dict,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Phase 3 (S3) — List files in an S3 bucket prefix, classify with AI.
    Input:  {bucket, prefix}
    Output: {files: [{name, size, s3_key, download_url, suggested_type, confidence_pct}], total}
    """
    from app.engines.vv.folder_connector import (
        classify_documents_with_ai,
        fetch_s3_files,
    )
    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")

    bucket = (data.get("bucket") or "").strip()
    prefix = (data.get("prefix") or "").strip()
    if not bucket:
        raise HTTPException(400, "bucket is required")

    raw_files = fetch_s3_files(bucket, prefix)
    if raw_files and "error" in raw_files[0]:
        raise HTTPException(400, raw_files[0]["error"])
    if not raw_files:
        return {"files": [], "total": 0, "message": "No supported files found at this S3 path"}

    file_inputs = [{"filename": f["name"], "extension": f.get("extension", "")} for f in raw_files]
    classifications = await classify_documents_with_ai(file_inputs)
    class_map = {c["filename"]: c for c in classifications}

    result = []
    for f in raw_files:
        cl = class_map.get(f["name"], {})
        result.append({
            **f,
            "suggested_type": cl.get("suggested_type"),
            "confidence_pct": cl.get("confidence_pct", 0),
            "reasoning": cl.get("reasoning", ""),
        })
    return {"files": result, "total": len(result)}


@router.post("/projects/{project_id}/folder-ingest")
async def folder_ingest_endpoint(
    project_id: UUID,
    data: dict,
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Phase 2/3 — Download and ingest accepted remote files (SharePoint / S3 presigned URLs).
    Input:  {files: [{name, document_type, download_url, graph_token (optional)}]}
    Output: {ingested, errors, files: [{name, status, doc_id?}]}
    """
    from app.engines.vv.folder_connector import download_and_store
    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")

    files = data.get("files", [])
    if not files:
        raise HTTPException(400, "No files provided")

    results = []
    for f in files:
        res = await download_and_store(
            download_url=f["download_url"],
            filename=f["name"],
            project_id=str(project_id),
            document_type=f.get("document_type", "other"),
            user_id=str(user.id),
            graph_token=f.get("graph_token"),
        )
        if "doc_id" in res:
            background_tasks.add_task(_process_document, res["doc_id"])
            results.append({"name": f["name"], "status": "ingested", "doc_id": res["doc_id"]})
        else:
            results.append({"name": f["name"], "status": "error", "error": res.get("error", "Unknown")})

    return {
        "ingested": sum(1 for r in results if r["status"] == "ingested"),
        "errors":   sum(1 for r in results if r["status"] == "error"),
        "files": results,
    }

# ── Audit log helper ─────────────────────────────────────────────────────────
def _log_action(db, *, project_id=None, document_id=None, actor_id=None, actor_name=None, action, metadata=None):
    # Coerce non-UUID sentinel values (e.g. "system") to None so PostgreSQL is
    # never handed a string that fails UUID validation.  actor_name already
    # carries the human-readable label ("AI Classifier", "System", etc.) so no
    # information is lost.
    import uuid as _uuid_mod
    if actor_id is not None:
        try:
            _uuid_mod.UUID(str(actor_id))
        except (ValueError, AttributeError):
            actor_id = None  # not a valid UUID — store as system/anonymous action
    try:
        entry = VVAuditLog(
            project_id=project_id, document_id=document_id,
            actor_id=actor_id, actor_name=actor_name,
            action=action, log_data=metadata or {},
        )
        db.add(entry); db.commit()
    except Exception as e:
        logger.warning(f"Audit log write failed: {e}")
        # CRITICAL: always rollback after a failed commit so the session is not
        # left in PendingRollbackError state.  Without this, every subsequent DB
        # operation in the same session raises PendingRollbackError even though
        # the original work (e.g. document extraction) succeeded.
        try:
            db.rollback()
        except Exception:
            pass


# ── Portfolio dashboard ───────────────────────────────────────────────────────
@router.get("/portfolio")
def get_portfolio(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Aggregate all projects with completeness, expiry count, and last activity."""
    projects = db.query(VVProject).order_by(VVProject.created_at.desc()).all()
    if not projects:
        return []
    today = datetime.utcnow().date()

    # Batch-load all non-deleted documents in ONE query (F012 N+1 fix)
    project_ids = [p.id for p in projects]
    all_docs = db.query(VVDocument).filter(
        VVDocument.project_id.in_(project_ids),
        (VVDocument.is_deleted == False) | (VVDocument.is_deleted == None)
    ).all()

    # Group docs by project_id
    docs_by_project: dict = defaultdict(list)
    for d in all_docs:
        docs_by_project[d.project_id].append(d)

    result = []
    for p in projects:
        docs = docs_by_project.get(p.id, [])
        # Completeness: methodology → required doc types
        methodology_code = ""
        registry_slug = ""
        if p.description and "REGISTRY:" in p.description:
            registry_slug = p.description.split("REGISTRY:")[1].split("|")[0]
        if p.description and "METHODOLOGY:" in p.description:
            methodology_code = p.description.split("METHODOLOGY:")[1].split("|")[0]
        required = _get_required_doc_types(methodology_code, db)
        uploaded_types = {d.document_type for d in docs}
        met = [r for r in required if r in uploaded_types]
        pct = int(len(met) / len(required) * 100) if required else 0
        # Expiry warnings
        expiring = sum(1 for d in docs if d.expiry_date and _as_date(d.expiry_date) <= today + timedelta(days=60))
        # Last activity
        last_at = max((d.uploaded_at for d in docs if d.uploaded_at), default=p.created_at)
        result.append({
            "id": str(p.id), "name": p.name, "status": p.status,
            "registry_slug": registry_slug, "methodology_code": methodology_code,
            "project_developer": p.project_developer, "location": p.location,
            "vintage_year": p.vintage_year,
            "submission_deadline": p.submission_deadline.isoformat() if getattr(p, 'submission_deadline', None) else None,
            "document_count": len(docs),
            "pct_complete": pct,
            "missing_count": len(required) - len(met),
            "requirements_count": len(required),
            "expiring_count": expiring,
            "last_activity": last_at.isoformat() if last_at else None,
            "created_at": p.created_at.isoformat(),
        })
    return result


# ── Completeness scorecard ────────────────────────────────────────────────────

# Safety alias map — redirects any lingering old codes to the current ones.
# The startup.py migration rewrites these in the DB on every deploy, but this
# map catches any edge-case records that haven't been migrated yet.
_METHODOLOGY_ALIASES: dict = {
    "PURO-CCS-ACE2": "PURO-CCS-GSC",   # renamed; DB migrated via startup.py
}

def _get_required_doc_types(methodology_code: str, db: Session) -> list:
    """Return required document types for a methodology code.

    Looks up the VVProtocol by code, then collects the union of all
    evidence_types across its VVCheckpointDef rows.  This makes the
    completeness scorecard driven entirely by what is defined in the
    Protocol Manager — no hardcoded matrix needed.

    Falls back to a minimal 3-doc set if the protocol is not found.
    """
    code = (methodology_code or "").strip().upper().replace(" ", "-")
    # Resolve any legacy aliases
    code = _METHODOLOGY_ALIASES.get(code, code)
    if not code:
        return ["project_description", "lca_report", "monitoring_data"]

    # Find the protocol — case-insensitive
    protocol = (
        db.query(VVProtocol)
        .filter(VVProtocol.code.ilike(code))
        .first()
    )
    if not protocol:
        logger.warning(f"_get_required_doc_types: no protocol found for code '{code}', using fallback")
        return ["project_description", "lca_report", "monitoring_data"]

    # Collect every evidence_type declared across all checkpoint definitions
    checkpoint_defs = (
        db.query(VVCheckpointDef)
        .filter(VVCheckpointDef.protocol_id == protocol.id)
        .all()
    )
    required: set[str] = set()
    for cd in checkpoint_defs:
        if cd.evidence_types and isinstance(cd.evidence_types, list):
            for et in cd.evidence_types:
                if et:
                    required.add(et)

    if not required:
        logger.warning(f"_get_required_doc_types: protocol '{code}' has no evidence_types on its checkpoints, using fallback")
        return ["project_description", "lca_report", "monitoring_data"]

    return sorted(required)


@router.get("/projects/{project_id}/completeness")
def get_project_completeness(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p: raise HTTPException(404, "Project not found")
    methodology_code = ""
    if p.description and "METHODOLOGY:" in p.description:
        methodology_code = p.description.split("METHODOLOGY:")[1].split("|")[0]
    required = _get_required_doc_types(methodology_code, db)
    docs = db.query(VVDocument).filter(
        VVDocument.project_id == project_id,
        (VVDocument.is_deleted == False) | (VVDocument.is_deleted == None)
    ).all()
    uploaded_types = {d.document_type for d in docs}
    missing = [r for r in required if r not in uploaded_types]
    met = [r for r in required if r in uploaded_types]
    pct = int(len(met) / len(required) * 100) if required else 0
    if pct == 100: colour = "green"
    elif pct >= 60: colour = "amber"
    else: colour = "red"
    return {
        "methodology_code": methodology_code,
        "required": required, "uploaded": list(uploaded_types),
        "met": met, "missing": missing,
        "pct_complete": pct, "colour": colour,
    }


# ── Feature #9: Methodology update alerts ───────────────────────────────────
# Last-updated dates for each supported methodology (ISO 8601).
# Update these whenever a new methodology version is officially published.
_METHODOLOGY_VERSIONS: dict = {
    "PURO-CCS-GSC":   {"version": "GSC-2024-03", "released": "2024-03-15", "notes": "Revised monitoring uncertainty quantification requirements (§7.3) and updated CO₂ storage permanence criteria."},
    "PURO-BIOCHAR-V2": {"version": "BIOCHAR-V2.1", "released": "2024-06-01", "notes": "Updated H:Corg ratio thresholds (from 0.7 to 0.6) and introduced mandatory third-party lab accreditation requirement."},
    "PURO-DAC-V1":     {"version": "DAC-V1.2",     "released": "2025-01-10", "notes": "Added new energy source verification requirements and updated lifecycle assessment boundary conditions."},
    "PURO-EW-V1":      {"version": "EW-V1.1",      "released": "2024-09-20", "notes": "Revised weathering rate calculation methodology and added new soil sampling requirements."},
    "ISO-BIOCHAR-V1.2":{"version": "ISO-20200-V1.2","released": "2024-11-01","notes": "Harmonised with ISO 20200:2024 amendment — new PAH threshold tables in Annex B."},
    "VM0044-V2":       {"version": "VM0044-V2.1",   "released": "2025-02-14", "notes": "Updated leakage accounting procedures and clarified permanence buffer pool contribution rates."},
}

@router.get("/projects/{project_id}/methodology-alert")
def get_methodology_alert(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Return an alert if the project's methodology has been updated since project creation."""
    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")

    # Resolve methodology code from description (VVProject has no methodology_code column;
    # the code is embedded as REGISTRY:...|METHODOLOGY:...|... in the description field)
    methodology_code = ""
    if p.description and "METHODOLOGY:" in p.description:
        methodology_code = p.description.split("METHODOLOGY:")[1].split("|")[0].strip()

    code_upper = methodology_code.upper().replace(" ", "-")
    meta = next((v for k, v in _METHODOLOGY_VERSIONS.items() if k.upper() == code_upper), None)

    if not meta:
        return {"has_alert": False, "methodology_code": methodology_code}

    from datetime import date as _date
    released_date = _date.fromisoformat(meta["released"])
    created_date  = (p.created_at.date() if p.created_at else _date.today())

    has_alert = released_date > created_date
    return {
        "has_alert":        has_alert,
        "methodology_code": methodology_code,
        "current_version":  meta["version"],
        "released":         meta["released"],
        "notes":            meta["notes"],
        "project_created":  created_date.isoformat(),
    }


# ── Feature #10: Benchmark dashboard ─────────────────────────────────────────
@router.get("/benchmarks")
def get_benchmarks(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Aggregate benchmarks across all V&V projects for the current tenant."""
    from sqlalchemy import func as sqlfunc  # noqa: F401
    from collections import Counter

    # VVProject does not have org_id — load all projects (org isolation handled at auth layer)
    projects = db.query(VVProject).all()

    if not projects:
        return {"total_projects": 0, "methodologies": [], "avg_docs": 0, "avg_checkpoints": 0,
                "avg_pass_rate": None, "rfi_stats": {}, "credit_estimates": []}

    proj_ids = [p.id for p in projects]

    # Per-methodology breakdown (code is stored in description as METHODOLOGY:CODE|...)
    meth_counter: Counter = Counter()
    for p in projects:
        if p.description and "METHODOLOGY:" in p.description:
            mc = p.description.split("METHODOLOGY:")[1].split("|")[0] or "Unknown"
        else:
            mc = "Unknown"
        meth_counter[mc] += 1

    # Document stats
    docs = db.query(VVDocument).filter(
        VVDocument.project_id.in_(proj_ids),
        (VVDocument.is_deleted == False) | (VVDocument.is_deleted == None),
    ).all()
    docs_per_proj: Counter = Counter(str(d.project_id) for d in docs)
    avg_docs = round(sum(docs_per_proj.values()) / len(projects), 1) if projects else 0

    # doc_type breakdown (top 10)
    type_counter: Counter = Counter(d.document_type for d in docs if d.document_type)
    top_doc_types = [{"type": t, "count": c} for t, c in type_counter.most_common(10)]

    # Checkpoint stats
    checkpoints = db.query(VVCheckpoint).filter(VVCheckpoint.project_id.in_(proj_ids)).all()
    cp_per_proj: Counter = Counter(str(c.project_id) for c in checkpoints)
    avg_checkpoints = round(sum(cp_per_proj.values()) / len(projects), 1) if projects else 0

    total_cps     = len(checkpoints)
    passed_cps    = sum(1 for c in checkpoints if c.verifier_status == "passed")
    avg_pass_rate = round(passed_cps / total_cps * 100, 1) if total_cps else None

    # RFI stats
    rfis = db.query(VVRfi).filter(VVRfi.project_id.in_(proj_ids)).all()
    rfi_by_severity: Counter = Counter(r.severity for r in rfis)
    rfi_by_status:   Counter = Counter(r.status   for r in rfis)
    rfis_per_proj:   Counter = Counter(str(r.project_id) for r in rfis)
    avg_rfis = round(sum(rfis_per_proj.values()) / len(projects), 1) if projects else 0

    # Credit estimates from reports
    reports = db.query(VVReport).filter(VVReport.project_id.in_(proj_ids)).all()
    credit_estimates = [r.credit_estimate for r in reports if r.credit_estimate is not None]
    avg_credits = round(sum(credit_estimates) / len(credit_estimates), 0) if credit_estimates else None

    # Outcome breakdown
    outcomes: Counter = Counter(r.overall_outcome for r in reports if r.overall_outcome)

    # Average time-to-report: days between project created_at and report generated_at
    durations = []
    proj_created = {str(p.id): p.created_at for p in projects}
    for r in reports:
        pc = proj_created.get(str(r.project_id))
        if pc and r.generated_at:
            durations.append((r.generated_at - pc).days)
    avg_days_to_report = round(sum(durations) / len(durations), 1) if durations else None

    return {
        "total_projects":    len(projects),
        "methodologies":     [{"code": k, "count": v} for k, v in meth_counter.most_common()],
        "avg_docs":          avg_docs,
        "avg_checkpoints":   avg_checkpoints,
        "avg_pass_rate":     avg_pass_rate,
        "avg_rfis":          avg_rfis,
        "top_doc_types":     top_doc_types,
        "rfi_by_severity":   dict(rfi_by_severity),
        "rfi_by_status":     dict(rfi_by_status),
        "outcomes":          dict(outcomes),
        "credit_estimates":  credit_estimates,
        "avg_credits":       avg_credits,
        "avg_days_to_report": avg_days_to_report,
    }


# ── Document expiry ───────────────────────────────────────────────────────────
@router.get("/projects/{project_id}/expiring-documents")
def get_expiring_documents(
    project_id: UUID,
    days: int = 60,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    cutoff = datetime.utcnow() + timedelta(days=days)
    docs = db.query(VVDocument).filter(
        VVDocument.project_id == project_id,
        VVDocument.expiry_date != None,
        VVDocument.expiry_date <= cutoff,
        (VVDocument.is_deleted == False) | (VVDocument.is_deleted == None)
    ).all()
    today = datetime.utcnow().date()
    return [
        {**_doc_out(d), "days_until_expiry": (_as_date(d.expiry_date) - today).days}
        for d in docs
    ]


@router.patch("/projects/{project_id}/documents/{doc_id}/expiry")
def set_document_expiry(
    project_id: UUID, doc_id: UUID, data: dict,
    db: Session = Depends(get_db), user=Depends(get_current_user)
):
    doc = db.query(VVDocument).filter(VVDocument.id == doc_id, VVDocument.project_id == project_id).first()
    if not doc: raise HTTPException(404, "Document not found")
    expiry_str = data.get("expiry_date")
    if expiry_str:
        from datetime import datetime as dt
        doc.expiry_date = dt.fromisoformat(expiry_str.replace("Z", "+00:00"))
    else:
        doc.expiry_date = None
    db.commit()
    _log_action(db, project_id=str(project_id), document_id=str(doc_id),
                actor_id=str(user.id), actor_name=getattr(user, 'full_name', '') or getattr(user, 'email', ''),
                action='expiry_date_set', metadata={'expiry_date': expiry_str})
    return _doc_out(doc)


@router.patch("/projects/{project_id}/documents/{doc_id}/retype")
def retype_document(
    project_id: UUID, doc_id: UUID, data: dict,
    db: Session = Depends(get_db), user=Depends(get_current_user)
):
    """Re-assign the document_type of an already-uploaded document in place.
    No file re-upload required. Body: { "document_type": "new_type_key" }
    Triggers scorecard recalculation on next completeness fetch.
    """
    doc = db.query(VVDocument).filter(
        VVDocument.id == doc_id,
        VVDocument.project_id == project_id,
        (VVDocument.is_deleted == False) | (VVDocument.is_deleted == None),
    ).first()
    if not doc:
        raise HTTPException(404, "Document not found")
    new_type = (data.get("document_type") or "").strip()
    if not new_type:
        raise HTTPException(422, "document_type is required")
    old_type = doc.document_type or ""
    doc.document_type = new_type
    db.commit()
    db.refresh(doc)
    actor_name = getattr(user, "full_name", None) or getattr(user, "email", "unknown")
    _log_action(
        db,
        project_id=str(project_id),
        document_id=str(doc_id),
        actor_id=str(user.id),
        actor_name=actor_name,
        action="document_retyped",
        metadata={"old_type": old_type, "new_type": new_type, "document_name": doc.name},
    )
    return _doc_out(doc)


# ── AI content validation ─────────────────────────────────────────────────────
DOC_VALIDATION_CHECKLISTS: dict = {
    "lca_report": ["System boundary defined","Functional unit stated","Emission factors cited","Net removal calculated","Third-party reviewed","ISO 14064 referenced"],
    "lab_report":  ["Sample ID present","Test date recorded","H:Corg ratio reported","TOC reported","PAH result included","Accredited lab stamp"],
    "chain_of_custody": ["Origin documented","Transfer records complete","Batch numbers match","Custody signatures present"],
    "monitoring_data": ["Date/time column present","Parameter units defined","Calibration reference","Data gap explanation"],
    "lca_spreadsheet": ["Input assumptions documented","Emission factors referenced","Net removal formula present","Version control"],
    "reservoir_modelling": ["Injectivity curve present","Trapping mechanisms described","Uncertainty range stated"],
    "project_description": ["Project name","Technology described","Scale/capacity stated","Location identified","Timeline provided"],
    "additionality_assessment": ["Financial barrier analysis","Regulatory barrier analysis","Common practice assessment","Conclusion stated"],
    "eia_sia": ["Scope defined","Impact categories covered","Mitigation measures","Stakeholder input"],
    "stakeholder_engagement": ["Communities identified","Consultation dates","Feedback documented","Grievance mechanism"],
}

DEFAULT_CHECKLIST = ["Document is legible","Key data present","Relevant to stated document type","No obvious data gaps"]


@router.post("/projects/{project_id}/documents/{doc_id}/validate")
async def validate_document_content(
    project_id: UUID, doc_id: UUID,
    db: Session = Depends(get_db), user=Depends(get_current_user)
):
    """AI-powered content validation: check document against type-specific checklist."""
    from app.engines.ai.claude_client import call_claude_json

    doc = db.query(VVDocument).filter(VVDocument.id == doc_id, VVDocument.project_id == project_id).first()
    if not doc: raise HTTPException(404, "Document not found")

    checklist = DOC_VALIDATION_CHECKLISTS.get(doc.document_type or "", DEFAULT_CHECKLIST)
    text_preview = (doc.extracted_data or {}).get("text") or (doc.extracted_data or {}).get("preview") or doc.extraction_summary or ""
    text_preview = str(text_preview)[:3000]

    system = "You are a carbon registry document compliance auditor. Respond with valid JSON only."
    prompt = f"""Validate the following document against its required checklist items.

Document type: {doc.document_type}
Document name: {doc.name}
Content preview:
{text_preview or "(no text extracted yet — base on filename and document type only)"}

Checklist to verify:
{chr(10).join(f"- {item}" for item in checklist)}

Return JSON:
{{
  "passed": true/false,
  "overall_score": 0-100,
  "summary": "1-2 sentence overall assessment",
  "checks": [
    {{"item": "checklist item", "status": "pass"|"fail"|"partial"|"unknown", "note": "brief explanation"}}
  ]
}}

For each check: pass=clearly present, fail=clearly absent, partial=partially addressed, unknown=insufficient text to determine."""

    try:
        result = await call_claude_json(system, prompt, max_tokens=1200)
        if not isinstance(result, dict):
            raise ValueError("Unexpected AI response shape")
    except Exception as e:
        logger.warning(f"AI validation failed: {e}")
        result = {
            "passed": None, "overall_score": 0,
            "summary": "Validation could not complete — AI service unavailable.",
            "checks": [{"item": item, "status": "unknown", "note": "AI unavailable"} for item in checklist]
        }

    from sqlalchemy.orm.attributes import flag_modified
    doc.validation_result = result
    flag_modified(doc, 'validation_result')
    db.commit()
    _log_action(db, project_id=str(project_id), document_id=str(doc_id),
                actor_id=str(user.id), actor_name=getattr(user, 'full_name', '') or getattr(user, 'email', ''),
                action='document_validated', metadata={'score': result.get('overall_score'), 'passed': result.get('passed')})
    return result


@router.patch("/projects/{project_id}/documents/{doc_id}/validation-result")
def save_manual_validation(
    project_id: UUID,
    doc_id: UUID,
    data: dict,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Save a manually-reviewed validation result (human override of AI assessment)."""
    doc = db.query(VVDocument).filter(
        VVDocument.id == doc_id, VVDocument.project_id == project_id
    ).first()
    if not doc:
        raise HTTPException(404, "Document not found")

    from sqlalchemy.orm.attributes import flag_modified
    actor_name = getattr(user, 'full_name', '') or getattr(user, 'email', '')
    doc.validation_result = data
    flag_modified(doc, 'validation_result')
    db.commit()
    _log_action(
        db,
        project_id=str(project_id),
        document_id=str(doc_id),
        actor_id=str(user.id),
        actor_name=actor_name,
        action='validation_manually_reviewed',
        metadata={'score': data.get('overall_score'), 'passed': data.get('passed'), 'reviewer': actor_name},
    )
    return data


# ── Cross-document consistency checker ───────────────────────────────────────
@router.post("/projects/{project_id}/consistency-check")
async def consistency_check(
    project_id: UUID,
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db), user=Depends(get_current_user)
):
    """AI-powered cross-document consistency check: find numerical/factual discrepancies."""
    from app.engines.ai.claude_client import call_claude_json

    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p: raise HTTPException(404, "Project not found")
    docs = db.query(VVDocument).filter(
        VVDocument.project_id == project_id,
        (VVDocument.is_deleted == False) | (VVDocument.is_deleted == None)
    ).all()
    if len(docs) < 2:
        raise HTTPException(400, "Need at least 2 documents to run consistency check")

    doc_summaries = []
    for d in docs[:12]:  # cap at 12 docs to stay within context
        text = (d.extracted_data or {}).get("text") or (d.extracted_data or {}).get("preview") or d.extraction_summary or ""
        doc_summaries.append(f"[{d.document_type}: {d.name}]\n{str(text)[:800]}")

    docs_block = "\n\n---\n\n".join(doc_summaries)
    system = "You are a carbon registry auditor specialising in cross-document data consistency. Respond with valid JSON only."
    prompt = f"""Review the following documents from a carbon project and identify numerical, factual, or temporal discrepancies between them.

PROJECT: {p.name}

DOCUMENTS:
{docs_block}

Return JSON:
{{
  "discrepancies": [
    {{
      "doc_a": "document type/name",
      "doc_b": "document type/name",
      "field": "what data field or claim conflicts",
      "value_a": "value in doc_a",
      "value_b": "value in doc_b",
      "severity": "high"|"medium"|"low",
      "note": "brief explanation and recommended action"
    }}
  ],
  "summary": "1-2 sentence overall consistency assessment",
  "overall_consistency": "high"|"medium"|"low"
}}

Focus on: volumes (tonnes, MWh), dates, percentages, financial figures, regulatory numbers. Return empty discrepancies array if data is consistent."""

    try:
        result = await call_claude_json(system, prompt, max_tokens=2000)
        if not isinstance(result, dict):
            raise ValueError("Unexpected AI response shape")
    except Exception as e:
        logger.warning(f"Consistency check failed: {e}")
        result = {"discrepancies": [], "summary": "Consistency check could not complete — AI service unavailable.", "overall_consistency": "unknown"}

    # ── Persist result so it survives page reloads ───────────────────────────
    from sqlalchemy.orm.attributes import flag_modified
    p.last_consistency_result = result
    p.last_consistency_run_at = datetime.utcnow()
    flag_modified(p, 'last_consistency_result')
    db.commit()

    _log_action(db, project_id=str(project_id),
                actor_id=str(user.id), actor_name=getattr(user, 'full_name', '') or getattr(user, 'email', ''),
                action='consistency_check_run',
                metadata={'discrepancy_count': len(result.get('discrepancies', [])), 'overall': result.get('overall_consistency')})
    background_tasks.add_task(
        _send_notification_bg, str(project_id), 'on_consistency_check',
        f"Consistency Check Complete — {p.name}",
        f"Cross-document consistency check for '{p.name}' found {len(result.get('discrepancies', []))} discrepancy(ies). Overall consistency: {result.get('overall_consistency', 'unknown')}.",
    )
    return result


# ── RFI (Request for Information) workflow ───────────────────────────────────

RFI_SEVERITIES = {"high", "medium", "low", "info"}
RFI_STATUSES   = {"open", "in_review", "resolved", "closed"}


def _rfi_out(r) -> dict:
    return {
        "id": str(r.id),
        "project_id": str(r.project_id),
        "checkpoint_id": r.checkpoint_id,
        "title": r.title,
        "body": r.body,
        "severity": r.severity,
        "status": r.status,
        "raised_by_name": r.raised_by_name,
        "raised_at": r.raised_at.isoformat() if r.raised_at else None,
        "assigned_to_name": r.assigned_to_name,
        "response": r.response,
        "responded_by_name": r.responded_by_name,
        "responded_at": r.responded_at.isoformat() if r.responded_at else None,
        "resolved_by_name": r.resolved_by_name,
        "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


@router.get("/projects/{project_id}/rfis")
def list_rfis(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """List all RFIs for a project, newest first."""
    rfis = (
        db.query(VVRfi)
        .filter(VVRfi.project_id == project_id)
        .order_by(VVRfi.raised_at.desc())
        .all()
    )
    return [_rfi_out(r) for r in rfis]


@router.post("/projects/{project_id}/rfis", status_code=201)
def create_rfi(
    project_id: UUID,
    data: dict,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Raise a new RFI against a project."""
    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")

    title = (data.get("title") or "").strip()
    body  = (data.get("body")  or "").strip()
    if not title or not body:
        raise HTTPException(400, "title and body are required")

    severity = data.get("severity", "medium")
    if severity not in RFI_SEVERITIES:
        raise HTTPException(400, f"severity must be one of {sorted(RFI_SEVERITIES)}")

    actor_name = getattr(user, "full_name", "") or getattr(user, "email", "")
    rfi = VVRfi(
        project_id=project_id,
        checkpoint_id=(data.get("checkpoint_id") or "").strip() or None,
        title=title,
        body=body,
        severity=severity,
        status="open",
        raised_by=user.id,
        raised_by_name=actor_name,
        assigned_to_name=(data.get("assigned_to_name") or "").strip() or None,
    )
    db.add(rfi)
    db.commit()
    db.refresh(rfi)
    _log_action(
        db, project_id=str(project_id),
        actor_id=str(user.id), actor_name=actor_name,
        action="rfi_raised",
        metadata={"rfi_id": str(rfi.id), "title": title, "severity": severity},
    )
    background_tasks_local = BackgroundTasks()
    background_tasks_local.add_task(
        _send_notification_bg, str(project_id), "on_status_change",
        f"New RFI Raised — {p.name}",
        f"An RFI '{title}' (severity: {severity}) was raised for project '{p.name}' by {actor_name}.",
    )
    return _rfi_out(rfi)


@router.patch("/projects/{project_id}/rfis/{rfi_id}")
def update_rfi(
    project_id: UUID,
    rfi_id: UUID,
    data: dict,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Update an RFI — respond, change status, or reassign."""
    rfi = db.query(VVRfi).filter(
        VVRfi.id == rfi_id, VVRfi.project_id == project_id
    ).first()
    if not rfi:
        raise HTTPException(404, "RFI not found")

    actor_name = getattr(user, "full_name", "") or getattr(user, "email", "")
    old_status = rfi.status

    # Allow editing title/body while open
    if "title" in data and rfi.status == "open":
        rfi.title = (data["title"] or "").strip() or rfi.title
    if "body" in data and rfi.status == "open":
        rfi.body = (data["body"] or "").strip() or rfi.body
    if "severity" in data:
        if data["severity"] not in RFI_SEVERITIES:
            raise HTTPException(400, f"severity must be one of {sorted(RFI_SEVERITIES)}")
        rfi.severity = data["severity"]
    if "assigned_to_name" in data:
        rfi.assigned_to_name = data["assigned_to_name"]

    # Response
    if "response" in data and data["response"]:
        rfi.response = data["response"]
        rfi.responded_by_name = actor_name
        rfi.responded_at = datetime.utcnow()
        if rfi.status == "open":
            rfi.status = "in_review"

    # Explicit status transition
    if "status" in data:
        new_status = data["status"]
        if new_status not in RFI_STATUSES:
            raise HTTPException(400, f"status must be one of {sorted(RFI_STATUSES)}")
        rfi.status = new_status
        if new_status in ("resolved", "closed"):
            rfi.resolved_by_name = actor_name
            rfi.resolved_at = datetime.utcnow()

    db.commit()
    db.refresh(rfi)
    _log_action(
        db, project_id=str(project_id),
        actor_id=str(user.id), actor_name=actor_name,
        action="rfi_updated",
        metadata={"rfi_id": str(rfi_id), "old_status": old_status, "new_status": rfi.status},
    )
    return _rfi_out(rfi)


@router.delete("/projects/{project_id}/rfis/{rfi_id}", status_code=204)
def delete_rfi(
    project_id: UUID,
    rfi_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Delete (permanently close) an RFI — admin only."""
    role = getattr(user, "role", "")
    if role not in ("admin", "super_admin"):
        raise HTTPException(403, "Only admins can delete RFIs")
    rfi = db.query(VVRfi).filter(
        VVRfi.id == rfi_id, VVRfi.project_id == project_id
    ).first()
    if not rfi:
        raise HTTPException(404, "RFI not found")
    db.delete(rfi)
    db.commit()


# ── Corrective Action Requests (CARs) ────────────────────────────────────────

def _car_out(c) -> dict:
    return {
        "id":               str(c.id),
        "project_id":       str(c.project_id),
        "checkpoint_code":  c.checkpoint_code,
        "car_number":       c.car_number,
        "severity":         c.severity,
        "title":            c.title,
        "description":      c.description,
        "status":           c.status,
        "raised_by_name":   c.raised_by_name,
        "raised_at":        c.raised_at.isoformat() if c.raised_at else None,
        "response":         c.response,
        "responded_by_name": c.responded_by_name,
        "responded_at":     c.responded_at.isoformat() if c.responded_at else None,
        "closed_by_name":   c.closed_by_name,
        "closed_at":        c.closed_at.isoformat() if c.closed_at else None,
        "closure_note":     c.closure_note,
        "updated_at":       c.updated_at.isoformat() if c.updated_at else None,
    }


@router.get("/projects/{project_id}/cars")
def list_cars(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """List all CARs for a project, most recent first."""
    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")
    cars = (
        db.query(VVCar)
        .filter(VVCar.project_id == project_id)
        .order_by(VVCar.raised_at.desc())
        .all()
    )
    return [_car_out(c) for c in cars]


@router.post("/projects/{project_id}/cars", status_code=201)
def create_car(project_id: UUID, data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Raise a new Corrective Action Request."""
    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")

    severity = data.get("severity", "minor_nc")
    if severity not in ("major_nc", "minor_nc"):
        raise HTTPException(400, "severity must be 'major_nc' or 'minor_nc'")
    if not str(data.get("title", "")).strip():
        raise HTTPException(400, "title is required")
    if not str(data.get("description", "")).strip():
        raise HTTPException(400, "description is required")

    # Auto-generate scoped car_number (CAR-001, CAR-002 …)
    existing_count = db.query(VVCar).filter(VVCar.project_id == project_id).count()
    car_number = f"CAR-{existing_count + 1:03d}"

    car = VVCar(
        project_id=project_id,
        checkpoint_code=data.get("checkpoint_code") or None,
        car_number=car_number,
        severity=severity,
        title=str(data["title"]).strip(),
        description=str(data["description"]).strip(),
        status="open",
        raised_by=user.id,
        raised_by_name=getattr(user, "email", None) or str(user.id),
    )
    db.add(car)
    db.commit()
    db.refresh(car)
    return _car_out(car)


@router.patch("/projects/{project_id}/cars/{car_id}")
def update_car(
    project_id: UUID,
    car_id: UUID,
    data: dict,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Update a CAR: respond, close, or escalate."""
    car = db.query(VVCar).filter(VVCar.id == car_id, VVCar.project_id == project_id).first()
    if not car:
        raise HTTPException(404, "CAR not found")

    # Developer / verifier submits a response
    if data.get("response"):
        car.response = str(data["response"]).strip()
        car.responded_by_name = getattr(user, "email", None) or str(user.id)
        car.responded_at = datetime.utcnow()
        if car.status == "open":
            car.status = "responded"

    # Explicit status transition
    if "status" in data:
        allowed_statuses = ("open", "responded", "closed", "withdrawn")
        if data["status"] not in allowed_statuses:
            raise HTTPException(400, f"status must be one of: {allowed_statuses}")
        car.status = data["status"]
        if data["status"] == "closed":
            car.closed_by_name = getattr(user, "email", None) or str(user.id)
            car.closed_at = datetime.utcnow()

    if data.get("closure_note"):
        car.closure_note = str(data["closure_note"]).strip()

    db.commit()
    db.refresh(car)
    return _car_out(car)


@router.delete("/projects/{project_id}/cars/{car_id}", status_code=204)
def withdraw_car(
    project_id: UUID,
    car_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Withdraw (soft-delete) a CAR — sets status to 'withdrawn'."""
    car = db.query(VVCar).filter(VVCar.id == car_id, VVCar.project_id == project_id).first()
    if not car:
        raise HTTPException(404, "CAR not found")
    car.status = "withdrawn"
    db.commit()
    return Response(status_code=204)


# ── Formal Verification Decision ──────────────────────────────────────────────

def _decision_out(d) -> dict:
    return {
        "id":                   str(d.id),
        "project_id":           str(d.project_id),
        "decision":             d.decision,
        "findings_summary":     d.findings_summary,
        "conditions":           d.conditions or [],
        "open_cars_at_decision": d.open_cars_at_decision or 0,
        "decided_by_name":      d.decided_by_name,
        "decided_at":           d.decided_at.isoformat() if d.decided_at else None,
        "superseded_at":        d.superseded_at.isoformat() if d.superseded_at else None,
    }


@router.get("/projects/{project_id}/decision")
def get_decision(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Return the current active decision, or null if none exists."""
    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")
    decision = (
        db.query(VVDecision)
        .filter(VVDecision.project_id == project_id, VVDecision.superseded_at == None)  # noqa: E711
        .order_by(VVDecision.decided_at.desc())
        .first()
    )
    if not decision:
        return None
    return _decision_out(decision)


@router.post("/projects/{project_id}/decision", status_code=201)
def create_decision(
    project_id: UUID,
    data: dict,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Create or replace the verification decision.

    Approve / Conditional Approve are blocked if any open Major NC CARs exist.
    The previous active decision is superseded (kept for history).
    """
    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")

    decision_value = str(data.get("decision", "")).strip()
    valid_decisions = ("approved", "conditional_approved", "rejected", "deferred")
    if decision_value not in valid_decisions:
        raise HTTPException(400, f"decision must be one of: {', '.join(valid_decisions)}")

    # Gating: Approve / Conditional Approve blocked by unresolved Major CARs
    if decision_value in ("approved", "conditional_approved"):
        open_major = (
            db.query(VVCar)
            .filter(
                VVCar.project_id == project_id,
                VVCar.severity == "major_nc",
                VVCar.status.in_(("open", "responded")),
            )
            .count()
        )
        if open_major > 0:
            raise HTTPException(
                409,
                f"Cannot approve: {open_major} open Major Non-Conformity CAR(s) must be closed first",
            )

    # Snapshot of all open CARs at decision time
    open_cars_count = (
        db.query(VVCar)
        .filter(VVCar.project_id == project_id, VVCar.status.in_(("open", "responded")))
        .count()
    )

    # Supersede the current active decision (preserve history)
    db.query(VVDecision).filter(
        VVDecision.project_id == project_id,
        VVDecision.superseded_at == None,  # noqa: E711
    ).update({"superseded_at": datetime.utcnow()})

    new_decision = VVDecision(
        project_id=project_id,
        decision=decision_value,
        findings_summary=str(data.get("findings_summary", "")).strip() or None,
        conditions=data.get("conditions") or [],
        open_cars_at_decision=open_cars_count,
        decided_by=user.id,
        decided_by_name=getattr(user, "email", None) or str(user.id),
    )
    db.add(new_decision)

    # Mirror decision onto project status
    status_map = {
        "approved":             "verified",
        "conditional_approved": "under_review",
        "rejected":             "rejected",
        "deferred":             "submitted",
    }
    p.status = status_map.get(decision_value, p.status)

    db.commit()
    db.refresh(new_decision)
    return _decision_out(new_decision)


# ── Phase 2: Credit Quantity Calculation ─────────────────────────────────────

# Methodology-specific buffer pool rates (Phase 2)
_BUFFER_POOL_RATES: dict = {
    "PURO-CCS-GSC":   0.20,
    "PURO-BIOCHAR-V2": 0.15,
    "VM0044-V2":      0.18,
    "GS-BIOCHAR-1.0": 0.15,
    "ISOMETRIC-DAC":  0.10,
}

# Countersign threshold — projects claiming above this require two-person sign-off (Phase 4)
_COUNTERSIGN_THRESHOLD_TCO2E = 10_000


@router.get("/projects/{project_id}/credit-quantity")
def get_credit_quantity(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Return the last saved credit quantity result, or null."""
    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")
    try:
        result = p.credit_quantity_result
        run_at = p.credit_quantity_run_at
        if result is None:
            return None
        return {**result, "run_at": run_at.isoformat() if run_at else None}
    except Exception:
        try: db.rollback()
        except Exception: pass
        return None


@router.post("/projects/{project_id}/credit-quantity")
async def compute_credit_quantity(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    AI-powered credit quantification:
    extracts gross removals from monitoring docs, applies buffer pool deduction,
    returns net issuable credits with materiality analysis.
    """
    import json
    from app.engines.ai.claude_client import call_claude_json

    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")

    methodology_code = ""
    if p.description and "METHODOLOGY:" in p.description:
        methodology_code = p.description.split("METHODOLOGY:")[1].split("|")[0].strip()

    buffer_rate = _BUFFER_POOL_RATES.get(methodology_code, 0.20)

    docs = db.query(VVDocument).filter(
        VVDocument.project_id == project_id,
        (VVDocument.is_deleted == False) | (VVDocument.is_deleted == None),
        VVDocument.status == "processed",
    ).all()

    QUANT_TYPES = {
        "monitoring_data", "capture_transport_monitoring", "ace_monitoring_plan",
        "lca_report", "field_trial_data", "yield_data", "lab_analysis",
    }
    quant_docs = [d for d in docs if d.document_type in QUANT_TYPES]

    if not quant_docs:
        raise HTTPException(400, "No processed quantification documents found — upload monitoring data or LCA reports first")

    doc_summaries = []
    for d in quant_docs[:6]:
        data = d.extracted_data or {}
        text = str(data.get("text") or data.get("preview") or "")[:600]
        doc_summaries.append({
            "name": d.name, "type": d.document_type,
            "content": text, "key_terms": data.get("key_terms", {}),
        })

    system = "You are a carbon credit quantification specialist. Extract credit quantities from monitoring documents. Return valid JSON only."
    prompt = f"""Analyze monitoring documents from project "{p.name}" (methodology: {methodology_code or "unknown"}).

DOCUMENTS:
{json.dumps(doc_summaries, indent=2)}

Extract gross CO2 removals and identify any material discrepancies.
Materiality threshold: 5% of total claimed credits.

Return JSON:
{{
  "gross_removals": <number or null>,
  "gross_removals_unit": "tCO2e",
  "quantification_basis": "<1-2 sentences on how derived>",
  "data_source_documents": ["<doc name>"],
  "materiality_items": [
    {{"item": "<description>", "value": <number>, "pct_of_total": <0-100>, "flag": "material|immaterial"}}
  ],
  "confidence": "high|medium|low|insufficient_data",
  "confidence_reason": "<brief>",
  "anomalies": ["<data quality issue>"]
}}"""

    try:
        ai_result = await call_claude_json(system, prompt, max_tokens=800)
    except Exception as e:
        raise HTTPException(503, f"AI credit quantification failed: {e}")

    gross = ai_result.get("gross_removals")
    buffer_amount = round(gross * buffer_rate, 2) if isinstance(gross, (int, float)) else None
    net_credits   = round(gross - buffer_amount, 2) if gross is not None and buffer_amount is not None else None

    MATERIALITY_THRESHOLD = 5.0
    items = ai_result.get("materiality_items") or []
    for item in items:
        pct = item.get("pct_of_total") or 0
        item["flag"] = "material" if pct > MATERIALITY_THRESHOLD else "immaterial"

    result = {
        "gross_removals": gross,
        "gross_removals_unit": ai_result.get("gross_removals_unit", "tCO2e"),
        "buffer_pool_rate_pct": round(buffer_rate * 100, 1),
        "buffer_pool_deduction": buffer_amount,
        "net_issuable_credits": net_credits,
        "credit_unit": "tCO2e",
        "materiality_threshold_pct": MATERIALITY_THRESHOLD,
        "materiality_items": items,
        "quantification_basis": ai_result.get("quantification_basis", ""),
        "data_source_documents": ai_result.get("data_source_documents") or [],
        "confidence": ai_result.get("confidence", "insufficient_data"),
        "confidence_reason": ai_result.get("confidence_reason", ""),
        "anomalies": ai_result.get("anomalies") or [],
        "methodology_code": methodology_code,
    }

    try:
        p.credit_quantity_result = result
        p.credit_quantity_run_at = datetime.utcnow()
        from sqlalchemy.orm.attributes import flag_modified as _fm
        _fm(p, "credit_quantity_result")
        db.commit()
    except Exception as _pe:
        logger.warning("Could not persist credit quantity result: %s", _pe)
        try: db.rollback()
        except Exception: pass

    return {**result, "run_at": datetime.utcnow().isoformat()}


# ── Phase 3: Additionality Assessment ────────────────────────────────────────

@router.get("/projects/{project_id}/additionality-assessment")
def get_additionality(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")
    try:
        result = p.additionality_result
        run_at = p.additionality_run_at
        return {**(result or {}), "run_at": run_at.isoformat() if run_at else None} if result else None
    except Exception:
        try: db.rollback()
        except Exception: pass
        return None


@router.post("/projects/{project_id}/additionality-assessment")
async def run_additionality(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    AI assessment of additionality: financial barrier, regulatory barrier,
    common practice analysis — returns rating and evidence gaps.
    """
    import json
    from app.engines.ai.claude_client import call_claude_json

    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")

    docs = db.query(VVDocument).filter(
        VVDocument.project_id == project_id,
        (VVDocument.is_deleted == False) | (VVDocument.is_deleted == None),
        VVDocument.status == "processed",
    ).all()

    ADD_TYPES = {"additionality_assessment", "project_description", "lca_report",
                 "financial_analysis", "feasibility_study"}
    add_docs = [d for d in docs if d.document_type in ADD_TYPES]

    if not add_docs:
        raise HTTPException(400, "No additionality documents found — upload an additionality assessment or project description")

    summaries = []
    for d in add_docs[:5]:
        data = d.extracted_data or {}
        summaries.append({"name": d.name, "type": d.document_type,
                           "content": str(data.get("text") or data.get("preview") or "")[:700]})

    system = "You are a carbon credit additionality expert. Assess additionality based on ISO 14064-2 / VCS / Puro standards. Return valid JSON only."
    prompt = f"""Assess the additionality of project "{p.name}" from these documents.

DOCUMENTS:
{json.dumps(summaries, indent=2)}

Evaluate all three additionality tests:
1. Financial barrier / investment barrier
2. Regulatory / legal barrier
3. Common practice (market penetration)

Return JSON:
{{
  "overall_rating": "strong|adequate|weak|insufficient_evidence",
  "overall_summary": "<2-3 sentences>",
  "financial_barrier": {{"satisfied": true|false, "confidence": "high|medium|low", "finding": "<brief>", "evidence_gaps": ["<gap>"]}},
  "regulatory_barrier": {{"satisfied": true|false, "confidence": "high|medium|low", "finding": "<brief>", "evidence_gaps": ["<gap>"]}},
  "common_practice": {{"satisfied": true|false, "confidence": "high|medium|low", "finding": "<brief>", "evidence_gaps": ["<gap>"]}},
  "missing_evidence": ["<doc or data needed>"],
  "risk_flags": ["<additionality risk>"]
}}"""

    try:
        ai_result = await call_claude_json(system, prompt, max_tokens=900)
    except Exception as e:
        raise HTTPException(503, f"AI additionality assessment failed: {e}")

    result = {
        "overall_rating":   ai_result.get("overall_rating", "insufficient_evidence"),
        "overall_summary":  ai_result.get("overall_summary", ""),
        "financial_barrier": ai_result.get("financial_barrier", {}),
        "regulatory_barrier": ai_result.get("regulatory_barrier", {}),
        "common_practice":  ai_result.get("common_practice", {}),
        "missing_evidence": ai_result.get("missing_evidence") or [],
        "risk_flags":       ai_result.get("risk_flags") or [],
    }

    try:
        p.additionality_result = result
        p.additionality_run_at = datetime.utcnow()
        from sqlalchemy.orm.attributes import flag_modified as _fm
        _fm(p, "additionality_result")
        db.commit()
    except Exception as _pe:
        logger.warning("Could not persist additionality result: %s", _pe)
        try: db.rollback()
        except Exception: pass

    return {**result, "run_at": datetime.utcnow().isoformat()}


# ── Phase 3: Permanence Assessment ───────────────────────────────────────────

@router.get("/projects/{project_id}/permanence-assessment")
def get_permanence(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")
    try:
        result = p.permanence_result
        run_at = p.permanence_run_at
        return {**(result or {}), "run_at": run_at.isoformat() if run_at else None} if result else None
    except Exception:
        try: db.rollback()
        except Exception: pass
        return None


@router.post("/projects/{project_id}/permanence-assessment")
async def run_permanence(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    AI assessment of permanence / durability: storage security,
    reversal risk, buffer pool contribution, monitoring period.
    """
    import json
    from app.engines.ai.claude_client import call_claude_json

    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")

    docs = db.query(VVDocument).filter(
        VVDocument.project_id == project_id,
        (VVDocument.is_deleted == False) | (VVDocument.is_deleted == None),
        VVDocument.status == "processed",
    ).all()

    PERM_TYPES = {"reservoir_modelling", "storage_site_overview", "monitoring_data",
                  "lca_report", "project_description", "risk_assessment"}
    perm_docs = [d for d in docs if d.document_type in PERM_TYPES]

    if not perm_docs:
        raise HTTPException(400, "No permanence documents found — upload reservoir modelling or storage site overview")

    summaries = []
    for d in perm_docs[:5]:
        data = d.extracted_data or {}
        summaries.append({"name": d.name, "type": d.document_type,
                           "content": str(data.get("text") or data.get("preview") or "")[:700]})

    system = "You are a carbon permanence expert. Assess long-term storage security and buffer pool requirements. Return valid JSON only."
    prompt = f"""Assess the permanence/durability of project "{p.name}" from these documents.

DOCUMENTS:
{json.dumps(summaries, indent=2)}

Return JSON:
{{
  "permanence_rating": "high|medium|low|insufficient_evidence",
  "permanence_period_years": <number or null>,
  "permanence_summary": "<2-3 sentences>",
  "storage_security": {{"rating": "high|medium|low", "finding": "<brief>", "evidence_gaps": ["<gap>"]}},
  "reversal_risk": {{"rating": "high|medium|low", "finding": "<brief>", "mitigation": "<brief>"}},
  "recommended_buffer_pool_pct": <number>,
  "monitoring_requirements": ["<requirement>"],
  "risk_flags": ["<permanence risk>"]
}}"""

    try:
        ai_result = await call_claude_json(system, prompt, max_tokens=800)
    except Exception as e:
        raise HTTPException(503, f"AI permanence assessment failed: {e}")

    result = {
        "permanence_rating":       ai_result.get("permanence_rating", "insufficient_evidence"),
        "permanence_period_years": ai_result.get("permanence_period_years"),
        "permanence_summary":      ai_result.get("permanence_summary", ""),
        "storage_security":        ai_result.get("storage_security", {}),
        "reversal_risk":           ai_result.get("reversal_risk", {}),
        "recommended_buffer_pool_pct": ai_result.get("recommended_buffer_pool_pct", 20),
        "monitoring_requirements": ai_result.get("monitoring_requirements") or [],
        "risk_flags":              ai_result.get("risk_flags") or [],
    }

    try:
        p.permanence_result = result
        p.permanence_run_at = datetime.utcnow()
        from sqlalchemy.orm.attributes import flag_modified as _fm
        _fm(p, "permanence_result")
        db.commit()
    except Exception as _pe:
        logger.warning("Could not persist permanence result: %s", _pe)
        try: db.rollback()
        except Exception: pass

    return {**result, "run_at": datetime.utcnow().isoformat()}


# ── Phase 4: Two-person rule / Countersign ────────────────────────────────────

@router.post("/projects/{project_id}/decision/{decision_id}/countersign")
def countersign_decision(
    project_id: UUID,
    decision_id: UUID,
    data: dict,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Second reviewer countersigns the active decision.
    Generates a SHA-256 signature hash as an immutable audit record.
    Blocked if the second reviewer is the same person as the lead verifier.
    """
    import hashlib

    decision = db.query(VVDecision).filter(
        VVDecision.id == decision_id,
        VVDecision.project_id == project_id,
        VVDecision.superseded_at == None,  # noqa: E711
    ).first()
    if not decision:
        raise HTTPException(404, "Active decision not found")

    # Cannot countersign your own decision
    if str(getattr(decision, "decided_by", None)) == str(user.id):
        raise HTTPException(409, "The countersigner must be different from the lead verifier")

    if decision.countersigned_at:
        raise HTTPException(409, "Decision has already been countersigned")

    reviewer_name = getattr(user, "email", None) or str(user.id)
    countersign_time = datetime.utcnow()

    # Deterministic signature: hash of decision identity + countersigner + timestamp
    sig_input = (
        f"{project_id}:{decision_id}:{decision.decision}:"
        f"{decision.decided_at}:{decision.decided_by}:"
        f"{reviewer_name}:{countersign_time.isoformat()}"
    )
    sig_hash = hashlib.sha256(sig_input.encode()).hexdigest()

    try:
        decision.second_reviewer_id   = user.id
        decision.second_reviewer_name = reviewer_name
        decision.second_reviewer_note = str(data.get("note", "")).strip() or None
        decision.countersigned_at     = countersign_time
        decision.signature_hash       = sig_hash
        db.commit()
        db.refresh(decision)
    except Exception as _pe:
        logger.warning("Could not persist countersign (migration pending?): %s", _pe)
        db.rollback()
        raise HTTPException(503, "Countersign persistence failed — ensure migration 0015 has run")

    return {
        "decision_id":          str(decision.id),
        "countersigned_by":     reviewer_name,
        "countersigned_at":     countersign_time.isoformat(),
        "signature_hash":       sig_hash,
        "second_reviewer_note": decision.second_reviewer_note,
    }


# ── Phase 5: SLA & Turnaround Tracking ───────────────────────────────────────

@router.get("/projects/{project_id}/sla")
def get_sla(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    Derive SLA status from project timestamps — no additional DB storage needed.
    Uses submission_deadline if set; otherwise defaults to 30-day SLA from created_at.
    """
    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")

    now = datetime.utcnow()
    submitted_at = p.created_at or now
    DEFAULT_SLA_DAYS = 30

    # Determine deadline
    dl = getattr(p, "submission_deadline", None)
    if dl:
        deadline = _as_date(dl)
        sla_days  = (deadline - submitted_at.date()).days
    else:
        sla_days  = DEFAULT_SLA_DAYS
        deadline  = (submitted_at + timedelta(days=sla_days)).date()

    days_elapsed    = (now.date() - submitted_at.date()).days
    days_remaining  = (deadline - now.date()).days

    if days_remaining < 0:
        sla_status = "overdue"
    elif days_remaining <= 5:
        sla_status = "at_risk"
    elif days_remaining <= 14:
        sla_status = "warning"
    else:
        sla_status = "on_track"

    # Stage completion from project data
    cps   = db.query(VVCheckpoint).filter(VVCheckpoint.project_id == project_id).count()
    docs  = db.query(VVDocument).filter(
        VVDocument.project_id == project_id,
        (VVDocument.is_deleted == False) | (VVDocument.is_deleted == None),
    ).count()

    active_decision = (
        db.query(VVDecision)
        .filter(VVDecision.project_id == project_id, VVDecision.superseded_at == None)  # noqa: E711
        .first()
    )
    open_cars = db.query(VVCar).filter(
        VVCar.project_id == project_id, VVCar.status.in_(("open", "responded"))
    ).count()

    stages = [
        {"name": "Document Upload",   "complete": docs > 0,                        "detail": f"{docs} documents uploaded"},
        {"name": "AI Verification",   "complete": cps > 0,                          "detail": f"{cps} checkpoints assessed"},
        {"name": "CAR Resolution",    "complete": open_cars == 0 and cps > 0,       "detail": f"{open_cars} open CARs"},
        {"name": "Formal Decision",   "complete": active_decision is not None,      "detail": active_decision.decision if active_decision else "pending"},
        {"name": "Registry Submission","complete": False,                            "detail": "not yet submitted"},
    ]

    return {
        "submitted_at":   submitted_at.isoformat(),
        "deadline":       deadline.isoformat(),
        "sla_days":       sla_days,
        "days_elapsed":   days_elapsed,
        "days_remaining": days_remaining,
        "sla_status":     sla_status,
        "stages":         stages,
        "has_deadline_set": dl is not None,
    }


# ── Phase 6: Registry Submission Framework ───────────────────────────────────

def _submission_out(s) -> dict:
    return {
        "id":                   str(s.id),
        "project_id":           str(s.project_id),
        "decision_id":          str(s.decision_id) if s.decision_id else None,
        "submission_number":    s.submission_number,
        "registry_slug":        s.registry_slug,
        "status":               s.status,
        "submitted_at":         s.submitted_at.isoformat() if s.submitted_at else None,
        "submitted_by_name":    s.submitted_by_name,
        "registry_ref_number":  s.registry_ref_number,
        "registry_response":    s.registry_response or {},
        "estimated_review_days": s.estimated_review_days,
        "notes":                s.notes,
        "created_at":           s.created_at.isoformat() if s.created_at else None,
    }


def _mock_submit_to_registry(payload: dict) -> dict:
    """
    Mock registry API integration.
    Replace the body of this function with a real API call when credentials are available.
    Contract: receives structured payload dict, returns dict with at minimum
    {"success": bool, "registry_ref_number": str, "status": str}.
    """
    import hashlib, random
    ref = "REG-" + hashlib.md5(
        str(payload.get("project_id", "x")).encode()
    ).hexdigest()[:8].upper()
    return {
        "success":               True,
        "registry_ref_number":   ref,
        "status":                "pending",
        "message":               "Submission received. Registry review typically takes 5–10 business days.",
        "estimated_review_days": random.randint(5, 10),
        "portal_url":            f"https://registry.puro.earth/submissions/{ref}",
    }


@router.get("/projects/{project_id}/registry-submissions")
def list_registry_submissions(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")
    subs = (
        db.query(VVRegistrySubmission)
        .filter(VVRegistrySubmission.project_id == project_id)
        .order_by(VVRegistrySubmission.created_at.desc())
        .all()
    )
    return [_submission_out(s) for s in subs]


@router.post("/projects/{project_id}/registry-submit", status_code=201)
def registry_submit(project_id: UUID, data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    Submit verification package to registry.
    Requires an active Approved or Conditionally Approved decision.
    Calls _mock_submit_to_registry() — replace with real API when available.
    """
    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")

    # Require an active approved decision
    decision = (
        db.query(VVDecision)
        .filter(
            VVDecision.project_id == project_id,
            VVDecision.superseded_at == None,  # noqa: E711
            VVDecision.decision.in_(("approved", "conditional_approved")),
        )
        .first()
    )
    if not decision:
        raise HTTPException(409, "A formal Approved or Conditionally Approved decision is required before registry submission")

    # Build submission payload
    docs  = db.query(VVDocument).filter(
        VVDocument.project_id == project_id,
        (VVDocument.is_deleted == False) | (VVDocument.is_deleted == None),
    ).count()
    cps   = db.query(VVCheckpoint).filter(VVCheckpoint.project_id == project_id).all()
    passed = sum(1 for c in cps if (c.verifier_status or c.status) == "passed")

    payload = {
        "project_id":        str(project_id),
        "project_name":      p.name,
        "registry_slug":     p.description.split("REGISTRY:")[1].split("|")[0] if p.description and "REGISTRY:" in p.description else "puro_earth",
        "methodology_code":  p.description.split("METHODOLOGY:")[1].split("|")[0] if p.description and "METHODOLOGY:" in p.description else "",
        "vintage_year":      p.vintage_year,
        "decision":          decision.decision,
        "decision_made_by":  decision.decided_by_name,
        "decided_at":        decision.decided_at.isoformat() if decision.decided_at else None,
        "findings_summary":  decision.findings_summary,
        "document_count":    docs,
        "checkpoints_total": len(cps),
        "checkpoints_passed": passed,
        "submitted_by":      getattr(user, "email", None) or str(user.id),
        "submitted_at":      datetime.utcnow().isoformat(),
        "notes":             str(data.get("notes", "")).strip() or None,
    }

    # Call registry (mock or real)
    try:
        registry_response = _mock_submit_to_registry(payload)
    except Exception as e:
        raise HTTPException(503, f"Registry submission failed: {e}")

    # Auto-generate submission number
    existing_count = db.query(VVRegistrySubmission).filter(VVRegistrySubmission.project_id == project_id).count()
    sub_number = f"REG-SUB-{existing_count + 1:03d}"

    sub = VVRegistrySubmission(
        project_id=project_id,
        decision_id=decision.id,
        submission_number=sub_number,
        registry_slug=payload["registry_slug"],
        status=registry_response.get("status", "submitted"),
        payload=payload,
        submitted_at=datetime.utcnow(),
        submitted_by=user.id,
        submitted_by_name=payload["submitted_by"],
        registry_ref_number=registry_response.get("registry_ref_number"),
        registry_response=registry_response,
        estimated_review_days=registry_response.get("estimated_review_days"),
        notes=payload["notes"],
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return _submission_out(sub)


# ── Audit log ────────────────────────────────────────────────────────────────
@router.get("/projects/{project_id}/audit-log")
def get_audit_log(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    entries = db.query(VVAuditLog).filter(
        VVAuditLog.project_id == str(project_id)
    ).order_by(VVAuditLog.created_at.desc()).limit(200).all()
    return [
        {
            "id": str(e.id), "action": e.action,
            "actor_name": e.actor_name, "document_id": str(e.document_id) if e.document_id else None,
            "metadata": e.log_data or {},
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in entries
    ]


# ── Review / comment workflow ─────────────────────────────────────────────────
@router.get("/projects/{project_id}/documents/{doc_id}/comments")
def get_document_comments(project_id: UUID, doc_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    comments = db.query(VVDocumentComment).filter(
        VVDocumentComment.document_id == doc_id
    ).order_by(VVDocumentComment.created_at.asc()).all()
    return [
        {
            "id": str(c.id), "author_name": c.author_name, "body": c.body,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for c in comments
    ]


@router.post("/projects/{project_id}/documents/{doc_id}/comments")
def add_document_comment(
    project_id: UUID, doc_id: UUID, data: dict,
    db: Session = Depends(get_db), user=Depends(get_current_user)
):
    doc = db.query(VVDocument).filter(VVDocument.id == doc_id, VVDocument.project_id == project_id).first()
    if not doc: raise HTTPException(404, "Document not found")
    body = (data.get("body") or "").strip()
    if not body: raise HTTPException(400, "Comment body is required")
    comment = VVDocumentComment(
        document_id=doc_id, project_id=project_id,
        author_id=user.id,
        author_name=getattr(user, 'full_name', None) or getattr(user, 'email', 'Unknown'),
        body=body,
    )
    db.add(comment); db.commit(); db.refresh(comment)
    _log_action(db, project_id=str(project_id), document_id=str(doc_id),
                actor_id=str(user.id), actor_name=getattr(user, 'full_name', '') or getattr(user, 'email', ''),
                action='comment_added', metadata={'body_preview': body[:80]})
    return {"id": str(comment.id), "author_name": comment.author_name, "body": comment.body,
            "created_at": comment.created_at.isoformat()}


@router.patch("/projects/{project_id}/documents/{doc_id}/review-status")
def update_review_status(
    project_id: UUID, doc_id: UUID, data: dict,
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db), user=Depends(get_current_user)
):
    doc = db.query(VVDocument).filter(VVDocument.id == doc_id, VVDocument.project_id == project_id).first()
    if not doc: raise HTTPException(404, "Document not found")
    new_status = data.get("review_status")
    valid_statuses = {"draft", "under_review", "approved", "rejected"}
    if new_status not in valid_statuses:
        raise HTTPException(400, f"review_status must be one of {valid_statuses}")
    old_status = doc.review_status
    doc.review_status = new_status
    doc.review_notes = data.get("review_notes") or doc.review_notes
    doc.reviewed_by_name = getattr(user, 'full_name', None) or getattr(user, 'email', 'Unknown')
    doc.reviewed_at = datetime.utcnow()
    if new_status == "approved":
        doc.signed_off_by = getattr(user, 'full_name', None) or getattr(user, 'email', 'Unknown')
        doc.signed_off_at = datetime.utcnow()
    db.commit()
    _log_action(db, project_id=str(project_id), document_id=str(doc_id),
                actor_id=str(user.id), actor_name=getattr(user, 'full_name', '') or getattr(user, 'email', ''),
                action='review_status_changed',
                metadata={'from': old_status, 'to': new_status, 'notes': data.get('review_notes', '')})
    background_tasks.add_task(
        _send_notification_bg, str(project_id), 'on_status_change',
        f"Document Status Changed — {doc.name}",
        f"'{doc.name}' status changed from {old_status} to {new_status} by {getattr(user, 'full_name', '') or getattr(user, 'email', '')}.",
    )
    return _doc_out(doc)


# ── Monitoring data time-series ───────────────────────────────────────────────
@router.get("/projects/{project_id}/documents/{doc_id}/timeseries")
def get_document_timeseries(
    project_id: UUID, doc_id: UUID,
    db: Session = Depends(get_db), user=Depends(get_current_user)
):
    """Parse a CSV/Excel document and return structured time-series data for charting."""
    import csv

    doc = db.query(VVDocument).filter(VVDocument.id == doc_id, VVDocument.project_id == project_id).first()
    if not doc: raise HTTPException(404, "Document not found")
    if doc.file_type not in ("csv", "xlsx", "xls", "xlsm"):
        raise HTTPException(400, "Time-series is only available for CSV/Excel documents")

    try:
        with storage.open_local(doc.storage_path, suffix=f".{doc.file_type}") as local_path:
            if doc.file_type == "csv":
                with open(local_path, "r", errors="replace") as f:
                    reader = csv.DictReader(f)
                    rows = list(reader)
                    columns = reader.fieldnames or []
            else:
                import openpyxl
                wb = openpyxl.load_workbook(local_path, data_only=True)
                ws = wb.active
                rows_raw = list(ws.iter_rows(values_only=True))
                if not rows_raw: return {"columns": [], "series": [], "row_count": 0}
                columns = [str(c) if c is not None else f"Col{i}" for i, c in enumerate(rows_raw[0])]
                rows = [{columns[i]: str(v) if v is not None else "" for i, v in enumerate(r)} for r in rows_raw[1:]]
    except Exception as e:
        raise HTTPException(500, f"Failed to read document: {e}")

    # Auto-detect timestamp column
    time_col = None
    for col in columns:
        if any(k in col.lower() for k in ["date", "time", "timestamp", "datetime", "period"]):
            time_col = col; break
    if not time_col and columns:
        time_col = columns[0]

    # Numeric columns → series
    numeric_cols = []
    for col in columns:
        if col == time_col: continue
        vals = [r.get(col, "") for r in rows[:20]]
        try:
            [float(v) for v in vals if v]
            numeric_cols.append(col)
        except (ValueError, TypeError):
            pass

    series = []
    for col in numeric_cols[:8]:  # cap to 8 series
        data_points = []
        for r in rows[:2000]:
            x = r.get(time_col, "")
            y_str = r.get(col, "")
            try:
                y = float(y_str)
                data_points.append({"x": x, "y": y})
            except (ValueError, TypeError):
                pass
        series.append({"name": col, "data": data_points})

    return {"columns": columns, "time_col": time_col, "series": series, "row_count": len(rows)}


# ── Baseline vs Monitoring comparison ────────────────────────────────────────

@router.get("/projects/{project_id}/baseline-comparison")
async def baseline_comparison(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    AI-powered comparison: finds baseline and monitoring documents, extracts key metrics,
    computes % reduction and identifies deviations.
    """
    import json
    from app.engines.ai.claude_client import call_claude_json

    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")

    # Find baseline and monitoring documents (by document_type)
    BASELINE_TYPES = {"additionality_assessment", "project_description", "lca_report", "reservoir_modelling", "storage_site_overview"}
    MONITORING_TYPES = {"monitoring_data", "capture_transport_monitoring", "ace_monitoring_plan", "data_systems"}

    docs = db.query(VVDocument).filter(
        VVDocument.project_id == project_id,
        (VVDocument.is_deleted == False) | (VVDocument.is_deleted == None),
        VVDocument.status == "processed",
    ).all()

    baseline_docs  = [d for d in docs if d.document_type in BASELINE_TYPES]
    monitoring_docs = [d for d in docs if d.document_type in MONITORING_TYPES]

    if not baseline_docs and not monitoring_docs:
        return {
            "status": "insufficient_data",
            "message": "Upload baseline (additionality assessment / LCA report) and monitoring data documents to enable comparison.",
            "baseline_docs": [], "monitoring_docs": [],
            "comparison": None,
        }

    def _doc_summary(d) -> dict:
        data = d.extracted_data or {}
        text = data.get("text") or data.get("text_preview") or data.get("preview") or ""
        sheets = data.get("sheets", {})
        sheet_info = [f"Sheet '{k}' ({v.get('row_count',0)} rows, cols: {', '.join(str(c) for c in v.get('columns',[])[:8])})"
                      for k, v in list(sheets.items())[:3] if isinstance(v, dict)]
        return {
            "id": str(d.id), "name": d.name, "type": d.document_type,
            "content_preview": str(text)[:800],
            "sheets": sheet_info,
            "key_terms": data.get("key_terms", {}),
        }

    baseline_summaries  = [_doc_summary(d) for d in baseline_docs[:4]]
    monitoring_summaries = [_doc_summary(d) for d in monitoring_docs[:4]]

    if not baseline_summaries or not monitoring_summaries:
        # Return what we have without AI comparison
        return {
            "status": "partial_data",
            "message": f"Found {len(baseline_docs)} baseline document(s) and {len(monitoring_docs)} monitoring document(s). Both types needed for comparison.",
            "baseline_docs": [d.name for d in baseline_docs],
            "monitoring_docs": [d.name for d in monitoring_docs],
            "comparison": None,
        }

    system = "You are a carbon registry verification specialist. Compare baseline and monitoring data from carbon projects. Return valid JSON only."
    prompt = f"""Compare the following baseline and monitoring documents from a carbon removal project.

PROJECT: {p.name}

BASELINE DOCUMENTS:
{json.dumps(baseline_summaries, indent=2)}

MONITORING DOCUMENTS:
{json.dumps(monitoring_summaries, indent=2)}

Identify:
1. Key metrics (CO2 quantities, volumes, rates) in baseline vs monitoring
2. % change/reduction achieved
3. Any deviations or discrepancies requiring investigation
4. Overall data quality assessment

Return JSON:
{{
  "key_metrics": [
    {{
      "metric": "metric name",
      "baseline_value": "value with unit or null",
      "monitoring_value": "value with unit or null",
      "change_pct": null_or_number,
      "status": "on_track|deviation|insufficient_data",
      "note": "brief explanation"
    }}
  ],
  "overall_reduction_pct": null_or_number,
  "data_quality": "good|acceptable|poor|insufficient",
  "deviations": ["deviation 1", "deviation 2"],
  "summary": "2-3 sentence assessment",
  "recommended_actions": ["action 1"]
}}"""

    try:
        result = await call_claude_json(system, prompt, max_tokens=1500)
        if not isinstance(result, dict):
            raise ValueError("Unexpected AI response")
    except Exception as e:
        logger.warning(f"Baseline comparison AI failed: {e}")
        result = {
            "key_metrics": [], "overall_reduction_pct": None,
            "data_quality": "insufficient",
            "deviations": [],
            "summary": "Comparison could not be completed — AI service unavailable.",
            "recommended_actions": [],
        }

    return {
        "status": "complete",
        "baseline_docs": [d.name for d in baseline_docs],
        "monitoring_docs": [d.name for d in monitoring_docs],
        "comparison": result,
    }


# ── Credit calculation verifier ──────────────────────────────────────────────

# Indicative limits per methodology — used for cap-check and risk flagging
_CREDIT_CAPS: dict = {
    "PURO-CCS-GSC":   {"cap": 500_000,  "unit": "CORC", "scrutiny_threshold": 100_000,
                         "note": "Puro.Earth GSC — no hard cap but >100 000 CORCs requires enhanced scrutiny"},
    "PURO-BIOCHAR-V2": {"cap":  50_000,  "unit": "CORC", "scrutiny_threshold": 20_000,
                         "note": "Puro.Earth Biochar V2 — indicative 50 000 CORC/year practical ceiling"},
    "PURO-DAC-V1":     {"cap": 500_000,  "unit": "CORC", "scrutiny_threshold": 100_000, "note": ""},
    "PURO-EW-V1":      {"cap": None,     "unit": "CORC", "scrutiny_threshold": 10_000,  "note": "No hard cap"},
    "ISO-BIOCHAR-V1.2":{"cap": None,     "unit": "tCO2", "scrutiny_threshold": 50_000,  "note": "No hard cap"},
    "VM0044-V2":       {"cap": None,     "unit": "tCO2e","scrutiny_threshold": 50_000,  "note": "No hard cap"},
    "GS-ICS-V3":       {"cap": None,     "unit": "tCO2e","scrutiny_threshold": 100_000, "note": "No hard cap"},
}


def _extract_credit_candidates(docs, db) -> list:
    """Walk all processed documents and collect every plausible credit value with provenance."""
    import re
    candidates = []
    for doc in docs:
        data = doc.extracted_data or {}
        # ── Excel / CSV: scan numeric columns for CO2/credit keywords ──────
        sheets = data.get("sheets", {})
        for sheet_name, sheet in sheets.items():
            if not isinstance(sheet, dict):
                continue
            for col, stats in (sheet.get("numeric_summary") or {}).items():
                col_l = col.lower()
                if any(w in col_l for w in ["net","removal","co2","credit","corc","carbon","tonne","t_co2"]):
                    val = abs(stats.get("sum", 0) or stats.get("max", 0) or 0)
                    if 10 < val < 10_000_000:
                        candidates.append({
                            "source": f"{doc.document_type}: {doc.name}",
                            "sheet": sheet_name,
                            "column": col,
                            "value": round(val, 1),
                            "extraction": "excel_numeric_column",
                            "confidence": "medium",
                        })
        # ── PDF/text: regex scan ────────────────────────────────────────────
        text = data.get("text") or data.get("text_preview") or ""
        if text:
            for pattern in [
                r'(\d[\d,\.]+)\s*(?:t(?:CO2)?e?|tonnes?|CORCs?)\s*(?:per\s*year|/\s*yr|annual)?',
                r'(?:net\s+removal|credit[s]?|issuance)[:\s]+(\d[\d,\.]+)',
            ]:
                for m in re.finditer(pattern, text, re.IGNORECASE):
                    raw = m.group(1).replace(",", "")
                    try:
                        val = float(raw)
                        if 10 < val < 10_000_000:
                            ctx = text[max(0, m.start()-60):m.end()+60].replace("\n"," ").strip()
                            candidates.append({
                                "source": f"{doc.document_type}: {doc.name}",
                                "context": ctx,
                                "value": round(val, 1),
                                "extraction": "text_regex",
                                "confidence": "low",
                            })
                    except ValueError:
                        pass
        # ── key_terms from extraction ───────────────────────────────────────
        kt = data.get("key_terms", {})
        if kt.get("co2_tonnes"):
            try:
                val = float(str(kt["co2_tonnes"]).replace(",", "."))
                if val > 10:
                    candidates.append({
                        "source": f"{doc.document_type}: {doc.name}",
                        "value": round(val, 1),
                        "extraction": "key_term",
                        "confidence": "low",
                    })
            except ValueError:
                pass
    # Deduplicate by rounding to nearest 100 (avoid the same value from multiple sources)
    seen: set = set()
    deduped = []
    for c in candidates:
        bucket = round(c["value"] / 100) * 100
        if bucket not in seen:
            seen.add(bucket)
            deduped.append(c)
    return deduped


@router.get("/projects/{project_id}/credit-verification")
def credit_verification(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    Extract and cross-check credit estimates from all processed documents.
    Returns: best estimate, extraction candidates, methodology cap check, risk flags.
    """
    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")

    docs = db.query(VVDocument).filter(
        VVDocument.project_id == project_id,
        (VVDocument.is_deleted == False) | (VVDocument.is_deleted == None),
    ).all()

    # Methodology context
    methodology_code = ""
    if p.description and "METHODOLOGY:" in p.description:
        methodology_code = p.description.split("METHODOLOGY:")[1].split("|")[0]
    cap_info = _CREDIT_CAPS.get(methodology_code, {"cap": None, "unit": "tCO2e", "scrutiny_threshold": 50_000, "note": ""})

    # Extract candidates
    candidates = _extract_credit_candidates(docs, db)

    # Best estimate = highest-confidence candidate (prefer excel over text)
    confidence_rank = {"excel_numeric_column": 3, "key_term": 2, "text_regex": 1}
    sorted_candidates = sorted(candidates, key=lambda c: (-confidence_rank.get(c["extraction"], 0), -c["value"]))
    best = sorted_candidates[0] if sorted_candidates else None

    # Cap and risk checks
    warnings = []
    cap_status = "no_cap"
    if best:
        val = best["value"]
        scrutiny = cap_info.get("scrutiny_threshold")
        hard_cap  = cap_info.get("cap")
        if hard_cap and val > hard_cap:
            cap_status = "exceeds_cap"
            warnings.append(f"⚠ Estimated credits ({val:,.0f}) exceed the methodology cap ({hard_cap:,.0f} {cap_info['unit']}).")
        elif scrutiny and val > scrutiny:
            cap_status = "scrutiny_required"
            warnings.append(f"📋 Estimated credits ({val:,.0f}) above enhanced scrutiny threshold ({scrutiny:,.0f} {cap_info['unit']}). Additional documentation recommended.")
        else:
            cap_status = "within_limit"

    # Confidence summary
    if not candidates:
        overall_confidence = "none"
        summary = "No credit values could be extracted. Upload an LCA spreadsheet or leakage determination to enable automatic estimation."
    elif best and best["extraction"] == "excel_numeric_column":
        overall_confidence = "medium"
        summary = f"Credit estimate of {best['value']:,.0f} {cap_info['unit']} extracted from spreadsheet column '{best.get('column', '')}' in '{best.get('sheet', '')}'. Manual review required."
    else:
        overall_confidence = "low"
        summary = f"Indicative estimate of {best['value']:,.0f} {cap_info['unit']} from document text. Upload an LCA spreadsheet for a higher-confidence estimate."

    return {
        "estimated_credits": best["value"] if best else None,
        "unit": cap_info["unit"],
        "overall_confidence": overall_confidence,
        "summary": summary,
        "cap_status": cap_status,
        "methodology_code": methodology_code,
        "methodology_cap": cap_info.get("cap"),
        "scrutiny_threshold": cap_info.get("scrutiny_threshold"),
        "cap_note": cap_info.get("note", ""),
        "warnings": warnings,
        "candidates": sorted_candidates[:8],
    }


# ── Submission package builder ────────────────────────────────────────────────
@router.post("/projects/{project_id}/build-submission-package")
def build_submission_package(
    project_id: UUID,
    db: Session = Depends(get_db), user=Depends(get_current_user)
):
    """Build a ZIP containing all approved documents + a manifest CSV."""
    import csv

    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p: raise HTTPException(404, "Project not found")

    docs = db.query(VVDocument).filter(
        VVDocument.project_id == project_id,
        (VVDocument.is_deleted == False) | (VVDocument.is_deleted == None)
    ).all()

    if not docs:
        raise HTTPException(400, "No documents in this project")

    methodology_code = ""
    if p.description and "METHODOLOGY:" in p.description:
        methodology_code = p.description.split("METHODOLOGY:")[1].split("|")[0]
    required = _get_required_doc_types(methodology_code, db)
    uploaded_types = {d.document_type for d in docs}
    missing = [r for r in required if r not in uploaded_types]

    zip_buffer = io.BytesIO()
    manifest_rows = []

    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for doc in docs:
            try:
                with storage.open_local(doc.storage_path, suffix=f".{doc.file_type}") as local_path:
                    safe_name = f"{doc.document_type}__{(doc.name or 'file').replace('/', '-')}"
                    zf.write(local_path, arcname=f"documents/{safe_name}")
                    manifest_rows.append({
                        "document_type": doc.document_type,
                        "filename": safe_name,
                        "review_status": doc.review_status or "draft",
                        "signed_off_by": doc.signed_off_by or "",
                        "upload_date": doc.uploaded_at.strftime("%Y-%m-%d") if doc.uploaded_at else "",
                        "expiry_date": doc.expiry_date.strftime("%Y-%m-%d") if doc.expiry_date else "",
                    })
            except Exception as e:
                logger.warning(f"Could not include {doc.name}: {e}")

        # Generate manifest CSV in memory
        manifest_buf = io.StringIO()
        writer = csv.DictWriter(manifest_buf, fieldnames=["document_type","filename","review_status","signed_off_by","upload_date","expiry_date"])
        writer.writeheader(); writer.writerows(manifest_rows)
        zf.writestr("MANIFEST.csv", manifest_buf.getvalue())

        # Missing docs warning
        if missing:
            missing_txt = "MISSING REQUIRED DOCUMENTS:\n" + "\n".join(f"- {m}" for m in missing)
            zf.writestr("MISSING_DOCUMENTS.txt", missing_txt)

    zip_buffer.seek(0)
    safe_proj = (p.name or "project").replace(" ", "_").replace("/", "-")[:40]
    filename = f"Submission_{safe_proj}_{datetime.utcnow().strftime('%Y%m%d')}.zip"

    _log_action(db, project_id=str(project_id),
                actor_id=str(user.id), actor_name=getattr(user, 'full_name', '') or getattr(user, 'email', ''),
                action='submission_package_built', metadata={'doc_count': len(manifest_rows), 'missing': missing})

    return Response(
        content=zip_buffer.read(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Notification preferences ──────────────────────────────────────────────────
@router.get("/notification-preferences")
def get_notification_preferences(db: Session = Depends(get_db), user=Depends(get_current_user)):
    prefs = db.query(VVNotificationPreference).filter(VVNotificationPreference.user_id == user.id).first()
    if not prefs:
        return {
            "email": getattr(user, 'email', ''),
            "on_document_uploaded": True, "on_expiry_warning": True,
            "on_status_change": True, "on_consistency_check": True,
            "on_validation_complete": False,
        }
    return {
        "email": prefs.email or getattr(user, 'email', ''),
        "on_document_uploaded": prefs.on_document_uploaded,
        "on_expiry_warning": prefs.on_expiry_warning,
        "on_status_change": prefs.on_status_change,
        "on_consistency_check": prefs.on_consistency_check,
        "on_validation_complete": prefs.on_validation_complete,
    }


@router.put("/notification-preferences")
def update_notification_preferences(
    data: dict,
    db: Session = Depends(get_db), user=Depends(get_current_user)
):
    prefs = db.query(VVNotificationPreference).filter(VVNotificationPreference.user_id == user.id).first()
    if not prefs:
        prefs = VVNotificationPreference(user_id=user.id)
        db.add(prefs)
    for field in ["email","on_document_uploaded","on_expiry_warning","on_status_change","on_consistency_check","on_validation_complete"]:
        if field in data:
            setattr(prefs, field, data[field])
    prefs.updated_at = datetime.utcnow()
    db.commit()
    return {"saved": True}


def _send_notification_event(db, *, project_id: str, event: str, subject: str, body: str):
    """Send SES email to all users with this event preference enabled."""
    try:
        prefs_list = db.query(VVNotificationPreference).filter(
            getattr(VVNotificationPreference, event) == True
        ).all()
        if not prefs_list:
            return
        import boto3
        ses = boto3.client("ses", region_name=os.environ.get("AWS_REGION", "us-east-1"))
        sender = os.environ.get("SES_FROM_EMAIL", "noreply@datasentinel.io")
        for prefs in prefs_list:
            recipient = prefs.email
            if not recipient:
                continue
            try:
                ses.send_email(
                    Source=sender,
                    Destination={"ToAddresses": [recipient]},
                    Message={
                        "Subject": {"Data": f"[DataSentinel] {subject}"},
                        "Body": {"Text": {"Data": body}},
                    },
                )
            except Exception as e:
                logger.warning(f"SES send failed to {recipient}: {e}")
    except Exception as e:
        logger.warning(f"Notification event failed: {e}")


def _send_notification_bg(project_id: str, event: str, subject: str, body: str) -> None:
    """Background-safe wrapper: opens its own DB session so the request session is not blocked."""
    db = SessionLocal()
    try:
        _send_notification_event(db, project_id=project_id, event=event, subject=subject, body=body)
    finally:
        db.close()


# ── Verification ─────────────────────────────────────────────────────────────
@router.post("/projects/{project_id}/verify")
def run_verification(project_id: UUID, background_tasks: BackgroundTasks = BackgroundTasks(),
                     db: Session = Depends(get_db), user=Depends(get_current_user)):
    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p: raise HTTPException(404, "Project not found")

    docs = db.query(VVDocument).filter(VVDocument.project_id == project_id).all()
    if not docs:
        raise HTTPException(400, "No documents uploaded. Upload project documents before running verification.")

    # Get registry ruleset
    registry_slug = "puro_earth"
    methodology_code = ""
    if p.description and "REGISTRY:" in p.description:
        registry_slug = p.description.split("REGISTRY:")[1].split("|")[0]
    if p.description and "METHODOLOGY:" in p.description:
        methodology_code = p.description.split("METHODOLOGY:")[1].split("|")[0]

    ruleset = get_ruleset(registry_slug, methodology_code)
    checkpoints = ruleset["checkpoints"]

    # Delete existing checkpoints
    db.query(VVCheckpoint).filter(VVCheckpoint.project_id == project_id).delete()
    db.commit()

    # Update project status
    p.status = "under_review"
    db.commit()

    # Run in background via FastAPI BackgroundTasks — replaces daemon thread (F012)
    background_tasks.add_task(_run_verification_bg, str(project_id), str(user.id), checkpoints)

    return {"message": "Verification started. Results will appear shortly.", "status": "under_review"}

@router.post("/projects/{project_id}/ai-analyse")
async def ai_analyse_project(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    Run Claude AI deep-analysis on all uploaded documents against all checkpoints.
    Updates each VVCheckpoint with ai_finding, ai_confidence, ai_evidence.
    """
    from app.engines.ai.vv_agent import analyse_project

    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")

    docs = db.query(VVDocument).filter(VVDocument.project_id == project_id).all()
    checkpoints = db.query(VVCheckpoint).filter(VVCheckpoint.project_id == project_id).all()

    if not docs:
        raise HTTPException(400, "No documents uploaded — upload project documents first")
    if not checkpoints:
        raise HTTPException(400, "No checkpoints found — run verification first to create checkpoints")

    result = await analyse_project(p, docs, checkpoints)

    if "error" in result:
        raise HTTPException(503, result["error"])

    # Persist AI findings to each checkpoint
    findings = result.get("checkpoint_findings", [])
    updated = 0
    for f in findings:
        cp_id = f.get("id")
        if not cp_id:
            continue
        try:
            cp = db.query(VVCheckpoint).filter(VVCheckpoint.id == cp_id).first()
            if cp:
                cp.ai_finding = f.get("ai_finding", "")
                cp.ai_confidence = f.get("ai_confidence", 0.0)
                cp.ai_evidence = f.get("ai_evidence", [])
                # Persist finding severity from AI (verifier can override later)
                # Guard: finding_severity is deferred — skip if column doesn't exist yet
                raw_sev = f.get("finding_severity", "none")
                if raw_sev in ("major_nc", "minor_nc", "observation", "ofi", "none"):
                    try:
                        cp.finding_severity = raw_sev
                    except Exception:
                        pass
                # Only promote status if checkpoint hasn't been reviewed yet
                if cp.status in ("pending", "not_started", None):
                    cp.status = f.get("status", cp.status)
                updated += 1
        except Exception as exc:
            logger.warning("Failed to update checkpoint %s: %s", cp_id, exc)
            continue

    p.status = "under_review"

    # Persist the summary result so the frontend can reload it without re-running
    analysis_payload = {
        "checkpoints_updated": updated,
        "overall_assessment": result.get("overall_assessment", ""),
        "critical_gaps": result.get("critical_gaps", []),
        "recommended_actions": result.get("recommended_actions", []),
        "estimated_credit_risk": result.get("estimated_credit_risk", "unknown"),
    }
    try:
        p.last_analysis_result = analysis_payload
        p.last_analysis_run_at = datetime.utcnow()
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(p, 'last_analysis_result')
    except Exception as _pe:
        logger.warning("Could not persist analysis result (migration pending?): %s", _pe)

    db.commit()

    return analysis_payload

@router.get("/projects/{project_id}/checkpoints")
def list_checkpoints(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    cps = db.query(VVCheckpoint).filter(VVCheckpoint.project_id == project_id).order_by(VVCheckpoint.checkpoint_id).all()
    return [_cp_out(c) for c in cps]

@router.patch("/projects/{project_id}/checkpoints/{cp_id}")
def update_checkpoint(project_id: UUID, cp_id: UUID, data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    cp = db.query(VVCheckpoint).filter(VVCheckpoint.id == cp_id).first()
    if not cp: raise HTTPException(404, "Checkpoint not found")
    if "verifier_status" in data: cp.verifier_status = data["verifier_status"]
    if "verifier_note" in data: cp.verifier_note = data["verifier_note"]
    if "finding_severity" in data:
        valid_severities = ("major_nc", "minor_nc", "observation", "ofi", "none")
        if data["finding_severity"] in valid_severities:
            try:
                cp.finding_severity = data["finding_severity"]
            except Exception:
                pass  # column absent — migration 0013 pending
    cp.reviewed_by = user.id
    cp.reviewed_at = datetime.utcnow()
    db.commit(); db.refresh(cp)
    return _cp_out(cp)

# ── Reports ──────────────────────────────────────────────────────────────────
@router.post("/projects/{project_id}/report")
async def generate_report(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    p = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not p: raise HTTPException(404, "Project not found")

    cps = db.query(VVCheckpoint).filter(VVCheckpoint.project_id == project_id).all()
    if not cps:
        raise HTTPException(400, "Run verification first before generating report.")

    passed = sum(1 for c in cps if (c.verifier_status or c.status) == "passed")
    failed = sum(1 for c in cps if (c.verifier_status or c.status) == "failed")
    warnings = sum(1 for c in cps if (c.verifier_status or c.status) == "warning")
    critical_failed = [c for c in cps if c.category in ("Eligibility","Quality","Monitoring") and (c.verifier_status or c.status) == "failed"]

    if critical_failed:
        outcome = "not_verified"
        fallback_summary = f"Verification FAILED. {len(critical_failed)} critical checkpoint(s) not met."
    elif warnings > 0:
        outcome = "conditional"
        fallback_summary = f"Conditional verification. {passed} checkpoints passed, {warnings} require attention."
    else:
        outcome = "verified"
        fallback_summary = f"Verification APPROVED. All {passed} checkpoints passed."

    findings = [{"checkpoint": c.checkpoint_id, "name": c.name, "status": c.verifier_status or c.status, "finding": c.ai_finding or c.verifier_note} for c in cps]
    conditions = [{"checkpoint": c.checkpoint_id, "note": c.verifier_note} for c in cps if (c.verifier_status or c.status) == "warning"]

    # ── AI narrative generation ───────────────────────────────────────────────
    summary = fallback_summary
    recommendations = []
    credit_risk = "unknown"
    try:
        from app.engines.ai.claude_client import call_claude_json
        failed_details = [{"id": c.checkpoint_id, "name": c.name, "category": c.category, "finding": c.ai_finding or c.verifier_note or ""} for c in cps if (c.verifier_status or c.status) in ("failed", "warning")]
        ai_prompt = f"""You are a carbon credit verification expert writing an official verification report.

Project: {p.name}
Registry: {p.registry_id or 'Unknown'}
Outcome: {outcome.upper()}
Checkpoints: {len(cps)} total — {passed} passed, {failed} failed, {warnings} warnings

Failed/Warning checkpoints:
{failed_details[:15]}

Write a professional verification report assessment. Return JSON with:
- summary: 2-3 sentence executive summary of the verification outcome (professional, specific, formal tone)
- recommendations: list of 3-5 specific actionable recommendations (strings), prioritised by urgency
- credit_risk: one of "low" | "medium" | "high" | "critical" — assessment of risk to carbon credit issuance
- credit_risk_rationale: 1 sentence explaining the credit risk rating"""

        ai_result = await call_claude_json("You are a carbon credit verification expert.", ai_prompt, max_tokens=800)
        if ai_result and isinstance(ai_result, dict):
            summary = ai_result.get("summary", fallback_summary)
            recommendations = ai_result.get("recommendations", [])
            credit_risk = ai_result.get("credit_risk", "unknown")
            credit_risk_rationale = ai_result.get("credit_risk_rationale", "")
            if credit_risk_rationale and recommendations:
                recommendations.append(f"Credit risk note: {credit_risk_rationale}")
    except Exception as ai_err:
        logger.warning("AI report generation failed, using fallback: %s", ai_err)

    if not recommendations:
        if outcome == "conditional":
            recommendations = ["Resolve outstanding items and resubmit for final verification."]
        elif outcome == "not_verified":
            recommendations = ["Address all failed checkpoints and resubmit a complete documentation package."]
        else:
            recommendations = ["Project is cleared for certificate issuance."]

    report = VVReport(
        project_id=project_id,
        report_type="verification",
        status="final",
        overall_outcome=outcome,
        summary=summary,
        findings=findings,
        recommendations=recommendations,
        conditions=conditions,
        generated_by=user.id,
        finalized_at=datetime.utcnow(),
        report_data={"project_name": p.name, "checkpoints_total": len(cps),
                     "passed": passed, "failed": failed, "warnings": warnings,
                     "outcome": outcome, "credit_risk": credit_risk,
                     "generated_at": datetime.utcnow().isoformat()}
    )
    p.status = "verified" if outcome == "verified" else ("conditional" if outcome == "conditional" else "rejected")
    db.add(report); db.commit(); db.refresh(report)
    return _report_out(report)

@router.get("/projects/{project_id}/reports/{report_id}/pdf")
def download_report_pdf(project_id: UUID, report_id: UUID,
                        db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Generate and return a PDF verification report."""
    try:
        from app.engines.vv.pdf_report import generate_vv_pdf
    except ImportError:
        raise HTTPException(500, "PDF generation requires reportlab. Run: pip install reportlab==4.2.2 inside the backend container.")

    project_obj = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not project_obj: raise HTTPException(404, "Project not found")

    report_obj = db.query(VVReport).filter(VVReport.id == report_id,
                                            VVReport.project_id == project_id).first()
    if not report_obj: raise HTTPException(404, "Report not found")

    checkpoints = db.query(VVCheckpoint).filter(VVCheckpoint.project_id == project_id).all()
    documents   = db.query(VVDocument).filter(VVDocument.project_id == project_id).all()

    project_dict  = _project_out(project_obj, db)
    report_dict   = _report_out(report_obj)
    cp_dicts      = [_cp_out(c) for c in checkpoints]
    doc_dicts     = [_doc_out(d) for d in documents]

    pdf_bytes = generate_vv_pdf(project_dict, report_dict, cp_dicts, doc_dicts)

    safe_name = (project_obj.name or "report").replace(" ","_").replace("/","-")[:50]
    filename = f"VV_Report_{safe_name}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@router.post("/projects/{project_id}/reports/{report_id}/signoff")
def signoff_report(
    project_id: UUID, report_id: UUID,
    data: dict,
    db: Session = Depends(get_db), user=Depends(get_current_user),
):
    """
    Dual independent sign-off on a verification report.
    Sign-off slot is determined by who has already signed:
    - First call → slot 1 (primary verifier)
    - Second call by a DIFFERENT user → slot 2 (QA reviewer)
    Sign-offs are stored inside report_data JSONB — no migration required.
    """
    report = db.query(VVReport).filter(
        VVReport.id == report_id, VVReport.project_id == project_id
    ).first()
    if not report:
        raise HTTPException(404, "Report not found")

    actor_name = getattr(user, "full_name", "") or getattr(user, "email", "")
    actor_id   = str(user.id)

    # Load current sign-off state
    rd = dict(report.report_data or {})
    signoffs: list = rd.get("signoffs", [])

    # Check for duplicate sign-off by same user
    if any(s["user_id"] == actor_id for s in signoffs):
        raise HTTPException(409, "You have already signed off on this report. A second sign-off must come from a different user.")

    if len(signoffs) >= 2:
        raise HTTPException(409, "This report already has two sign-offs. No further sign-off is required.")

    slot = len(signoffs) + 1
    signoffs.append({
        "slot": slot,
        "user_id": actor_id,
        "user_name": actor_name,
        "role": getattr(user, "role", "analyst"),
        "note": (data.get("note") or "").strip(),
        "signed_at": datetime.utcnow().isoformat(),
    })
    rd["signoffs"] = signoffs
    rd["signoff_status"] = "dual_signoff_complete" if len(signoffs) >= 2 else "awaiting_second_signoff"

    from sqlalchemy.orm.attributes import flag_modified
    report.report_data = rd
    flag_modified(report, "report_data")
    db.commit()

    _log_action(db, project_id=str(project_id),
                actor_id=actor_id, actor_name=actor_name,
                action=f"report_signoff_{slot}",
                metadata={"report_id": str(report_id), "slot": slot, "status": rd["signoff_status"]})

    return {"slot": slot, "signoff_status": rd["signoff_status"], "signoffs": signoffs}


@router.get("/projects/{project_id}/reports")
def list_reports(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    reports = db.query(VVReport).filter(VVReport.project_id == project_id).all()
    return [_report_out(r) for r in reports]


# ── Feature #8: Live Registry Sync ───────────────────────────────────────────

@router.post("/projects/{project_id}/registry-sync")
def trigger_registry_sync(
    project_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Sync this project against the upstream registry (Puro.Earth by default).

    Uses MockPuroAdapter when PURO_API_KEY is absent — swap env-vars for live data.
    Detects discrepancies between local data and the registry record, stores the
    result in vv_registry_sync (upserted per project), and returns the sync row.
    """
    from datetime import timezone as _tz

    project = db.query(VVProject).filter(VVProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Resolve the external project ID: use the project's own string id as a stable key
    external_id = str(project_id)

    from app.engines.registry.puro_earth import get_adapter
    adapter = get_adapter()

    try:
        result = adapter.fetch_project(external_id)
        sync_status = "ok"
        discrepancies: list[str] = []

        # ── Compare registry data against local fields ────────────────────────
        # Methodology mismatch
        local_method = (project.methodology.code if project.methodology else None)
        if local_method and result.methodology_version:
            reg_code = result.methodology_version.split("/")[0]
            if reg_code and local_method != reg_code:
                discrepancies.append(
                    f"Methodology mismatch: local={local_method}, registry={reg_code}"
                )

        # Registry status not active
        if result.status not in ("active", "pending"):
            discrepancies.append(f"Registry project status is '{result.status}'")

        # Flags from registry
        for flag in result.flags:
            discrepancies.append(f"Registry flag: {flag}")

        if discrepancies:
            sync_status = "discrepancy"

        registry_data = {
            "registry_slug":         result.registry_slug,
            "external_project_id":   result.external_project_id,
            "status":                result.status,
            "methodology_version":   result.methodology_version,
            "credit_issued_to_date": result.credit_issued_to_date,
            "next_review_date":      result.next_review_date,
            "flags":                 result.flags,
            "raw":                   result.raw,
        }
    except Exception as exc:  # noqa: BLE001
        logger.error("Registry sync error for project %s: %s", project_id, exc)
        sync_status = "error"
        discrepancies = [f"Sync error: {exc}"]
        registry_data = {}

    now = datetime.now(_tz.utc)

    if not _check_registry_sync_table(db):
        # Migration 0011 hasn't run yet — return a synthetic result without persisting
        return {
            "sync_status":         sync_status,
            "last_synced_at":      now.isoformat(),
            "registry_slug":       adapter.slug,
            "external_project_id": str(project_id),
            "discrepancies":       discrepancies,
            "registry_data":       registry_data,
        }

    # Upsert — one row per project (project_id is UUID, NOT str)
    sync_row = db.query(VVRegistrySync).filter(
        VVRegistrySync.project_id == project_id
    ).first()

    if sync_row:
        sync_row.registry_slug       = adapter.slug
        sync_row.external_project_id = str(project_id)
        sync_row.sync_status         = sync_status
        sync_row.last_synced_at      = now
        sync_row.registry_data       = registry_data
        sync_row.discrepancies       = discrepancies
        from sqlalchemy.orm.attributes import flag_modified as _fm
        _fm(sync_row, "registry_data")
        _fm(sync_row, "discrepancies")
    else:
        import uuid as _uuid
        sync_row = VVRegistrySync(
            id                   = _uuid.uuid4(),   # UUID object, not str
            project_id           = project_id,       # UUID object from path param
            registry_slug        = adapter.slug,
            external_project_id  = str(project_id),
            sync_status          = sync_status,
            last_synced_at       = now,
            registry_data        = registry_data,
            discrepancies        = discrepancies,
        )
        db.add(sync_row)

    db.commit()
    db.refresh(sync_row)

    actor_id   = str(user.id) if user else None
    actor_name = (getattr(user, "full_name", None) or getattr(user, "email", None) or "Unknown") if user else "Unknown"
    _log_action(db, project_id=str(project_id),
                actor_id=actor_id, actor_name=actor_name,
                action="registry_sync",
                metadata={"sync_status": sync_status, "discrepancies": len(discrepancies)})

    return {
        "sync_status":          sync_row.sync_status,
        "last_synced_at":       sync_row.last_synced_at.isoformat() if sync_row.last_synced_at else None,
        "registry_slug":        sync_row.registry_slug,
        "external_project_id":  sync_row.external_project_id,
        "discrepancies":        sync_row.discrepancies or [],
        "registry_data":        sync_row.registry_data or {},
    }


@router.get("/projects/{project_id}/registry-sync")
def get_registry_sync(
    project_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Return the most recent registry sync result for this project."""
    if not _check_registry_sync_table(db):
        return None  # migration 0011 hasn't run yet — return null, not 500
    try:
        sync_row = db.query(VVRegistrySync).filter(
            VVRegistrySync.project_id == project_id
        ).first()
    except Exception:
        return None
    if not sync_row:
        return None
    return {
        "sync_status":          sync_row.sync_status,
        "last_synced_at":       sync_row.last_synced_at.isoformat() if sync_row.last_synced_at else None,
        "registry_slug":        sync_row.registry_slug,
        "external_project_id":  sync_row.external_project_id,
        "discrepancies":        sync_row.discrepancies or [],
        "registry_data":        sync_row.registry_data or {},
    }


@router.post("/projects/{project_id}/reports/{report_id}/anchor")
def anchor_report(
    project_id: UUID,
    report_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Feature #12: Anchor a V&V report to the Polygon blockchain.

    When POLYGON_RPC_URL + POLYGON_WALLET_PRIVATE_KEY are set, sends a real
    transaction to Polygon Mainnet (chainId=137) with the report SHA-256 hash
    embedded in calldata.  Without credentials, generates a deterministic
    simulated anchor (chain = 'polygon-simulated') so the workflow can be
    exercised without on-chain cost.
    """
    import hashlib
    import secrets

    report = db.query(VVReport).filter(
        VVReport.id == report_id,
        VVReport.project_id == project_id,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    # Check if already anchored — guard deferred column access
    if _anchor_cols_exist is not False:
        try:
            already = report.anchor_tx_hash
        except Exception:
            already = None
    else:
        already = None
    if already:
        raise HTTPException(status_code=409, detail="Report already anchored")

    # Build deterministic hash over the immutable report fields
    import json as _json
    report_blob = _json.dumps({
        "id":             str(report.id),
        "project_id":     str(report.project_id),
        "report_type":    report.report_type,
        "status":         report.status,
        "overall_outcome": report.overall_outcome,
        "summary":        report.summary,
        "credit_estimate": report.credit_estimate,
        "findings":       report.findings or [],
        "generated_at":   report.generated_at.isoformat() if report.generated_at else None,
    }, sort_keys=True)
    report_hash = hashlib.sha256(report_blob.encode()).hexdigest()

    rpc_url     = os.environ.get("POLYGON_RPC_URL", "")
    private_key = os.environ.get("POLYGON_WALLET_PRIVATE_KEY", "")

    if rpc_url and private_key:
        # ── Real Polygon transaction ─────────────────────────────────────────
        try:
            try:
                from web3 import Web3  # type: ignore[import]
            except ImportError:
                raise RuntimeError("web3 package not installed — add web3 to requirements.txt to enable live anchoring")

            w3 = Web3(Web3.HTTPProvider(rpc_url))
            if not w3.is_connected():
                raise RuntimeError("Cannot connect to Polygon RPC")

            account   = w3.eth.account.from_key(private_key)
            calldata  = f"DS-ANCHOR:{report_hash}".encode()
            nonce     = w3.eth.get_transaction_count(account.address)
            gas_price = w3.eth.gas_price

            tx = {
                "chainId": 137,          # Polygon Mainnet
                "to":      "0x000000000000000000000000000000000000dEaD",  # burn address
                "value":   0,
                "gas":     30_000,
                "gasPrice": gas_price,
                "nonce":   nonce,
                "data":    calldata,
            }
            signed = account.sign_transaction(tx)
            tx_hash_bytes = w3.eth.send_raw_transaction(signed.raw_transaction)
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash_bytes, timeout=60)

            tx_hash     = receipt.transactionHash.hex()
            block_number = int(receipt.blockNumber)
            chain_label  = "polygon"
        except Exception as exc:
            logger.error("Polygon anchor failed: %s", exc)
            raise HTTPException(status_code=500, detail=f"Blockchain error: {exc}") from exc
    else:
        # ── Simulated anchor (no credentials configured) ─────────────────────
        tx_hash      = "0x" + secrets.token_hex(32)
        block_number = None
        chain_label  = "polygon-simulated"

    now = datetime.utcnow()
    # Only persist anchor fields if migration 0010 has run (columns exist)
    if _anchor_cols_exist is not False:
        try:
            report.anchor_tx_hash     = tx_hash
            report.anchor_block       = block_number
            report.anchor_anchored_at = now
            report.anchor_report_hash = report_hash
            report.anchor_chain       = chain_label
            db.commit()
            db.refresh(report)
            _anchor_cols_exist = True   # confirmed writeable
        except Exception as exc:
            db.rollback()
            _anchor_cols_exist = False
            logger.warning("Anchor columns not yet in DB (migration pending): %s", exc)
    else:
        logger.warning("Anchor columns not yet in DB — anchor result not persisted")

    explorer_url = (
        f"https://polygonscan.com/tx/{tx_hash}"
        if chain_label == "polygon"
        else None
    )

    actor_id   = str(user.id) if user else None
    actor_name = (getattr(user, "full_name", None) or getattr(user, "email", None) or "Unknown") if user else "Unknown"
    _log_action(db, project_id=str(project_id),
                actor_id=actor_id, actor_name=actor_name,
                action="report_anchored",
                metadata={"report_id": str(report_id), "chain": chain_label, "tx_hash": tx_hash})

    return {
        "tx_hash":      tx_hash,
        "block_number": block_number,
        "report_hash":  report_hash,
        "chain":        chain_label,
        "anchored_at":  now.isoformat(),
        "explorer_url": explorer_url,
    }


# ── Background tasks ─────────────────────────────────────────────────────────

def _sanitize_for_postgres(obj):
    """
    Recursively strip values that PostgreSQL cannot store in a JSONB/text column:
      - Null bytes  (\x00)        — PostgreSQL raises UntranslatableCharacter
      - Lone Unicode surrogates   — cause encode/decode errors on some platforms
      - float NaN / Inf           — not valid JSON; psycopg2 raises ValueError
    Works on str, dict, list, float; passes all other types through unchanged.
    """
    if isinstance(obj, float):
        import math
        # Replace NaN / ±Infinity with None (stored as JSON null)
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, str):
        # Remove null bytes, then re-encode/decode to drop any lone surrogates
        cleaned = obj.replace('\x00', '')
        return cleaned.encode('utf-8', errors='ignore').decode('utf-8', errors='ignore')
    if isinstance(obj, dict):
        return {_sanitize_for_postgres(k): _sanitize_for_postgres(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_postgres(item) for item in obj]
    return obj


def _extract_pdf_text(local_path: str) -> str:
    """Extract plain text from a PDF file using pypdf (fallback)."""
    try:
        from pypdf import PdfReader
        reader = PdfReader(local_path)
        pages_text = []
        for page in reader.pages:
            pages_text.append(page.extract_text() or "")
        raw = "\n".join(pages_text)
        # Strip null bytes and lone surrogates before returning — some PDFs
        # embed them and PostgreSQL rejects the JSONB write with
        # "unsupported Unicode escape sequence /  cannot be converted to text"
        return _sanitize_for_postgres(raw)
    except Exception as e:
        logger.warning(f"pypdf extraction failed: {e}")
        return ""


def _extract_pdf_content(local_path: str) -> dict:
    """
    Extract rich content from a PDF — text + tables + key figures.

    Primary:  pdfplumber  (better layout, table detection)
    Fallback: pypdf       (always in requirements)
    """
    # ── Primary: pdfplumber ──────────────────────────────────────────────────
    try:
        import pdfplumber
        pages_text: list = []
        all_tables: list = []
        with pdfplumber.open(local_path) as pdf:
            page_count = len(pdf.pages)
            for page in pdf.pages[:60]:   # cap at 60 pages for performance
                pages_text.append(page.extract_text() or "")
                for tbl in (page.extract_tables() or []):
                    if tbl:
                        all_tables.append(tbl)

        full_text: str = _sanitize_for_postgres("\n".join(pages_text))

        # Serialize tables (cap to 10; sanitize cell values)
        tables_out = [
            [[str(cell) if cell is not None else "" for cell in row] for row in tbl]
            for tbl in all_tables[:10]
        ]

        # Key numerical / compliance terms
        from app.engines.vv.verification_engine import DocumentExtractor
        key_terms = DocumentExtractor()._extract_key_terms(full_text)

        return {
            "file_type": "pdf",
            "text": full_text,
            "preview": full_text[:2000],
            "page_count": page_count,
            "char_count": len(full_text),
            "tables": tables_out,
            "table_count": len(all_tables),
            "key_terms": key_terms,
        }

    except ImportError:
        logger.info("pdfplumber not installed — falling back to pypdf for PDF extraction")

    except Exception as e:
        logger.warning(f"pdfplumber failed for {local_path}: {e} — falling back to pypdf")

    # ── Fallback: pypdf ──────────────────────────────────────────────────────
    text = _extract_pdf_text(local_path)
    from app.engines.vv.verification_engine import DocumentExtractor
    key_terms = DocumentExtractor()._extract_key_terms(text) if text else {}
    return {
        "file_type": "pdf",
        "text": text,
        "preview": text[:2000],
        "page_count": text.count("\x0c") + 1,
        "char_count": len(text),
        "tables": [],
        "table_count": 0,
        "key_terms": key_terms,
    }


def _process_document(doc_id: str):
    db = None
    try:
        from app.engines.vv.verification_engine import DocumentExtractor
        db = SessionLocal()
        doc = db.query(VVDocument).filter(VVDocument.id == doc_id).first()
        if not doc: return
        doc.status = "processing"
        db.commit()

        with storage.open_local(doc.storage_path, suffix=f".{doc.file_type}") as local_path:
            # PDF: rich extraction (text + tables + key figures) via pdfplumber → pypdf
            if doc.file_type == "pdf":
                data = _extract_pdf_content(local_path)
            else:
                extractor = DocumentExtractor()
                data = extractor.extract(local_path, doc.file_type)

        # Strip null bytes / lone surrogates before writing to JSONB — some PDFs
        # and CSV/Excel files embed  which PostgreSQL rejects at the DB level.
        data = _sanitize_for_postgres(data)
        doc.extracted_data = data
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(doc, "extracted_data")
        # For Excel files the extractor returns a 'sheets' dict — aggregate across sheets
        if data.get("sheets"):
            sheets = data["sheets"]
            total_rows = sum(s.get("row_count", 0) for s in sheets.values() if isinstance(s, dict))
            all_cols: list = []
            for s in sheets.values():
                if isinstance(s, dict):
                    all_cols.extend(s.get("columns", []))
            doc.row_count = total_rows
            doc.column_count = len(all_cols)
            sheet_names = list(sheets.keys())
            doc.extraction_summary = (
                f"Extracted {total_rows:,} rows across {len(sheet_names)} sheet(s): "
                f"{', '.join(sheet_names[:4])}{'…' if len(sheet_names) > 4 else ''}."
            )
        else:
            doc.row_count = data.get("row_count")
            doc.column_count = len(data.get("columns", []))
            if doc.file_type == "pdf":
                chars = data.get("char_count", 0)
                pages = data.get("page_count", 0)
                tables = data.get("table_count", 0)
                key_terms = data.get("key_terms", {})
                summary_parts = [f"PDF: {pages} page(s), {chars:,} characters"]
                if tables:
                    summary_parts.append(f"{tables} table(s) extracted")
                if key_terms.get("co2_tonnes"):
                    summary_parts.append(f"CO₂: {key_terms['co2_tonnes']} t")
                # Append a short text excerpt so AI-based tools get real content
                excerpt = (data.get("text") or "")[:600].strip()
                doc.extraction_summary = (
                    ". ".join(summary_parts) + "."
                    + (f" Excerpt: {excerpt}" if excerpt else "")
                )
            else:
                doc.extraction_summary = f"Extracted {doc.row_count or 0} rows, {doc.column_count or 0} columns. Columns: {', '.join(data.get('columns',[])[:8])}"

        # ── Second-pass content reclassification ─────────────────────────────
        # If the file landed as "other" (filename alone wasn't enough to classify
        # it), try again using the extracted text.  Only auto-update when the AI
        # is confident (≥ 70 %) so we never silently assign the wrong type.
        if doc.document_type in ("other", "other_document", None):
            text_snippet = (data.get("text") or data.get("preview") or "")[:2000]
            if text_snippet.strip():
                try:
                    from app.engines.vv.folder_connector import reclassify_with_content
                    new_type, confidence = reclassify_with_content(text_snippet, doc.name or "")
                    if new_type and confidence >= 70:
                        old_type = doc.document_type or "other"
                        doc.document_type = new_type
                        _log_action(
                            db,
                            project_id=str(doc.project_id),
                            document_id=str(doc.id),
                            actor_id=None,        # automated action — no user UUID
                            actor_name="AI Classifier",
                            action="document_retyped",
                            metadata={
                                "old_type": old_type,
                                "new_type": new_type,
                                "confidence_pct": confidence,
                                "method": "content_reclassification",
                                "document_name": doc.name,
                            },
                        )
                        logger.info(
                            "Content reclassify: %s → %s (%d%%)", doc.name, new_type, confidence
                        )
                except Exception as _rce:
                    logger.warning("Content reclassify hook failed for %s: %s", doc_id, _rce)

        doc.status = "processed"
        doc.processed_at = datetime.utcnow()
        db.commit()
    except Exception as e:
        import traceback
        logger.error(f"Document processing failed for {doc_id}: {e}\n{traceback.format_exc()}")
        if db is not None:
            try:
                # Must rollback first — if the exception came from a failed DB operation the
                # session is in an aborted-transaction state and any further query will raise
                # PendingRollbackError, which previously got swallowed by the bare `pass` and
                # left the document stuck at "processing" indefinitely.
                db.rollback()
                _doc = db.query(VVDocument).filter(VVDocument.id == doc_id).first()
                if _doc:
                    _doc.status = "error"
                    # Store the actual error message so it's visible in the UI
                    _doc.extraction_summary = f"Extraction failed: {type(e).__name__}: {str(e)[:300]}"
                    db.commit()
            except Exception as inner_e:
                logger.error(f"Could not mark document {doc_id} as error: {inner_e}")
    finally:
        if db is not None:
            db.close()

def _run_verification_bg(project_id: str, user_id: str, checkpoints: list):
    db = SessionLocal()
    try:
        p = db.query(VVProject).filter(VVProject.id == project_id).first()
        docs = db.query(VVDocument).filter(VVDocument.project_id == project_id).all()
        # Download S3 files to local temp paths so the engine can read them
        with contextlib.ExitStack() as stack:
            docs_dicts = []
            for d in docs:
                local_path = stack.enter_context(
                    storage.open_local(d.storage_path, suffix=f".{d.file_type}")
                )
                docs_dicts.append({
                    "id": str(d.id), "name": d.name, "file_type": d.file_type,
                    "document_type": d.document_type, "storage_path": local_path,
                    "extracted_data": d.extracted_data or {}
                })

            engine = VerificationEngine()
            result = engine.run({"id": project_id}, docs_dicts, checkpoints)

        for cp_result in result["checkpoint_results"]:
            cp = VVCheckpoint(
                project_id=project_id,
                checkpoint_id=cp_result["id"],
                category=cp_result.get("category",""),
                name=cp_result.get("name",""),
                description=cp_result.get("requirement",""),
                requirement=cp_result.get("requirement",""),
                status=cp_result.get("status","pending"),
                ai_finding=cp_result.get("finding",""),
                ai_confidence=cp_result.get("confidence",0.5),
                ai_evidence=cp_result.get("evidence",[]),
            )
            db.add(cp)

        p.status = "under_review"
        db.commit()
        logger.info(f"Verification complete for project {project_id}: {result['outcome']}")
    except Exception as e:
        logger.error(f"Verification engine error: {e}")
        if p := db.query(VVProject).filter(VVProject.id == project_id).first():
            p.status = "submitted"; db.commit()
    finally:
        db.close()

# ── Serialisers ───────────────────────────────────────────────────────────────
# Module-level cache — None = unchecked, True/False = result
_consistency_cols_exist: "bool | None" = None
_finding_severity_col_exists: "bool | None" = None


def _safe_finding_severity(cp, db) -> str:
    """Return finding_severity from a VVCheckpoint, falling back to 'none' if column absent."""
    global _finding_severity_col_exists

    if _finding_severity_col_exists is None:
        try:
            from sqlalchemy import text as _sql
            row = db.execute(_sql(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name='vv_checkpoints' AND column_name='finding_severity' LIMIT 1"
            )).fetchone()
            _finding_severity_col_exists = row is not None
        except Exception:
            _finding_severity_col_exists = False
            try:
                db.rollback()
            except Exception:
                pass

    if not _finding_severity_col_exists:
        return "none"

    try:
        val = cp.finding_severity  # triggers deferred SELECT
        return val or "none"
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        _finding_severity_col_exists = False
        return "none"


def _safe_consistency_fields(p, db) -> dict:
    """Return last_consistency_* fields, gracefully handling pre-migration state."""
    global _consistency_cols_exist

    # One-time check: does the column actually exist in this DB?
    if _consistency_cols_exist is None:
        try:
            from sqlalchemy import text as _sql
            row = db.execute(_sql(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name='vv_projects' AND column_name='last_consistency_result' LIMIT 1"
            )).fetchone()
            _consistency_cols_exist = row is not None
        except Exception:
            _consistency_cols_exist = False
            try:
                db.rollback()   # clear aborted-tx state so get_db()'s commit() succeeds
            except Exception:
                pass

    if not _consistency_cols_exist:
        return {"last_consistency_result": None, "last_consistency_run_at": None}

    try:
        cr  = p.last_consistency_result   # triggers deferred SELECT
        run = p.last_consistency_run_at
        return {
            "last_consistency_result": cr,
            "last_consistency_run_at": run.isoformat() if run else None,
        }
    except Exception:
        # Rollback so the session stays usable for subsequent queries
        try:
            db.rollback()
        except Exception:
            pass
        _consistency_cols_exist = False   # stop retrying this request
        return {"last_consistency_result": None, "last_consistency_run_at": None}


# ── Safe AI-analysis deferred-column accessor (migration-safe) ────────────────
_analysis_cols_exist: "bool | None" = None


def _safe_analysis_fields(p, db) -> dict:
    """Return last_analysis_* fields, gracefully handling pre-migration-0012 state."""
    global _analysis_cols_exist

    if _analysis_cols_exist is None:
        try:
            from sqlalchemy import text as _sql
            row = db.execute(_sql(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name='vv_projects' AND column_name='last_analysis_result' LIMIT 1"
            )).fetchone()
            _analysis_cols_exist = row is not None
        except Exception:
            _analysis_cols_exist = False
            try:
                db.rollback()
            except Exception:
                pass

    if not _analysis_cols_exist:
        return {"last_analysis_result": None, "last_analysis_run_at": None}

    try:
        ar  = p.last_analysis_result
        run = p.last_analysis_run_at
        return {
            "last_analysis_result": ar,
            "last_analysis_run_at": run.isoformat() if run else None,
        }
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        _analysis_cols_exist = False
        return {"last_analysis_result": None, "last_analysis_run_at": None}


# ── Safe deferred-column accessors (migration-safe) ───────────────────────────

_doc_v7_cols_exist: "bool | None" = None

def _safe_doc_v7_fields(d, db) -> dict:
    """Return doc_version / version_history, gracefully handling pre-migration-0009 state."""
    global _doc_v7_cols_exist
    if _doc_v7_cols_exist is None:
        try:
            from sqlalchemy import text as _sql
            row = db.execute(_sql(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name='vv_documents' AND column_name='doc_version' LIMIT 1"
            )).fetchone()
            _doc_v7_cols_exist = row is not None
        except Exception:
            _doc_v7_cols_exist = False
            try:
                db.rollback()   # clear aborted-tx state so get_db()'s commit() succeeds
            except Exception:
                pass

    if not _doc_v7_cols_exist:
        return {"doc_version": 1, "version_history": []}

    try:
        return {
            "doc_version":    (d.doc_version or 1),
            "version_history": (d.version_history or []),
        }
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        _doc_v7_cols_exist = False
        return {"doc_version": 1, "version_history": []}


_anchor_cols_exist: "bool | None" = None

def _safe_anchor_fields(r, db) -> dict:
    """Return anchor_* fields from VVReport, gracefully handling pre-migration-0010 state."""
    global _anchor_cols_exist
    if _anchor_cols_exist is None:
        try:
            from sqlalchemy import text as _sql
            row = db.execute(_sql(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name='vv_reports' AND column_name='anchor_tx_hash' LIMIT 1"
            )).fetchone()
            _anchor_cols_exist = row is not None
        except Exception:
            _anchor_cols_exist = False
            try:
                db.rollback()   # clear aborted-tx state so get_db()'s commit() succeeds
            except Exception:
                pass

    if not _anchor_cols_exist:
        return {
            "anchor_tx_hash": None, "anchor_block": None,
            "anchor_anchored_at": None, "anchor_report_hash": None, "anchor_chain": None,
        }

    try:
        return {
            "anchor_tx_hash":     r.anchor_tx_hash,
            "anchor_block":       r.anchor_block,
            "anchor_anchored_at": r.anchor_anchored_at.isoformat() if r.anchor_anchored_at else None,
            "anchor_report_hash": r.anchor_report_hash,
            "anchor_chain":       r.anchor_chain,
        }
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        _anchor_cols_exist = False
        return {
            "anchor_tx_hash": None, "anchor_block": None,
            "anchor_anchored_at": None, "anchor_report_hash": None, "anchor_chain": None,
        }


def _safe_doc_v7_inline(d) -> dict:
    """Inline deferred-column access for doc_version / version_history — no db needed."""
    global _doc_v7_cols_exist
    if _doc_v7_cols_exist is False:
        return {"doc_version": 1, "version_history": []}
    try:
        dv = d.doc_version   # triggers deferred SELECT if not loaded
        vh = d.version_history
        _doc_v7_cols_exist = True
        return {"doc_version": dv or 1, "version_history": vh or []}
    except Exception as _e:
        logger.warning("_safe_doc_v7_inline: deferred column access failed (%s) — returning defaults", _e)
        _doc_v7_cols_exist = False
        # CRITICAL: roll back the aborted transaction so get_db()'s db.commit() does not
        # raise InFailedSqlTransaction and turn a recoverable miss into a 500.
        try:
            _sess = object_session(d)
            if _sess is not None:
                _sess.rollback()
        except Exception:
            pass
        return {"doc_version": 1, "version_history": []}


def _safe_anchor_inline(r) -> dict:
    """Inline deferred-column access for anchor fields — no db needed."""
    global _anchor_cols_exist
    if _anchor_cols_exist is False:
        return {"anchor_tx_hash": None, "anchor_block": None,
                "anchor_anchored_at": None, "anchor_report_hash": None, "anchor_chain": None}
    try:
        tx   = r.anchor_tx_hash
        blk  = r.anchor_block
        aat  = r.anchor_anchored_at
        rh   = r.anchor_report_hash
        ch   = r.anchor_chain
        _anchor_cols_exist = True
        return {
            "anchor_tx_hash":     tx,
            "anchor_block":       blk,
            "anchor_anchored_at": aat.isoformat() if aat else None,
            "anchor_report_hash": rh,
            "anchor_chain":       ch,
        }
    except Exception as _e:
        logger.warning("_safe_anchor_inline: deferred column access failed (%s) — returning defaults", _e)
        _anchor_cols_exist = False
        # CRITICAL: roll back the aborted transaction so get_db()'s db.commit() does not
        # raise InFailedSqlTransaction and turn a recoverable miss into a 500.
        try:
            _sess = object_session(r)
            if _sess is not None:
                _sess.rollback()
        except Exception:
            pass
        return {"anchor_tx_hash": None, "anchor_block": None,
                "anchor_anchored_at": None, "anchor_report_hash": None, "anchor_chain": None}


_registry_sync_table_exists: "bool | None" = None

def _check_registry_sync_table(db) -> bool:
    """One-time check whether vv_registry_sync table exists."""
    global _registry_sync_table_exists
    if _registry_sync_table_exists is None:
        try:
            from sqlalchemy import text as _sql
            row = db.execute(_sql(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_name='vv_registry_sync' LIMIT 1"
            )).fetchone()
            _registry_sync_table_exists = row is not None
        except Exception:
            _registry_sync_table_exists = False
            try:
                db.rollback()   # clear aborted-tx state so get_db()'s commit() succeeds
            except Exception:
                pass
    return bool(_registry_sync_table_exists)


def _project_out(p, db, _doc_count=None, _cp_stats=None):
    import traceback as _tb
    try:
        docs = _doc_count if _doc_count is not None else db.query(VVDocument).filter(VVDocument.project_id == p.id).count()
        # When _cp_stats dict is provided (from list_vv_projects batch load) use it directly;
        # otherwise query the DB for this single project.
        if _cp_stats is not None:
            cp_total   = _cp_stats.get('total',    0)
            cp_passed  = _cp_stats.get('passed',   0)
            cp_failed  = _cp_stats.get('failed',   0)
            cp_warnings= _cp_stats.get('warnings', 0)
        else:
            cps = db.query(VVCheckpoint).filter(VVCheckpoint.project_id == p.id).all()
            cp_total    = len(cps)
            cp_passed   = sum(1 for c in cps if (c.verifier_status or c.status) == "passed")
            cp_failed   = sum(1 for c in cps if (c.verifier_status or c.status) == "failed")
            cp_warnings = sum(1 for c in cps if (c.verifier_status or c.status) == "warning")
        registry_slug = "puro_earth"
        methodology_code = "PURO-BIOCHAR-V2"
        if p.description and "REGISTRY:" in p.description:
            registry_slug = p.description.split("REGISTRY:")[1].split("|")[0]
            methodology_code = p.description.split("METHODOLOGY:")[1].split("|")[0] if "METHODOLOGY:" in p.description else "PURO-BIOCHAR-V2"
        # Days to submission deadline — startup.py creates this as DATE; psycopg2 returns
        # datetime.date for DATE columns, so _as_date() handles both datetime and date.
        dl = getattr(p, 'submission_deadline', None)
        days_to_deadline: int | None = None
        if dl:
            days_to_deadline = (_as_date(dl) - datetime.utcnow().date()).days

        return {
            "id": str(p.id), "name": p.name, "status": p.status,
            "project_developer": p.project_developer, "location": p.location,
            "vintage_year": p.vintage_year,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "updated_at": p.updated_at.isoformat() if p.updated_at else None,
            "submission_deadline": dl.isoformat() if dl else None,
            "days_to_deadline": days_to_deadline,
            "registry_slug": registry_slug, "methodology_code": methodology_code,
            "document_count": docs,
            "checkpoint_stats": {
                "total":    cp_total,
                "passed":   cp_passed,
                "failed":   cp_failed,
                "warnings": cp_warnings,
            },
            # Deferred columns — guard against migration not yet run on this DB
            **_safe_consistency_fields(p, db),
            **_safe_analysis_fields(p, db),
            # Feature toggles — None means all enabled (backward-compatible)
            "features_enabled":       getattr(p, 'features_enabled', None),
            "reviewer_assignment_id": str(p.reviewer_assignment_id) if getattr(p, 'reviewer_assignment_id', None) else None,
            # Locked when linked to a formal Reviewer Platform assignment
            "features_locked":        bool(getattr(p, 'reviewer_assignment_id', None)),
        }
    except Exception as _exc:
        # Log the FULL traceback so it's visible in CloudWatch, then surface it in
        # the 500 detail so the network tab shows exactly what failed.
        logger.exception("_project_out FAILED for project %s: %s", getattr(p, 'id', '?'), _exc)
        raise HTTPException(
            status_code=500,
            detail=f"_project_out error: {type(_exc).__name__}: {_exc}\n{_tb.format_exc()}",
        )

def _doc_out(d):
    expiry = getattr(d, 'expiry_date', None)
    today = datetime.utcnow().date()
    expiry_status = None
    if expiry:
        exp_date = expiry.date() if hasattr(expiry, 'date') else expiry
        if exp_date < today:
            expiry_status = 'expired'
        elif exp_date <= today + timedelta(days=60):
            expiry_status = 'expiring_soon'
        else:
            expiry_status = 'valid'
    return {
        "id": str(d.id), "project_id": str(d.project_id), "name": d.name,
        "file_type": d.file_type, "document_type": d.document_type,
        "file_size": d.file_size, "status": d.status,
        "extraction_summary": d.extraction_summary,
        "row_count": d.row_count, "column_count": d.column_count,
        "uploaded_at": d.uploaded_at.isoformat() if d.uploaded_at else None,
        "processed_at": d.processed_at.isoformat() if d.processed_at else None,
        # V6 fields
        "expiry_date": expiry.isoformat() if expiry else None,
        "expiry_status": expiry_status,
        "review_status": getattr(d, 'review_status', 'draft') or 'draft',
        "review_notes": getattr(d, 'review_notes', None),
        "reviewed_by_name": getattr(d, 'reviewed_by_name', None),
        "reviewed_at": d.reviewed_at.isoformat() if getattr(d, 'reviewed_at', None) else None,
        "signed_off_by": getattr(d, 'signed_off_by', None),
        "signed_off_at": d.signed_off_at.isoformat() if getattr(d, 'signed_off_at', None) else None,
        "validation_result": getattr(d, 'validation_result', None),
        # V7 version history — deferred; safe if migration 0009 hasn't run yet
        **_safe_doc_v7_inline(d),
    }

def _cp_out(c):
    # finding_severity is deferred (migration 0013) — guard against pre-migration DB
    try:
        sev = c.finding_severity or 'none'
    except Exception:
        sev = 'none'
    return {
        "id": str(c.id), "project_id": str(c.project_id),
        "checkpoint_id": c.checkpoint_id, "category": c.category,
        "name": c.name, "requirement": c.requirement,
        "status": c.status, "ai_finding": c.ai_finding,
        "ai_confidence": c.ai_confidence, "ai_evidence": c.ai_evidence or [],
        "verifier_status": c.verifier_status, "verifier_note": c.verifier_note,
        "finding_severity": sev,
        "reviewed_at": c.reviewed_at.isoformat() if c.reviewed_at else None,
    }

def _report_out(r):
    return {
        "id": str(r.id), "project_id": str(r.project_id),
        "report_type": r.report_type, "status": r.status,
        "overall_outcome": r.overall_outcome, "summary": r.summary,
        "credit_estimate": r.credit_estimate, "credit_unit": r.credit_unit,
        "findings": r.findings or [], "recommendations": r.recommendations or [],
        "conditions": r.conditions or [],
        "generated_at": r.generated_at.isoformat() if r.generated_at else None,
        "report_data": r.report_data or {},
        # Feature #12: blockchain anchor fields (deferred — safe before migration 0010 runs)
        **_safe_anchor_inline(r),
    }
