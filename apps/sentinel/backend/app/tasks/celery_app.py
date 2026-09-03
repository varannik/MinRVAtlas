from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

celery_app = Celery(
    "datasentinel",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.tasks.dqa_tasks"],
)
celery_app.conf.update(
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_soft_time_limit=300,
    task_time_limit=600,
    worker_prefetch_multiplier=1,
    task_default_retry_delay=60,

    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,

    # ── Beat schedule: nightly ML retraining + weekly protocol monitor ───
    # All schedules live here (not in APScheduler) so jobs fire once per interval,
    # not once per gunicorn worker process.
    beat_schedule={
        "retrain-dqa-xgb-nightly": {
            "task": "retrain_dqa_model",
            "schedule": crontab(hour=2, minute=0),   # 02:00 UTC nightly
            "options": {"queue": "celery"},
        },
        "retrain-anomaly-models-nightly": {
            "task": "retrain_anomaly_models",
            "schedule": crontab(hour=2, minute=30),  # 02:30 UTC nightly
            "options": {"queue": "celery"},
        },
        "protocol-monitor-weekly": {
            "task": "run_protocol_monitor",
            "schedule": crontab(hour=6, minute=0, day_of_week=1),  # Mon 06:00 UTC
            "options": {"queue": "celery"},
        },
        "gc-revoked-tokens-nightly": {
            "task": "gc_revoked_tokens",
            "schedule": crontab(hour=3, minute=0),   # 03:00 UTC nightly
            "options": {"queue": "celery"},
        },
        "gc-run-progress-events-nightly": {
            "task": "gc_run_progress_events",
            "schedule": crontab(hour=3, minute=15),  # 03:15 UTC nightly
            "options": {"queue": "celery"},
        },
    },
    beat_scheduler="celery.beat:PersistentScheduler",
)
