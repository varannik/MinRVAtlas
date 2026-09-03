import logging
import os
import uuid as uuid_lib
from typing import Optional
from uuid import UUID

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core import storage
from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_user
from app.models import Dataset, Project, ProjectMember
from app.schemas import DatasetOut

logger = logging.getLogger("datasentinel.datasets")

# F013: Maximum dataset upload size (200 MB)
MAX_UPLOAD_BYTES = 200 * 1024 * 1024

# Domain-level required columns (mirrors ingest.py)
DOMAIN_REQUIRED_COLS = {
    "ccs": ["timestamp_utc", "operational_state"],
    "biochar": ["timestamp_utc"],
    "general": [],
}

router = APIRouter()

ALLOWED_EXTENSIONS = {".csv", ".xlsx", ".xls", ".parquet"}


def _require_project_access(db: Session, project_id, user) -> None:
    """Raise 403 if user is not admin/super_admin and not a member of the project."""
    role = getattr(user, "role", "")
    if role in ("admin", "super_admin"):
        return
    member = db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == user.id,
    ).first()
    if not member:
        raise HTTPException(403, "You don't have access to this project")

def _load_dataframe(path: str) -> pd.DataFrame:
    ext = os.path.splitext(path)[1].lower()
    if ext == ".csv":
        return pd.read_csv(path)
    if ext == ".parquet":
        return pd.read_parquet(path)
    return pd.read_excel(path)

def _profile_dataframe(df: pd.DataFrame) -> list:
    cols = []
    for col in df.columns:
        series = df[col]
        null_count = int(series.isnull().sum())
        dtype = str(series.dtype)
        is_numeric = pd.api.types.is_numeric_dtype(series)
        meta = {
            "name": col,
            "dtype": dtype,
            "null_count": null_count,
            "null_pct": round(null_count / len(df) * 100, 2) if len(df) else 0,
            "unique_count": int(series.nunique()),
        }
        if is_numeric:
            meta.update({
                "min": round(float(series.min()), 4) if null_count < len(df) else None,
                "max": round(float(series.max()), 4) if null_count < len(df) else None,
                "mean": round(float(series.mean()), 4) if null_count < len(df) else None,
                "std": round(float(series.std()), 4) if null_count < len(df) else None,
            })
        cols.append(meta)
    return cols

@router.post("/upload", response_model=DatasetOut)
async def upload_dataset(
    project_id: UUID = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"File type '{ext}' not supported. Use CSV or Excel.")

    # Verify caller has access to the target project
    _require_project_access(db, project_id, user)

    # F013: Enforce upload size cap before writing to disk
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            400,
            f"File exceeds the 200 MB upload limit ({len(content) // (1024 * 1024)} MB received)"
        )

    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    file_id = str(uuid_lib.uuid4())
    tmp_path = os.path.join(settings.UPLOAD_DIR, f"{file_id}{ext}")

    with open(tmp_path, "wb") as f:
        f.write(content)

    try:
        df = _load_dataframe(tmp_path)
        cols_meta = _profile_dataframe(df)
    except Exception as e:
        os.remove(tmp_path)
        # F028: log full error internally; return a generic message to the client
        logger.warning("Dataset parse error for %s: %s", file.filename, e)
        raise HTTPException(400, "Could not parse the uploaded file. Ensure it is a valid CSV or Excel file with readable data.")

    # Persist to S3 (production) or keep local (dev); returns the storage_path for the DB
    stored_path = storage.save(tmp_path, f"uploads/{file_id}{ext}")

    # Schema validation against project domain
    project = db.query(Project).filter(Project.id == project_id).first()
    domain = (project.domain or "general") if project else "general"
    required_cols = DOMAIN_REQUIRED_COLS.get(domain, [])
    actual_cols = list(df.columns)
    schema_warnings = [f"Missing expected column: {c}" for c in required_cols if c not in actual_cols]

    dataset = Dataset(
        project_id=project_id,
        name=file.filename,
        source_type=ext.lstrip("."),
        row_count=len(df),
        column_count=len(df.columns),
        columns_meta=cols_meta,
        storage_path=stored_path,
        ingested_by=user.id,
        status="ready"
    )
    db.add(dataset); db.commit(); db.refresh(dataset)

    # Return enriched response with schema warnings
    out = DatasetOut.model_validate(dataset)
    response_dict = out.model_dump()
    response_dict["schema_warnings"] = schema_warnings
    response_dict["domain"] = domain
    return response_dict

