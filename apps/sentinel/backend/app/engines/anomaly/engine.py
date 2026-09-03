"""
DataSentinel Anomaly Detection Engine
Three-model ensemble: Heuristic + Statistical (IQR/Z-score) + ML (Isolation Forest)
Based on the 44.01 DQA anomaly detection service architecture.
"""
import logging
import math
import time
from typing import Dict, Optional

import numpy as np
import pandas as pd

logger = logging.getLogger("datasentinel.anomaly")

# ── Default threshold config (mirrors thresholds.config from frontend code) ──
DEFAULT_THRESHOLDS: Dict[str, Dict] = {
    # CO2 Capture & Storage parameters (44.01 / Puro.Earth CCS)
    "CO2_FLOW_RATE":          {"min": 0.1,  "max": 50.0,  "critical_min": 0,    "critical_max": 80,   "unit": "kg/hr"},
    "WATER_FLOW_RATE":        {"min": 0.5,  "max": 100.0, "critical_min": 0,    "critical_max": 150,  "unit": "m3/hr"},
    "LIQUID_TRACER_FLOW_RATE":{"min": 0.0,  "max": 20.0,  "critical_min": None, "critical_max": 30,   "unit": "L/hr"},
    "INJECTION_PRESSURE":     {"min": 10.0, "max": 200.0, "critical_min": 5,    "critical_max": 250,  "unit": "bar"},
    "WATER_CO2_RATIO":        {"min": 0.05, "max": 0.6,   "critical_min": 0,    "critical_max": 1.0,  "unit": "ratio"},
    "CO2_PURITY_PERCENTAGE":  {"min": 90.0, "max": 100.0, "critical_min": 80,   "critical_max": None, "unit": "%"},
    "TOTAL_ENERGY":           {"min": 0.0,  "max": 1000.0,"critical_min": None, "critical_max": 2000, "unit": "KWh"},
    "CO2_TOTALIZER":          {"min": 0.0,  "max": 50000.0,"critical_min":None, "critical_max": None, "unit": "Kg"},
    # Generic sensor parameters
    "FLOWRATE_1_M3H":         {"min": 0.0,  "max": 660.0, "critical_min": None, "critical_max": 800,  "unit": "m3/h"},
    "TEMPERATURE":            {"min": 0.0,  "max": 150.0, "critical_min": -10,  "critical_max": 200,  "unit": "°C"},
    "PRESSURE":               {"min": 0.0,  "max": 300.0, "critical_min": None, "critical_max": 400,  "unit": "bar"},
}

MODEL_WEIGHTS = {"heuristic": 0.30, "statistical": 0.35, "ml": 0.35}

def _get_live_weights() -> Dict:
    """Load ensemble weights from model store (updated nightly by retraining task)."""
    try:
        from app.ml import model_store
        w = model_store.load_or_none("anomaly_weights")
        if w and isinstance(w, dict) and "heuristic" in w:
            return w
    except Exception:
        pass
    return MODEL_WEIGHTS


def _find_threshold(col_name: str) -> Optional[Dict]:
    """Fuzzy-match a column name to its threshold config."""
    key = col_name.upper().replace(" ", "_").replace("-", "_")
    if key in DEFAULT_THRESHOLDS:
        return DEFAULT_THRESHOLDS[key]
    for k, v in DEFAULT_THRESHOLDS.items():
        if k in key or key in k:
            return v
    return None


