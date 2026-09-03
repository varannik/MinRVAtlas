"""
Provider-agnostic LLM client for DataSentinel AI agents.

Supports Anthropic (Claude), OpenAI (GPT), and Azure OpenAI (Microsoft Foundry).
Selected via LLM_PROVIDER env var — all agent code is unchanged.

  LLM_PROVIDER=azure_openai →  uses AZURE_OPENAI_DEPLOYMENT name  (default)
  LLM_PROVIDER=anthropic    →  claude-opus-4-5
  LLM_PROVIDER=openai       →  gpt-4o
  LLM_MODEL=<name>          →  override the default model for anthropic / openai
"""
import json
import logging
from typing import Any, Dict, Optional

import httpx

from app.core.config import settings

logger = logging.getLogger("datasentinel.ai")

# ── Provider defaults (not used for azure_openai — endpoint is dynamic) ───────
_DEFAULTS = {
    "anthropic": {
        "model":   "claude-opus-4-5",
        "api_url": "https://api.anthropic.com/v1/messages",
    },
    "openai": {
        "model":   "gpt-4o",
        "api_url": "https://api.openai.com/v1/chat/completions",
    },
}

_VALID_PROVIDERS = {"anthropic", "openai", "azure_openai"}

# Last error detail — set by call_claude on failure so callers can surface it
_last_call_error: str = ""


def _provider() -> str:
    p = (settings.LLM_PROVIDER or "azure_openai").lower().strip()
    if p not in _VALID_PROVIDERS:
        logger.warning("Unknown LLM_PROVIDER '%s' — falling back to 'azure_openai'", p)
        return "azure_openai"
    return p


def _model(provider: str) -> str:
    """Return LLM_MODEL override if set, otherwise the provider default."""
    if provider == "azure_openai":
        # Azure uses the deployment name; LLM_MODEL can override it
        return (settings.LLM_MODEL or "").strip() or settings.AZURE_OPENAI_DEPLOYMENT or "gpt-4o"
    return (settings.LLM_MODEL or "").strip() or _DEFAULTS[provider]["model"]


def _api_key(provider: str) -> Optional[str]:
    if provider == "openai":
        return settings.OPENAI_API_KEY or None
    if provider == "azure_openai":
        return settings.AZURE_OPENAI_API_KEY or None
    return settings.ANTHROPIC_API_KEY or None


def _key_env_name(provider: str) -> str:
    return {
        "anthropic":    "ANTHROPIC_API_KEY",
        "openai":       "OPENAI_API_KEY",
        "azure_openai": "AZURE_OPENAI_API_KEY",
    }.get(provider, "API_KEY")


# ── Anthropic ─────────────────────────────────────────────────────────────────

def _anthropic_payload(system: str, user: str, model: str, max_tokens: int) -> dict:
    return {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }


def _anthropic_headers(api_key: str) -> dict:
    return {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }


def _anthropic_extract(data: dict) -> str:
    return data["content"][0]["text"]


# ── OpenAI (direct) ───────────────────────────────────────────────────────────

def _openai_payload(system: str, user: str, model: str, max_tokens: int) -> dict:
    return {
        "model": model,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
    }


def _openai_headers(api_key: str) -> dict:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def _openai_extract(data: dict) -> str:
    return data["choices"][0]["message"]["content"]


# ── Azure OpenAI ─────────────────────────────────────────────────────────────
# Endpoint format:
#   https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions?api-version=...
# Auth: api-key header (not Bearer)
# Body: same shape as OpenAI but model field is ignored (deployment is in URL)

def _azure_url(deployment: str) -> str:
    base = (settings.AZURE_OPENAI_ENDPOINT or "").rstrip("/")
    version = settings.AZURE_OPENAI_API_VERSION or "2024-02-15-preview"
    return f"{base}/openai/deployments/{deployment}/chat/completions?api-version={version}"


def _azure_payload(system: str, user: str, max_tokens: int) -> dict:
    # model field not needed — deployment is in the URL
    return {
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
    }


def _azure_headers(api_key: str) -> dict:
    return {
        "api-key": api_key,           # Azure uses api-key, not Authorization: Bearer
        "Content-Type": "application/json",
    }


# response shape is identical to OpenAI
_azure_extract = _openai_extract


# ── Public interface ──────────────────────────────────────────────────────────

