"""
DataSentinel Correction Engine
Phase 1: Rule-based (interpolation, exclusion, substitution)
Phase 2: AI-based (XGBoost with SHAP explainability)
"""
import math
import uuid
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd


def _clean(val):
    """Replace NaN/Inf with None so PostgreSQL JSON accepts it."""
    if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
        return None
    if isinstance(val, list):
        return [_clean(v) for v in val]
    if isinstance(val, dict):
        return {k: _clean(v) for k, v in val.items()}
    return val


# ── Rule-Based Correction Engine ─────────────────────────────────────────────

class CorrectionSuggestionRecord:
    def __init__(self, violation_id: str, source: str, original: Any,
                 suggested: Any, method: str, confidence: float,
                 explanation: str, feature_importance: Dict = None):
        self.id = str(uuid.uuid4())
        self.violation_id = violation_id
        self.suggestion_source = source
        self.original_value = original
        self.suggested_value = suggested
        self.correction_method = method
        self.confidence_score = confidence
        self.explanation = explanation
        self.feature_importance = feature_importance or {}
        self.model_version = None

class RuleBasedCorrectionEngine:

    def generate(self, df: pd.DataFrame, violations: List[Dict],
                  correction_rules: List[Dict]) -> List[CorrectionSuggestionRecord]:
        suggestions = []
        for v in violations:
            rule_id = v["rule_id"]
            # Match correction rules by target DQA rule ID, sorted by priority
            matching = sorted(
                [r for r in correction_rules if r.get("target_dqa_rule_id") == rule_id and r.get("is_active", True)],
                key=lambda r: r.get("priority", 100)
            )
            if not matching:
                # Auto-generate sensible default suggestions
                auto = self._auto_suggest(df, v)
                if auto: suggestions.append(auto)
                continue
            for crule in matching:
                s = self._apply_strategy(df, v, crule)
                if s:
                    suggestions.append(s)
                    break  # first match wins
        return suggestions

    def _auto_suggest(self, df: pd.DataFrame, v: Dict) -> Optional[CorrectionSuggestionRecord]:
        rule_id = v["rule_id"]
        field = v.get("affected_field", "")
        rows = v.get("affected_rows", [])

        if rule_id == "I-04" and field and rows:
            # Spike: linear interpolation
            return self._interpolate(df, v, field, rows, "Auto-spike correction")

        if rule_id == "I-01" and field and rows:
            # Flatline: linear interpolation
            return self._interpolate(df, v, field, rows, "Auto-flatline correction")

        if rule_id == "C-02" and field and rows:
            # Nulls: forward-fill
            # Confidence depends on null density — sparse nulls interpolate more reliably
            if df.empty or field not in df.columns:
                null_density = len(rows) / max(1, 100)   # unknown series length → assume 100
                confidence = round(max(0.40, 0.80 - null_density * 1.5), 4)
                return CorrectionSuggestionRecord(
                    v["id"] if isinstance(v, dict) and "id" in v else str(uuid.uuid4()),
                    "rule_engine", [None]*len(rows), "forward_fill_estimate", "forward_fill", confidence,
                    f"Forward-fill applied to {len(rows)} null values in {field}. Re-upload dataset for precise values."
                )
            series = df[field].copy()
            null_density = len(rows) / max(len(series), 1)
            # High null density = lower confidence (can't forward-fill reliably from sparse context)
            confidence = round(max(0.40, 0.92 - null_density * 1.5), 4)
            original = _clean(series[rows].tolist())
            series = series.ffill().bfill()
            suggested = _clean(series[rows].tolist())
            return CorrectionSuggestionRecord(
                v["id"] if isinstance(v, dict) and "id" in v else str(uuid.uuid4()),
                "rule_engine", original, suggested, "forward_fill", confidence,
                f"Forward-fill applied to {len(rows)} null values in {field} (null density: {null_density:.1%})"
            )

        if rule_id == "CON-04":
            # Water/CO2 ratio exceeds limit → clamp ratio column to max_ratio
            detail = v.get("violation_detail", {})
            max_ratio = detail.get("max_ratio", 0.6)
            # Extract the actual ratio column name: field may be "WATER/CO2" compound
            # Try violation_detail first, then parse the compound field name
            ratio_col = None
            compound = v.get("affected_field", "")
            if compound and "/" in compound:
                ratio_col = compound.split("/")[0]  # e.g. "WATER_CO2_RATIO"
            elif compound and compound in (df.columns if not df.empty else []):
                ratio_col = compound
            if ratio_col and not df.empty and ratio_col in df.columns and rows:
                series = df[ratio_col].copy().astype(float)
                original = _clean(series[rows].tolist())
                suggested = _clean([min(float(x), max_ratio) if x is not None and not (isinstance(x, float) and __import__("math").isnan(x)) else None
                                    for x in original])
                if suggested and original and suggested != original:
                    peak = max((x for x in original if x is not None), default=0)
                    # Confidence based on violation magnitude: large overshoot = clearer correction
                    violation_degree = (peak - max_ratio) / max(max_ratio, 1e-9) if peak > max_ratio else 0.0
                    confidence = round(min(0.97, 0.65 + 0.30 * min(violation_degree, 1.0)), 4)
                    return CorrectionSuggestionRecord(
                        v.get("id", str(uuid.uuid4())),
                        "rule_engine", original, suggested, "ratio_clamp", confidence,
                        f"Water/CO₂ ratio clamped to max {max_ratio} in {ratio_col}. "
                        f"{len(rows)} rows corrected from peak {peak:.3f} (violation degree: {violation_degree:.2f})."
                    )

        if rule_id == "REL-01":
            rows = v.get("affected_rows", [])
            state_col = v.get("affected_field", "operational_state") or "operational_state"
            # Check if rows are ALREADY excluded — skip to avoid infinite loop
            if not df.empty and state_col in df.columns and rows:
                already_excluded = all(
                    str(df.loc[r, state_col]).lower() == "excluded"
                    for r in rows if r < len(df)
                )
                if already_excluded:
                    return None  # No correction needed — already excluded
            return CorrectionSuggestionRecord(
                v.get("id", str(uuid.uuid4())),
                "rule_engine", None, "excluded",
                "operational_state_exclusion", 0.95,
                f"Rows flagged as non-operational ({v.get('violation_detail',{}).get('excluded_states','')}) — excluded from credit-eligible totals"
            )
        return None

    def _interpolate(self, df, v, field, rows, label) -> Optional[CorrectionSuggestionRecord]:
        if df.empty or field not in df.columns:
            # No dataframe available — generate estimate-based suggestion from violation detail
            original = v.get('violation_detail', {}).get('offending_values', [None])
            return CorrectionSuggestionRecord(
                v.get('id', str(uuid.uuid4())), 'rule_engine',
                original, None, 'linear_interpolation', 0.65,
                f'{label}: {len(rows)} row(s) in {field} flagged. '
                f'Re-upload dataset for precise interpolated values.'
            )
        series = df[field].copy().astype(float)
        original = _clean(series[rows].tolist())
        # Mark bad rows as NaN then interpolate
        series_copy = series.copy()
        series_copy[rows] = np.nan
        series_interp = series_copy.interpolate(method="linear", limit_direction="both")
        suggested = _clean(series_interp[rows].round(4).tolist())

        # Skip if correction makes no difference — breaks the iteration loop
        # Keep if either side is None (unknown value, still useful)
        def _same(a, b):
            if a is None or b is None:
                return False
            if isinstance(a, list) and isinstance(b, list):
                if len(a) != len(b): return False
                return all(abs((x or 0) - (y or 0)) < 0.0001 for x, y in zip(a, b))
            return False

        if _same(original, suggested):
            return None  # No meaningful change — skip to prevent correction loop

        # Confidence based on gap fraction: small contiguous gaps interpolate reliably
        series_len    = max(len(series), 1)
        gap_fraction  = len(rows) / series_len
        # More consecutive rows = harder to interpolate accurately
        consecutive_penalty = min(len(rows) / 10.0, 0.40)
        confidence = round(max(0.45, 0.95 - gap_fraction * 2.0 - consecutive_penalty), 4)

        return CorrectionSuggestionRecord(
            v.get("id", str(uuid.uuid4())),
            "rule_engine", original, suggested,
            "linear_interpolation", confidence,
            f"{label}: linear interpolation over {len(rows)} rows in {field} "
            f"(gap fraction: {gap_fraction:.1%}, confidence: {confidence:.2f}). "
            f"Interpolated from adjacent clean readings."
        )

    def _apply_strategy(self, df: pd.DataFrame, v: Dict, crule: Dict):
        ctype = crule.get("correction_type", "")
        field = v.get("affected_field", "")
        rows = v.get("affected_rows", [])
        logic = crule.get("correction_logic", {})

        if ctype == "linear_interpolation" and field in df.columns and rows:
            return self._interpolate(df, v, field, rows, crule["name"])

        if ctype == "exclusion":
            return CorrectionSuggestionRecord(
                v.get("id", str(uuid.uuid4())), "rule_engine",
                None, "excluded", "exclusion", 0.95,
                f"Rows excluded per correction rule '{crule['name']}'"
            )

        if ctype == "substitution" and "substitute_value" in logic:
            return CorrectionSuggestionRecord(
                v.get("id", str(uuid.uuid4())), "rule_engine",
                v.get("violation_detail", {}).get("offending_values"),
                logic["substitute_value"], "substitution", 0.75,
                f"Substituted with configured value {logic['substitute_value']} per rule '{crule['name']}'"
            )

        if ctype == "formula" and "formula" in logic:
            formula_str = logic["formula"]
            # Confidence based on formula specificity: longer, more explicit formulas = higher confidence
            # Short (<20 chars): 0.65, long (80+ chars): 0.85
            specificity = min(len(formula_str) / 80.0, 1.0)
            formula_confidence = round(0.65 + 0.20 * specificity, 4)
            return CorrectionSuggestionRecord(
                v.get("id", str(uuid.uuid4())), "rule_engine",
                None, f"formula:{formula_str}", "formula", formula_confidence,
                f"Formula correction '{formula_str}' applied per rule '{crule['name']}' "
                f"(formula specificity: {specificity:.0%}, confidence: {formula_confidence:.2f})"
            )
        return None