# ── Model 1: Heuristic (threshold-based) ─────────────────────────────────────
def heuristic_detection(value: float, cfg: Dict) -> Dict:
    """Check value against min/max/critical bounds."""
    mn, mx = cfg["min"], cfg["max"]
    cmn, cmx = cfg.get("critical_min"), cfg.get("critical_max")
    is_anomaly = value < mn or value > mx
    alarm_type = "Normal"
    severity = "normal"

    if cmn is not None and value <= cmn:
        alarm_type = "Low-Low"; severity = "critical"
    elif cmx is not None and value >= cmx:
        alarm_type = "High-High"; severity = "critical"
    elif value < mn:
        alarm_type = "Low"; severity = "high"
    elif value > mx:
        alarm_type = "High"; severity = "high"

    # Confidence based on normalized deviation from threshold bounds — not a fixed score
    range_size = max(mx - mn, 1e-9)
    if not is_anomaly:
        # How centered is the value? More centered = more confident it's truly normal
        dist_from_edge = min(value - mn, mx - value)
        center_ratio = min(max(dist_from_edge / (range_size / 2), 0.0), 1.0)
        h_confidence = round(0.15 + 0.25 * center_ratio, 4)
    elif severity == "critical":
        # Breach beyond critical bound: larger breach = higher confidence
        if cmx is not None and value >= cmx:
            crit_span = max(cmx - mx, range_size * 0.05, 1e-9)
            breach = value - cmx
        elif cmn is not None and value <= cmn:
            crit_span = max(mn - cmn, range_size * 0.05, 1e-9)
            breach = cmn - value
        else:
            crit_span, breach = range_size * 0.1, 0.0
        h_confidence = round(min(0.98, 0.82 + 0.16 * min(breach / crit_span, 1.0)), 4)
    else:
        # Breach beyond min/max: larger overshoot = higher confidence it's a real anomaly
        breach = max(value - mx, mn - value, 0.0)
        h_confidence = round(min(0.85, 0.55 + 0.30 * min(breach / range_size, 1.0)), 4)
    return {
        "status": "Anomaly" if is_anomaly else "Normal",
        "alarm_type": alarm_type,
        "severity": severity,
        "value": value,
        "threshold": {"min": mn, "max": mx},
        "confidence": h_confidence,
    }


# ── Model 2: Statistical (IQR + Z-score) ────────────────────────────────────
def statistical_detection(value: float, series: pd.Series, cfg: Dict, iqr_multiplier: float = 1.5, z_threshold: float = 2.5) -> Dict:
    """IQR outlier detection + Z-score cross-validation."""
    clean = series.dropna()
    if len(clean) < 4:
        # Fallback to z-score against threshold midpoint
        mid = (cfg["min"] + cfg["max"]) / 2
        std = (cfg["max"] - cfg["min"]) / 6
        z = abs(value - mid) / std if std > 0 else 0
        is_anomaly = z > z_threshold
        return {"status": "Anomaly" if is_anomaly else "Normal", "method": "z-score-fallback",
                "z_score": round(z, 3), "confidence": min(z / 4, 1.0) if is_anomaly else 0.2}

    q1, q3 = clean.quantile(0.25), clean.quantile(0.75)
    iqr = q3 - q1
    lower, upper = q1 - iqr_multiplier * iqr, q3 + iqr_multiplier * iqr
    mean, std = clean.mean(), clean.std()
    z = abs(value - mean) / std if std > 0 else 0

    iqr_anomaly = value < lower or value > upper
    z_anomaly = z > z_threshold

    is_anomaly = iqr_anomaly or z_anomaly
    confidence = 0.0
    if iqr_anomaly: confidence += 0.5
    if z_anomaly:   confidence += min(z / 5, 0.5)

    return {
        "status": "Anomaly" if is_anomaly else "Normal",
        "method": "IQR+Z-score",
        "iqr_anomaly": iqr_anomaly,
        "z_score": round(z, 3),
        "z_anomaly": z_anomaly,
        "iqr_bounds": {"lower": round(lower, 4), "upper": round(upper, 4)},
        "confidence": round(min(confidence, 1.0), 3),
    }


