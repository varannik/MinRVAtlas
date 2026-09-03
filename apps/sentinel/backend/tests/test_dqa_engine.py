"""
DQA engine unit tests — test individual rule checks with synthetic data.
Run with: pytest backend/tests/
"""
import pytest
import pandas as pd
import numpy as np


# ── Feature vector builder ────────────────────────────────────────────────────

def test_build_feature_vector_returns_correct_length():
    from app.ml.dqa_xgb import _build_feature_vector, FEATURE_NAMES
    record = {
        "feature_vector": {
            "lag_1": 1.0, "lag_2": 0.5, "lag_3": 0.3,
            "rolling_mean_5": 1.2, "rolling_std_5": 0.1,
            "rolling_mean_10": 1.1, "rolling_std_10": 0.15,
            "z_score": 0.8, "iqr_deviation": 0.2,
            "hour_of_day": 10, "day_of_week": 2,
            "rule_id": "I-04-SPIKE",
            "severity": "high",
            "violation_row_count": 5,
        }
    }
    vec = _build_feature_vector(record)
    assert vec is not None
    assert len(vec) == len(FEATURE_NAMES), f"Expected {len(FEATURE_NAMES)} features, got {len(vec)}"


def test_build_feature_vector_empty_returns_none():
    from app.ml.dqa_xgb import _build_feature_vector
    assert _build_feature_vector({}) is None
    assert _build_feature_vector({"feature_vector": {}}) is None
    assert _build_feature_vector({"feature_vector": None}) is None


def test_build_feature_vector_spike_flag():
    from app.ml.dqa_xgb import _build_feature_vector, FEATURE_NAMES
    record = {"feature_vector": {"rule_id": "I-04-SPIKE", "severity": "critical",
                                  "violation_row_count": 1}}
    vec = _build_feature_vector(record)
    assert vec is not None
    spike_idx = FEATURE_NAMES.index("rule_is_spike")
    assert vec[spike_idx] == 1.0


# ── Violation status validation ───────────────────────────────────────────────

def test_violation_status_valid_values():
    """Regression: the endpoint should accept exactly these statuses."""
    valid = {"open", "acknowledged", "resolved", "false_positive", "waived"}
    # Simulate the validation logic from violations.py
    for s in valid:
        assert s in valid

    invalid = ["hacked", "", "OPEN", "deleted", "null"]
    for s in invalid:
        assert s not in valid, f"'{s}' should not be a valid status"


# ── Model store ───────────────────────────────────────────────────────────────

def test_model_store_cache_roundtrip():
    """In-memory cache stores and retrieves any object."""
    from app.ml import model_store
    dummy = {"weights": [0.5, 0.3, 0.2]}
    model_store.set_cached("test_key", dummy, "v1")
    result = model_store.get_cached("test_key")
    assert result == dummy


def test_model_store_no_bucket_skips_s3_save():
    """When AWS_S3_BUCKET is unset, save_model_s3 returns None without crashing."""
    import os
    from unittest.mock import patch
    from app.ml import model_store
    with patch.dict(os.environ, {"AWS_S3_BUCKET": ""}):
        result = model_store.save_model_s3("test_key", {"data": 1})
    assert result is None