# ── AI Correction Engine ──────────────────────────────────────────────────────

class AICorrectionEngine:
    """
    XGBoost-based correction strategy classifier with real SHAP explainability.
    Uses the persisted global model from app.ml.model_store (trained nightly via Celery beat).
    Falls back to rule engine if the model has not yet been trained (<50 approved corrections).
    """
    MIN_SAMPLES = 50

    def predict(self, df: pd.DataFrame, violations: List[Dict],
                feedback_records: List[Dict], project_id: str) -> List[CorrectionSuggestionRecord]:
        from app.ml import dqa_xgb, model_store

        # Load persisted XGBoost model (S3 → memory cache)
        model = model_store.load_or_none("dqa_xgb")
        if model is None:
            return []  # Not yet trained — rule engine handles all corrections

        suggestions = []
        for v in violations:
            field = v.get("affected_field", "")
            rows  = v.get("affected_rows", [])
            if not rows:
                continue
            first_row = rows[0]

            # Build rolling context from live dataframe
            series_ctx = dqa_xgb.extract_series_context(df, field, first_row)

            try:
                result = dqa_xgb.predict_with_shap(model, v, series_ctx)
            except Exception as e:
                import logging as _log
                _log.getLogger("datasentinel.correction").warning("XGBoost predict failed: %s", e)
                continue

            strategy  = result["strategy"]
            confidence = result["confidence"]
            shap_vals  = result.get("shap_values", {})
            top_feats  = result.get("top_features", [])

            # Build human-readable explanation
            top_str = ", ".join(
                f"{f['feature']}={f['shap']:+.3f}" for f in top_feats[:3]
            ) if top_feats else "ensemble features"
            explanation = (
                f"XGBoost ({strategy}) — confidence {confidence:.0%}. "
                f"Key drivers: {top_str}. "
                f"Model trained on approved corrections."
            )

            suggestions.append(CorrectionSuggestionRecord(
                v.get("id", str(uuid.uuid4())),
                "ai_xgboost",
                float(df[field].iloc[first_row]) if field in df.columns and not df.empty
                    and pd.notna(df[field].iloc[first_row]) else None,
                strategy,
                strategy,
                confidence,
                explanation,
                {
                    "shap_values": shap_vals,
                    "top_features": top_feats,
                    "all_probas": result.get("all_probas", {}),
                    "source": result.get("source", "xgboost_v1"),
                }
            ))
        return suggestions
