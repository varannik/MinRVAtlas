"""
Rule Studio API — unified detection + correction pair management.

Each "pair" is a DQARule (detection side) linked to a CorrectionRule
(correction side) via CorrectionRule.target_dqa_rule_id.

Endpoints:
  GET  /pairs/{project_id}          — list all pairs for a project
  POST /pairs                       — create a pair (standard/ai/manual)
  PATCH /pairs/{pair_id}            — update a pair
  DELETE /pairs/{pair_id}           — delete both sides
  POST /ai-generate                 — AI generate a complete pair
  POST /pairs/{pair_id}/test        — test against last dataset
  GET  /standard-library            — static library of standard pairs
"""
import logging
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models import CorrectionRule, DQARule, Project

logger = logging.getLogger("datasentinel.rule_studio")
router = APIRouter()


# ── Standard library ──────────────────────────────────────────────────────────

STANDARD_LIBRARY: List[Dict[str, Any]] = [
    {
        "id": "STD-A01",
        "category": "Accuracy",
        "detection": {
            "rule_id": "A-01", "rule_name": "sensor_vs_calculated_totaliser",
            "dimension": "Accuracy", "severity": "critical", "is_hard_gate": False,
            "weight": 0.20,
            "description": "Sensor totaliser vs integration of flowrate over same interval",
            "parameters": {"tag_a": "TOTALISER_TAG", "tag_b": "FLOWRATE_TAG", "tolerance_pct": 5},
        },
        "correction": {
            "name": "forward_fill_from_primary_sensor",
            "correction_type": "fill",
            "description": "Forward-fill totaliser from primary sensor when deviation exceeds threshold",
            "correction_logic": {"method": "forward_fill", "source": "primary_sensor"},
            "auto_apply_threshold": 0,
            "auto_apply_severity_max": "none",
        },
    },
    {
        "id": "STD-A02",
        "category": "Accuracy",
        "detection": {
            "rule_id": "A-02", "rule_name": "co2_loading_vs_credit_note",
            "dimension": "Accuracy", "severity": "critical", "is_hard_gate": False,
            "weight": 0.20,
            "description": "Sensor-derived CO₂ load-in volume vs credit note value",
            "parameters": {"tag": "CO2_LOADING_TAG", "tolerance_pct": 5},
        },
        "correction": {
            "name": "manual_review_co2_loading",
            "correction_type": "flag",
            "description": "Flag for manual review — CO₂ credit values require human sign-off",
            "correction_logic": {"method": "flag", "action": "manual_review"},
            "auto_apply_threshold": 0,
            "auto_apply_severity_max": "none",
        },
    },
    {
        "id": "STD-C01",
        "category": "Completeness",
        "detection": {
            "rule_id": "C-01", "rule_name": "missing_timestamps",
            "dimension": "Completeness", "severity": "critical", "is_hard_gate": True,
            "weight": 0.15,
            "description": "Gaps in the expected timestamp sequence at defined frequency",
            "parameters": {"expected_freq_minutes": 120},
        },
        "correction": {
            "name": "linear_interpolation",
            "correction_type": "interpolate",
            "description": "Linear interpolation for gaps up to 4 hours; flag longer gaps",
            "correction_logic": {"method": "linear", "max_gap_hours": 4},
            "auto_apply_threshold": 85,
            "auto_apply_severity_max": "medium",
        },
    },
    {
        "id": "STD-C02",
        "category": "Completeness",
        "detection": {
            "rule_id": "C-02", "rule_name": "null_value_tags",
            "dimension": "Completeness", "severity": "high", "is_hard_gate": False,
            "weight": 0.15,
            "description": "Tags present in batch but value is null or empty",
            "parameters": {"mandatory_tags": []},
        },
        "correction": {
            "name": "median_imputation",
            "correction_type": "impute",
            "description": "Replace nulls with rolling 24-hour median",
            "correction_logic": {"method": "median", "window_hours": 24},
            "auto_apply_threshold": 80,
            "auto_apply_severity_max": "medium",
        },
    },
    {
        "id": "STD-C03",
        "category": "Completeness",
        "detection": {
            "rule_id": "C-03", "rule_name": "critical_tag_absence",
            "dimension": "Completeness", "severity": "critical", "is_hard_gate": True,
            "weight": 0.15,
            "description": "Mandatory tags entirely absent from the batch",
            "parameters": {"mandatory_tags": []},
        },
        "correction": {
            "name": "flag_missing_critical_tag",
            "correction_type": "flag",
            "description": "Flag batch — critical tag absence cannot be auto-corrected",
            "correction_logic": {"method": "flag", "action": "block_run"},
            "auto_apply_threshold": 0,
            "auto_apply_severity_max": "none",
        },
    },
    {
        "id": "STD-I01",
        "category": "Integrity",
        "detection": {
            "rule_id": "I-01", "rule_name": "rate_of_change_spike",
            "dimension": "Integrity", "severity": "high", "is_hard_gate": False,
            "weight": 0.10,
            "description": "Rate-of-change exceeds physically plausible limits",
            "parameters": {"rate_tag": "RATE_TAG", "max_rate_per_hour": 100},
        },
        "correction": {
            "name": "rolling_average_smooth",
            "correction_type": "smooth",
            "description": "Replace spike with 3-point rolling average",
            "correction_logic": {"method": "rolling_mean", "window": 3},
            "auto_apply_threshold": 85,
            "auto_apply_severity_max": "high",
        },
    },
    {
        "id": "STD-I02",
        "category": "Integrity",
        "detection": {
            "rule_id": "I-02", "rule_name": "range_bounds_violation",
            "dimension": "Integrity", "severity": "high", "is_hard_gate": False,
            "weight": 0.10,
            "description": "Sensor reading outside physically plausible min/max bounds",
            "parameters": {"tag": "SENSOR_TAG", "min_val": 0, "max_val": 1000},
        },
        "correction": {
            "name": "clamp_to_bounds",
            "correction_type": "clamp",
            "description": "Clamp value to valid range and flag for review",
            "correction_logic": {"method": "clamp", "flag": True},
            "auto_apply_threshold": 90,
            "auto_apply_severity_max": "medium",
        },
    },
    {
        "id": "STD-CON01",
        "category": "Consistency",
        "detection": {
            "rule_id": "CON-01", "rule_name": "cross_sensor_consistency",
            "dimension": "Consistency", "severity": "high", "is_hard_gate": False,
            "weight": 0.10,
            "description": "Two sensors measuring the same physical quantity diverge",
            "parameters": {"tag_a": "PRIMARY_TAG", "tag_b": "BACKUP_TAG", "tolerance_pct": 10},
        },
        "correction": {
            "name": "use_primary_sensor",
            "correction_type": "substitute",
            "description": "Substitute divergent reading with primary sensor value",
            "correction_logic": {"method": "substitute", "source": "tag_a"},
            "auto_apply_threshold": 80,
            "auto_apply_severity_max": "medium",
        },
    },
    {
        "id": "STD-R01",
        "category": "Reliability",
        "detection": {
            "rule_id": "R-01", "rule_name": "duplicate_records",
            "dimension": "Reliability", "severity": "medium", "is_hard_gate": False,
            "weight": 0.05,
            "description": "Exact duplicate rows in the dataset",
            "parameters": {"key_columns": ["timestamp_utc"]},
        },
        "correction": {
            "name": "remove_duplicates",
            "correction_type": "deduplicate",
            "description": "Keep first occurrence; remove exact duplicates",
            "correction_logic": {"method": "keep_first"},
            "auto_apply_threshold": 95,
            "auto_apply_severity_max": "high",
        },
    },
    {
        "id": "STD-R02",
        "category": "Reliability",
        "detection": {
            "rule_id": "R-02", "rule_name": "frozen_sensor",
            "dimension": "Reliability", "severity": "high", "is_hard_gate": False,
            "weight": 0.10,
            "description": "Sensor reports identical value for more than N consecutive readings",
            "parameters": {"tag": "SENSOR_TAG", "max_repeats": 5},
        },
        "correction": {
            "name": "flag_frozen_sensor",
            "correction_type": "flag",
            "description": "Flag frozen period — likely sensor fault requiring manual investigation",
            "correction_logic": {"method": "flag", "action": "manual_review"},
            "auto_apply_threshold": 0,
            "auto_apply_severity_max": "none",
        },
    },
]


