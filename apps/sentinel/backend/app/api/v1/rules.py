import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models import DQARule, ProjectMember
from app.schemas import RuleCreate, RuleOut, RuleUpdate

logger = logging.getLogger("datasentinel.rules")
router = APIRouter()

# Full CO₂ Sequestration rule set extracted from DQA_Rules.xlsx
CO2_RULES = [
    # Completeness
    {"rule_id":"C-01","rule_name":"missing_timestamps","dimension":"Completeness","what_it_checks":"Gaps in the expected timestamp sequence at defined frequency","severity":"critical","is_hard_gate":True,"weight":0.15,"parameters":{"frequency_minutes":2}},
    {"rule_id":"C-02","rule_name":"null_value_tags","dimension":"Completeness","what_it_checks":"Tags present in batch but value is null or empty","severity":"high","is_hard_gate":False,"weight":0.15,"parameters":{"null_threshold_pct":5}},
    {"rule_id":"C-03","rule_name":"critical_tag_absence","dimension":"Completeness","what_it_checks":"Mandatory tags entirely absent from the batch","severity":"critical","is_hard_gate":True,"weight":0.15,"parameters":{"mandatory_tags":["timestamp_utc","operational_state"]}},
    {"rule_id":"C-04","rule_name":"incomplete_batch","dimension":"Completeness","what_it_checks":"Batch row count materially below expected volume for the 2-hour window","severity":"medium","is_hard_gate":False,"weight":0.15,"parameters":{"expected_rows":60,"tolerance_pct":10}},
    # Integrity
    {"rule_id":"I-01","rule_name":"flatline_detection","dimension":"Integrity","what_it_checks":"Tag reading identical for consecutive window — configurable per tag type","severity":"high","is_hard_gate":False,"weight":0.20,"parameters":{"window_rows":5,"tolerance":0.001}},
    {"rule_id":"I-02","rule_name":"range_bounds_check","dimension":"Integrity","what_it_checks":"Reading outside physical plausibility range per tag","severity":"critical","is_hard_gate":False,"weight":0.20,"parameters":{"bounds":{"WHP_WELL_A_bar":{"min":0,"max":300},"WHP_WELL_B_bar":{"min":0,"max":300},"INJ_RATE_FT01_m3h":{"min":0,"max":500},"INJ_RATE_FT02_m3h":{"min":0,"max":500},"TEMP_SURF_01_degC":{"min":-10,"max":80},"TEMP_SURF_02_degC":{"min":-10,"max":80},"CO2_TRACER_01_ppm":{"min":0,"max":500},"WATER_FLOW_m3h":{"min":0,"max":100},"ENERGY_PER_TONNE_kWht":{"min":50,"max":400}}}},
    {"rule_id":"I-03","rule_name":"timestamp_sequence","dimension":"Integrity","what_it_checks":"Timestamps out of order or duplicated within batch","severity":"critical","is_hard_gate":True,"weight":0.20,"parameters":{}},
    {"rule_id":"I-04","rule_name":"spike_detection","dimension":"Integrity","what_it_checks":"Single-point deviation beyond configurable sigma from local mean","severity":"high","is_hard_gate":False,"weight":0.20,"parameters":{"sigma_threshold":4.0,"window_rows":10}},
    # Timeliness
    {"rule_id":"T-01","rule_name":"ingestion_latency_sla","dimension":"Timeliness","what_it_checks":"Time between data generation and ingestion exceeds SLA threshold","severity":"medium","is_hard_gate":False,"weight":0.10,"parameters":{"sla_threshold_seconds":300}},
    {"rule_id":"T-02","rule_name":"batch_arrival_regularity","dimension":"Timeliness","what_it_checks":"2-hour batch arrives materially late relative to expected schedule","severity":"low","is_hard_gate":False,"weight":0.10,"parameters":{"max_delay_minutes":30}},
    # Uniqueness
    {"rule_id":"U-01","rule_name":"duplicate_timestamp_tag","dimension":"Uniqueness","what_it_checks":"Identical timestamp appears more than once in batch","severity":"high","is_hard_gate":False,"weight":0.10,"parameters":{}},
    {"rule_id":"U-02","rule_name":"event_deduplication","dimension":"Uniqueness","what_it_checks":"Duplicate operational state transition events submitted more than once","severity":"medium","is_hard_gate":False,"weight":0.10,"parameters":{}},
    # Accuracy
    {"rule_id":"A-01","rule_name":"sensor_vs_calculated_totaliser","dimension":"Accuracy","what_it_checks":"Sensor totaliser vs integration of flowrate over same interval","severity":"critical","is_hard_gate":False,"weight":0.20,"parameters":{"tolerance_pct":2.0,"flowrate_col":"INJ_RATE_FT01_m3h","totaliser_col":"CO2_TOTAL_SENSOR_m3","freq_minutes":2}},
    {"rule_id":"A-02","rule_name":"co2_loading_vs_credit_note","dimension":"Accuracy","what_it_checks":"Sensor-derived CO₂ load-in volume vs credit note value","severity":"critical","is_hard_gate":False,"weight":0.20,"parameters":{"tolerance_pct":1.0}},
    {"rule_id":"A-03","rule_name":"operational_sheet_vs_sensor","dimension":"Accuracy","what_it_checks":"2-hour manual operational sheet entry vs sensor average","severity":"high","is_hard_gate":False,"weight":0.20,"parameters":{"tolerance_pct":5.0}},
    # Consistency
    {"rule_id":"CON-01","rule_name":"flowrate_cross_sensor_agreement","dimension":"Consistency","what_it_checks":"Two FT sensors on the same line — readings agree within tolerance","severity":"high","is_hard_gate":False,"weight":0.15,"parameters":{"tag_a":"INJ_RATE_FT01_m3h","tag_b":"INJ_RATE_FT02_m3h","tolerance_abs":5.0}},
    {"rule_id":"CON-02","rule_name":"flowrate_totaliser_integration","dimension":"Consistency","what_it_checks":"Rate of flowrate change consistent with totaliser increment","severity":"high","is_hard_gate":False,"weight":0.15,"parameters":{"tolerance_pct":3.0}},
    {"rule_id":"CON-03","rule_name":"energy_per_tonne_trend","dimension":"Consistency","what_it_checks":"Energy-per-tonne within expected statistical range of historical trend","severity":"medium","is_hard_gate":False,"weight":0.15,"parameters":{"sigma_threshold":3.0,"window_rows":30,"tag":"ENERGY_PER_TONNE_kWht"}},
    {"rule_id":"CON-04","rule_name":"water_co2_tracer_ratio","dimension":"Consistency","what_it_checks":"Ratio of water / CO₂ / tracer within expected physical bounds","severity":"high","is_hard_gate":False,"weight":0.15,"parameters":{"water_tag":"WATER_FLOW_m3h","co2_tag":"INJ_RATE_FT01_m3h","min_ratio":0.05,"max_ratio":0.6}},
    {"rule_id":"CON-05","rule_name":"pressure_temperature_correlation","dimension":"Consistency","what_it_checks":"Wellhead pressure and temperature move in expected directional relationship","severity":"medium","is_hard_gate":False,"weight":0.15,"parameters":{"pressure_tag":"WHP_WELL_A_bar","temperature_tag":"TEMP_SURF_01_degC","min_correlation":0.3}},
    {"rule_id":"CON-06","rule_name":"injection_rate_pressure_correlation","dimension":"Consistency","what_it_checks":"Injection rate and wellhead pressure positively correlated during active injection","severity":"high","is_hard_gate":False,"weight":0.15,"parameters":{"rate_tag":"INJ_RATE_FT01_m3h","pressure_tag":"WHP_WELL_A_bar","min_correlation":0.4}},
    {"rule_id":"CON-07","rule_name":"rolling_zscore_anomaly","dimension":"Consistency","what_it_checks":"Per-tag rolling z-score statistical outlier detection","severity":"medium","is_hard_gate":False,"weight":0.15,"parameters":{"sigma_threshold":3.0,"window_rows":20}},
    # Relevance
    {"rule_id":"REL-01","rule_name":"operational_state_filter","dimension":"Relevance","what_it_checks":"Exclude records during maintenance, idle, shutdown states","severity":"high","is_hard_gate":False,"weight":0.10,"parameters":{"state_column":"operational_state","exclude_states":["maintenance","idle","shutdown","excluded"]}},
    {"rule_id":"REL-02","rule_name":"maintenance_interval_exclusion","dimension":"Relevance","what_it_checks":"Records within defined window around maintenance event flagged as non-operational","severity":"medium","is_hard_gate":False,"weight":0.10,"parameters":{"buffer_rows":2}},
    {"rule_id":"REL-03","rule_name":"startup_transient_exclusion","dimension":"Relevance","what_it_checks":"Records immediately after state transition to active injection excluded during stabilisation","severity":"medium","is_hard_gate":False,"weight":0.10,"parameters":{"stabilisation_rows":3}},
    # Readiness
    {"rule_id":"READ-01","rule_name":"weighted_dimension_score","dimension":"Readiness","what_it_checks":"Weighted aggregate of all dimension scores","severity":"info","is_hard_gate":False,"weight":1.0,"parameters":{}},
    {"rule_id":"READ-02","rule_name":"critical_flag_gate","dimension":"Readiness","what_it_checks":"Hard block if any dimension carries a critical flag","severity":"critical","is_hard_gate":True,"weight":1.0,"parameters":{}},
    {"rule_id":"READ-03","rule_name":"minimum_data_coverage","dimension":"Readiness","what_it_checks":"Minimum percentage of expected timestamps must pass quality checks","severity":"critical","is_hard_gate":True,"weight":1.0,"parameters":{"min_coverage_pct":85}},
]

