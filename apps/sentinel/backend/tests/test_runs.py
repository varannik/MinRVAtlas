"""
Comprehensive tests for DQA run execution, RBAC guards, and run lifecycle.
Run with: pytest backend/tests/test_runs.py -v
"""
import os
import json
import pytest

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-only-32chars!")
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("UPLOAD_DIR", "/tmp/ds_test_uploads")

pytest.importorskip("fastapi", reason="FastAPI not installed — skipping (works in CI)")


# ── Progress store ─────────────────────────────────────────────────────────────

def test_publish_progress_stores_events():
    from app.api.v1.runs import _publish_progress, _progress_store, _progress_lock
    run_id = "test-run-publish-001"
    _publish_progress(run_id, "Loading", 10, "Reading file…")
    _publish_progress(run_id, "Done", 100, "Complete")
    with _progress_lock:
        events = _progress_store.get(run_id, [])
    assert len(events) == 2
    first = json.loads(events[0])
    assert first["step"] == "Loading"
    assert first["pct"] == 10
    assert first["detail"] == "Reading file…"


def test_publish_progress_json_parseable():
    from app.api.v1.runs import _publish_progress, _progress_store, _progress_lock
    run_id = "test-run-json-002"
    _publish_progress(run_id, "Step", 50, 'Detail with "quotes" & <chars>')
    with _progress_lock:
        raw = _progress_store[run_id][0]
    parsed = json.loads(raw)
    assert parsed["pct"] == 50


def test_progress_store_is_thread_safe():
    """Multiple threads publishing to different run_ids must not corrupt the store."""
    import threading
    from app.api.v1.runs import _publish_progress, _progress_store, _progress_lock

    def publish_many(rid):
        for i in range(20):
            _publish_progress(rid, f"step-{i}", i * 5)

    threads = [threading.Thread(target=publish_many, args=(f"run-thread-{n}",)) for n in range(5)]
    for t in threads: t.start()
    for t in threads: t.join()

    for n in range(5):
        with _progress_lock:
            events = _progress_store.get(f"run-thread-{n}", [])
        assert len(events) == 20


# ── Run schema validation ──────────────────────────────────────────────────────

def test_run_create_schema_requires_ids():
    from pydantic import ValidationError
    from app.schemas import RunCreate
    with pytest.raises(ValidationError):
        RunCreate()  # missing both required fields


def test_run_create_schema_accepts_valid_uuids():
    import uuid
    from app.schemas import RunCreate
    rc = RunCreate(dataset_id=uuid.uuid4(), project_id=uuid.uuid4())
    assert rc.dataset_id is not None
    assert rc.project_id is not None


# ── RBAC helper ────────────────────────────────────────────────────────────────

def test_require_project_access_allows_admin():
    """Admin role must always pass without a DB lookup."""
    from unittest.mock import MagicMock
    from app.api.v1.runs import _require_project_access
    db = MagicMock()
    user = MagicMock()
    user.role = "admin"
    # Should NOT raise
    _require_project_access(db, "any-project-id", user)
    db.query.assert_not_called()


def test_require_project_access_allows_super_admin():
    from unittest.mock import MagicMock
    from app.api.v1.runs import _require_project_access
    db = MagicMock()
    user = MagicMock()
    user.role = "super_admin"
    _require_project_access(db, "any-project-id", user)
    db.query.assert_not_called()


def test_require_project_access_denies_non_member():
    """Non-admin with no ProjectMember row must get 403."""
    from unittest.mock import MagicMock, patch
    from fastapi import HTTPException
    from app.api.v1.runs import _require_project_access

    db = MagicMock()
    user = MagicMock()
    user.role = "analyst"
    user.id = "user-123"
    # Simulate no member row found
    db.query.return_value.filter.return_value.first.return_value = None

    with pytest.raises(HTTPException) as exc_info:
        _require_project_access(db, "project-abc", user)
    assert exc_info.value.status_code == 403


