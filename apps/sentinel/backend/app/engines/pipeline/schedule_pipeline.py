"""
Full Schedule Pipeline Engine
==============================
Orchestrates the complete automated flow for a scheduled DQA run:

  1. Pull latest file from source (local / SharePoint / S3)
  2. Ingest as a Dataset
  3. Run DQA detection rules
  4. Auto-apply corrections above confidence threshold
  5. Generate corrected file + correction report (CSV)
  6. Push both to /corrected subfolder at the original source
  7. Evaluate gate results on corrected data
  8. Send email alert if any hard gate fails
  9. Persist pipeline result on the schedule record
"""
import csv
import io
import logging
import os
import tempfile
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("datasentinel.pipeline")


# ── Source adapters ────────────────────────────────────────────────────────────

async def _pull_from_sharepoint(config: Dict[str, Any]) -> Tuple[bytes, str]:
    """Download the latest CSV/Excel from a SharePoint folder."""
    import httpx
    folder_url  = config.get("folder_url", "")
    graph_token = config.get("graph_token", "")
    headers     = {"Authorization": f"Bearer {graph_token}"}

    # List files in folder
    from app.engines.vv.folder_connector import fetch_sharepoint_files
    files = await fetch_sharepoint_files(folder_url, graph_token)
    allowed = {"csv", "xlsx", "xls"}
    csv_files = [f for f in files if f.get("extension", "").lower() in allowed and not f.get("error")]
    if not csv_files:
        raise ValueError("No CSV/Excel files found in SharePoint folder")

    # Pick most recently modified (or first)
    target = csv_files[0]
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.get(target["download_url"], headers=headers, follow_redirects=True)
    resp.raise_for_status()
    return resp.content, target["name"]


async def _pull_from_s3(config: Dict[str, Any]) -> Tuple[bytes, str]:
    """Download the latest CSV/Excel from an S3 bucket prefix."""
    import boto3
    bucket  = config.get("bucket", "")
    prefix  = config.get("prefix", "")
    region  = config.get("region", "us-east-1")

    kwargs: dict = {"region_name": region}
    if config.get("aws_access_key_id"):
        kwargs["aws_access_key_id"]    = config["aws_access_key_id"]
        kwargs["aws_secret_access_key"] = config.get("aws_secret_access_key", "")

    s3 = boto3.client("s3", **kwargs)
    allowed = {".csv", ".xlsx", ".xls"}
    response = s3.list_objects_v2(Bucket=bucket, Prefix=prefix)
    objects  = [o for o in response.get("Contents", [])
                if os.path.splitext(o["Key"])[1].lower() in allowed]
    if not objects:
        raise ValueError(f"No CSV/Excel files found in s3://{bucket}/{prefix}")

    # Pick most recently modified
    objects.sort(key=lambda o: o["LastModified"], reverse=True)
    target = objects[0]

    buf = io.BytesIO()
    s3.download_fileobj(bucket, target["Key"], buf)
    return buf.getvalue(), target["Key"].split("/")[-1]


async def _pull_from_local(config: Dict[str, Any]) -> Tuple[bytes, str]:
    """Read the latest CSV/Excel from a local folder path."""
    folder = config.get("folder_path", "")
    if not os.path.isdir(folder):
        raise ValueError(f"Local folder not found: {folder}")
    allowed = {".csv", ".xlsx", ".xls"}
    files = [
        os.path.join(folder, f) for f in os.listdir(folder)
        if os.path.splitext(f)[1].lower() in allowed
    ]
    if not files:
        raise ValueError(f"No CSV/Excel files found in {folder}")
    files.sort(key=os.path.getmtime, reverse=True)
    with open(files[0], "rb") as fh:
        return fh.read(), os.path.basename(files[0])


# ── Output adapters ────────────────────────────────────────────────────────────

async def _push_to_sharepoint(file_bytes: bytes, filename: str,
                               config: Dict[str, Any], subfolder: str):
    """Upload corrected file to SharePoint subfolder."""
    import httpx
    graph_token = config.get("graph_token", "")
    folder_url  = config.get("folder_url", "")
    # Build upload URL (simplified — uses the same parent folder with subfolder appended)
    # Full implementation requires Graph API drive/item path resolution
    upload_url = folder_url.rstrip("/") + f"/{subfolder}/{filename}:/content"
    headers = {"Authorization": f"Bearer {graph_token}", "Content-Type": "application/octet-stream"}
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.put(upload_url, content=file_bytes, headers=headers)
    if resp.status_code not in (200, 201):
        logger.warning("SharePoint upload returned %s: %s", resp.status_code, resp.text[:200])