@router.get("/")
def list_datasets(project_id: Optional[UUID] = None, offset: int = 0, limit: int = 200,
                  db: Session = Depends(get_db), user=Depends(get_current_user)):
    # F021: return standard envelope {items, total, offset, limit}
    from app.core.pagination import paginate_query
    role = getattr(user, "role", "analyst")
    q = db.query(Dataset)
    if project_id:
        q = q.filter(Dataset.project_id == project_id)
    elif role not in ("admin", "super_admin"):
        # Non-admin without project_id: restrict to datasets within user's projects
        user_project_ids = db.query(ProjectMember.project_id).filter(
            ProjectMember.user_id == user.id
        ).subquery()
        q = q.filter(Dataset.project_id.in_(user_project_ids))
    q = q.order_by(Dataset.ingested_at.desc())
    return paginate_query(q, offset=offset, limit=limit)

@router.get("/{dataset_id}", response_model=DatasetOut)
def get_dataset(dataset_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    d = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not d: raise HTTPException(404, "Dataset not found")
    return d

@router.get("/{dataset_id}/profile")
def dataset_profile(dataset_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    d = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not d: raise HTTPException(404, "Dataset not found")
    return {"dataset_id": str(dataset_id), "name": d.name, "row_count": d.row_count,
            "column_count": d.column_count, "columns": d.columns_meta}

_PREVIEW_MAX_ROWS = 1_000   # hard cap — prevents OOM on multi-million-row files

@router.get("/{dataset_id}/preview")
def dataset_preview(dataset_id: UUID, rows: int = 20, db: Session = Depends(get_db), user=Depends(get_current_user)):
    d = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not d: raise HTTPException(404, "Dataset not found")
    if not d.storage_path or not storage.exists(d.storage_path):
        raise HTTPException(404, "File not found")
    # Fix #09: cap requested rows to prevent unbounded file loads into memory
    capped = min(max(1, rows), _PREVIEW_MAX_ROWS)
    with storage.open_local(d.storage_path) as local_path:
        ext = os.path.splitext(local_path)[1].lower()
        # Pass nrows/skiprows at read time so the engine doesn't scan the full file
        if ext == ".csv":
            df = pd.read_csv(local_path, nrows=capped)
        elif ext == ".parquet":
            df = pd.read_parquet(local_path).head(capped)
        else:
            df = pd.read_excel(local_path, nrows=capped)
    return {
        "columns": list(df.columns),
        "rows": df.fillna("").astype(str).values.tolist(),
        "truncated": rows > _PREVIEW_MAX_ROWS,
        "row_count": len(df),
    }

@router.get("/{dataset_id}/lineage")
def dataset_lineage(dataset_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Return a lineage graph: dataset → DQA runs → corrections."""
    from app.models import CorrectionSuggestion, DQARun
    d = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not d:
        raise HTTPException(404, "Dataset not found")

    runs = db.query(DQARun).filter(DQARun.dataset_id == dataset_id).order_by(DQARun.triggered_at.asc()).all()

    nodes = [{"id": f"ds_{dataset_id}", "type": "dataset", "label": d.name,
               "meta": {"rows": d.row_count, "cols": d.column_count, "status": d.status}}]
    edges = []

    for r in runs:
        run_node_id = f"run_{r.id}"
        nodes.append({
            "id": run_node_id, "type": "dqa_run",
            "label": f"DQA Run {r.triggered_at.strftime('%b %d %H:%M') if r.triggered_at else str(r.id)[:8]}",
            "meta": {"readiness": round((r.readiness_score or 0) * 100, 1),
                     "violations": r.total_violations or 0,
                     "gate_passed": r.gate_passed, "status": r.status}
        })
        edges.append({"from": f"ds_{dataset_id}", "to": run_node_id, "label": "analyzed by"})

        # Corrections for this run
        corrections = db.query(CorrectionSuggestion).filter(CorrectionSuggestion.run_id == r.id).all()
        for c in corrections:
            corr_node_id = f"corr_{c.id}"
            nodes.append({
                "id": corr_node_id, "type": "correction",
                "label": f"Correction: {c.field_name or c.correction_type}",
                "meta": {"status": c.status, "confidence": c.confidence,
                         "field": c.field_name, "type": c.correction_type}
            })
            edges.append({"from": run_node_id, "to": corr_node_id, "label": "generated"})

    return {"dataset_id": str(dataset_id), "nodes": nodes, "edges": edges}


# ── Shared helper: download a remote file, profile it, create Dataset ──────────

def _ingest_remote_file(
    *,
    file_bytes: bytes,
    filename: str,
    project_id,
    db: Session,
    user,
    source_label: str,
    split_rows: Optional[int] = None,
) -> dict:
    """
    Take raw file bytes from a remote source, profile them, persist to storage,
    and create a Dataset record. Returns the DatasetOut dict + schema_warnings.
    If split_rows is given and the file has more rows, it's split into multiple
    Dataset records of at most split_rows each (returned as a "parts" list).
    """
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"File type '{ext}' not supported. Use CSV, Excel, or Parquet.")
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, f"File exceeds the 200 MB limit ({len(file_bytes)//(1024*1024)} MB)")

    _require_project_access(db, project_id, user)

    file_id  = str(uuid_lib.uuid4())
    tmp_path = os.path.join(settings.UPLOAD_DIR, f"{file_id}{ext}")
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    with open(tmp_path, "wb") as fh:
        fh.write(file_bytes)

    try:
        df = _load_dataframe(tmp_path)
    except Exception as e:
        os.remove(tmp_path)
        raise HTTPException(400, f"Could not parse file — {e}")
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    project  = db.query(Project).filter(Project.id == project_id).first()
    domain   = (project.domain or "general") if project else "general"
    required = DOMAIN_REQUIRED_COLS.get(domain, [])
    warnings = [f"Missing expected column: {c}" for c in required if c not in list(df.columns)]

    base_name = os.path.splitext(filename)[0]
    chunks: list[pd.DataFrame]
    if split_rows and split_rows > 0 and len(df) > split_rows:
        chunks = [df.iloc[i:i + split_rows] for i in range(0, len(df), split_rows)]
    else:
        chunks = [df]

    created = []
    for idx, chunk_df in enumerate(chunks):
        chunk_id   = str(uuid_lib.uuid4())
        chunk_name = filename if len(chunks) == 1 else f"{base_name}_part{idx+1:02d}{ext}"
        chunk_tmp  = os.path.join(settings.UPLOAD_DIR, f"{chunk_id}{ext}")
        if ext == ".csv":
            chunk_df.to_csv(chunk_tmp, index=False)
        elif ext == ".parquet":
            chunk_df.to_parquet(chunk_tmp, index=False)
        else:
            chunk_df.to_excel(chunk_tmp, index=False)

        stored_path = storage.save(chunk_tmp, f"uploads/{chunk_id}{ext}")
        cols_meta = _profile_dataframe(chunk_df)

        dataset = Dataset(
            project_id=project_id,
            name=chunk_name,
            source_type=source_label,
            row_count=len(chunk_df),
            column_count=len(chunk_df.columns),
            columns_meta=cols_meta,
            storage_path=stored_path,
            ingested_by=user.id,
            status="ready",
        )
        db.add(dataset); db.commit(); db.refresh(dataset)
        created.append(DatasetOut.model_validate(dataset).model_dump())

    if len(created) == 1:
        result = created[0]
        result["schema_warnings"] = warnings
        result["domain"] = domain
        return result

    return {
        "parts": created,
        "schema_warnings": warnings,
        "domain": domain,
        "split_into": len(created),
    }


# ── SharePoint connector ───────────────────────────────────────────────────────

@router.post("/sharepoint/browse")
async def sharepoint_browse(data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    List CSV/Excel files in a SharePoint folder via Microsoft Graph API.
    Body: {folder_url, graph_token}
    """
    folder_url  = (data.get("folder_url") or "").strip()
    graph_token = (data.get("graph_token") or "").strip()
    if not folder_url or not graph_token:
        raise HTTPException(400, "folder_url and graph_token are required")

    try:
        from app.engines.vv.folder_connector import fetch_sharepoint_files
        files = await fetch_sharepoint_files(folder_url, graph_token)
    except Exception as e:
        raise HTTPException(502, f"SharePoint connection failed: {e}")

    if files and "error" in files[0]:
        raise HTTPException(400, files[0]["error"])

    # Filter to CSV/Excel only
    allowed_ext = {"csv", "xlsx", "xls", "parquet"}
    return [
        {"key": f["name"], "name": f["name"], "size": f.get("size", 0),
         "download_url": f.get("download_url"), "extension": f.get("extension", ""),
         "last_modified": f.get("lastModifiedDateTime", "")}
        for f in files
        if f.get("extension", "").lower() in allowed_ext
    ]


@router.post("/sharepoint/import")
async def sharepoint_import(data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    Download a specific file from SharePoint and ingest it as a Dataset.
    Body: {project_id, download_url, filename, graph_token}
    """
    import httpx
    project_id   = data.get("project_id")
    download_url = (data.get("download_url") or "").strip()
    filename     = (data.get("filename") or "file.csv").strip()
    graph_token  = (data.get("graph_token") or "").strip()

    if not project_id or not download_url:
        raise HTTPException(400, "project_id and download_url are required")

    try:
        headers = {"Authorization": f"Bearer {graph_token}"} if graph_token else {}
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.get(download_url, headers=headers, follow_redirects=True)
        resp.raise_for_status()
        file_bytes = resp.content
    except Exception as e:
        raise HTTPException(502, f"Failed to download from SharePoint: {e}")

    return _ingest_remote_file(
        file_bytes=file_bytes, filename=filename,
        project_id=project_id, db=db, user=user, source_label="sharepoint",
        split_rows=data.get("split_rows"),
    )


# ── S3 connector ───────────────────────────────────────────────────────────────

@router.post("/s3/browse")
async def s3_browse(data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    List CSV/Excel files in an S3 bucket prefix.
    Body: {bucket, prefix, aws_access_key_id?, aws_secret_access_key?, region?}
    """
    bucket     = (data.get("bucket") or "").strip()
    prefix     = (data.get("prefix") or "").strip()
    if not bucket:
        raise HTTPException(400, "bucket is required")

    try:
        import boto3
        kwargs: dict = {"region_name": data.get("region") or settings.AWS_REGION or "us-east-1"}
        if data.get("aws_access_key_id"):
            kwargs["aws_access_key_id"]     = data["aws_access_key_id"]
            kwargs["aws_secret_access_key"]  = data.get("aws_secret_access_key", "")
        s3 = boto3.client("s3", **kwargs)

        paginator = s3.get_paginator("list_objects_v2")
        allowed_ext = {".csv", ".xlsx", ".xls", ".parquet"}
        files = []
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix, PaginationConfig={"MaxItems": 200}):
            for obj in page.get("Contents") or []:
                key = obj["Key"]
                ext = os.path.splitext(key)[1].lower()
                if ext in allowed_ext:
                    files.append({
                        "key":  key,
                        "name": key.split("/")[-1],
                        "size": obj["Size"],
                        "last_modified": obj["LastModified"].isoformat(),
                        "extension": ext.lstrip("."),
                    })
        return files
    except Exception as e:
        raise HTTPException(502, f"S3 browse failed: {e}")


@router.post("/s3/import")
async def s3_import(data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    Download a specific S3 object and ingest it as a Dataset.
    Body: {project_id, bucket, key, aws_access_key_id?, aws_secret_access_key?, region?}
    """
    import tempfile
    project_id = data.get("project_id")
    bucket     = (data.get("bucket") or "").strip()
    key        = (data.get("key") or "").strip()

    if not project_id or not bucket or not key:
        raise HTTPException(400, "project_id, bucket and key are required")

    try:
        import boto3
        kwargs: dict = {"region_name": data.get("region") or settings.AWS_REGION or "us-east-1"}
        if data.get("aws_access_key_id"):
            kwargs["aws_access_key_id"]    = data["aws_access_key_id"]
            kwargs["aws_secret_access_key"] = data.get("aws_secret_access_key", "")
        s3 = boto3.client("s3", **kwargs)

        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            s3.download_fileobj(bucket, key, tmp)
            tmp_path = tmp.name

        with open(tmp_path, "rb") as fh:
            file_bytes = fh.read()
        os.remove(tmp_path)
    except Exception as e:
        raise HTTPException(502, f"Failed to download from S3: {e}")

    filename = key.split("/")[-1]
    return _ingest_remote_file(
        file_bytes=file_bytes, filename=filename,
        project_id=project_id, db=db, user=user, source_label="s3",
        split_rows=data.get("split_rows"),
    )



# ── GCS helpers ────────────────────────────────────────────────────────────────

async def _gcs_token(sa_json_str: str) -> str:
    import json, time
    import jwt as pyjwt
    sa = json.loads(sa_json_str)
    now = int(time.time())
    claim = {
        "iss": sa["client_email"],
        "scope": "https://www.googleapis.com/auth/devstorage.read_only",
        "aud": "https://oauth2.googleapis.com/token",
        "exp": now + 3600, "iat": now,
    }
    signed = pyjwt.encode(claim, sa["private_key"], algorithm="RS256")
    import httpx as _httpx
    async with _httpx.AsyncClient(timeout=30) as c:
        r = await c.post("https://oauth2.googleapis.com/token",
                         data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": signed})
        r.raise_for_status()
        return r.json()["access_token"]


@router.post("/gcs/browse")
async def gcs_browse(data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    List CSV/Excel files in a GCS bucket prefix.
    Body: {bucket, prefix?, service_account_json?}
    """
    import httpx
    bucket  = (data.get("bucket") or "").strip()
    prefix  = (data.get("prefix") or "").strip()
    sa_json = (data.get("service_account_json") or "").strip()
    if not bucket:
        raise HTTPException(400, "bucket is required")

    try:
        headers = {}
        if sa_json:
            token = await _gcs_token(sa_json)
            headers["Authorization"] = f"Bearer {token}"

        params = {"maxResults": 500}
        if prefix:
            params["prefix"] = prefix

        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.get(
                f"https://storage.googleapis.com/storage/v1/b/{bucket}/o",
                params=params, headers=headers
            )
            r.raise_for_status()
            items = r.json().get("items") or []

        allowed_ext = {".csv", ".xlsx", ".xls", ".parquet"}
        files = []
        for obj in items:
            key = obj["name"]
            ext = os.path.splitext(key)[1].lower()
            if ext in allowed_ext:
                files.append({
                    "key": key,
                    "name": key.split("/")[-1],
                    "size": int(obj.get("size", 0)),
                    "last_modified": obj.get("updated", ""),
                    "extension": ext.lstrip("."),
                })
        return files
    except Exception as e:
        raise HTTPException(502, f"GCS browse failed: {e}")


@router.post("/gcs/import")
async def gcs_import(data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    Download a specific GCS object and ingest it as a Dataset.
    Body: {project_id, bucket, key, service_account_json?}
    """
    import httpx, urllib.parse
    project_id = data.get("project_id")
    bucket     = (data.get("bucket") or "").strip()
    key        = (data.get("key") or "").strip()
    sa_json    = (data.get("service_account_json") or "").strip()

    if not project_id or not bucket or not key:
        raise HTTPException(400, "project_id, bucket and key are required")

    try:
        headers = {}
        if sa_json:
            token = await _gcs_token(sa_json)
            headers["Authorization"] = f"Bearer {token}"

        encoded_key = urllib.parse.quote(key, safe='')
        async with httpx.AsyncClient(timeout=120) as c:
            r = await c.get(
                f"https://storage.googleapis.com/storage/v1/b/{bucket}/o/{encoded_key}?alt=media",
                headers=headers, follow_redirects=True
            )
            r.raise_for_status()
            file_bytes = r.content
    except Exception as e:
        raise HTTPException(502, f"Failed to download from GCS: {e}")

    filename = key.split("/")[-1]
    return _ingest_remote_file(
        file_bytes=file_bytes, filename=filename,
        project_id=project_id, db=db, user=user, source_label="gcs",
        split_rows=data.get("split_rows"),
    )


@router.post("/gcs/preview")
async def gcs_preview(data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Preview first N rows of a GCS file. Body: {bucket, key, service_account_json?, preview_rows?}"""
    import httpx, urllib.parse, io
    bucket      = (data.get("bucket") or "").strip()
    key         = (data.get("key") or "").strip()
    sa_json     = (data.get("service_account_json") or "").strip()
    preview_rows = int(data.get("preview_rows") or 20)

    if not bucket or not key:
        raise HTTPException(400, "bucket and key are required")

    try:
        headers = {}
        if sa_json:
            token = await _gcs_token(sa_json)
            headers["Authorization"] = f"Bearer {token}"
        encoded_key = urllib.parse.quote(key, safe='')
        async with httpx.AsyncClient(timeout=120) as c:
            r = await c.get(
                f"https://storage.googleapis.com/storage/v1/b/{bucket}/o/{encoded_key}?alt=media",
                headers=headers, follow_redirects=True
            )
            r.raise_for_status()
            file_bytes = r.content
    except Exception as e:
        raise HTTPException(502, f"Failed to download from GCS: {e}")

    return _preview_bytes(file_bytes, key, preview_rows)


# ── Fabric helpers ─────────────────────────────────────────────────────────────

async def _fabric_token(tenant_id: str, client_id: str, client_secret: str) -> str:
    """Get Azure AD token for OneLake, trying storage scope then Fabric scope as fallback."""
    import httpx as _httpx
    url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    last_error = ""
    for scope in ("https://storage.azure.com/.default", "https://api.fabric.microsoft.com/.default"):
        async with _httpx.AsyncClient(timeout=30) as c:
            r = await c.post(url, data={
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": client_secret,
                "scope": scope,
            })
            if r.status_code == 200:
                return r.json()["access_token"]
            # Capture Azure AD error description for diagnostics
            try:
                err_body = r.json()
                last_error = err_body.get("error_description") or err_body.get("error") or r.text[:200]
            except Exception:
                last_error = r.text[:200]
    raise HTTPException(502, f"Azure AD token request failed: {last_error}")


def _parse_onelake_paths(response_json: dict, strip_prefix: str = "") -> list:
    """
    Parse ADLS Gen2 / OneLake DFS list response.
    Response shape: {"paths": [{"name": "...", "isDirectory": "true"|absent, "contentLength": "123", ...}]}
    isDirectory is a STRING "true" when present, absent for files.
    `name` is workspace-relative (e.g. "{lakehouseId}/Files/sub/file.csv"); strip_prefix
    removes the "{lakehouseId}/Files/" portion so keys are relative to the lakehouse.
    """
    allowed_ext = {".csv", ".xlsx", ".xls", ".parquet"}
    files = []
    for obj in response_json.get("paths", []):
        if obj.get("isDirectory") == "true":   # string comparison — ADLS returns string not bool
            continue
        name = obj.get("name", "")
        ext = os.path.splitext(name)[1].lower()
        if ext not in allowed_ext:
            continue
        key = name[len(strip_prefix):] if strip_prefix and name.startswith(strip_prefix) else name
        files.append({
            "key":           key,
            "name":          key.split("/")[-1],
            "size":          int(obj.get("contentLength") or 0),
            "last_modified": obj.get("lastModified", ""),
            "extension":     ext.lstrip("."),
        })
    return files


@router.post("/fabric/browse")
async def fabric_browse(data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    List CSV/Excel files in a Microsoft Fabric Lakehouse via OneLake DFS API.
    Body: {workspace_id, lakehouse_id, tenant_id?, client_id?, client_secret?, prefix?}
    """
    import httpx
    workspace_id  = (data.get("workspace_id") or "").strip()
    lakehouse_id  = (data.get("lakehouse_id") or "").strip()
    tenant_id     = (data.get("tenant_id") or "").strip()
    client_id     = (data.get("client_id") or "").strip()
    client_secret = (data.get("client_secret") or "").strip()
    prefix        = (data.get("prefix") or "").strip().lstrip("/")

    if not workspace_id or not lakehouse_id:
        raise HTTPException(400, "workspace_id and lakehouse_id are required")

    try:
        headers: dict = {"x-ms-version": "2019-12-12"}
        if tenant_id and client_id and client_secret:
            token = await _fabric_token(tenant_id, client_id, client_secret)
            headers["Authorization"] = f"Bearer {token}"

        # OneLake DFS: the workspace is the "filesystem"; the lakehouse path is
        # passed via the `directory` query param, not as a URL path segment.
        directory = f"{lakehouse_id}/Files"
        if prefix and prefix != lakehouse_id:
            directory += f"/{prefix}"
        base_url = (
            f"https://onelake.dfs.fabric.microsoft.com/{workspace_id}"
            f"?resource=filesystem&recursive=true&directory={directory}"
        )

        # OneLake paginates large directory listings via x-ms-continuation;
        # loop until exhausted (capped) so deep/large trees aren't truncated.
        all_paths: list = []
        continuation = ""
        import urllib.parse
        for _ in range(50):  # safety cap ~ up to 50 pages
            url = base_url + (f"&continuation={urllib.parse.quote(continuation)}" if continuation else "")
            async with httpx.AsyncClient(timeout=60) as c:
                r = await c.get(url, headers=headers)

            if r.status_code == 404:
                break
            if r.status_code not in (200, 206):
                raise HTTPException(502, f"OneLake returned {r.status_code} for {url} — {r.text[:300]}")

            body = r.text.strip()
            if body:
                all_paths.extend(r.json().get("paths", []))

            continuation = r.headers.get("x-ms-continuation", "")
            if not continuation:
                break

        return _parse_onelake_paths({"paths": all_paths}, strip_prefix=f"{lakehouse_id}/Files/")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Fabric browse failed: {e}")


@router.post("/fabric/import")
async def fabric_import(data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    Download a specific Fabric file and ingest it as a Dataset.
    Body: {project_id, workspace_id, lakehouse_id, key, tenant_id?, client_id?, client_secret?}
    """
    import httpx
    project_id    = data.get("project_id")
    workspace_id  = (data.get("workspace_id") or "").strip()
    lakehouse_id  = (data.get("lakehouse_id") or "").strip()
    key           = (data.get("key") or "").strip()
    tenant_id     = (data.get("tenant_id") or "").strip()
    client_id     = (data.get("client_id") or "").strip()
    client_secret = (data.get("client_secret") or "").strip()

    if not project_id or not workspace_id or not lakehouse_id or not key:
        raise HTTPException(400, "project_id, workspace_id, lakehouse_id and key are required")

    try:
        headers = {}
        if tenant_id and client_id and client_secret:
            token = await _fabric_token(tenant_id, client_id, client_secret)
            headers["Authorization"] = f"Bearer {token}"

        url = (
            f"https://onelake.dfs.fabric.microsoft.com"
            f"/{workspace_id}/{lakehouse_id}/Files/{key}"
        )
        async with httpx.AsyncClient(timeout=120) as c:
            r = await c.get(url, headers=headers, follow_redirects=True)
            r.raise_for_status()
            file_bytes = r.content
    except Exception as e:
        raise HTTPException(502, f"Failed to download from Fabric: {e}")

    filename = key.split("/")[-1]
    return _ingest_remote_file(
        file_bytes=file_bytes, filename=filename,
        project_id=project_id, db=db, user=user, source_label="fabric",
        split_rows=data.get("split_rows"),
    )


@router.post("/fabric/preview")
async def fabric_preview(data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Preview first N rows of a Fabric file."""
    import httpx
    workspace_id  = (data.get("workspace_id") or "").strip()
    lakehouse_id  = (data.get("lakehouse_id") or "").strip()
    key           = (data.get("key") or "").strip()
    tenant_id     = (data.get("tenant_id") or "").strip()
    client_id     = (data.get("client_id") or "").strip()
    client_secret = (data.get("client_secret") or "").strip()
    preview_rows  = int(data.get("preview_rows") or 20)

    if not workspace_id or not lakehouse_id or not key:
        raise HTTPException(400, "workspace_id, lakehouse_id and key are required")

    try:
        headers = {}
        if tenant_id and client_id and client_secret:
            token = await _fabric_token(tenant_id, client_id, client_secret)
            headers["Authorization"] = f"Bearer {token}"
        url = (
            f"https://onelake.dfs.fabric.microsoft.com"
            f"/{workspace_id}/{lakehouse_id}/Files/{key}"
        )
        async with httpx.AsyncClient(timeout=120) as c:
            r = await c.get(url, headers=headers, follow_redirects=True)
            r.raise_for_status()
            file_bytes = r.content
    except Exception as e:
        raise HTTPException(502, f"Failed to download from Fabric: {e}")

    return _preview_bytes(file_bytes, key, preview_rows)


# ── S3 preview ─────────────────────────────────────────────────────────────────

@router.post("/s3/preview")
async def s3_preview(data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Preview first N rows of an S3 file. Body: {bucket, key, aws_access_key_id?, ..., preview_rows?}"""
    import tempfile
    bucket      = (data.get("bucket") or "").strip()
    key         = (data.get("key") or "").strip()
    preview_rows = int(data.get("preview_rows") or 20)

    if not bucket or not key:
        raise HTTPException(400, "bucket and key are required")

    try:
        import boto3
        kwargs: dict = {"region_name": data.get("region") or settings.AWS_REGION or "us-east-1"}
        if data.get("aws_access_key_id"):
            kwargs["aws_access_key_id"]    = data["aws_access_key_id"]
            kwargs["aws_secret_access_key"] = data.get("aws_secret_access_key", "")
        s3 = boto3.client("s3", **kwargs)
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            s3.download_fileobj(bucket, key, tmp)
            tmp_path = tmp.name
        with open(tmp_path, "rb") as fh:
            file_bytes = fh.read()
        os.remove(tmp_path)
    except Exception as e:
        raise HTTPException(502, f"Failed to download from S3: {e}")

    return _preview_bytes(file_bytes, key, preview_rows)


# ── SharePoint preview ─────────────────────────────────────────────────────────

@router.post("/sharepoint/preview")
async def sharepoint_preview(data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Preview first N rows of a SharePoint file. Body: {download_url, graph_token, preview_rows?}"""
    import httpx
    download_url  = (data.get("download_url") or "").strip()
    graph_token   = (data.get("graph_token") or "").strip()
    filename      = (data.get("filename") or "file.csv").strip()
    preview_rows  = int(data.get("preview_rows") or 20)

    if not download_url:
        raise HTTPException(400, "download_url is required")

    try:
        headers = {"Authorization": f"Bearer {graph_token}"} if graph_token else {}
        async with httpx.AsyncClient(timeout=120) as c:
            r = await c.get(download_url, headers=headers, follow_redirects=True)
            r.raise_for_status()
            file_bytes = r.content
    except Exception as e:
        raise HTTPException(502, f"Failed to download from SharePoint: {e}")

    return _preview_bytes(file_bytes, filename, preview_rows)


# ── Preview helper ─────────────────────────────────────────────────────────────

def _preview_bytes(file_bytes: bytes, filename: str, preview_rows: int) -> dict:
    """Read up to preview_rows rows from file bytes and return preview dict."""
    import io, tempfile
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"File type '{ext}' not supported for preview")

    capped = min(max(1, preview_rows), _PREVIEW_MAX_ROWS)
    try:
        if ext == ".csv":
            df_full = pd.read_csv(io.BytesIO(file_bytes))
            df = pd.read_csv(io.BytesIO(file_bytes), nrows=capped)
        elif ext == ".parquet":
            df_full = pd.read_parquet(io.BytesIO(file_bytes))
            df = df_full.head(capped)
        else:
            df_full = pd.read_excel(io.BytesIO(file_bytes))
            df = pd.read_excel(io.BytesIO(file_bytes), nrows=capped)
    except Exception as e:
        raise HTTPException(400, f"Could not parse file for preview: {e}")

    date_cols = []
    for col in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df[col]):
            date_cols.append(col)
        elif any(kw in col.lower() for kw in ("date", "time", "timestamp")):
            date_cols.append(col)

    return {
        "columns": list(df.columns),
        "rows": df.fillna("").astype(str).values.tolist(),
        "total_rows": len(df_full),
        "date_columns": date_cols,
    }


@router.delete("/{dataset_id}")
def delete_dataset(dataset_id: UUID, db: Session = Depends(get_db),
                   user=Depends(get_current_user)):
    # Only admins and analysts can delete datasets
    if user.role not in ("admin", "analyst", "super_admin"):
        raise HTTPException(403, "Insufficient permissions — analyst or admin role required to delete datasets")
    d = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not d: raise HTTPException(404, "Dataset not found")
    # Verify caller has access to the dataset's project
    _require_project_access(db, d.project_id, user)
    if d.storage_path:
        storage.delete(d.storage_path)
    db.delete(d); db.commit()
    return {"message": "Dataset deleted"}