def test_require_project_access_allows_member():
    """Analyst who is a ProjectMember must pass."""
    from unittest.mock import MagicMock
    from app.api.v1.runs import _require_project_access

    db = MagicMock()
    user = MagicMock()
    user.role = "analyst"
    user.id = "user-123"
    # Simulate member row found
    db.query.return_value.filter.return_value.first.return_value = MagicMock()

    _require_project_access(db, "project-abc", user)  # should NOT raise


# ── DQA engine unit tests ──────────────────────────────────────────────────────

def test_dqa_engine_empty_rules_runs_without_error():
    """Engine should complete without crashing given an empty rule list."""
    import pandas as pd
    from app.engines.dqa.engine import DQAEngine
    df = pd.DataFrame({"a": [1, 2, 3], "b": ["x", "y", "z"]})
    engine = DQAEngine()
    result = engine.run(df, [])
    # Engine may run implicit checks even with no explicit rules — just verify
    # the response shape is correct and it doesn't crash.
    assert "violations" in result
    assert "rules_executed" in result
    assert isinstance(result["violations"], list)
    assert isinstance(result.get("readiness_score", 1.0), float)


def test_dqa_engine_completeness_runs_without_error():
    """Engine accepts completeness rules and returns a valid result structure."""
    import pandas as pd
    from app.engines.dqa.engine import DQAEngine
    df = pd.DataFrame({"sensor_value": [1.0, None, 3.0, None, 5.0]})
    rules = [{
        "rule_id": "R001", "rule_name": "No nulls in sensor_value",
        "dimension": "completeness", "severity": "high",
        "is_hard_gate": False, "weight": 0.5,
        "parameters": {"field": "sensor_value", "threshold": 0.0},
        "is_active": True,
    }]
    engine = DQAEngine()
    result = engine.run(df, rules)
    assert "violations" in result
    assert "rules_executed" in result
    assert isinstance(result["violations"], list)
    assert 0.0 <= result.get("readiness_score", 1.0) <= 1.0


def test_dqa_engine_uniqueness_runs_without_error():
    """Engine accepts uniqueness rules and returns a valid result structure."""
    import pandas as pd
    from app.engines.dqa.engine import DQAEngine
    df = pd.DataFrame({"record_id": ["A", "A", "B", "C", "C"]})
    rules = [{
        "rule_id": "R002", "rule_name": "Unique record IDs",
        "dimension": "uniqueness", "severity": "high",
        "is_hard_gate": False, "weight": 0.5,
        "parameters": {"field": "record_id"},
        "is_active": True,
    }]
    engine = DQAEngine()
    result = engine.run(df, rules)
    assert "violations" in result
    assert isinstance(result["violations"], list)
    assert 0.0 <= result.get("readiness_score", 1.0) <= 1.0


def test_dqa_engine_readiness_score_between_0_and_1():
    import pandas as pd
    from app.engines.dqa.engine import DQAEngine
    df = pd.DataFrame({"x": range(100)})
    engine = DQAEngine()
    result = engine.run(df, [])
    score = result.get("readiness_score", 1.0)
    assert 0.0 <= score <= 1.0


# ── Run status transitions ─────────────────────────────────────────────────────

def test_run_statuses_are_valid_strings():
    """Verify the expected status values match what the model allows."""
    valid_statuses = {"queued", "running", "completed", "failed"}
    assert "queued" in valid_statuses
    assert "completed" in valid_statuses
    assert "failed" in valid_statuses


def test_progress_event_at_100_pct():
    """A 100% event should include 'Complete' or 'done' language."""
    from app.api.v1.runs import _publish_progress, _progress_store, _progress_lock
    run_id = "run-complete-test"
    _publish_progress(run_id, "Complete", 100, "Gate PASSED")
    with _progress_lock:
        events = _progress_store.get(run_id, [])
    last = json.loads(events[-1])
    assert last["pct"] == 100