async def _push_to_s3(file_bytes: bytes, filename: str,
                       config: Dict[str, Any], subfolder: str):
    """Upload corrected file to S3 subfolder."""
    import boto3
    bucket = config.get("bucket", "")
    prefix = config.get("prefix", "").rstrip("/")
    region = config.get("region", "us-east-1")

    kwargs: dict = {"region_name": region}
    if config.get("aws_access_key_id"):
        kwargs["aws_access_key_id"]    = config["aws_access_key_id"]
        kwargs["aws_secret_access_key"] = config.get("aws_secret_access_key", "")

    s3  = boto3.client("s3", **kwargs)
    key = f"{prefix}/{subfolder}/{filename}" if prefix else f"{subfolder}/{filename}"
    s3.put_object(Bucket=bucket, Key=key, Body=file_bytes)
    logger.info("Pushed corrected file to s3://%s/%s", bucket, key)


def _push_to_local(file_bytes: bytes, filename: str,
                   config: Dict[str, Any], subfolder: str):
    """Save corrected file to local subfolder."""
    folder = config.get("folder_path", "")
    out_dir = os.path.join(folder, subfolder)
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, filename)
    with open(out_path, "wb") as fh:
        fh.write(file_bytes)
    logger.info("Saved corrected file to %s", out_path)


# ── Correction application ─────────────────────────────────────────────────────

def _apply_corrections(df: Any, violations: List[Any],
                        correction_rules: List[Any],
                        threshold_pct: int) -> Tuple[Any, List[Dict]]:
    """
    Apply corrections to a DataFrame based on correction rules and violations.
    Returns (corrected_df, correction_log).

    correction_log: list of dicts describing what was done to each field.
    """
    import pandas as pd
    corrected_df  = df.copy()
    correction_log: List[Dict] = []

    # Build correction rule lookup by rule_id
    rule_map = {}
    for cr in correction_rules:
        rid = getattr(cr, "target_dqa_rule_id", None)
        if rid:
            rule_map[rid] = cr

    for v in violations:
        rule_id    = getattr(v, "rule_id", None)
        field_name = getattr(v, "field_name", None) or getattr(v, "tag", None)
        row_index  = getattr(v, "row_index", None)
        orig_value = getattr(v, "original_value", None)
        confidence = float(getattr(v, "confidence", 0) or 0) * 100  # convert 0-1 to 0-100

        cr = rule_map.get(rule_id)
        if not cr:
            correction_log.append({
                "field": field_name, "row": row_index,
                "original_value": orig_value, "corrected_value": None,
                "correction_type": "none", "confidence_pct": confidence,
                "applied": False, "reason": "No correction rule found",
            })
            continue

        auto_threshold = getattr(cr, "auto_apply_threshold", threshold_pct)
        if confidence < auto_threshold:
            correction_log.append({
                "field": field_name, "row": row_index,
                "original_value": orig_value, "corrected_value": None,
                "correction_type": cr.correction_type, "confidence_pct": confidence,
                "applied": False, "reason": f"Confidence {confidence:.0f}% below threshold {auto_threshold}%",
            })
            continue

        logic  = cr.correction_logic or {}
        method = logic.get("method", "flag")
        new_val = orig_value

        try:
            if method == "forward_fill" and field_name and field_name in corrected_df.columns:
                corrected_df[field_name] = corrected_df[field_name].fillna(method="ffill")
                new_val = "forward-filled"
            elif method == "median" and field_name and field_name in corrected_df.columns:
                median_val = corrected_df[field_name].median()
                if row_index is not None and row_index < len(corrected_df):
                    corrected_df.at[row_index, field_name] = median_val
                new_val = median_val
            elif method == "linear" and field_name and field_name in corrected_df.columns:
                corrected_df[field_name] = corrected_df[field_name].interpolate(method="linear")
                new_val = "interpolated"
            elif method == "clamp" and field_name and field_name in corrected_df.columns:
                min_v = logic.get("min_val")
                max_v = logic.get("max_val")
                if min_v is not None:
                    corrected_df[field_name] = corrected_df[field_name].clip(lower=min_v)
                if max_v is not None:
                    corrected_df[field_name] = corrected_df[field_name].clip(upper=max_v)
                new_val = "clamped"
            elif method == "rolling_mean" and field_name and field_name in corrected_df.columns:
                window = int(logic.get("window", 3))
                corrected_df[field_name] = corrected_df[field_name].rolling(window, min_periods=1).mean()
                new_val = "smoothed"
            elif method == "keep_first":
                corrected_df = corrected_df.drop_duplicates()
                new_val = "duplicates removed"
            # flag / substitute / other → no automatic data change, just log
        except Exception as apply_err:
            logger.warning("Correction apply error for %s: %s", field_name, apply_err)
            correction_log.append({
                "field": field_name, "row": row_index,
                "original_value": orig_value, "corrected_value": None,
                "correction_type": cr.correction_type, "confidence_pct": confidence,
                "applied": False, "reason": f"Apply error: {apply_err}",
            })
            continue

        correction_log.append({
            "field": field_name, "row": row_index,
            "original_value": orig_value, "corrected_value": new_val,
            "correction_type": cr.correction_type, "confidence_pct": confidence,
            "applied": True, "reason": f"Auto-applied ({method})",
        })

    return corrected_df, correction_log