@router.get("/standard-library")
def get_standard_library():
    return STANDARD_LIBRARY


# ── Default correction map ────────────────────────────────────────────────────
# Maps any known rule_id prefix/pattern to a default correction.
# Used by auto-pair to fill in corrections for existing unpaired rules.
DEFAULT_CORRECTIONS: Dict[str, Dict[str, Any]] = {
    # Accuracy
    "A-01": {"name": "forward_fill_from_primary_sensor",       "correction_type": "fill",        "description": "Forward-fill totaliser from primary sensor when deviation exceeds tolerance",       "correction_logic": {"method": "forward_fill", "source": "primary_sensor"},          "auto_apply_threshold": 0,  "auto_apply_severity_max": "none"},
    "A-02": {"name": "manual_review_co2_credit",               "correction_type": "flag",        "description": "Flag for manual review — CO₂ credit values require human sign-off",                  "correction_logic": {"method": "flag", "action": "manual_review"},                    "auto_apply_threshold": 0,  "auto_apply_severity_max": "none"},
    "A-03": {"name": "flag_operational_sheet_mismatch",        "correction_type": "flag",        "description": "Flag mismatch between operational sheet entry and sensor reading for investigation", "correction_logic": {"method": "flag", "action": "manual_review"},                    "auto_apply_threshold": 0,  "auto_apply_severity_max": "none"},
    # Completeness
    "C-01": {"name": "linear_interpolation_timestamps",        "correction_type": "interpolate", "description": "Linear interpolation for timestamp gaps up to 4 hours; flag longer gaps",           "correction_logic": {"method": "linear", "max_gap_hours": 4},                         "auto_apply_threshold": 85, "auto_apply_severity_max": "medium"},
    "C-02": {"name": "median_imputation_null_tags",            "correction_type": "impute",      "description": "Replace null tag values with rolling 24-hour median",                                "correction_logic": {"method": "median", "window_hours": 24},                         "auto_apply_threshold": 80, "auto_apply_severity_max": "medium"},
    "C-03": {"name": "block_on_critical_tag_absence",          "correction_type": "flag",        "description": "Block DQA run — critical tag entirely absent cannot be auto-corrected",              "correction_logic": {"method": "flag", "action": "block_run"},                        "auto_apply_threshold": 0,  "auto_apply_severity_max": "none"},
    "C-04": {"name": "flag_incomplete_batch",                  "correction_type": "flag",        "description": "Flag incomplete batch for investigation before processing",                          "correction_logic": {"method": "flag", "action": "manual_review"},                    "auto_apply_threshold": 0,  "auto_apply_severity_max": "none"},
    "C-05": {"name": "forward_fill_missing_values",            "correction_type": "fill",        "description": "Forward-fill missing field values from last known good reading",                    "correction_logic": {"method": "forward_fill"},                                        "auto_apply_threshold": 80, "auto_apply_severity_max": "medium"},
    # Consistency
    "CON-01": {"name": "use_primary_sensor_flowrate",          "correction_type": "substitute",  "description": "Substitute divergent reading with primary sensor value",                             "correction_logic": {"method": "substitute", "source": "tag_a"},                      "auto_apply_threshold": 80, "auto_apply_severity_max": "medium"},
    "CON-02": {"name": "use_primary_sensor_totaliser",         "correction_type": "substitute",  "description": "Use primary totaliser when integration diverges from sensor",                       "correction_logic": {"method": "substitute", "source": "tag_a"},                      "auto_apply_threshold": 80, "auto_apply_severity_max": "medium"},
    "CON-03": {"name": "flag_cross_sensor_inconsistency",      "correction_type": "flag",        "description": "Flag cross-sensor inconsistency for manual investigation",                           "correction_logic": {"method": "flag", "action": "manual_review"},                    "auto_apply_threshold": 0,  "auto_apply_severity_max": "none"},
    # Integrity
    "I-01": {"name": "clamp_range_violation",                  "correction_type": "clamp",       "description": "Clamp value to valid physical bounds and flag for review",                          "correction_logic": {"method": "clamp", "flag": True},                                "auto_apply_threshold": 90, "auto_apply_severity_max": "medium"},
    "I-02": {"name": "smooth_rate_of_change_spike",            "correction_type": "smooth",      "description": "Replace rate-of-change spike with 3-point rolling average",                        "correction_logic": {"method": "rolling_mean", "window": 3},                          "auto_apply_threshold": 85, "auto_apply_severity_max": "high"},
    "I-03": {"name": "flag_physical_impossibility",            "correction_type": "flag",        "description": "Flag physically impossible value for manual correction",                             "correction_logic": {"method": "flag", "action": "manual_review"},                    "auto_apply_threshold": 0,  "auto_apply_severity_max": "none"},
    # Reliability
    "R-01": {"name": "remove_exact_duplicates",                "correction_type": "deduplicate", "description": "Keep first occurrence; remove exact duplicate rows",                                "correction_logic": {"method": "keep_first"},                                          "auto_apply_threshold": 95, "auto_apply_severity_max": "high"},
    "R-02": {"name": "flag_frozen_sensor",                     "correction_type": "flag",        "description": "Flag frozen sensor period — likely hardware fault requiring investigation",          "correction_logic": {"method": "flag", "action": "manual_review"},                    "auto_apply_threshold": 0,  "auto_apply_severity_max": "none"},
    "R-03": {"name": "flag_sensor_dropout",                    "correction_type": "flag",        "description": "Flag sensor dropout period for manual investigation",                               "correction_logic": {"method": "flag", "action": "manual_review"},                    "auto_apply_threshold": 0,  "auto_apply_severity_max": "none"},
    # Readability
    "READ-01": {"name": "standardise_units",                   "correction_type": "transform",   "description": "Convert to standard SI units automatically",                                        "correction_logic": {"method": "unit_convert"},                                        "auto_apply_threshold": 95, "auto_apply_severity_max": "high"},
    "READ-02": {"name": "normalise_column_names",              "correction_type": "transform",   "description": "Normalise column names to snake_case standard",                                     "correction_logic": {"method": "rename_columns"},                                      "auto_apply_threshold": 95, "auto_apply_severity_max": "high"},
}

