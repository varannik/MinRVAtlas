"""
Data Source Connectors — register, test, and pull from S3 / PostgreSQL / REST API.
Routes:
  GET    /api/v1/connectors/                   list connectors (project-scoped)
  POST   /api/v1/connectors/                   create connector
  GET    /api/v1/connectors/{id}               get connector
  PATCH  /api/v1/connectors/{id}               update connector
  DELETE /api/v1/connectors/{id}               delete connector
  POST   /api/v1/connectors/{id}/test          test connection
  GET    /api/v1/connectors/{id}/preview       preview first 5 rows
"""
import json
import logging
import re
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user

logger = logging.getLogger("datasentinel.connectors")
router = APIRouter()

VALID_TYPES = {"s3", "postgresql", "rest_api"}
RETRY_TIMEOUT = 10  # seconds for connection test


# ── Serialiser ─────────────────────────────────────────────────────────────────

def _out(row) -> dict:
    cfg = row.config or {}
    # Redact secrets from output
    safe_cfg = {k: v for k, v in cfg.items() if k not in ("password", "token", "api_key", "secret")}
    if "password" in cfg:
        safe_cfg["password"] = "***"
    if "token" in cfg or "api_key" in cfg:
        safe_cfg["token"] = "***"
    return {
        "id":               str(row.id),
        "name":             row.name,
        "connector_type":   row.connector_type,
        "config":           safe_cfg,
        "project_id":       str(row.project_id) if row.project_id else None,
        "is_active":        row.is_active,
        "last_tested_at":   row.last_tested_at.isoformat() if row.last_tested_at else None,
        "last_test_status": row.last_test_status,
        "last_test_error":  row.last_test_error,
        "created_at":       row.created_at.isoformat() if row.created_at else None,
    }


def _get_connector(connector_id: str, db: Session):
    row = db.execute(text(
        "SELECT * FROM data_connectors WHERE id = :id::uuid AND is_active = TRUE"
    ), {"id": connector_id}).fetchone()
    if not row:
        raise HTTPException(404, "Connector not found")
    return row


def _require_connector_access(row, db: Session, user) -> None:
    """Raise 403 if the caller doesn't belong to the connector's project."""
    role = getattr(user, "role", "analyst")
    if role in ("admin", "super_admin"):
        return
    if not row.project_id:
        return  # global / unscoped connector — any authenticated user may access
    member = db.execute(text("""
        SELECT 1 FROM project_members
        WHERE project_id = :pid::uuid AND user_id = :uid::uuid
        LIMIT 1
    """), {"pid": str(row.project_id), "uid": str(user.id)}).fetchone()
    if not member:
        raise HTTPException(403, "You don't have access to this connector")


# ── Validation helpers ─────────────────────────────────────────────────────────

def _validate_config(connector_type: str, cfg: dict) -> None:
    if connector_type == "s3":
        if not cfg.get("bucket"):
            raise HTTPException(400, "S3 connector requires 'bucket'")
        bucket = cfg["bucket"]
        if len(bucket) < 3 or len(bucket) > 63:
            raise HTTPException(400, "S3 bucket name must be 3–63 characters")
        if not all(c.isalnum() or c in "-." for c in bucket):
            raise HTTPException(400, "S3 bucket name contains invalid characters")

    elif connector_type == "postgresql":
        conn = cfg.get("connection_string", "")
        if not conn:
            raise HTTPException(400, "PostgreSQL connector requires 'connection_string'")
        if not (conn.startswith("postgresql://") or conn.startswith("postgres://")):
            raise HTTPException(400, "connection_string must start with postgresql://")
        if any(h in conn for h in ("localhost", "127.0.0.1", "::1")):
            raise HTTPException(400, "Localhost PostgreSQL connections are not permitted")

    elif connector_type == "rest_api":
        base_url = cfg.get("base_url", "")
        if not base_url:
            raise HTTPException(400, "REST API connector requires 'base_url'")
        if not base_url.startswith("https://"):
            raise HTTPException(400, "base_url must use HTTPS")


# ── CRUD endpoints ─────────────────────────────────────────────────────────────

