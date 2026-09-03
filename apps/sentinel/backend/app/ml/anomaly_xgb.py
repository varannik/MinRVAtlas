"""
Anomaly Detection XGBoost model — calibrated binary classifier trained
on user TP/FP labels from the anomaly feedback table.

Sits on top of the three-model ensemble:
  features = [heuristic_score, stat_score, if_score, z_score, iqr_dev,
               severity_enc, votes, param_anomaly_rate, value_norm]
  label    = 1 (true anomaly) | 0 (false positive)
"""
import logging
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger("datasentinel.ml.anomaly_xgb")

MIN_SAMPLES = 30

# F033 — cache SHAP TreeExplainer per model instance (creating it is expensive)
_shap_explainer_cache: dict = {}

FEATURE_NAMES = [
    "heuristic_confidence",
    "statistical_confidence",
    "isolation_forest_confidence",
    "z_score",
    "iqr_deviation",
    "severity_enc",       # critical=3, high=2, medium=1, normal=0
    "ensemble_votes",
    "active_models",
    "param_anomaly_rate",
    "value_normalised",   # (value - param_mean) / param_std  — normalised deviation
]


def _severity_enc(severity: str) -> float:
    return {"critical": 3.0, "high": 2.0, "medium": 1.0, "normal": 0.0}.get(
        str(severity).lower(), 1.0
    )


def build_anomaly_feature(anomaly: Dict, param_stats: Dict) -> Optional[List[float]]:
    """
    Build feature vector from a single anomaly detection result dict
    (as returned by AnomalyDetectionEngine.run()).
    param_stats: the parameter_stats entry for this parameter.
    """
    try:
        models = anomaly.get("models", {})
        h_conf = float((models.get("heuristic") or {}).get("confidence", 0))
        s_conf = float((models.get("statistical") or {}).get("confidence", 0))
        m_conf = float((models.get("ml") or {}).get("confidence", 0))

        ctx    = anomaly.get("context", {})
        z      = float(ctx.get("z_score") or 0)
        iqr_b  = ctx.get("iqr_bounds") or {}
        val    = float(anomaly.get("value", 0))
        iqr_lower = float(iqr_b.get("lower", val))
        iqr_upper = float(iqr_b.get("upper", val))
        iqr_range = max(iqr_upper - iqr_lower, 1e-9)
        iqr_dev = max(val - iqr_upper, iqr_lower - val, 0) / iqr_range

        sev    = _severity_enc(anomaly.get("severity", "medium"))
        votes  = float(anomaly.get("votes", 1))
        active = float(anomaly.get("active_models", 2))

        ps     = param_stats or {}
        p_rate = float(ps.get("anomaly_rate", 5)) / 100.0
        p_mean = float((ps.get("stats") or {}).get("mean") or val)
        p_std  = float((ps.get("stats") or {}).get("std") or 1)
        val_norm = (val - p_mean) / max(p_std, 1e-9)

        return [h_conf, s_conf, m_conf, z, iqr_dev, sev, votes, active, p_rate, val_norm]
    except Exception as e:
        logger.debug("Anomaly feature build failed: %s", e)
        return None


def train_anomaly_model(feedback_records: List[Dict]) -> Tuple[Any, Dict]:
    """
    Train XGBoost binary classifier on labeled anomaly feedback.
    Each record: {feature_vector: [...], label: 1|0}
    Returns (model, metrics).
    """
    import xgboost as xgb
    from sklearn.metrics import accuracy_score, f1_score, roc_auc_score
    from sklearn.model_selection import train_test_split

    X, y = [], []
    for rec in feedback_records:
        fv  = rec.get("feature_vector")
        lbl = rec.get("label")
        if fv is not None and lbl is not None:
            X.append(fv)
            y.append(int(lbl))

    if len(X) < MIN_SAMPLES:
        raise ValueError(f"Insufficient anomaly feedback: {len(X)} < {MIN_SAMPLES}")

    X_arr = np.array(X, dtype=np.float32)
    y_arr = np.array(y, dtype=np.int32)

    pos = int(y_arr.sum())
    neg = len(y_arr) - pos
    scale_pos = neg / max(pos, 1)

    X_train, X_test, y_train, y_test = train_test_split(
        X_arr, y_arr, test_size=0.2, random_state=42,
        stratify=y_arr if len(set(y_arr)) > 1 else None
    )

    model = xgb.XGBClassifier(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.08,
        subsample=0.85,
        colsample_bytree=0.85,
        scale_pos_weight=scale_pos,
        eval_metric="logloss",
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train, y_train,
              eval_set=[(X_test, y_test)],
              verbose=False)

    y_pred  = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1]

    acc = float(accuracy_score(y_test, y_pred))
    f1  = float(f1_score(y_test, y_pred, zero_division=0))
    try:
        auc = float(roc_auc_score(y_test, y_proba))
    except Exception:
        auc = 0.0

    metrics = {
        "accuracy":      round(acc, 4),
        "f1":            round(f1, 4),
        "roc_auc":       round(auc, 4),
        "train_samples": len(X_train),
        "test_samples":  len(X_test),
        "pos_class_pct": round(pos / max(len(y_arr), 1) * 100, 1),
    }
    logger.info("Anomaly XGBoost trained: acc=%.3f f1=%.3f auc=%.3f n=%d", acc, f1, auc, len(X))
    return model, metrics


