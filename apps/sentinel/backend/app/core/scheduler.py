"""
Scheduler shim — background jobs delegated to Celery Beat where possible.
A lightweight in-process thread handles webhook retries (Task-31) since
that needs to run every ~60s regardless of whether a Celery worker is live.
"""
import logging
import threading

logger = logging.getLogger("datasentinel.scheduler")

_retry_thread: threading.Thread | None = None
_retry_stop_event = threading.Event()


def _webhook_retry_loop():
    """Background thread: retry failed webhook deliveries every 60 seconds."""
    logger.info("Webhook retry worker started")
    while not _retry_stop_event.wait(60):
        try:
            from app.api.v1.webhooks import retry_pending_webhooks
            retry_pending_webhooks()
        except Exception as exc:
            logger.warning("Webhook retry loop error: %s", exc)
    logger.info("Webhook retry worker stopped")


def start_scheduler():
    """Start the webhook retry background thread. Celery Beat handles ML jobs."""
    global _retry_thread
    _retry_stop_event.clear()
    _retry_thread = threading.Thread(
        target=_webhook_retry_loop, daemon=True, name="webhook-retry-worker"
    )
    _retry_thread.start()
    logger.info("Scheduler started: webhook retry worker active; ML retraining via Celery Beat")


def stop_scheduler():
    """Stop the webhook retry thread gracefully."""
    _retry_stop_event.set()
    if _retry_thread and _retry_thread.is_alive():
        _retry_thread.join(timeout=5)
        # Fix: detect and log when join() timed out (thread still alive)
        if _retry_thread.is_alive():
            logger.warning(
                "Webhook retry thread did not stop within 5s — it may still be "
                "mid-flight. The thread is a daemon so it will be killed when the "
                "process exits, but any in-flight DB write may be incomplete."
            )
    logger.info("Scheduler stopped")


async def trigger_protocol_monitor_now() -> dict:
    """Manually trigger a protocol monitor run (called from API endpoint)."""
    from app.engines.vv.protocol_monitor import run_all_protocol_monitors
    return await run_all_protocol_monitors()