@router.get("/")
def list_rules(project_id: Optional[UUID] = None, dimension: Optional[str] = None,
               offset: int = 0, limit: int = 500,
               db: Session = Depends(get_db), user=Depends(get_current_user)):
    # F021: return standard envelope {items, total, offset, limit}
    from app.core.pagination import paginate_query
    role = getattr(user, "role", "analyst")
    q = db.query(DQARule)
    if project_id:
        q = q.filter(DQARule.project_id == project_id)
    elif role not in ("admin", "super_admin"):
        # Non-admin without project_id: restrict to projects the user belongs to
        user_project_ids = db.query(ProjectMember.project_id).filter(
            ProjectMember.user_id == user.id
        ).subquery()
        q = q.filter(DQARule.project_id.in_(user_project_ids))
    if dimension: q = q.filter(DQARule.dimension == dimension)
    q = q.order_by(DQARule.dimension, DQARule.rule_id)
    return paginate_query(q, offset=offset, limit=limit)

@router.post("/", response_model=RuleOut)
def create_rule(project_id: UUID, data: RuleCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rule = DQARule(**data.model_dump(), project_id=project_id, created_by=user.id)
    db.add(rule); db.commit(); db.refresh(rule)
    return rule

@router.post("/seed/{project_id}")
def seed_co2_rules(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    updated = 0; created = 0
    for r in CO2_RULES:
        existing = db.query(DQARule).filter(
            DQARule.project_id == project_id,
            DQARule.rule_id == r["rule_id"]
        ).first()
        if existing:
            # Update parameters to latest version
            existing.parameters = r.get("parameters", {})
            existing.severity = r.get("severity", existing.severity)
            existing.weight = r.get("weight", existing.weight)
            existing.is_hard_gate = r.get("is_hard_gate", existing.is_hard_gate)
            existing.is_active = True
            updated += 1
        else:
            rule = DQARule(**r, project_id=project_id, created_by=user.id)
            db.add(rule)
            created += 1
    db.commit()
    return {"message": f"Rules synced: {created} created, {updated} updated", "seeded": created + updated}

@router.post("/ai-gap-detect")
async def ai_gap_detect(data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    Detect rule coverage gaps using AI.
    Body: { project_id, dataset_id (optional) }
    Always returns 200 — never a bare 500 — so the frontend can display a
    meaningful message even when the LLM is unavailable or slow.
    """
    import asyncio
    import traceback as _tb
    from app.engines.ai.rule_gap_agent import detect_gaps
    from app.models import Dataset, Project

    def _fallback(msg: str, timed_out: bool = False) -> dict:
        return {
            "gaps_found": [], "coverage_score": None,
            "summary": msg, "priority_action": "",
            "timed_out": timed_out,
        }

    try:
        project_id = data.get("project_id")
        dataset_id = data.get("dataset_id")
        if not project_id:
            raise HTTPException(400, "project_id is required")

        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise HTTPException(404, "Project not found")

        active_rules = db.query(DQARule).filter(
            DQARule.project_id == project_id, DQARule.is_active == True
        ).all()

        rules_dicts = [
            {"rule_id": r.rule_id, "rule_name": r.rule_name, "dimension": r.dimension,
             "severity": r.severity, "parameters": r.parameters or {}}
            for r in active_rules
        ]
        # Cap at 20 rules to keep the LLM prompt manageable and avoid 504s.
        # Gap analysis on the top 20 (sorted by severity) is still meaningful.
        SEV_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
        rules_dicts = sorted(rules_dicts, key=lambda r: SEV_ORDER.get(r.get("severity","info"), 9))[:20]

        # Get columns from the most recent dataset or specified one
        columns_meta: list = []
        if dataset_id:
            ds = db.query(Dataset).filter(Dataset.id == dataset_id).first()
            if ds:
                columns_meta = ds.columns_meta or []
        else:
            from app.models import DQARun
            last_run = (
                db.query(DQARun)
                .filter(DQARun.project_id == project_id, DQARun.status == "completed")
                .order_by(DQARun.triggered_at.desc())
                .first()
            )
            if last_run:
                ds = db.query(Dataset).filter(Dataset.id == last_run.dataset_id).first()
                if ds:
                    columns_meta = ds.columns_meta or []

        # Hard 40 s cap — guarantees response well before ALB 60 s idle timeout.
        # With 32 rules the prompt was large enough to cause 504s at 50 s.
        # Rules are already capped to 20 above to keep the prompt manageable.
        try:
            result = await asyncio.wait_for(
                detect_gaps(
                    columns=columns_meta,
                    active_rules=rules_dicts,
                    domain=project.domain or "general",
                    project_name=project.name,
                ),
                timeout=40,
            )
        except (asyncio.TimeoutError, TimeoutError):
            result = _fallback(
                "AI gap analysis timed out — the LLM took too long to respond. "
                "Please try again in a moment.", timed_out=True
            )
        except asyncio.CancelledError:
            result = _fallback(
                "AI gap analysis was cancelled due to timeout. Please try again.", timed_out=True
            )
        except Exception as ai_err:
            logger.warning("detect_gaps raised: %s", ai_err)
            result = _fallback(f"AI gap analysis failed: {type(ai_err).__name__}: {str(ai_err)[:200]}")

        return result

    except HTTPException:
        raise   # let 400/404 propagate normally
    except Exception as exc:
        logger.error("ai_gap_detect unexpected error: %s\n%s", exc, _tb.format_exc())
        # Return a structured 200 with an error message rather than a bare 500
        # so the UI can display something useful instead of a generic crash.
        return _fallback(f"Gap detection error: {type(exc).__name__}: {str(exc)[:300]}")


@router.post("/nl-build")
async def nl_build_rule(data: dict, db: Session = Depends(get_db),
                        user=Depends(get_current_user)):
    """Generate a DQA rule JSON from a plain-English description using AI."""
    description = (data.get("description") or "").strip()
    if not description:
        raise HTTPException(400, "description is required")

    import re

    from app.engines.ai.claude_client import call_claude_json

    SYSTEM = (
        "You are a DQA rule engineering expert for CO₂ sequestration and biochar sensor pipelines. "
        "Convert natural language rule descriptions into precise DataSentinel DQA rule configurations. "
        "Respond with VALID JSON ONLY — no markdown fences, no text outside the JSON object."
    )
    USER = f"""Convert this description into a DQA rule JSON:
"{description}"

Return exactly this structure:
{{
  "rule_id": "CUSTOM-01",
  "rule_name": "snake_case_name",
  "dimension": "<one of: Completeness|Integrity|Timeliness|Uniqueness|Accuracy|Consistency|Relevance|Readiness>",
  "what_it_checks": "<one clear sentence>",
  "severity": "<critical|high|medium|low>",
  "is_hard_gate": false,
  "weight": 0.15,
  "parameters": {{}},
  "explanation": "<one sentence on how the rule fires>"
}}

Dimension guide:
- Completeness: missing/null values, timestamp gaps, incomplete batches
- Integrity: impossible readings, spikes (MAD/z-score), flatlines, out-of-range
- Timeliness: late data, SLA breaches, delayed batches
- Uniqueness: duplicate rows, repeated events
- Accuracy: sensor vs calculated comparison, cross-reference discrepancy
- Consistency: cross-sensor agreement, correlation, ratio checks
- Relevance: operational-state filtering, maintenance exclusion

Common parameter keys: sigma_threshold, window_rows, tolerance_pct, bounds (dict),
tag, tag_a, tag_b, min_ratio, max_ratio, sla_threshold_seconds, expected_rows, mandatory_tags (list).
"""
    result = await call_claude_json(SYSTEM, USER, max_tokens=600)

    if result:
        return {"success": True, "fallback": False, "rule": result}

    # ── Keyword fallback when LLM is not configured ───────────────────────────
    desc_lower = description.lower()
    dim = "Integrity"
    sev = "medium"
    for kw in ("missing", "null", "absent", "gap", "incomplete"):
        if kw in desc_lower:
            dim = "Completeness"; break
    for kw in ("duplicate", "repeated", "dedup"):
        if kw in desc_lower:
            dim = "Uniqueness"; break
    for kw in ("late", "delay", "sla", "latency"):
        if kw in desc_lower:
            dim = "Timeliness"; break
    for kw in ("agree", "match", "ratio", "correlat", "cross"):
        if kw in desc_lower:
            dim = "Consistency"; break
    if any(kw in desc_lower for kw in ("critical", "block", "gate", "hard")):
        sev = "critical"
    elif any(kw in desc_lower for kw in ("high", "urgent")):
        sev = "high"

    name = re.sub(r"[^a-z0-9]+", "_", desc_lower)[:40].strip("_") or "custom_rule"
    return {
        "success": False,
        "fallback": True,
        "rule": {
            "rule_id": "CUSTOM-01",
            "rule_name": name,
            "dimension": dim,
            "what_it_checks": description,
            "severity": sev,
            "is_hard_gate": False,
            "weight": 0.10,
            "parameters": {},
            "explanation": "Keyword-inferred — configure an LLM_PROVIDER + API key for AI-generated rules.",
        },
    }


@router.post("/from-violation/{violation_id}")
def create_rule_from_violation(
    violation_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """B1-#8: Draft a new DQA rule pre-populated from a violation's context.
    Creates the rule in the same project as the violation's run.
    Returns the created rule so the frontend can navigate to edit it.
    """
    import re

    from app.models import DQARun, DQAViolation

    v = db.query(DQAViolation).filter(DQAViolation.id == violation_id).first()
    if not v:
        raise HTTPException(404, "Violation not found")

    run = db.query(DQARun).filter(DQARun.id == v.run_id).first()
    if not run:
        raise HTTPException(404, "Associated run not found")

    # Build a sensible rule_id that won't collide with seeded rules
    safe_name = re.sub(r"[^a-z0-9]+", "_", (v.rule_name or "custom").lower())[:20].strip("_")
    base_id = f"CUSTOM-{safe_name[:12].upper()}"
    # Make unique — append a suffix if already exists
    existing_ids = {
        r.rule_id for r in db.query(DQARule.rule_id)
        .filter(DQARule.project_id == run.project_id).all()
    }
    rule_id = base_id
    suffix = 1
    while rule_id in existing_ids:
        rule_id = f"{base_id}-{suffix}"
        suffix += 1

    rule = DQARule(
        project_id=run.project_id,
        rule_id=rule_id,
        rule_name=f"custom_{v.rule_name or 'rule'}",
        dimension=v.dimension,
        description=f"Rule created from violation {str(v.id)[:8]} — {v.rule_name}",
        what_it_checks=f"Checks for {v.rule_name} issues in {v.affected_field or 'the dataset'}",
        severity=v.severity,
        is_hard_gate=False,
        weight=0.10,
        parameters={"source_violation_id": str(v.id)},
        is_active=True,
        created_by=user.id,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return {
        "id": str(rule.id),
        "rule_id": rule.rule_id,
        "rule_name": rule.rule_name,
        "dimension": rule.dimension,
        "severity": rule.severity,
        "project_id": str(rule.project_id),
        "message": f"Rule '{rule.rule_id}' created — edit it in the Rule Manager.",
    }


@router.get("/{rule_id_path}", response_model=RuleOut)
def get_rule(rule_id_path: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    r = db.query(DQARule).filter(DQARule.id == rule_id_path).first()
    if not r: raise HTTPException(404, "Rule not found")
    return r

@router.patch("/{rule_id_path}", response_model=RuleOut)
def update_rule(rule_id_path: UUID, data: RuleUpdate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    r = db.query(DQARule).filter(DQARule.id == rule_id_path).first()
    if not r: raise HTTPException(404, "Rule not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(r, k, v)
    db.commit(); db.refresh(r)
    return r

@router.delete("/{rule_id_path}")
def deactivate_rule(rule_id_path: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    # Only admins and analysts can deactivate rules
    if user.role not in ("admin", "analyst"):
        raise HTTPException(403, "Insufficient permissions — analyst or admin role required")
    r = db.query(DQARule).filter(DQARule.id == rule_id_path).first()
    if not r: raise HTTPException(404, "Rule not found")
    r.is_active = False; db.commit()
    return {"message": "Rule deactivated"}