def calibrate_anomaly(model, anomaly: Dict, param_stats: Dict) -> Dict:
    """
    Run XGBoost calibration on top of ensemble result.
    Returns calibrated probability + SHAP explanation.
    Falls back gracefully if model is None.
    """
    fv = build_anomaly_feature(anomaly, param_stats)

    if model is None or fv is None:
        # No model yet — return ensemble confidence as-is
        return {
            "calibrated_probability": anomaly.get("ensemble_confidence", 0.5),
            "xgb_active": False,
            "shap_values": {},
            "top_features": [],
        }

    import numpy as np
    import shap

    X = np.array([fv], dtype=np.float32)
    proba = float(model.predict_proba(X)[0][1])

    # Real SHAP — explainer cached per model instance (F033)
    try:
        model_key = id(model)
        if model_key not in _shap_explainer_cache:
            _shap_explainer_cache[model_key] = shap.TreeExplainer(model)
        explainer = _shap_explainer_cache[model_key]
        shap_vals = explainer.shap_values(X)
        # Binary: shap_vals may be (n_samples, n_features) or list of two
        if isinstance(shap_vals, list):
            sv = shap_vals[1][0]  # positive class
        else:
            sv = shap_vals[0]
        shap_dict = {FEATURE_NAMES[i]: round(float(sv[i]), 5) for i in range(len(FEATURE_NAMES))}
        top = sorted(shap_dict.items(), key=lambda x: abs(x[1]), reverse=True)[:5]
    except Exception as e:
        logger.warning("Anomaly SHAP failed: %s", e)
        shap_dict = {}
        top = []

    return {
        "calibrated_probability": round(proba, 4),
        "xgb_active":   True,
        "shap_values":  shap_dict,
        "top_features": [{"feature": k, "shap": v} for k, v in top],
    }


def update_ensemble_weights(feedback_records: List[Dict]) -> Dict[str, float]:
    """
    Compute per-model accuracy from feedback labels and return updated weights.
    Falls back to equal weights if insufficient data.
    """
    if len(feedback_records) < 10:
        return {"heuristic": 0.30, "statistical": 0.35, "ml": 0.35}

    h_correct = s_correct = m_correct = total = 0
    for rec in feedback_records:
        lbl  = rec.get("label")
        fv   = rec.get("feature_vector") or []
        if lbl is None or len(fv) < 3:
            continue
        total += 1
        # feature_vector order: h_conf, s_conf, m_conf, ...
        h_pred = 1 if fv[0] > 0.5 else 0
        s_pred = 1 if fv[1] > 0.5 else 0
        m_pred = 1 if fv[2] > 0.5 else 0
        if h_pred == lbl: h_correct += 1
        if s_pred == lbl: s_correct += 1
        if m_pred == lbl: m_correct += 1

    if total == 0:
        return {"heuristic": 0.30, "statistical": 0.35, "ml": 0.35}

    h_acc = h_correct / total
    s_acc = s_correct / total
    m_acc = m_correct / total
    total_acc = max(h_acc + s_acc + m_acc, 1e-9)

    weights = {
        "heuristic":  round(h_acc / total_acc, 4),
        "statistical": round(s_acc / total_acc, 4),
        "ml":          round(m_acc / total_acc, 4),
    }
    logger.info("Ensemble weights updated: %s (n=%d)", weights, total)
    return weights
