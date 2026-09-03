"""
Real-Time Sensor Ingest Webhook — accepts JSON or CSV from SCADA/IoT systems.
Authenticated via API key (Bearer token). Auto-triggers DQA on receipt.
"""
import io
import logging
import os
import uuid as uuid_lib
from datetime import datetime
from typing import Optional

import pandas as pd
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.core import storage
from app.core.database import get_db
from app.models import Dataset, DQARun, Project

router = APIRouter()
logger = logging.getLogger("datasentinel.ingest")

# Required columns per domain (schema validation)
DOMAIN_SCHEMA = {
    "ccs": ["timestamp_utc", "operational_state"],
    "biochar": ["timestamp_utc"],
    "general": [],
}


def _get_api_key(authorization: Optional[str], db: Session):
    """Extract and verify Bearer API key from Authorization header."""
    from app.api.v1.api_keys import verify_api_key
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Authorization: Bearer <api_key> required")
    raw_key = authorization.removeprefix("Bearer ").strip()
    k = verify_api_key(raw_key, db)
    if not k:
        raise HTTPException(401, "Invalid or revoked API key")
    return k


@router.post("/")
async def ingest(
    request: Request,
    background_tasks: BackgroundTasks,
    authorization: Optional[str] = Header(default=None),
    x_project_id: Optional[str] = Header(default=None),
    x_dataset_name: Optional[str] = Header(default=None),
    x_run_dqa: Optional[str] = Header(default="true"),
    x_idempotency_key: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    """
    Ingest sensor data directly from SCADA/IoT systems.

    Headers:
      Authorization: Bearer <api_key>
      X-Project-Id: <project_uuid>
      X-Dataset-Name: <optional name>
      X-Run-Dqa: true|false (default: true)
      X-Idempotency-Key: <unique batch ID — prevents duplicate processing>

    Body: JSON array of records OR CSV text (Content-Type: text/csv)
    """
    api_key = _get_api_key(authorization, db)

    # Idempotency deduplication — reject duplicate batch submissions
    if x_idempotency_key:
        from app.models import IngestBatch
        existing = db.query(IngestBatch).filter(
            IngestBatch.idempotency_key == x_idempotency_key
        ).first()
        if existing:
            logger.info(f"Duplicate ingest rejected: idempotency_key={x_idempotency_key}")
            return {
                "duplicate": True,
                "message": "Batch already processed",
                "original_dataset_id": str(existing.dataset_id) if existing.dataset_id else None,
                "idempotency_key": x_idempotency_key,
            }

    # Resolve project: from header, or from API key's project
    # Fix (cross-tenant ingest bypass): when the caller supplies an X-Project-Id that
    # differs from the key's own project, reject the request — the key is scoped to
    # its bound project only.  A key without a bound project may ingest to any project.
    if x_project_id and api_key.project_id and str(api_key.project_id) != str(x_project_id):
        raise HTTPException(403, "API key is not authorised for the specified project")
    project_id = x_project_id or (str(api_key.project_id) if api_key.project_id else None)
    if not project_id:
        raise HTTPException(400, "X-Project-Id header required (or bind the API key to a project)")

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")

    # Parse body — enforce size cap before loading into memory
    MAX_INGEST_BYTES = 50 * 1024 * 1024  # 50 MB
    content_type = request.headers.get("content-type", "")
    body = await request.body()
    if len(body) > MAX_INGEST_BYTES:
        raise HTTPException(413, f"Request body exceeds maximum ingest size of 50 MB ({len(body) // (1024*1024)} MB received)")

    try:
        if "text/csv" in content_type or "text/plain" in content_type:
            df = pd.read_csv(io.StringIO(body.decode("utf-8")))
        else:
            import json
            data = json.loads(body)
            if isinstance(data, list):
                df = pd.DataFrame(data)
            elif isinstance(data, dict) and "data" in data:
                df = pd.DataFrame(data["data"])
            else:
                df = pd.DataFrame([data])
    except Exception as e:
        raise HTTPException(400, f"Could not parse body as CSV or JSON: {e}")

    if df.empty:
        raise HTTPException(400, "Payload contains no data rows")

    # Schema validation
    domain = project.domain or "general"
    required_cols = DOMAIN_SCHEMA.get(domain, [])
    missing = [c for c in required_cols if c not in df.columns]
    schema_warnings = [f"Missing expected column: {c}" for c in missing]

    # Save CSV to storage
    dataset_name = x_dataset_name or f"ingest_{datetime.utcnow().strftime('%Y%m%dT%H%M%S')}.csv"
    upload_dir = os.environ.get("UPLOAD_DIR", "/app/uploads")
    os.makedirs(upload_dir, exist_ok=True)
    file_id = str(uuid_lib.uuid4())
    tmp_path = os.path.join(upload_dir, f"{file_id}.csv")
    df.to_csv(tmp_path, index=False)
    stored_path = storage.save(tmp_path, f"uploads/{file_id}.csv")

    # Profile columns
    def _profile(col):
        s = df[col]
        null_count = int(s.isnull().sum())
        m = {"name": col, "dtype": str(s.dtype), "null_count": null_count,
             "null_pct": round(null_count / len(df) * 100, 2) if len(df) else 0,
             "unique_count": int(s.nunique())}
        if pd.api.types.is_numeric_dtype(s) and null_count < len(df):
            m.update({"min": round(float(s.min()), 4), "max": round(float(s.max()), 4),
                      "mean": round(float(s.mean()), 4)})
        return m

    cols_meta = [_profile(c) for c in df.columns]

    dataset = Dataset(
        project_id=project.id,
        name=dataset_name,
        source_type="csv",
        row_count=len(df),
        column_count=len(df.columns),
        columns_meta=cols_meta,
        storage_path=stored_path,
        status="ready",
    )
    db.add(dataset)
    db.flush()

    run_id = None
    if x_run_dqa and x_run_dqa.lower() != "false":
        run = DQARun(
            dataset_id=dataset.id,
            project_id=project.id,
            status="queued",
        )
        db.add(run)
        db.flush()
        run_id = str(run.id)
        # Register idempotency key
        if x_idempotency_key:
            from app.models import IngestBatch
            batch = IngestBatch(
                idempotency_key=x_idempotency_key,
                project_id=project.id,
                dataset_id=dataset.id,
            )
            db.add(batch)
        db.commit()
        from app.api.v1.runs import _execute_dqa
        background_tasks.add_task(_execute_dqa, run_id)
    else:
        if x_idempotency_key:
            from app.models import IngestBatch
            batch = IngestBatch(
                idempotency_key=x_idempotency_key,
                project_id=project.id,
                dataset_id=dataset.id,
            )
            db.add(batch)
        db.commit()

    logger.info(f"Ingest: project={project.name} rows={len(df)} dataset={dataset.id} run={run_id}")
    return {
        "dataset_id": str(dataset.id),
        "dataset_name": dataset_name,
        "rows_ingested": len(df),
        "columns": len(df.columns),
        "run_id": run_id,
        "dqa_triggered": run_id is not None,
        "schema_warnings": schema_warnings,
    }


@router.get("/schema/{domain}")
def get_domain_schema(domain: str):
    """Return expected columns for a given project domain."""
    return {
        "domain": domain,
        "required_columns": DOMAIN_SCHEMA.get(domain, []),
        "note": "Additional columns are allowed and will be profiled automatically.",
    }
