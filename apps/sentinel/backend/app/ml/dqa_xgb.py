"""
DQA Correction XGBoost model — predicts optimal correction strategy
and returns real SHAP feature importance values.

Training signal: approved_corrections + ai_training_feedback tables.
Minimum 50 samples required before XGBoost activates; falls back to
rule engine below that threshold.
"""
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger("datasentinel.ml.dqa_xgb")

MIN_SAMPLES = 50

# F033 — cache SHAP TreeExplainer per model instance (creating it is expensive)
_shap_explainer_cache: dict = {}

# Correction strategy labels
STRATEGY_LABELS = ["linear_interpolation", "forward_fill", "exclusion", "substitution"]

# Feature names (order must match _build_feature_vector)
FEATURE_NAMES = [
    "lag_1", "lag_2", "lag_3",
    "rolling_mean_5", "rolling_std_5",
    "rolling_mean_10", "rolling_std_10",
    "z_score", "iqr_deviation",
    "hour_of_day", "day_of_week",
    "rule_is_spike", "rule_is_flatline", "rule_is_null",
    "rule_is_range", "rule_is_ratio",
    "severity_critical", "severity_high", "severity_medium",
    "violation_row_count",
]


def _build_feature_vector(record: Dict) -> Optional[List[float]]:
    """Build feature vector from an ai_training_feedback or live violation record."""
    fv = record.get("feature_vector") or {}
    if not fv:
        return None
    try:
        rule_id = str(fv.get("rule_id", "")).upper()
        severity = str(fv.get("severity", "medium")).lower()
        return [
            float(fv.get("lag_1", 0) or 0),
            float(fv.get("lag_2", 0) or 0),
            float(fv.get("lag_3", 0) or 0),
            float(fv.get("rolling_mean_5", 0) or 0),
            float(fv.get("rolling_std_5", 1) or 1),
            float(fv.get("rolling_mean_10", 0) or 0),
            float(fv.get("rolling_std_10", 1) or 1),
            float(fv.get("z_score", 0) or 0),
            float(fv.get("iqr_deviation", 0) or 0),
            float(fv.get("hour_of_day", 0) or 0),
            float(fv.get("day_of_week", 0) or 0),
            1.0 if "I-04" in rule_id or "SPIKE" in rule_id else 0.0,
            1.0 if "I-01" in rule_id or "FLAT" in rule_id else 0.0,
            1.0 if "C-02" in rule_id or "NULL" in rule_id else 0.0,
            1.0 if "C-01" in rule_id or "RANGE" in rule_id else 0.0,
            1.0 if "CON" in rule_id or "RATIO" in rule_id else 0.0,
            1.0 if severity == "critical" else 0.0,
            1.0 if severity == "high" else 0.0,
            1.0 if severity == "medium" else 0.0,
            float(fv.get("violation_row_count", 1) or 1),
        ]
    except Exception as e:
        logger.debug("Feature vector build failed: %s", e)
        return None


def _strategy_label(correction_method: str) -> int:
    """Map correction_method string to integer class label."""
    m = str(correction_method or "").lower()
    if "interpolat" in m:     return 0
    if "forward" in m or "fill" in m: return 1
    if "exclu" in m or "state" in m:  return 2
    if "substit" in m or "formula" in m: return 3
    return 0  # default to interpolation


def train_dqa_model(feedback_records: List[Dict]) -> Tuple[Any, Dict]:
    """
    Train XGBoost classifier on approved correction feedback.
    Returns (model, metrics_dict).
    """
    import xgboost as xgb
    from sklearn.metrics import accuracy_score, f1_score
    from sklearn.model_selection import train_test_split

    X, y = [], []
    for rec in feedback_records:
        fv = _build_feature_vector(rec)
        label = _strategy_label(rec.get("correction_method") or rec.get("error_type", ""))
        if fv is not None:
            X.append(fv)
            y.append(label)

    if len(X) < MIN_SAMPLES:
        raise ValueError(f"Insufficient samples: {len(X)} < {MIN_SAMPLES}")

    X_arr = np.array(X, dtype=np.float32)
    y_arr = np.array(y, dtype=np.int32)

    X_train, X_test, y_train, y_test = train_test_split(
        X_arr, y_arr, test_size=0.2, random_state=42, stratify=y_arr if len(set(y_arr)) > 1 else None
    )

    model = xgb.XGBClassifier(
        n_estimators=150,
        max_depth=5,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        use_label_encoder=False,
        eval_metric="mlogloss",
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train, y_train,
              eval_set=[(X_test, y_test)],
              verbose=False)

    y_pred = model.predict(X_test)
    acc = float(accuracy_score(y_test, y_pred))
    f1  = float(f1_score(y_test, y_pred, average="weighted", zero_division=0))

    metrics = {
        "accuracy":     round(acc, 4),
        "f1_weighted":  round(f1, 4),
        "train_samples": len(X_train),
        "test_samples":  len(X_test),
        "n_classes":     len(set(y_arr)),
    }
    logger.info("DQA XGBoost trained: acc=%.3f f1=%.3f n=%d", acc, f1, len(X))
    return model, metrics


