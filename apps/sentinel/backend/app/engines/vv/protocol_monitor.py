"""
Protocol Website Monitor
Fetches registry protocol pages weekly, compares SHA-256 content hash,
and generates AI-powered change summaries when content changes are detected.
Creates pending VVProtocolUpdateLog entries for admin review.
"""
import hashlib
import logging
import uuid as _uuid

logger = logging.getLogger("datasentinel.vv.protocol_monitor")

FETCH_TIMEOUT = 30          # seconds
MAX_CONTENT_BYTES = 500_000  # 500 KB cap per page


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


async def fetch_url_content(url: str) -> tuple[bytes | None, str | None]:
    """
    Fetch URL content and return (raw_bytes, error_message).
    Accepts any HTTP status — registry sites often return 403/429 to bots.
    Only fails on true network errors (DNS, timeout, SSL, connection refused).
    """
    try:
        import httpx
        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; DataSentinel-ProtocolMonitor/1.0; +https://datasentinel.io)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        }
        async with httpx.AsyncClient(timeout=FETCH_TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            # Accept any HTTP response — even 403/404 pages have stable content to hash
            raw = resp.content[:MAX_CONTENT_BYTES]
            # Prefix status code so a page going from 200→404 is detected as a change
            prefix = f"HTTP {resp.status_code}\n".encode()
            return prefix + raw, None
    except Exception as e:
        return None, str(e)


def extract_visible_text(raw_bytes: bytes) -> str:
    """Strip HTML tags and return visible text content."""
    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(raw_bytes, "html.parser")
        # Remove script and style elements
        for tag in soup(["script", "style", "nav", "footer", "header"]):
            tag.decompose()
        return soup.get_text(separator="\n", strip=True)[:50_000]
    except Exception:
        # Fallback: basic HTML strip
        import re
        text = raw_bytes.decode("utf-8", errors="replace")
        text = re.sub(r"<[^>]+>", " ", text)
        return text[:50_000]


async def generate_change_summary(old_text: str, new_text: str, protocol_name: str) -> str:
    """Use Claude to generate a human-readable summary of what changed."""
    try:
        from app.engines.ai.claude_client import call_claude_json
        prompt = f"""A carbon credit registry protocol page has changed.

Protocol: {protocol_name}

Summarise the key differences between the old and new page content.
Focus on changes to: requirements, checkpoints, eligibility criteria, monitoring rules, or version numbers.
Ignore navigation, styling, or marketing text changes.

OLD CONTENT (last 2000 chars):
{old_text[-2000:]}

NEW CONTENT (last 2000 chars):
{new_text[-2000:]}

Return a JSON object with:
- summary: 1-2 sentence plain English summary of what changed
- change_significance: "major" | "minor" | "cosmetic"
- affected_areas: list of areas affected (e.g. ["monitoring requirements", "eligibility criteria"])
- requires_review: true if admin should review this change"""

        result = await call_claude_json(prompt)
        if isinstance(result, dict):
            return result.get("summary", "Content changed — admin review recommended.")
        return "Protocol page content has changed — admin review recommended."
    except Exception:
        return "Protocol page content has changed — admin review recommended."


async def check_protocol_website(protocol, db) -> dict:
    """
    Check a single protocol's website URL for content changes.
    Returns result dict with status and any changes found.
    """

    from app.models import VVProtocolUpdateLog

    if not protocol.source_url:
        return {"protocol_id": str(protocol.id), "status": "skipped", "reason": "no_url"}

    raw_bytes, error = await fetch_url_content(protocol.source_url)
    if error:
        logger.warning(f"Failed to fetch {protocol.source_url}: {error}")
        return {"protocol_id": str(protocol.id), "status": "error", "error": error}

    new_hash = _sha256(raw_bytes)
    stored_hash = protocol.website_content_hash

    if stored_hash and stored_hash == new_hash:
        # Update last_verified_at even when no change
        from sqlalchemy import text
        try:
            db.execute(text(
                "UPDATE vv_protocols SET last_verified_at = NOW(), verified_by = 'web_monitor' "
                "WHERE id = :id"
            ), {"id": str(protocol.id)})
            db.commit()
        except Exception:
            pass
        return {"protocol_id": str(protocol.id), "status": "no_change"}

    # Content changed — generate summary and create pending log entry
    old_text = ""
    if stored_hash:
        # We don't store old text, but we pass empty string to AI
        old_text = "(previous version — hash: " + stored_hash[:16] + ")"
    new_text = extract_visible_text(raw_bytes)

    change_summary = await generate_change_summary(old_text, new_text, protocol.name)

    try:
        entry = VVProtocolUpdateLog(
            id=_uuid.uuid4(),
            protocol_id=protocol.id,
            proposed_by="web_monitor",
            change_type="metadata_update",
            checkpoint_id_affected=None,
            old_value={"website_content_hash": stored_hash},
            new_value={"website_content_hash": new_hash, "change_summary": change_summary},
            status="pending",
            notes=f"Automated website change detected: {change_summary}",
            source=protocol.source_url,
        )
        db.add(entry)

        # Update stored hash and last verified
        from sqlalchemy import text
        db.execute(text(
            "UPDATE vv_protocols SET website_content_hash = :hash, "
            "last_verified_at = NOW(), verified_by = 'web_monitor' WHERE id = :id"
        ), {"hash": new_hash, "id": str(protocol.id)})
        db.commit()

        # Create in-app notification for admins
        try:
            from app.models import Notification
            notif = Notification(
                user_id=None,  # broadcast to all
                title=f"Protocol Update Detected: {protocol.name}",
                message=f"Registry website change detected. {change_summary} Review pending in Protocol Manager.",
                event_type="protocol_change_detected",
                entity_type="vv_protocol",
                entity_id=protocol.id,
            )
            db.add(notif)
            db.commit()
        except Exception as ne:
            logger.warning(f"Notification creation failed: {ne}")

        logger.info(f"Protocol change detected: {protocol.code} — {change_summary[:100]}")
        return {
            "protocol_id": str(protocol.id),
            "protocol_code": protocol.code,
            "status": "changed",
            "summary": change_summary,
            "old_hash": stored_hash,
            "new_hash": new_hash,
        }
    except Exception as e:
        logger.error(f"Failed to record protocol change: {e}")
        try: db.rollback()
        except: pass
        return {"protocol_id": str(protocol.id), "status": "error", "error": str(e)}


async def run_all_protocol_monitors() -> dict:
    """
    Main entry point called by APScheduler.
    Checks all active protocols with a source_url for content changes.
    """
    from app.core.database import SessionLocal
    from app.models import VVProtocol

    db = SessionLocal()
    results = []
    try:
        protocols = db.query(VVProtocol).filter(
            VVProtocol.status == "active",
            VVProtocol.source_url.isnot(None)
        ).all()
        logger.info(f"Protocol monitor: checking {len(protocols)} protocols")

        for protocol in protocols:
            result = await check_protocol_website(protocol, db)
            results.append(result)

        changed = [r for r in results if r.get("status") == "changed"]
        errors = [r for r in results if r.get("status") == "error"]
        logger.info(f"Protocol monitor complete: {len(changed)} changed, {len(errors)} errors, "
                    f"{len(results) - len(changed) - len(errors)} unchanged")
        return {
            "checked": len(results),
            "changed": len(changed),
            "errors": len(errors),
            "details": results,
        }
    except Exception as e:
        logger.error(f"Protocol monitor run failed: {e}")
        return {"error": str(e)}
    finally:
        try: db.close()
        except: pass