@router.get("/")
def list_connectors(
    project_id: Optional[str] = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if project_id:
        # IDOR guard: verify caller belongs to this project before returning its connectors
        role = getattr(user, "role", "analyst")
        if role not in ("admin", "super_admin"):
            member = db.execute(text("""
                SELECT 1 FROM project_members
                WHERE project_id = :pid::uuid AND user_id = :uid::uuid
                LIMIT 1
            """), {"pid": project_id, "uid": str(user.id)}).fetchone()
            if not member:
                raise HTTPException(403, "You don't have access to this project")
        rows = db.execute(text("""
            SELECT * FROM data_connectors
            WHERE project_id = :pid::uuid AND is_active = TRUE
            ORDER BY created_at DESC
        """), {"pid": project_id}).fetchall()
    else:
        role = getattr(user, "role", "analyst")
        if role in ("admin", "super_admin"):
            rows = db.execute(text(
                "SELECT * FROM data_connectors WHERE is_active = TRUE ORDER BY created_at DESC"
            )).fetchall()
        else:
            rows = db.execute(text("""
                SELECT dc.* FROM data_connectors dc
                JOIN project_members pm ON pm.project_id = dc.project_id
                WHERE pm.user_id = :uid::uuid AND dc.is_active = TRUE
                ORDER BY dc.created_at DESC
            """), {"uid": str(user.id)}).fetchall()

    return {"items": [_out(r) for r in rows], "total": len(rows)}


@router.post("/")
def create_connector(
    data: dict,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    ctype = data.get("connector_type", "")
    if ctype not in VALID_TYPES:
        raise HTTPException(400, f"connector_type must be one of {sorted(VALID_TYPES)}")
    if not data.get("name", "").strip():
        raise HTTPException(400, "name is required")

    cfg = data.get("config", {})
    _validate_config(ctype, cfg)

    row = db.execute(text("""
        INSERT INTO data_connectors
            (name, connector_type, config, project_id, created_by, is_active)
        VALUES
            (:name, :ctype, :cfg::jsonb, :pid, :uid::uuid, TRUE)
        RETURNING *
    """), {
        "name":  data["name"].strip(),
        "ctype": ctype,
        "cfg":   json.dumps(cfg),
        "pid":   data.get("project_id"),
        "uid":   str(user.id),
    }).fetchone()
    db.commit()
    logger.info("Connector created: %s type=%s user=%s", row.id, ctype, user.email)
    return _out(row)


@router.get("/{connector_id}")
def get_connector(
    connector_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    row = _get_connector(str(connector_id), db)
    _require_connector_access(row, db, user)
    return _out(row)


@router.patch("/{connector_id}")
def update_connector(
    connector_id: UUID,
    data: dict,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    row = _get_connector(str(connector_id), db)
    _require_connector_access(row, db, user)
    cfg = data.get("config")
    if cfg is not None:
        ctype = data.get("connector_type") or db.execute(
            text("SELECT connector_type FROM data_connectors WHERE id = :id::uuid"),
            {"id": str(connector_id)}
        ).scalar()
        _validate_config(ctype, cfg)

    fields, vals = [], {"id": str(connector_id)}
    for k in ("name", "connector_type", "is_active"):
        if k in data:
            fields.append(f"{k} = :{k}")
            vals[k] = data[k]
    if cfg is not None:
        fields.append("config = :cfg::jsonb")
        vals["cfg"] = json.dumps(cfg)

    if not fields:
        raise HTTPException(400, "No fields to update")

    row = db.execute(text(
        f"UPDATE data_connectors SET {', '.join(fields)} WHERE id = :id::uuid RETURNING *"
    ), vals).fetchone()
    db.commit()
    return _out(row)


@router.delete("/{connector_id}")
def delete_connector(
    connector_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    row = _get_connector(str(connector_id), db)
    _require_connector_access(row, db, user)
    db.execute(text(
        "UPDATE data_connectors SET is_active = FALSE WHERE id = :id::uuid"
    ), {"id": str(connector_id)})
    db.commit()
    return {"deleted": str(connector_id)}


# ── Connection test ────────────────────────────────────────────────────────────

@router.post("/{connector_id}/test")
def test_connector(
    connector_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Test the connection and return {ok, message, latency_ms}."""
    import time
    row = _get_connector(str(connector_id), db)
    _require_connector_access(row, db, user)
    cfg = row.config or {}
    ctype = row.connector_type
    status, message, latency_ms = "failed", "Unknown error", 0

    t0 = time.monotonic()
    try:
        if ctype == "s3":
            import boto3
            s3 = boto3.client("s3")
            bucket = cfg["bucket"]
            prefix = cfg.get("prefix", "")
            s3.list_objects_v2(Bucket=bucket, Prefix=prefix, MaxKeys=1)
            message = f"Connected to s3://{bucket}/{prefix} successfully"
            status = "ok"

        elif ctype == "postgresql":
            import sqlalchemy as _sa
            engine = _sa.create_engine(
                cfg["connection_string"],
                connect_args={"connect_timeout": RETRY_TIMEOUT},
                pool_pre_ping=True,
            )
            with engine.connect() as conn:
                result = conn.execute(_sa.text("SELECT 1")).scalar()
            engine.dispose()
            assert result == 1
            message = "PostgreSQL connection successful"
            status = "ok"

        elif ctype == "rest_api":
            import httpx
            headers = {}
            auth_type = cfg.get("auth_type", "none")
            if auth_type == "bearer":
                headers["Authorization"] = f"Bearer {cfg.get('token', '')}"
            elif auth_type == "api_key":
                headers[cfg.get("header_name", "X-API-Key")] = cfg.get("api_key", "")
            base_url = cfg["base_url"].rstrip("/")
            health_path = cfg.get("health_path", "")
            url = f"{base_url}/{health_path.lstrip('/')}" if health_path else base_url
            resp = httpx.get(url, headers=headers, timeout=RETRY_TIMEOUT, follow_redirects=True)
            if resp.status_code < 400:
                message = f"REST API reachable — HTTP {resp.status_code}"
                status = "ok"
            else:
                message = f"REST API returned HTTP {resp.status_code}"

        else:
            message = f"Unknown connector type: {ctype}"

    except Exception as exc:
        message = str(exc)[:300]
        logger.warning("Connector test failed %s: %s", connector_id, exc)

    latency_ms = int((time.monotonic() - t0) * 1000)

    # Persist test result
    from datetime import datetime
    db.execute(text("""
        UPDATE data_connectors
        SET last_tested_at = :ts, last_test_status = :status, last_test_error = :err
        WHERE id = :id::uuid
    """), {
        "ts":     datetime.utcnow(),
        "status": status,
        "err":    message if status == "failed" else None,
        "id":     str(connector_id),
    })
    db.commit()

    return {"ok": status == "ok", "status": status, "message": message, "latency_ms": latency_ms}


# ── Data preview ───────────────────────────────────────────────────────────────

@router.get("/{connector_id}/preview")
def preview_connector(
    connector_id: UUID,
    limit: int = 5,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Return up to `limit` rows from the connector source as a preview."""
    row = _get_connector(str(connector_id), db)
    _require_connector_access(row, db, user)
    cfg = row.config or {}
    ctype = row.connector_type
    limit = max(1, min(limit, 100))

    try:
        if ctype == "s3":
            import io

            import boto3
            import pandas as pd
            s3 = boto3.client("s3")
            bucket = cfg["bucket"]
            prefix = cfg.get("prefix", "")
            file_key = cfg.get("file_key", "")
            if not file_key:
                # List objects and pick the first CSV/Excel
                resp = s3.list_objects_v2(Bucket=bucket, Prefix=prefix, MaxKeys=20)
                keys = [o["Key"] for o in resp.get("Contents", [])
                        if o["Key"].lower().endswith((".csv", ".xlsx", ".xls"))]
                if not keys:
                    return {"columns": [], "rows": [], "message": "No CSV/Excel files found"}
                file_key = keys[0]
            # Fix: limit download to first 10 MB to prevent OOM on large files
            obj = s3.get_object(Bucket=bucket, Key=file_key, Range="bytes=0-10485760")
            buf = io.BytesIO(obj["Body"].read())
            if file_key.lower().endswith(".csv"):
                df = pd.read_csv(buf, nrows=limit)
            else:
                df = pd.read_excel(buf, nrows=limit)
            return {
                "columns": list(df.columns),
                "rows": df.head(limit).fillna("").to_dict("records"),
                "source": f"s3://{bucket}/{file_key}",
            }

        elif ctype == "postgresql":
            import sqlalchemy as _sa
            engine = _sa.create_engine(cfg["connection_string"], pool_pre_ping=True)
            table = cfg.get("table", "")
            # Fix: validate table name against allowlist to prevent SQL injection.
            # User-supplied 'query' field is also restricted to SELECT-only.
            if table and not re.match(r'^[A-Za-z_][A-Za-z0-9_.]*$', table):
                raise HTTPException(400, "Invalid table name — only alphanumeric, underscore, and dot are allowed")
            custom_query = cfg.get("query", "")
            if custom_query:
                if not custom_query.strip().upper().startswith("SELECT"):
                    raise HTTPException(400, "Only SELECT queries are permitted for preview")
                query = custom_query
            elif table:
                query = f"SELECT * FROM {table} LIMIT :lim"  # table validated above
            else:
                engine.dispose()
                return {"columns": [], "rows": [], "message": "Set 'table' or 'query' in config"}
            # Fix: always dispose engine — use try/finally
            try:
                with engine.connect() as conn:
                    if custom_query:
                        result = conn.execute(_sa.text(query))
                    else:
                        result = conn.execute(_sa.text(query), {"lim": limit})
                    cols = list(result.keys())
                    rows = [dict(zip(cols, r)) for r in result.fetchmany(limit)]
            finally:
                engine.dispose()
            return {"columns": cols, "rows": rows}

        elif ctype == "rest_api":
            import httpx
            headers = {}
            auth_type = cfg.get("auth_type", "none")
            if auth_type == "bearer":
                headers["Authorization"] = f"Bearer {cfg.get('token', '')}"
            elif auth_type == "api_key":
                headers[cfg.get("header_name", "X-API-Key")] = cfg.get("api_key", "")
            base_url = cfg["base_url"].rstrip("/")
            endpoint = cfg.get("data_endpoint", "").lstrip("/")
            url = f"{base_url}/{endpoint}" if endpoint else base_url
            resp = httpx.get(url, headers=headers, timeout=15, follow_redirects=True)
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, list):
                rows = data[:limit]
            elif isinstance(data, dict):
                for k in ("data", "items", "results", "records"):
                    if isinstance(data.get(k), list):
                        rows = data[k][:limit]
                        break
                else:
                    rows = [data]
            else:
                rows = []
            cols = list(rows[0].keys()) if rows and isinstance(rows[0], dict) else []
            return {"columns": cols, "rows": rows[:limit], "source": url}

        else:
            raise HTTPException(400, f"Preview not supported for type: {ctype}")

    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Connector preview failed %s: %s", connector_id, exc)
        raise HTTPException(502, f"Preview failed: {str(exc)[:200]}")