def _generate_correction_report(correction_log: List[Dict], pipeline_result: Dict) -> bytes:
    """Generate a CSV correction report."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["# DataSentinel Correction Report",
                     f"Generated: {datetime.utcnow().isoformat()}"])
    writer.writerow(["# Gate result:", pipeline_result.get("gate_result", "unknown")])
    writer.writerow(["# Violations detected:", pipeline_result.get("violations_detected", 0)])
    writer.writerow(["# Corrections applied:", pipeline_result.get("corrections_applied", 0)])
    writer.writerow(["# Corrections flagged:", pipeline_result.get("corrections_flagged", 0)])
    writer.writerow([])
    writer.writerow(["Field", "Row", "Original Value", "Corrected Value",
                     "Correction Type", "Confidence %", "Applied", "Reason"])
    for row in correction_log:
        writer.writerow([
            row.get("field", ""),
            row.get("row", ""),
            row.get("original_value", ""),
            row.get("corrected_value", ""),
            row.get("correction_type", ""),
            f"{row.get('confidence_pct', 0):.0f}",
            "YES" if row.get("applied") else "NO",
            row.get("reason", ""),
        ])
    return buf.getvalue().encode("utf-8")


def _send_gate_fail_email(schedule: Any, pipeline_result: Dict, correction_report: bytes):
    """Send email notification when a gate check fails."""
    emails_raw = getattr(schedule, "gate_fail_emails", None) or getattr(schedule, "notify_email", None) or ""
    recipients = [e.strip() for e in emails_raw.replace(";", ",").split(",") if e.strip()]
    if not recipients:
        logger.info("Gate failed but no email recipients configured")
        return

    try:
        import boto3
        from app.core.config import settings

        ses = boto3.client("ses", region_name=settings.AWS_REGION or "us-east-1")
        subject = f"⚠ DQA Gate Failed — {schedule.name}"
        body = f"""DataSentinel Schedule Alert

Schedule:   {schedule.name}
Run time:   {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}
Gate result: FAILED

Summary:
  Violations detected:   {pipeline_result.get('violations_detected', 0)}
  Corrections applied:   {pipeline_result.get('corrections_applied', 0)}
  Corrections flagged:   {pipeline_result.get('corrections_flagged', 0)}
  Gate checks failed:    {pipeline_result.get('gates_failed', 0)}

The corrected file and detailed correction report have been saved to the
/{getattr(schedule, 'output_folder_suffix', 'corrected')} subfolder at the source location.

