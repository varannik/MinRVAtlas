"""
B3-#2: Weekly DQA digest — per-project summary email.

POST /api/v1/digest/{project_id}/send   — send digest immediately (admin/analyst)
GET  /api/v1/digest/{project_id}        — get digest config from project config
PUT  /api/v1/digest/{project_id}        — update digest config (enabled, email)
"""
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user, require_role
from app.models import DQARun, DQAViolation, Project

router = APIRouter()


def _build_digest_html(project_name: str, runs: list, violations: list) -> str:
    """Build a styled HTML email summarising the past week's DQA activity."""
    total_runs = len(runs)
    passed = sum(1 for r in runs if r.gate_passed)
    failed = total_runs - passed
    avg_readiness = (
        round(sum((r.readiness_score or 0) * 100 for r in runs) / total_runs, 1)
        if total_runs else 0
    )
    total_violations = sum(r.total_violations or 0 for r in runs)
    critical = sum(1 for v in violations if v.severity == "critical")
    high = sum(1 for v in violations if v.severity == "high")

    rows = ""
    for r in runs[-10:]:  # last 10 runs
        score = round((r.readiness_score or 0) * 100, 1)
        color = "#27AE60" if r.gate_passed else "#E05252"
        gate = "✅ PASSED" if r.gate_passed else "❌ FAILED"
        triggered = r.triggered_at.strftime("%d %b %H:%M") if r.triggered_at else "—"
        rows += f"""<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;font-size:12px;color:#bbb">{triggered}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;font-size:13px;font-weight:700;color:{color}">{gate}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;font-size:13px;color:#ccc">{score}%</td>
          <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;font-size:12px;color:#bbb">{r.total_violations or 0}</td>
        </tr>"""

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0d0f12;font-family:'Segoe UI',system-ui,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px">

    <!-- Header -->
    <div style="background:#1a1c21;border:1px solid #2a2a2a;border-radius:12px;padding:28px 32px;margin-bottom:20px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:#888;margin-bottom:8px">Weekly DQA Digest</div>
      <div style="font-size:22px;font-weight:800;color:#F5F2EB;margin-bottom:4px">{project_name}</div>
      <div style="font-size:12px;color:#666">Past 7 days · Generated {datetime.now(timezone.utc).strftime("%d %b %Y %H:%M UTC")}</div>
    </div>

    <!-- KPIs -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-bottom:20px">
      <div style="background:#1a1c21;border:1px solid #2a2a2a;border-radius:8px;padding:16px;text-align:center">
        <div style="font-size:26px;font-weight:800;color:#F5F2EB">{total_runs}</div>
        <div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.8px;margin-top:4px">Runs</div>
      </div>
      <div style="background:#1a1c21;border:1px solid #2a2a2a;border-radius:8px;padding:16px;text-align:center">
        <div style="font-size:26px;font-weight:800;color:#27AE60">{passed}</div>
        <div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.8px;margin-top:4px">Passed</div>
      </div>
      <div style="background:#1a1c21;border:1px solid #2a2a2a;border-radius:8px;padding:16px;text-align:center">
        <div style="font-size:26px;font-weight:800;color:#E05252">{failed}</div>
        <div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.8px;margin-top:4px">Failed</div>
      </div>
      <div style="background:#1a1c21;border:1px solid #2a2a2a;border-radius:8px;padding:16px;text-align:center">
        <div style="font-size:26px;font-weight:800;color:#F5F2EB">{avg_readiness}%</div>
        <div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.8px;margin-top:4px">Avg Readiness</div>
      </div>
    </div>

    <!-- Violations summary -->
    <div style="background:#1a1c21;border:1px solid #2a2a2a;border-radius:8px;padding:16px;margin-bottom:20px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#888;margin-bottom:10px">Violations This Week</div>
      <div style="display:flex;gap:20px">
        <div><span style="font-size:18px;font-weight:800;color:#E05252">{critical}</span> <span style="font-size:11px;color:#888">Critical</span></div>
        <div><span style="font-size:18px;font-weight:800;color:#E8A020">{high}</span> <span style="font-size:11px;color:#888">High</span></div>
        <div><span style="font-size:18px;font-weight:800;color:#F5F2EB">{total_violations}</span> <span style="font-size:11px;color:#888">Total</span></div>
      </div>
    </div>

    <!-- Run history -->
    <div style="background:#1a1c21;border:1px solid #2a2a2a;border-radius:8px;overflow:hidden;margin-bottom:24px">
      <div style="padding:14px 16px;border-bottom:1px solid #2a2a2a;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#888">Recent Runs</div>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#141618">
            <th style="padding:8px 12px;text-align:left;font-size:10px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.6px">Time</th>
            <th style="padding:8px 12px;text-align:left;font-size:10px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.6px">Gate</th>
            <th style="padding:8px 12px;text-align:left;font-size:10px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.6px">Readiness</th>
            <th style="padding:8px 12px;text-align:left;font-size:10px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.6px">Violations</th>
          </tr>
        </thead>
        <tbody>{rows or '<tr><td colspan="4" style="padding:16px;text-align:center;color:#555;font-size:12px">No runs this week</td></tr>'}</tbody>
      </table>
    </div>

    <!-- Footer -->
    <div style="text-align:center;font-size:11px;color:#444;padding-top:8px">
      DataSentinel · Weekly DQA Digest · <a href="#" style="color:#C0392B">Unsubscribe</a>
    </div>
  </div>
