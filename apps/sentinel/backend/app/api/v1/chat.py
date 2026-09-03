"""
AI Chat endpoint — context-aware Q&A over project DQA data.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models import DQARun, DQAViolation, Project

router = APIRouter()


@router.post("/")
async def chat(data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    Answer a natural-language question about a project's DQA data.
    Body: { project_id, message, conversation_history (optional) }
    """
    from app.engines.ai.chat_agent import answer

    message = (data.get("message") or "").strip()
    if not message:
        raise HTTPException(400, "message is required")

    project_id_str = data.get("project_id")
    conversation_history = data.get("conversation_history", [])

    # Build project context from DB
    project = None
    if project_id_str:
        try:
            project = db.query(Project).filter(Project.id == project_id_str).first()
        except Exception:
            pass

    # Recent runs (last 10 completed)
    run_query = db.query(DQARun).filter(DQARun.status == "completed")
    if project_id_str:
        run_query = run_query.filter(DQARun.project_id == project_id_str)
    recent_runs = run_query.order_by(DQARun.triggered_at.desc()).limit(10).all()

    # Recent violations
    violation_summary: dict = {}
    if recent_runs:
        last_run = recent_runs[0]
        viols = db.query(DQAViolation).filter(DQAViolation.run_id == last_run.id).all()
        for v in viols:
            key = v.affected_field or "unknown"
            violation_summary[key] = violation_summary.get(key, 0) + 1

    # Build trend
    scores = [round((r.readiness_score or 0) * 100, 1) for r in reversed(recent_runs)]
    avg = round(sum(scores) / len(scores), 1) if scores else 0
    trend_dir = "improving" if len(scores) >= 2 and scores[-1] > scores[0] else "declining" if len(scores) >= 2 and scores[-1] < scores[0] else "stable"

    latest_run = recent_runs[0] if recent_runs else None

    project_context = {
        "project_name": project.name if project else "All Projects",
        "domain": project.domain if project else "co2_sequestration",
        "recent_runs": [
            {
                "id": str(r.id)[:8],
                "date": r.triggered_at.strftime("%b %d %H:%M") if r.triggered_at else "",
                "readiness": round((r.readiness_score or 0) * 100, 1),
                "violations": r.total_violations or 0,
                "gate_passed": r.gate_passed,
                "dimension_scores": {k: round(v * 100, 1) for k, v in (r.dimension_scores or {}).items()},
            }
            for r in recent_runs
        ],
        "top_violation_fields": sorted(violation_summary.items(), key=lambda x: x[1], reverse=True)[:10],
        "trend": {
            "7_run_avg": avg,
            "direction": trend_dir,
            "latest_readiness": scores[-1] if scores else 0,
            "run_count": len(recent_runs),
        },
        "latest_run_summary": {
            "readiness": round((latest_run.readiness_score or 0) * 100, 1) if latest_run else 0,
            "gate_passed": latest_run.gate_passed if latest_run else None,
            "violations": latest_run.total_violations if latest_run else 0,
            "rules_executed": latest_run.rules_executed if latest_run else 0,
        } if latest_run else {},
    }

    result = await answer(message, project_context, conversation_history)
    return result