# ── Model 3: ML (Isolation Forest — uses persisted model, refit from series) ─
def ml_detection(value: float, series: pd.Series, contamination: float = 0.1, min_samples: int = 10) -> Dict:
    """
    Isolation Forest detection.
    Preference order:
      1. Persisted global IF model from S3 (retrained nightly on 90-day window)
      2. Fit a fresh IsolationForest on the current series (per-run fallback)
      3. MAD robust z-score (if sklearn unavailable)
    """
    clean = series.dropna().values
    if len(clean) < min_samples:
        return {"status": "WarmingUp", "confidence": 0.0,
                "message": f"Insufficient data ({len(clean)} points, need {min_samples}+)"}

    try:
        from sklearn.ensemble import IsolationForest

        from app.ml import model_store

        # Try the persisted global model first
        clf = model_store.load_or_none("anomaly_if")
        source = "persisted_global"

        if clf is None:
            # No persisted model yet — fit on current series
            clf = IsolationForest(contamination=contamination, random_state=42, n_estimators=100)
            clf.fit(clean.reshape(-1, 1))
            source = "per_run_fit"

        score = clf.decision_function([[value]])[0]
        pred  = clf.predict([[value]])[0]   # -1 = anomaly, 1 = normal
        is_anomaly = pred == -1
        confidence = float(max(0.0, min(1.0, (0.1 - score) / 0.3)))

        return {
            "status": "Anomaly" if is_anomaly else "Normal",
            "method": "IsolationForest",
            "source": source,
            "anomaly_score": round(float(score), 4),
            "confidence": round(confidence, 3),
        }

    except ImportError:
        # scikit-learn not available — MAD robust z-score fallback
        median = np.median(clean)
        mad = np.median(np.abs(clean - median))
        if mad == 0:
            return {"status": "Normal", "confidence": 0.1, "method": "MAD-fallback"}
        modified_z = 0.6745 * abs(value - median) / mad
        is_anomaly = modified_z > 3.5
        return {
            "status": "Anomaly" if is_anomaly else "Normal",
            "method": "MAD-robust-z",
            "modified_z_score": round(modified_z, 3),
            "confidence": round(min(modified_z / 6, 1.0), 3),
        }


# ── Ensemble Voting ───────────────────────────────────────────────────────────
def ensemble_vote(h: Dict, s: Dict, m: Dict) -> Dict:
    """
    Weighted ensemble vote across the three models.
    Weights are loaded dynamically from model store (updated nightly by retraining).
    """
    weights = _get_live_weights()
    votes = 0
    confidence = 0.0
    active_models = 0

    if h.get("status") == "Anomaly":
        votes += 1; confidence += weights["heuristic"] * h.get("confidence", 0.5)
    if h.get("status") in ("Anomaly", "Normal"):
        active_models += 1

    if s.get("status") == "Anomaly":
        votes += 1; confidence += weights["statistical"] * s.get("confidence", 0.5)
    if s.get("status") in ("Anomaly", "Normal"):
        active_models += 1

    if m.get("status") not in ("WarmingUp", None):
        active_models += 1
        if m.get("status") == "Anomaly":
            votes += 1; confidence += weights["ml"] * m.get("confidence", 0.5)

    # Anomaly if 2+ models agree, or if heuristic + statistical both flag
    is_anomaly = (votes >= 2) or (
        h.get("status") == "Anomaly" and s.get("status") == "Anomaly"
    )

    severity = "normal"
    if is_anomaly:
        severity = h.get("severity", "medium")
        if severity == "normal": severity = "medium"

    return {
        "is_anomaly": is_anomaly,
        "votes": votes,
        "active_models": active_models,
        "ensemble_confidence": round(min(confidence, 1.0), 3),
        "severity": severity,
        "weights_used": weights,
    }