</body></html>"""


@router.get("/{project_id}")
def get_digest_config(
    project_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    proj = db.query(Project).filter(Project.id == project_id).first()
    if not proj:
        raise HTTPException(404, "Project not found")
    cfg = proj.config or {}
    return {
        "project_id": str(project_id),
        "digest_enabled": cfg.get("digest_enabled", False),
        "digest_email": cfg.get("digest_email", ""),
    }


@router.put("/{project_id}")
def update_digest_config(
    project_id: UUID,
    data: dict,
    db: Session = Depends(get_db),
    user=Depends(require_role("admin", "analyst")),
):
    proj = db.query(Project).filter(Project.id == project_id).first()
    if not proj:
        raise HTTPException(404, "Project not found")
    cfg = dict(proj.config or {})
    if "digest_enabled" in data:
        cfg["digest_enabled"] = bool(data["digest_enabled"])
    if "digest_email" in data:
        cfg["digest_email"] = str(data["digest_email"])
    proj.config = cfg
    db.commit()
    return {"ok": True, "digest_enabled": cfg.get("digest_enabled"), "digest_email": cfg.get("digest_email", "")}


@router.post("/{project_id}/send")
def send_digest(
    project_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_role("admin", "analyst")),
):
    """Send the weekly digest immediately (useful for testing + manual trigger)."""
    proj = db.query(Project).filter(Project.id == project_id).first()
    if not proj:
        raise HTTPException(404, "Project not found")

    cfg = proj.config or {}
    digest_email = cfg.get("digest_email", "")
    if not digest_email:
        raise HTTPException(400, "No digest_email configured for this project. Set it first.")

    # Collect last 7 days of runs
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    runs = (
        db.query(DQARun)
        .filter(
            DQARun.project_id == project_id,
            DQARun.triggered_at >= cutoff,
            DQARun.status == "completed",
        )
        .order_by(DQARun.triggered_at.asc())
        .limit(100)
        .all()
    )

    # Collect violations from those runs
    run_ids = [r.id for r in runs]
    violations = (
        db.query(DQAViolation)
        .filter(DQAViolation.run_id.in_(run_ids))
        .all()
        if run_ids else []
    )

    html = _build_digest_html(proj.name, runs, violations)
    from app.services.email import send_email
    sent = send_email(
        subject=f"📊 DataSentinel Weekly Digest — {proj.name}",
        body_html=html,
        to_emails=[e.strip() for e in digest_email.split(",") if e.strip()],
    )
    return {
        "ok": True,
        "sent": sent,
        "runs_included": len(runs),
        "violations_included": len(violations),
        "recipients": [e.strip() for e in digest_email.split(",") if e.strip()],
    }