def predict_with_shap(model, violation: Dict, series_context: Dict) -> Dict:
    """
    Run XGBoost prediction + real SHAP explanation for a single violation.
    Returns prediction dict with strategy, confidence and SHAP values.
    """
    import shap

    # Build feature vector from live violation context
    fv_input = {
        "lag_1": series_context.get("lag_1", 0),
        "lag_2": series_context.get("lag_2", 0),
        "lag_3": series_context.get("lag_3", 0),
        "rolling_mean_5":  series_context.get("rolling_mean_5", 0),
        "rolling_std_5":   series_context.get("rolling_std_5", 1),
        "rolling_mean_10": series_context.get("rolling_mean_10", 0),
        "rolling_std_10":  series_context.get("rolling_std_10", 1),
        "z_score":         series_context.get("z_score", 0),
        "iqr_deviation":   series_context.get("iqr_deviation", 0),
        "hour_of_day":     series_context.get("hour_of_day", 0),
        "day_of_week":     series_context.get("day_of_week", 0),
        "rule_id":         violation.get("rule_id", ""),
        "severity":        violation.get("severity", "medium"),
        "violation_row_count": len(violation.get("affected_rows", [])),
    }
    fv = _build_feature_vector({"feature_vector": fv_input})
    if fv is None:
        return {"strategy": "linear_interpolation", "confidence": 0.0,
                "shap_values": {}, "source": "fallback_no_features",
                "note": "Feature vector could not be built — rule engine should handle this correction"}

    X = np.array([fv], dtype=np.float32)
    proba = model.predict_proba(X)[0]
    pred_class = int(np.argmax(proba))
    confidence = float(proba[pred_class])
    strategy = STRATEGY_LABELS[pred_class] if pred_class < len(STRATEGY_LABELS) else "linear_interpolation"

    # Real SHAP values — explainer is cached per model instance (F033)
    try:
        model_key = id(model)
        if model_key not in _shap_explainer_cache:
            _shap_explainer_cache[model_key] = shap.TreeExplainer(model)
        explainer = _shap_explainer_cache[model_key]
        shap_vals = explainer.shap_values(X)
        # shap_vals shape: (n_classes, n_samples, n_features) or (n_samples, n_features)
        if isinstance(shap_vals, list):
            # multi-class: take values for predicted class
            class_shap = shap_vals[pred_class][0]
        else:
            class_shap = shap_vals[0]
        shap_dict = {
            FEATURE_NAMES[i]: round(float(class_shap[i]), 5)
            for i in range(len(FEATURE_NAMES))
        }
        # Top 5 by absolute magnitude
        top_features = sorted(shap_dict.items(), key=lambda x: abs(x[1]), reverse=True)[:5]
    except Exception as e:
        logger.warning("SHAP computation failed: %s", e)
        shap_dict = {}
        top_features = []

    return {
        "strategy":      strategy,
        "confidence":    round(confidence, 4),
        "all_probas":    {STRATEGY_LABELS[i]: round(float(p), 4) for i, p in enumerate(proba)
                          if i < len(STRATEGY_LABELS)},
        "shap_values":   shap_dict,
        "top_features":  [{"feature": k, "shap": v} for k, v in top_features],
        "source":        "xgboost_v1",
    }


def extract_series_context(df, field: str, row_idx: int) -> Dict:
    """Build rolling stats context for a violation row."""
    try:
        import pandas as pd
        series = df[field].astype(float) if field in df.columns else pd.Series(dtype=float)
        if series.empty:
            return {}
        idx = min(row_idx, len(series) - 1)
        lag1 = float(series.iloc[max(0, idx - 1)]) if idx > 0 else 0.0
        lag2 = float(series.iloc[max(0, idx - 2)]) if idx > 1 else 0.0
        lag3 = float(series.iloc[max(0, idx - 3)]) if idx > 2 else 0.0
        roll5  = series.rolling(5,  min_periods=1)
        roll10 = series.rolling(10, min_periods=1)
        mean5  = float(roll5.mean().iloc[idx]  or 0)
        std5   = float(roll5.std().iloc[idx]   or 1)
        mean10 = float(roll10.mean().iloc[idx] or 0)
        std10  = float(roll10.std().iloc[idx]  or 1)
        val    = float(series.iloc[idx])
        z      = (val - mean10) / std10 if std10 > 0 else 0.0
        q1, q3 = float(series.quantile(0.25)), float(series.quantile(0.75))
        iqr    = q3 - q1
        iqr_dev = (val - q3) / iqr if val > q3 and iqr > 0 else (
                   (q1 - val) / iqr if val < q1 and iqr > 0 else 0.0)
        return {
            "lag_1": lag1, "lag_2": lag2, "lag_3": lag3,
            "rolling_mean_5": mean5, "rolling_std_5": std5,
            "rolling_mean_10": mean10, "rolling_std_10": std10,
            "z_score": round(z, 4), "iqr_deviation": round(iqr_dev, 4),
            "hour_of_day": datetime.utcnow().hour, "day_of_week": datetime.utcnow().weekday(),
        }
    except Exception:
        return {}