# ── Main Engine ───────────────────────────────────────────────────────────────
class AnomalyDetectionEngine:

    def run(self, df: pd.DataFrame, custom_thresholds: Optional[Dict] = None, model_params: Optional[Dict] = None) -> Dict:
        """
        Run full anomaly detection on a dataframe.
        Returns per-parameter and per-row anomaly reports.
        """
        start = time.time()
        thresholds = {**DEFAULT_THRESHOLDS, **(custom_thresholds or {})}
        mp = model_params or {}
        iqr_mult   = float(mp.get('iqr_multiplier', 1.5))
        z_thresh   = float(mp.get('z_threshold', 2.5))
        contam     = float(mp.get('contamination', 0.1))
        min_samp   = int(mp.get('min_samples', 10))

        numeric_cols = df.select_dtypes(include="number").columns.tolist()
        ts_cols = [c for c in df.columns if any(w in c.lower() for w in ["time","date","timestamp"])]

        anomalies = []
        parameter_stats: Dict[str, Dict] = {}
        total_checks = 0
        total_anomalies = 0

        for col in numeric_cols:
            cfg = _find_threshold(col) or thresholds.get(col.upper().replace(" ","_").replace("-","_"))
            if cfg is None:
                continue  # No threshold defined — skip

            series = df[col].dropna()
            col_anomaly_count = 0

            for idx, value in series.items():
                if not isinstance(value, (int, float)) or math.isnan(value):
                    continue
                total_checks += 1

                h_result = heuristic_detection(float(value), cfg)
                s_result  = statistical_detection(float(value), series, cfg, iqr_mult, z_thresh)
                m_result  = ml_detection(float(value), series, contam, min_samp)
                vote      = ensemble_vote(h_result, s_result, m_result)

                if vote["is_anomaly"]:
                    total_anomalies += 1
                    col_anomaly_count += 1
                    # Timestamp
                    ts = None
                    for tc in ts_cols:
                        try: ts = str(df.loc[idx, tc]); break
                        except: pass

                    anomaly_record = {
                        "row_index":   int(idx),
                        "timestamp":   ts,
                        "parameter":   col,
                        "value":       round(float(value), 4),
                        "unit":        cfg.get("unit", ""),
                        "severity":    vote["severity"],
                        "ensemble_confidence": vote["ensemble_confidence"],
                        "votes":       vote["votes"],
                        "active_models": vote["active_models"],
                        "alarm_type":  h_result.get("alarm_type", "Unknown"),
                        "models": {
                            "heuristic":  {"status": h_result["status"],   "confidence": h_result["confidence"],   "alarm_type": h_result.get("alarm_type")},
                            "statistical":{"status": s_result["status"],   "confidence": s_result["confidence"],   "method": s_result.get("method")},
                            "ml":         {"status": m_result["status"],   "confidence": m_result.get("confidence", 0), "method": m_result.get("method","—"), "source": m_result.get("source","per_run_fit")},
                        },
                        "context": {
                            "threshold": cfg,
                            "iqr_bounds": s_result.get("iqr_bounds"),
                            "z_score": s_result.get("z_score"),
                        },
                    }

                    # XGBoost calibration layer (uses persisted model if available)
                    try:
                        from app.ml import anomaly_xgb as axgb
                        from app.ml import model_store
                        xgb_model = model_store.load_or_none("anomaly_xgb")
                        ps_entry  = parameter_stats.get(col, {})
                        calibration = axgb.calibrate_anomaly(xgb_model, anomaly_record, ps_entry)
                        anomaly_record["xgb_calibration"] = calibration
                    except Exception:
                        anomaly_record["xgb_calibration"] = {"xgb_active": False}

                    anomalies.append(anomaly_record)

            # Parameter-level stats
            anomaly_rate = (col_anomaly_count / max(len(series), 1)) * 100
            parameter_stats[col] = {
                "parameter": col,
                "unit": cfg.get("unit", ""),
                "total_records": len(series),
                "anomaly_count": col_anomaly_count,
                "anomaly_rate": round(anomaly_rate, 2),
                "severity": "critical" if anomaly_rate > 20 else ("high" if anomaly_rate > 10 else ("medium" if anomaly_rate > 2 else "normal")),
                "threshold": {"min": cfg["min"], "max": cfg["max"]},
                "stats": {
                    "mean": round(float(series.mean()), 4) if len(series) > 0 else None,
                    "std":  round(float(series.std()), 4)  if len(series) > 1 else None,
                    "min":  round(float(series.min()), 4)  if len(series) > 0 else None,
                    "max":  round(float(series.max()), 4)  if len(series) > 0 else None,
                },
            }

        processing_ms = round((time.time() - start) * 1000, 1)
        readiness_pct = round((1 - total_anomalies / max(total_checks, 1)) * 100, 2)

        return {
            "success":            True,
            "total_records":      len(df),
            "total_checks":       total_checks,
            "anomalies_detected": total_anomalies,
            "readiness_score":    readiness_pct,
            "parameters_checked": len(parameter_stats),
            "anomalies":          anomalies,
            "parameter_stats":    list(parameter_stats.values()),
            "model_weights":      _get_live_weights(),
            "processing_ms":      processing_ms,
            "summary": {
                "critical": sum(1 for a in anomalies if a["severity"] == "critical"),
                "high":     sum(1 for a in anomalies if a["severity"] == "high"),
                "medium":   sum(1 for a in anomalies if a["severity"] == "medium"),
            },
        }