— DataSentinel Automated Pipeline
"""
        ses.send_email(
            Source=settings.SES_FROM_EMAIL or "noreply@datasentinel.io",
            Destination={"ToAddresses": recipients},
            Message={
                "Subject": {"Data": subject},
                "Body":    {"Text": {"Data": body}},
            },
        )
        logger.info("Gate-fail email sent to %s", recipients)
    except Exception as email_err:
        logger.warning("Could not send gate-fail email: %s", email_err)


# ── Main pipeline ──────────────────────────────────────────────────────────────

async def run_full_pipeline(schedule_id: str) -> Dict[str, Any]:
    """
    Run the complete detection → correction → output pipeline for a schedule.
    Called from the schedule trigger (manual or cron).
    """
    from app.core.database import SessionLocal
    from app.models import CorrectionRule, Dataset, DQARun, DQASchedule, DQAViolation, Project

    db = SessionLocal()
    pipeline_result: Dict[str, Any] = {
        "schedule_id":         schedule_id,
        "started_at":          datetime.utcnow().isoformat(),
        "source_type":         "unknown",
        "file_pulled":         None,
        "violations_detected": 0,
        "corrections_applied": 0,
        "corrections_flagged": 0,
        "gates_failed":        0,
        "gate_result":         "unknown",
        "output_files":        [],
        "error":               None,
    }

    try:
        schedule = db.query(DQASchedule).filter(DQASchedule.id == schedule_id).first()
        if not schedule:
            raise ValueError(f"Schedule {schedule_id} not found")

        source_type   = getattr(schedule, "source_type", "manual") or "manual"
        source_config = getattr(schedule, "source_config", {}) or {}
        pipeline_result["source_type"] = source_type

        # ── Step 1: pull latest file ──────────────────────────────────────────
        file_bytes: Optional[bytes] = None
        filename:   Optional[str]   = None

        if source_type == "sharepoint":
            file_bytes, filename = await _pull_from_sharepoint(source_config)
        elif source_type == "s3":
            file_bytes, filename = await _pull_from_s3(source_config)
        elif source_type == "local":
            file_bytes, filename = await _pull_from_local(source_config)
        else:
            # manual — use the pre-configured dataset_id
            if not schedule.dataset_id:
                raise ValueError("Manual schedule has no dataset configured")
            file_bytes = None  # will use existing dataset

        pipeline_result["file_pulled"] = filename

        # ── Step 2: ingest as dataset (for dynamic sources) ───────────────────
        dataset_id = schedule.dataset_id
        if file_bytes and filename:
            from app.api.v1.datasets import _ingest_remote_file
            result = _ingest_remote_file(
                file_bytes=file_bytes, filename=filename,
                project_id=schedule.project_id, db=db,
                user=type("U", (), {"id": schedule.created_by, "role": "admin"})(),
                source_label=source_type,
            )
            dataset_id = result["id"]
            logger.info("Pipeline: ingested %s as dataset %s", filename, dataset_id)

        if not dataset_id:
            raise ValueError("No dataset available to run DQA against")

        # ── Step 3: run DQA detection ─────────────────────────────────────────
        from app.api.v1.runs import _execute_dqa

        run = DQARun(
            dataset_id=dataset_id,
            project_id=schedule.project_id,
            triggered_by=schedule.created_by,
            status="queued",
        )
        db.add(run); db.flush()
        db.commit()

        _execute_dqa(str(run.id))  # synchronous execution

        db.refresh(run)
        violations = db.query(DQAViolation).filter(DQAViolation.run_id == run.id).all()
        pipeline_result["violations_detected"] = len(violations)
        pipeline_result["gates_failed"]         = sum(1 for v in violations if v.severity == "critical")
        logger.info("Pipeline: DQA complete — %d violations, %d critical",
                    len(violations), pipeline_result["gates_failed"])

        # ── Step 4: apply corrections (if enabled) ────────────────────────────
        correction_log: List[Dict] = []
        corrected_bytes: Optional[bytes] = None

        auto_correct = getattr(schedule, "auto_correct_enabled", False)
        if auto_correct and violations:
            threshold = getattr(schedule, "correction_confidence_pct", 80) or 80

            # Load the dataset as a DataFrame
            dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
            correction_rules = db.query(CorrectionRule).filter(
                CorrectionRule.project_id == schedule.project_id,
                CorrectionRule.is_active  == True,
            ).all()

            if dataset and dataset.storage_path:
                from app.core import storage as _storage
                import pandas as pd
                with _storage.open_local(dataset.storage_path,
                                         suffix=f".{dataset.source_type or 'csv'}") as local_path:
                    ext = os.path.splitext(local_path)[1].lower()
                    if ext == ".csv":
                        df = pd.read_csv(local_path)
                    else:
                        df = pd.read_excel(local_path)

                corrected_df, correction_log = _apply_corrections(
                    df, violations, correction_rules, threshold
                )
                applied = sum(1 for c in correction_log if c.get("applied"))
                flagged = sum(1 for c in correction_log if not c.get("applied"))
                pipeline_result["corrections_applied"] = applied
                pipeline_result["corrections_flagged"] = flagged

                # Serialise corrected DataFrame
                if ext == ".csv":
                    corrected_bytes = corrected_df.to_csv(index=False).encode("utf-8")
                    corrected_filename = (filename or "data").replace(".csv", "_corrected.csv")
                else:
                    buf = io.BytesIO()
                    corrected_df.to_excel(buf, index=False)
                    corrected_bytes = buf.getvalue()
                    base = os.path.splitext(filename or "data")[0]
                    corrected_filename = f"{base}_corrected.xlsx"

                logger.info("Pipeline: %d corrections applied, %d flagged", applied, flagged)

        # ── Step 5: generate correction report ────────────────────────────────
        report_bytes = _generate_correction_report(correction_log, pipeline_result)
        report_filename = (filename or "report").rsplit(".", 1)[0] + "_correction_report.csv"

        # ── Step 6: determine gate result ─────────────────────────────────────
        gate_failed = run.gate_passed is False
        pipeline_result["gate_result"] = "FAILED" if gate_failed else "PASSED"

        # ── Step 7: push outputs to /corrected subfolder ──────────────────────
        output_suffix = getattr(schedule, "output_folder_suffix", "corrected") or "corrected"
        outputs = []

        if corrected_bytes and corrected_filename:
            if source_type == "sharepoint":
                await _push_to_sharepoint(corrected_bytes, corrected_filename, source_config, output_suffix)
            elif source_type == "s3":
                await _push_to_s3(corrected_bytes, corrected_filename, source_config, output_suffix)
            elif source_type == "local":
                _push_to_local(corrected_bytes, corrected_filename, source_config, output_suffix)
            outputs.append(corrected_filename)

        # Always push the correction report
        if source_type == "sharepoint":
            await _push_to_sharepoint(report_bytes, report_filename, source_config, output_suffix)
        elif source_type == "s3":
            await _push_to_s3(report_bytes, report_filename, source_config, output_suffix)
        elif source_type == "local":
            _push_to_local(report_bytes, report_filename, source_config, output_suffix)
        outputs.append(report_filename)
        pipeline_result["output_files"] = outputs

        # ── Step 8: send gate-fail email ──────────────────────────────────────
        if gate_failed:
            _send_gate_fail_email(schedule, pipeline_result, report_bytes)

        # ── Step 9: persist result on schedule ────────────────────────────────
        pipeline_result["completed_at"] = datetime.utcnow().isoformat()
        schedule.last_run_at     = datetime.utcnow()
        schedule.last_run_status = pipeline_result["gate_result"]
        schedule.run_count       = (schedule.run_count or 0) + 1
        try:
            from sqlalchemy.orm.attributes import flag_modified
            schedule.last_pipeline_result = pipeline_result
            flag_modified(schedule, "last_pipeline_result")
        except Exception:
            pass
        db.commit()
        logger.info("Pipeline complete: gate=%s, files=%s",
                    pipeline_result["gate_result"], outputs)

    except Exception as exc:
        import traceback
        pipeline_result["error"] = f"{type(exc).__name__}: {exc}"
        pipeline_result["completed_at"] = datetime.utcnow().isoformat()
        logger.error("Pipeline failed for schedule %s: %s\n%s",
                     schedule_id, exc, traceback.format_exc())
        try:
            schedule = db.query(DQASchedule).filter(DQASchedule.id == schedule_id).first()
            if schedule:
                schedule.last_run_status = "error"
                schedule.last_pipeline_result = pipeline_result
                db.commit()
        except Exception:
            pass
    finally:
        db.close()

    return pipeline_result


# ── Anomaly detection pipeline for one project config ─────────────────────────

async def _run_anomaly_for_config(
    cfg: Dict[str, Any],
    schedule_created_by,
    anomaly_confidence_pct: int = 70,
    min_anomaly_count: int = 1,
    db=None,
) -> Dict[str, Any]:
    """
    Run anomaly detection for a single project config.
    Returns a result dict for inclusion in the overall pipeline result.
    """
    from app.models import Dataset, DQASchedule

    project_id  = cfg.get("project_id")
    source_type = cfg.get("source_type", "manual")
    src_cfg     = cfg.get("source_config") or {}
    out_suffix  = cfg.get("output_folder_suffix", "anomaly-reports")
    dataset_id  = cfg.get("dataset_id")

    result: Dict[str, Any] = {
        "project_id":      project_id,
        "source_type":     source_type,
        "anomalies_found": 0,
        "high_confidence": 0,
        "output_files":    [],
        "error":           None,
    }

    try:
        # Pull file if dynamic source
        file_bytes = None
        filename   = None
        if source_type == "sharepoint":
            file_bytes, filename = await _pull_from_sharepoint(src_cfg)
        elif source_type == "s3":
            file_bytes, filename = await _pull_from_s3(src_cfg)
        elif source_type == "local":
            file_bytes, filename = await _pull_from_local(src_cfg)

        if file_bytes and filename:
            from app.api.v1.datasets import _ingest_remote_file
            user_stub = type("U", (), {"id": schedule_created_by, "role": "admin"})()
            ds_result = _ingest_remote_file(
                file_bytes=file_bytes, filename=filename,
                project_id=project_id, db=db,
                user=user_stub, source_label=source_type,
            )
            dataset_id = ds_result["id"]

        if not dataset_id:
            raise ValueError("No dataset available for anomaly detection")

        # Load dataset
        dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
        if not dataset or not dataset.storage_path:
            raise ValueError("Dataset file not found")

        from app.core import storage as _storage
        import pandas as pd
        with _storage.open_local(dataset.storage_path,
                                  suffix=f".{dataset.source_type or 'csv'}") as local_path:
            df = pd.read_csv(local_path)

        # Run anomaly engine
        from app.engines.anomaly.engine import AnomalyDetectionEngine
        engine   = AnomalyDetectionEngine()
        ad_result = engine.run(df)

        anomalies   = ad_result.get("anomalies", [])
        high_conf   = [a for a in anomalies if float(a.get("anomaly_probability", 0)) >= anomaly_confidence_pct / 100]
        result["anomalies_found"] = len(anomalies)
        result["high_confidence"] = len(high_conf)

        # Generate anomaly report CSV
        import csv, io as _io
        buf = _io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["# DataSentinel Anomaly Detection Report",
                         f"Generated: {datetime.utcnow().isoformat()}"])
        writer.writerow(["# Total anomalies:", len(anomalies)])
        writer.writerow(["# High confidence:", len(high_conf)])
        writer.writerow([])
        writer.writerow(["Timestamp", "Field", "Value", "Anomaly Type",
                         "Probability", "Models", "Recommended Action"])
        for a in anomalies:
            writer.writerow([
                a.get("timestamp", ""),
                a.get("field", ""),
                a.get("value", ""),
                a.get("anomaly_type", ""),
                f"{float(a.get('anomaly_probability', 0))*100:.1f}%",
                ",".join(a.get("detected_by", [])),
                a.get("recommended_action", ""),
            ])
        report_bytes = buf.getvalue().encode("utf-8")
        report_name  = (filename or "data").rsplit(".", 1)[0] + "_anomaly_report.csv"

        # Push report to output subfolder
        if source_type == "sharepoint":
            await _push_to_sharepoint(report_bytes, report_name, src_cfg, out_suffix)
        elif source_type == "s3":
            await _push_to_s3(report_bytes, report_name, src_cfg, out_suffix)
        elif source_type == "local":
            _push_to_local(report_bytes, report_name, src_cfg, out_suffix)
        result["output_files"].append(report_name)

    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
        logger.error("Anomaly pipeline error for project %s: %s", project_id, exc)

    return result


# ── Multi-project full pipeline ────────────────────────────────────────────────

async def run_multi_project_pipeline(schedule_id: str) -> Dict[str, Any]:
    """
    Run the multi-project, multi-type pipeline for a schedule.
    Supports:
      schedule_type = "dqa"     → DQA + corrections only
      schedule_type = "anomaly" → Anomaly detection only
      schedule_type = "both"    → DQA first, then anomaly on same/corrected data
    Each project_config runs independently — failure in one doesn't stop others.
    """
    from app.core.database import SessionLocal
    from app.models import DQASchedule
    from sqlalchemy.orm.attributes import flag_modified

    db = SessionLocal()
    overall: Dict[str, Any] = {
        "schedule_id":     schedule_id,
        "schedule_type":   "dqa",
        "started_at":      datetime.utcnow().isoformat(),
        "project_results": [],
        "total_projects":  0,
        "succeeded":       0,
        "failed":          0,
        "error":           None,
    }

    try:
        schedule       = db.query(DQASchedule).filter(DQASchedule.id == schedule_id).first()
        if not schedule:
            raise ValueError(f"Schedule {schedule_id} not found")

        schedule_type   = getattr(schedule, "schedule_type", "dqa") or "dqa"
        project_configs = getattr(schedule, "project_configs", None) or []
        overall["schedule_type"] = schedule_type

        # Backward compat: if no project_configs, build one from legacy fields
        if not project_configs and schedule.project_id:
            project_configs = [{
                "project_id":         str(schedule.project_id),
                "source_type":        getattr(schedule, "source_type", "manual") or "manual",
                "source_config":      getattr(schedule, "source_config", {}) or {},
                "dataset_id":         str(schedule.dataset_id) if schedule.dataset_id else None,
                "auto_correct_enabled":     getattr(schedule, "auto_correct_enabled", False),
                "correction_confidence_pct": getattr(schedule, "correction_confidence_pct", 80),
                "output_folder_suffix":     getattr(schedule, "output_folder_suffix", "corrected") or "corrected",
            }]

        overall["total_projects"] = len(project_configs)
        all_gate_failed  = False
        all_alert_emails = [e.strip() for e in
                            (getattr(schedule, "gate_fail_emails", "") or "").replace(";", ",").split(",")
                            if e.strip()]
        anomaly_threshold = getattr(schedule, "anomaly_confidence_pct", 70) or 70
        min_anomaly       = getattr(schedule, "min_anomaly_count", 1) or 1

        for cfg in project_configs:
            proj_result: Dict[str, Any] = {
                "project_id":  cfg.get("project_id"),
                "dqa":         None,
                "anomaly":     None,
                "error":       None,
            }
            try:
                if schedule_type in ("dqa", "both"):
                    # Reuse existing single-project pipeline (returns per-project result)
                    dqa_res = await run_full_pipeline(schedule_id)  # for single legacy config
                    # For multi-project, run inline instead
                    dqa_res = await _run_dqa_for_config(cfg, schedule.created_by, db)
                    proj_result["dqa"] = dqa_res
                    if dqa_res.get("gate_result") == "FAILED":
                        all_gate_failed = True

                if schedule_type in ("anomaly", "both"):
                    anom_res = await _run_anomaly_for_config(
                        cfg, schedule.created_by, anomaly_threshold, min_anomaly, db
                    )
                    proj_result["anomaly"] = anom_res
                    # Trigger alert if enough high-confidence anomalies
                    if (anom_res.get("high_confidence", 0) or 0) >= min_anomaly:
                        all_gate_failed = True

                overall["succeeded"] += 1
            except Exception as proj_err:
                proj_result["error"] = str(proj_err)
                overall["failed"] += 1
                logger.error("Project %s failed in schedule: %s", cfg.get("project_id"), proj_err)

            overall["project_results"].append(proj_result)

        # Send alert if any project had issues
        if all_gate_failed and all_alert_emails:
            _send_gate_fail_email(schedule, overall, b"")

        overall["completed_at"]  = datetime.utcnow().isoformat()
        schedule.last_run_at     = datetime.utcnow()
        schedule.last_run_status = "error" if overall["failed"] > 0 else "completed"
        schedule.run_count       = (schedule.run_count or 0) + 1
        try:
            schedule.last_pipeline_result = overall
            flag_modified(schedule, "last_pipeline_result")
        except Exception:
            pass
        db.commit()

    except Exception as exc:
        overall["error"]        = f"{type(exc).__name__}: {exc}"
        overall["completed_at"] = datetime.utcnow().isoformat()
        logger.error("Multi-project pipeline failed: %s", exc)
    finally:
        db.close()

    return overall


async def _run_dqa_for_config(cfg: Dict[str, Any], created_by, db) -> Dict[str, Any]:
    """Run DQA + corrections for one project config (inline, no schedule record update)."""
    from app.models import CorrectionRule, Dataset, DQARun, DQAViolation

    project_id  = cfg.get("project_id")
    source_type = cfg.get("source_type", "manual")
    src_cfg     = cfg.get("source_config") or {}
    dataset_id  = cfg.get("dataset_id")
    auto_correct = cfg.get("auto_correct_enabled", False)
    threshold    = cfg.get("correction_confidence_pct", 80)
    out_suffix   = cfg.get("output_folder_suffix", "corrected")

    result: Dict[str, Any] = {
        "project_id":        project_id,
        "source_type":       source_type,
        "file_pulled":       None,
        "violations_detected": 0,
        "corrections_applied": 0,
        "corrections_flagged": 0,
        "gate_result":       "unknown",
        "output_files":      [],
        "error":             None,
    }

    file_bytes = None
    filename   = None

    if source_type == "sharepoint":
        file_bytes, filename = await _pull_from_sharepoint(src_cfg)
    elif source_type == "s3":
        file_bytes, filename = await _pull_from_s3(src_cfg)
    elif source_type == "local":
        file_bytes, filename = await _pull_from_local(src_cfg)

    if file_bytes and filename:
        from app.api.v1.datasets import _ingest_remote_file
        user_stub = type("U", (), {"id": created_by, "role": "admin"})()
        ds_result = _ingest_remote_file(
            file_bytes=file_bytes, filename=filename,
            project_id=project_id, db=db,
            user=user_stub, source_label=source_type,
        )
        dataset_id = ds_result["id"]
        result["file_pulled"] = filename

    if not dataset_id:
        raise ValueError("No dataset available")

    from app.api.v1.runs import _execute_dqa
    run = DQARun(dataset_id=dataset_id, project_id=project_id, triggered_by=created_by, status="queued")
    db.add(run); db.flush(); db.commit()
    _execute_dqa(str(run.id))
    db.refresh(run)

    violations = db.query(DQAViolation).filter(DQAViolation.run_id == run.id).all()
    result["violations_detected"] = len(violations)
    result["gate_result"] = "PASSED" if run.gate_passed else "FAILED"

    if auto_correct and violations:
        dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
        correction_rules = db.query(CorrectionRule).filter(
            CorrectionRule.project_id == project_id, CorrectionRule.is_active == True).all()
        if dataset and dataset.storage_path:
            from app.core import storage as _storage
            import pandas as pd
            with _storage.open_local(dataset.storage_path, suffix=f".{dataset.source_type or 'csv'}") as lp:
                df = pd.read_csv(lp) if lp.endswith(".csv") else __import__("pandas").read_excel(lp)
            corrected_df, correction_log = _apply_corrections(df, violations, correction_rules, threshold)
            applied = sum(1 for c in correction_log if c.get("applied"))
            result["corrections_applied"] = applied
            result["corrections_flagged"] = len(correction_log) - applied

            ext = ".csv"
            corrected_bytes = corrected_df.to_csv(index=False).encode("utf-8")
            corrected_name  = (filename or "data").replace(ext, f"_corrected{ext}") if filename else f"corrected{ext}"
            report_bytes    = _generate_correction_report(correction_log, result)
            report_name     = (filename or "report").rsplit(".", 1)[0] + "_correction_report.csv"

            for fb, fn in [(corrected_bytes, corrected_name), (report_bytes, report_name)]:
                if source_type == "sharepoint":
                    import asyncio; asyncio.get_event_loop().run_until_complete(_push_to_sharepoint(fb, fn, src_cfg, out_suffix))
                elif source_type == "s3":
                    import asyncio; asyncio.get_event_loop().run_until_complete(_push_to_s3(fb, fn, src_cfg, out_suffix))
                elif source_type == "local":
                    _push_to_local(fb, fn, src_cfg, out_suffix)
            result["output_files"] = [corrected_name, report_name]

    return result
