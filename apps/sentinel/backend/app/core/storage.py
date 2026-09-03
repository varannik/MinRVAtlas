"""
File storage abstraction — local filesystem in dev, S3 in production.

When AWS_S3_BUCKET is set:
  - save()       → uploads to S3, deletes the local temp file, returns the S3 key
  - open_local() → downloads the S3 object to a temp file, yields the path, cleans up
  - delete()     → removes the S3 object
  - exists()     → HEAD request to S3

When AWS_S3_BUCKET is empty:
  - save()       → returns the local path as-is
  - open_local() → yields the path directly (no-op)
  - delete()     → os.remove()
  - exists()     → os.path.exists()

storage_path values stored in the DB:
  - Local:  absolute path   e.g. "/app/uploads/uuid.csv"
  - S3:     S3 key only     e.g. "uploads/uuid.csv"
"""

import contextlib
import logging
import os
import tempfile

logger = logging.getLogger("datasentinel.storage")


def _cfg():
    from app.core.config import settings
    return settings


def _s3():
    import boto3
    cfg = _cfg()
    return boto3.client("s3", region_name=cfg.AWS_REGION)


def use_s3() -> bool:
    return bool(_cfg().AWS_S3_BUCKET)


# ── Write ────────────────────────────────────────────────────────────────────

def save(tmp_local_path: str, s3_key: str) -> str:
    """
    Persist a file that was already written to tmp_local_path.
    Returns the storage_path to store in the database.
    """
    if use_s3():
        bucket = _cfg().AWS_S3_BUCKET
        logger.info(f"Uploading {tmp_local_path} → s3://{bucket}/{s3_key}")
        _s3().upload_file(tmp_local_path, bucket, s3_key)
        try:
            os.remove(tmp_local_path)
        except OSError:
            pass
        return s3_key
    return tmp_local_path


# ── Read ─────────────────────────────────────────────────────────────────────

@contextlib.contextmanager
def open_local(storage_path: str, suffix: str = ""):
    """
    Context manager that yields a local filesystem path for reading.
    For S3-backed paths this downloads to a temp file and cleans up on exit.
    """
    if use_s3():
        bucket = _cfg().AWS_S3_BUCKET
        ext = suffix or ("." + storage_path.rsplit(".", 1)[-1] if "." in storage_path else "")
        tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
        tmp.close()
        try:
            logger.debug(f"Downloading s3://{bucket}/{storage_path} → {tmp.name}")
            _s3().download_file(bucket, storage_path, tmp.name)
            yield tmp.name
        finally:
            try:
                os.remove(tmp.name)
            except OSError:
                pass
    else:
        yield storage_path


# ── Delete ───────────────────────────────────────────────────────────────────

def delete(storage_path: str):
    if use_s3():
        _s3().delete_object(Bucket=_cfg().AWS_S3_BUCKET, Key=storage_path)
    elif os.path.exists(storage_path):
        try:
            os.remove(storage_path)
        except OSError as e:
            logger.warning(f"Could not delete {storage_path}: {e}")


# ── Exists ───────────────────────────────────────────────────────────────────

def exists(storage_path: str) -> bool:
    if use_s3():
        try:
            _s3().head_object(Bucket=_cfg().AWS_S3_BUCKET, Key=storage_path)
            return True
        except Exception:
            return False
    return os.path.exists(storage_path)