def _get_default_correction(rule_id: str) -> Dict[str, Any]:
    """
    Return the default correction for a known rule_id.
    Falls back to a generic 'flag for manual review' if rule not in map.
    Matches by prefix (e.g. 'A-01' matches 'A-01-CUSTOM').
    """
    # Exact match first
    if rule_id in DEFAULT_CORRECTIONS:
        return DEFAULT_CORRECTIONS[rule_id]
    # Prefix match
    for key, val in DEFAULT_CORRECTIONS.items():
        if rule_id.startswith(key):
            return val
    # Generic fallback
    return {
        "name":                   f"flag_{rule_id.lower().replace('-','_')}",
        "correction_type":        "flag",
        "description":            "Flag violation for manual review",
        "correction_logic":       {"method": "flag", "action": "manual_review"},
        "auto_apply_threshold":   0,
        "auto_apply_severity_max": "none",
    }


@router.post("/auto-pair/{project_id}")
def auto_pair_project(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    Auto-pair all unpaired detection rules with their default correction strategy.
    Safe to call multiple times — skips rules that already have a correction.
    Returns: {paired: N, skipped: N}
    """
    rules = db.query(DQARule).filter(DQARule.project_id == project_id).all()
    existing_corrections = db.query(CorrectionRule).filter(CorrectionRule.project_id == project_id).all()
    already_paired = {c.target_dqa_rule_id for c in existing_corrections}

    paired = 0
    skipped = 0

    for rule in rules:
        if rule.rule_id in already_paired:
            skipped += 1
            continue

        defaults = _get_default_correction(rule.rule_id)
        correction = CorrectionRule(
            project_id=project_id,
            name=defaults["name"],
            target_dqa_rule_id=rule.rule_id,
            correction_type=defaults["correction_type"],
            correction_logic=defaults["correction_logic"],
            is_active=True,
            created_by=user.id,
        )
        for col, val in [
            ("description",             defaults["description"]),
            ("auto_apply_threshold",    defaults["auto_apply_threshold"]),
            ("auto_apply_severity_max", defaults["auto_apply_severity_max"]),
            ("pair_type",               "standard"),
        ]:
            try:
                setattr(correction, col, val)
            except Exception:
                pass

        db.add(correction)
        paired += 1

    db.commit()
    return {"paired": paired, "skipped": skipped, "total": len(rules)}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _pair_out(rule: DQARule, corr: Optional[CorrectionRule]) -> Dict[str, Any]:
    auto_rate = 0
    if corr and (corr.auto_applied_count or 0) + (corr.rejected_count or 0) > 0:
        total = (corr.auto_applied_count or 0) + (corr.rejected_count or 0)
        auto_rate = round((corr.auto_applied_count or 0) / total * 100)

    return {
        "rule_uuid":      str(rule.id),
        "rule_id":        rule.rule_id,
        "rule_name":      rule.rule_name,
        "dimension":      rule.dimension,
        "severity":       rule.severity,
        "is_hard_gate":   rule.is_hard_gate,
        "weight":         rule.weight,
        "description":    rule.description,
        "parameters":     rule.parameters or {},
        "rule_active":    rule.is_active,
        "created_at":     rule.created_at.isoformat() if rule.created_at else None,
        "correction": {
            "id":                      str(corr.id) if corr else None,
            "name":                    corr.name if corr else None,
            "correction_type":         corr.correction_type if corr else None,
            "description":             getattr(corr, "description", None) if corr else None,
            "correction_logic":        corr.correction_logic if corr else {},
            "auto_apply_threshold":    getattr(corr, "auto_apply_threshold", 80) if corr else 80,
            "auto_apply_severity_max": getattr(corr, "auto_apply_severity_max", "medium") if corr else "medium",
            "pair_type":               getattr(corr, "pair_type", "standard") if corr else None,
            "correction_active":       corr.is_active if corr else False,
            "violation_count":         getattr(corr, "violation_count", 0) if corr else 0,
            "auto_applied_count":      getattr(corr, "auto_applied_count", 0) if corr else 0,
            "rejected_count":          getattr(corr, "rejected_count", 0) if corr else 0,
            "auto_fix_rate_pct":       auto_rate,
        } if corr else None,
    }


# ── Pairs list ────────────────────────────────────────────────────────────────

@router.get("/pairs/{project_id}")
def list_pairs(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rules = db.query(DQARule).filter(DQARule.project_id == project_id).order_by(DQARule.dimension, DQARule.rule_id).all()
    corrections = db.query(CorrectionRule).filter(CorrectionRule.project_id == project_id).all()
    corr_map = {c.target_dqa_rule_id: c for c in corrections}
    return [_pair_out(r, corr_map.get(r.rule_id)) for r in rules]


# ── Create pair ───────────────────────────────────────────────────────────────

@router.post("/pairs")
def create_pair(data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    Create a detection + correction pair.
    Body: { project_id, detection: {...}, correction: {...}, pair_type: standard|ai|manual }
    """
    project_id = data.get("project_id")
    if not project_id:
        raise HTTPException(400, "project_id is required")

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")

    det  = data.get("detection", {})
    corr = data.get("correction", {})
    pair_type = data.get("pair_type", "manual")

    rule = DQARule(
        project_id=project_id,
        rule_id=det.get("rule_id", "CUST-01"),
        rule_name=det.get("rule_name", "custom_rule"),
        dimension=det.get("dimension", "Integrity"),
        description=det.get("description", ""),
        severity=det.get("severity", "medium"),
        is_hard_gate=det.get("is_hard_gate", False),
        weight=det.get("weight", 0.10),
        parameters=det.get("parameters", {}),
        is_active=True,
        created_by=user.id,
    )
    db.add(rule); db.flush()

    if corr:
        correction = CorrectionRule(
            project_id=project_id,
            name=corr.get("name", f"correction_for_{rule.rule_id}"),
            target_dqa_rule_id=rule.rule_id,
            correction_type=corr.get("correction_type", "flag"),
            correction_logic=corr.get("correction_logic", {}),
            is_active=True,
            created_by=user.id,
        )
        # Rule Studio columns (guard for older DB)
        for col, default in [
            ("description", corr.get("description")),
            ("auto_apply_threshold", corr.get("auto_apply_threshold", 80)),
            ("auto_apply_severity_max", corr.get("auto_apply_severity_max", "medium")),
            ("pair_type", pair_type),
        ]:
            try:
                setattr(correction, col, default)
            except Exception:
                pass
        db.add(correction)

    db.commit()
    db.refresh(rule)
    corr_obj = db.query(CorrectionRule).filter(CorrectionRule.project_id == project_id, CorrectionRule.target_dqa_rule_id == rule.rule_id).first()
    return _pair_out(rule, corr_obj)


# ── Update pair ───────────────────────────────────────────────────────────────

@router.patch("/pairs/{rule_uuid}")
def update_pair(rule_uuid: UUID, data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rule = db.query(DQARule).filter(DQARule.id == rule_uuid).first()
    if not rule:
        raise HTTPException(404, "Rule not found")

    det  = data.get("detection", {})
    corr = data.get("correction", {})

    for field in ["rule_name", "dimension", "severity", "description", "weight", "parameters", "is_hard_gate", "is_active"]:
        if field in det:
            setattr(rule, field, det[field])

    corr_obj = db.query(CorrectionRule).filter(CorrectionRule.project_id == rule.project_id, CorrectionRule.target_dqa_rule_id == rule.rule_id).first()
    if corr_obj and corr:
        for field in ["name", "correction_type", "correction_logic", "is_active"]:
            if field in corr:
                setattr(corr_obj, field, corr[field])
        for field in ["description", "auto_apply_threshold", "auto_apply_severity_max"]:
            if field in corr:
                try:
                    setattr(corr_obj, field, corr[field])
                except Exception:
                    pass

    db.commit()
    return _pair_out(rule, corr_obj)


# ── Delete pair ───────────────────────────────────────────────────────────────

@router.patch("/corrections/{correction_uuid}/active")
def toggle_correction_active(
    correction_uuid: UUID,
    data: dict,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Toggle a correction rule's is_active flag by its own UUID.
    Avoids ambiguity when multiple corrections share the same target_dqa_rule_id.
    Body: { is_active: bool }
    """
    corr = db.query(CorrectionRule).filter(CorrectionRule.id == correction_uuid).first()
    if not corr:
        raise HTTPException(404, "Correction rule not found")
    corr.is_active = bool(data.get("is_active", True))
    db.commit()
    return {"id": str(corr.id), "is_active": corr.is_active}


@router.delete("/pairs/{rule_uuid}")
def delete_pair(rule_uuid: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rule = db.query(DQARule).filter(DQARule.id == rule_uuid).first()
    if not rule:
        raise HTTPException(404, "Rule not found")
    corr_obj = db.query(CorrectionRule).filter(CorrectionRule.project_id == rule.project_id, CorrectionRule.target_dqa_rule_id == rule.rule_id).first()
    if corr_obj:
        db.delete(corr_obj)
    db.delete(rule)
    db.commit()
    return {"message": "Pair deleted"}


# ── AI Generate pair ──────────────────────────────────────────────────────────

# ── Parameter / logic templates (Auto mode) ───────────────────────────────────

DETECTION_TEMPLATES: Dict[str, Dict[str, Any]] = {
    "sensor_vs_calculated":    {"tag_a": "",  "tag_b": "",  "tolerance_pct": 5},
    "cross_sensor":            {"tag_a": "",  "tag_b": "",  "tolerance_pct": 10},
    "flowrate_totaliser":      {"flowrate_col": "", "totaliser_col": "", "interval_hours": 2},
    "missing_timestamps":      {"expected_freq_minutes": 120},
    "timestamp_gap":           {"expected_freq_minutes": 120, "max_gap_hours": 4},
    "null_value":              {"mandatory_tags": []},
    "critical_tag_absence":    {"mandatory_tags": []},
    "range_bounds":            {"tag": "", "min_val": 0, "max_val": 1000},
    "rate_of_change":          {"rate_tag": "", "max_rate_per_hour": 100},
    "frozen_sensor":           {"tag": "", "max_repeats": 5},
    "duplicate":               {"key_columns": ["timestamp_utc"]},
    "co2_loading":             {"tag": "", "credit_note_col": "", "tolerance_pct": 5},
    "operational_sheet":       {"sensor_tag": "", "sheet_col": "", "tolerance_pct": 15},
    "completeness":            {"required_cols": []},
    "generic":                 {"tag": "", "threshold": 0},
}

CORRECTION_TEMPLATES: Dict[str, Dict[str, Any]] = {
    "fill":        {"method": "forward_fill", "source": "primary_sensor", "max_gap_hours": 4},
    "interpolate": {"method": "linear", "max_gap_hours": 4},
    "clamp":       {"method": "clamp", "min_val": None, "max_val": None, "flag": True},
    "smooth":      {"method": "rolling_mean", "window": 3, "min_periods": 1},
    "substitute":  {"method": "substitute", "source": "tag_a"},
    "flag":        {"method": "flag", "action": "manual_review"},
    "impute":      {"method": "median", "window_hours": 24},
    "deduplicate": {"method": "keep_first", "key_columns": ["timestamp_utc"]},
    "transform":   {"method": "unit_convert", "factor": 1.0, "offset": 0.0},
}


def _detection_template(rule_name: str) -> Dict[str, Any]:
    """Return the best-matching detection parameter template for a rule name."""
    name_lower = (rule_name or "").lower().replace("-", "_")
    for key, tpl in DETECTION_TEMPLATES.items():
        if key in name_lower:
            return dict(tpl)
    return dict(DETECTION_TEMPLATES["generic"])


def _correction_template(correction_type: str) -> Dict[str, Any]:
    """Return the default correction_logic template for a correction type."""
    return dict(CORRECTION_TEMPLATES.get(correction_type, DETECTION_TEMPLATES["generic"]))


@router.get("/templates")
def get_templates(_=Depends(get_current_user)):
    """Return all parameter/logic templates for the frontend Auto mode."""
    return {"detection": DETECTION_TEMPLATES, "correction": CORRECTION_TEMPLATES}


@router.post("/generate-logic")
async def generate_logic(data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    AI-generate the actual logic (parameters / correction_logic) for one side.
    Body: {
        side: "detection" | "correction",
        description: str,
        rule_name: str?,
        dimension: str?,
        correction_type: str?,
        current_logic: dict?   (existing logic to refine rather than start from scratch)
    }
    Returns: {logic: dict, explanation: str}
    """
    side            = (data.get("side") or "detection").lower()
    description     = (data.get("description") or "").strip()
    rule_name       = data.get("rule_name", "")
    dimension       = data.get("dimension", "")
    correction_type = data.get("correction_type", "")
    current_logic   = data.get("current_logic") or {}

    if not description:
        raise HTTPException(400, "description is required")

    from app.engines.ai.claude_client import call_claude_json

    if side == "detection":
        system = (
            "You are a DQA rule engineer for CO₂ carbon capture sensor pipelines. "
            "Generate the exact JSON parameters that define a detection rule's logic. "
            "Return only valid JSON — no markdown, no explanation."
        )
        prompt = f"""Generate the detection rule parameters JSON for:

RULE NAME: {rule_name}
DIMENSION: {dimension}
DESCRIPTION: {description}
CURRENT PARAMETERS: {current_logic}

The parameters dict should contain the exact field names and values that the DQA engine
uses to evaluate this rule (e.g. tag names, thresholds, tolerances, frequencies).

Respond with exactly:
{{
  "logic": {{ ...parameters dict... }},
  "explanation": "1 sentence explaining what each parameter does"
}}"""
    else:
        system = (
            "You are a data correction engineer for CO₂ sensor pipelines. "
            "Generate the exact JSON logic that defines how a correction strategy works. "
            "Return only valid JSON — no markdown, no explanation."
        )
        prompt = f"""Generate the correction logic JSON for:

CORRECTION TYPE: {correction_type}
DESCRIPTION: {description}
CURRENT LOGIC: {current_logic}

The logic dict should contain method, source fields, window sizes, thresholds etc.
that the correction engine uses to fix the detected violation.

Respond with exactly:
{{
  "logic": {{ ...correction logic dict... }},
  "explanation": "1 sentence explaining what each parameter does"
}}"""

    import asyncio
    try:
        result = await asyncio.wait_for(
            call_claude_json(system, prompt, max_tokens=800, timeout=40),
            timeout=45,
        )
    except (asyncio.TimeoutError, TimeoutError, asyncio.CancelledError):
        raise HTTPException(503, "AI generation timed out — please try again")
    except Exception as e:
        raise HTTPException(503, f"AI generation failed: {e}")

    if not result or "logic" not in result:
        raise HTTPException(503, "AI did not return a valid logic object")

    return result


@router.post("/ai-generate")
async def ai_generate_pair(data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    Given a plain-English description, generate both detection rule AND
    correction strategy using AI.
    Body: { description: str, project_id: str, domain: str? }
    """
    description = (data.get("description") or "").strip()
    project_id  = data.get("project_id")
    domain      = data.get("domain", "co2_sequestration")

    if not description:
        raise HTTPException(400, "description is required")

    from app.engines.ai.claude_client import call_claude_json

    system = (
        "You are a DQA rule engineering expert for CO₂ carbon capture sensor pipelines. "
        "Generate both a detection rule AND a correction strategy from a plain-English description. "
        "Respond with valid JSON only."
    )

    user_msg = f"""Generate a complete rule pair (detection + correction) for this data quality issue:

DESCRIPTION: {description}
DOMAIN: {domain}

Respond with exactly this JSON:
{{
  "detection": {{
    "rule_id": "CUST-XX",
    "rule_name": "snake_case_name",
    "dimension": "Accuracy|Completeness|Integrity|Consistency|Reliability|Readability",
    "severity": "critical|high|medium|low",
    "is_hard_gate": false,
    "weight": 0.10,
    "description": "What this rule checks",
    "parameters": {{"key": "value"}}
  }},
  "correction": {{
    "name": "correction_strategy_name",
    "correction_type": "fill|interpolate|clamp|smooth|substitute|flag|impute|deduplicate",
    "description": "How this correction fixes the issue",
    "correction_logic": {{"method": "...", "params": {{}}}},
    "auto_apply_threshold": 80,
    "auto_apply_severity_max": "medium",
    "rationale": "Why this correction is appropriate"
  }}
}}"""

    import asyncio
    try:
        result = await asyncio.wait_for(
            call_claude_json(system, user_msg, max_tokens=1500, timeout=45),
            timeout=50,
        )
    except (asyncio.TimeoutError, TimeoutError, asyncio.CancelledError):
        raise HTTPException(503, "AI generation timed out — please try again")
    except Exception as e:
        raise HTTPException(503, f"AI generation failed: {e}")

    if not result:
        raise HTTPException(503, "AI did not return a result — check LLM configuration")

    result["pair_type"] = "ai"
    return result


# ── Test pair against last dataset ────────────────────────────────────────────

@router.post("/pairs/{rule_uuid}/test")
def test_pair(rule_uuid: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    Simulate the rule pair against the project's most recent completed DQA run.
    Returns: would-have-flagged count, would-have-auto-corrected count.
    """
    from app.models import DQARun, DQAViolation

    rule = db.query(DQARule).filter(DQARule.id == rule_uuid).first()
    if not rule:
        raise HTTPException(404, "Rule not found")

    last_run = (
        db.query(DQARun)
        .filter(DQARun.project_id == rule.project_id, DQARun.status == "completed")
        .order_by(DQARun.triggered_at.desc())
        .first()
    )
    if not last_run:
        return {
            "tested": False,
            "message": "No completed DQA run found for this project — run DQA first then test",
        }

    violations = db.query(DQAViolation).filter(
        DQAViolation.run_id == last_run.id,
        DQAViolation.rule_id == rule.rule_id,
    ).all()

    corr_obj = db.query(CorrectionRule).filter(
        CorrectionRule.project_id == rule.project_id,
        CorrectionRule.target_dqa_rule_id == rule.rule_id,
    ).first()

    threshold = getattr(corr_obj, "auto_apply_threshold", 80) if corr_obj else 80
    # Simulate: violations with confidence > threshold would auto-correct
    would_auto = sum(1 for v in violations if (v.confidence or 0) * 100 >= threshold)

    result = {
        "tested":              True,
        "run_id":              str(last_run.id),
        "run_date":            last_run.triggered_at.isoformat() if last_run.triggered_at else None,
        "violations_found":    len(violations),
        "would_auto_correct":  would_auto,
        "would_need_review":   len(violations) - would_auto,
        "auto_apply_threshold": threshold,
    }

    if corr_obj:
        try:
            from sqlalchemy.orm.attributes import flag_modified
            corr_obj.last_test_result = result
            flag_modified(corr_obj, "last_test_result")
            db.commit()
        except Exception:
            pass

    return result