async def call_claude(
    system: str,
    user: str,
    max_tokens: int = 2000,
    model: str = "",        # leave blank to use provider default / LLM_MODEL
    timeout: int = 120,     # httpx per-attempt timeout in seconds
) -> Optional[str]:
    """
    Call the configured LLM and return the raw text response.
    Returns None if the API key is not configured or on any error.

    Pass timeout=25 for endpoints that have a fast local fallback (e.g. document
    classification) so slow LLM responses fall back quickly rather than blocking
    until the ALB 60-second idle timeout kills the connection.
    """
    global _last_call_error
    _last_call_error = ""

    provider = _provider()
    api_key  = _api_key(provider)

    if not api_key:
        _last_call_error = f"{provider.upper()} API key not set — configure {_key_env_name(provider)} in ECS"
        logger.warning("%s", _last_call_error)
        return None

    resolved_model = model or _model(provider)

    # Build request components per provider
    if provider == "anthropic":
        api_url = _DEFAULTS["anthropic"]["api_url"]
        payload = _anthropic_payload(system, user, resolved_model, max_tokens)
        headers = _anthropic_headers(api_key)
        extract = _anthropic_extract

    elif provider == "openai":
        api_url = _DEFAULTS["openai"]["api_url"]
        payload = _openai_payload(system, user, resolved_model, max_tokens)
        headers = _openai_headers(api_key)
        extract = _openai_extract

    else:  # azure_openai
        deployment = resolved_model
        if not settings.AZURE_OPENAI_ENDPOINT:
            _last_call_error = "AZURE_OPENAI_ENDPOINT not configured in ECS"
            logger.warning("%s", _last_call_error)
            return None
        api_url = _azure_url(deployment)
        payload = _azure_payload(system, user, max_tokens)
        headers = _azure_headers(api_key)
        extract = _azure_extract

    logger.info(
        "LLM call → provider=%s model=%s max_tokens=%s prompt_len=%s",
        provider, resolved_model, max_tokens, len(user),
    )

    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(api_url, headers=headers, json=payload)

            if resp.status_code == 200:
                return extract(resp.json())

            # 429 rate limit or 5xx — retry with backoff
            if resp.status_code in (429, 500, 502, 503, 504) and attempt < 2:
                import asyncio
                wait = 2 ** attempt * 2
                logger.warning(
                    "%s API %s on attempt %d — retrying in %ds",
                    provider.upper(), resp.status_code, attempt + 1, wait,
                )
                await asyncio.sleep(wait)
                continue

            logger.error(
                "%s API error %s | url=%s | body=%s",
                provider.upper(), resp.status_code, api_url, resp.text[:500],
            )
            _last_call_error = f"{provider.upper()} HTTP {resp.status_code}: {resp.text[:300]}"
            return None

        except httpx.TimeoutException as exc:
            last_exc = exc
            _last_call_error = f"{provider.upper()} timeout after {timeout}s (prompt may be too large)"
            logger.warning("LLM timeout on attempt %d (timeout=%ds): %s", attempt + 1, timeout, exc)
            if attempt < 2:
                import asyncio
                await asyncio.sleep(2 ** attempt * 2)
                continue
        except (httpx.ConnectError, httpx.ReadError) as exc:
            last_exc = exc
            _last_call_error = f"{provider.upper()} connection error: {exc}"
            if attempt < 2:
                import asyncio
                wait = 2 ** attempt * 2
                logger.warning(
                    "%s API transient error on attempt %d (%s) — retrying in %ds",
                    provider.upper(), attempt + 1, exc, wait,
                )
                await asyncio.sleep(wait)
                continue
        except Exception as exc:
            _last_call_error = f"{provider.upper()} unexpected error: {exc}"
            logger.error("%s API call failed: %s", provider.upper(), exc)
            return None

    logger.error("%s API call failed after 3 attempts: %s", provider.upper(), last_exc)
    return None


async def call_claude_json(
    system: str,
    user: str,
    max_tokens: int = 2000,
    timeout: int = 120,
) -> Optional[Dict[str, Any]]:
    """
    Call the configured LLM and parse the response as JSON.
    Handles markdown code fences automatically.

    Pass timeout=25 for classification tasks that have a fast local fallback —
    this ensures the keyword-based fallback always runs well within the ALB
    idle timeout (60 s) even when the LLM endpoint is slow or rate-limited.
    """
    raw = await call_claude(system, user, max_tokens, timeout=timeout)
    if not raw:
        return None

    text = raw.strip()
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0].strip()
    elif "```" in text:
        text = text.split("```")[1].split("```")[0].strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        global _last_call_error
        _last_call_error = f"JSON parse error — response was not valid JSON. First 300 chars: {text[:300]}"
        logger.error("LLM response is not valid JSON (%s): %s", exc, text[:300])
        return None
