"""Settings the AgentCore Runtime passes in (infra/lib/cortex/agent-stack.ts).

Run locally with the same names set in the shell (see ../README.md).
"""

import os
from dataclasses import dataclass


class NotConfigured(RuntimeError):
    """A setting the agent cannot run without is missing."""


@dataclass(frozen=True)
class Settings:
    region: str
    # Claude on Amazon Bedrock through the EU inference profile, so requests stay in EU regions.
    model_id: str
    effort: str
    gateway_url: str
    # The user pool that signs access tokens. Every request's token is checked against it.
    cognito_issuer: str
    cognito_client_ids: frozenset[str]
    # Conversations: DynamoDB through a tenant-tagged session. Unset locally: kept in memory.
    checkpoint_table: str | None
    tenant_session_role_arn: str | None
    checkpoint_ttl_days: int


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise NotConfigured(f"{name} is not set.")
    return value


def load() -> Settings:
    table = os.environ.get("CHECKPOINT_TABLE", "").strip() or None
    role = os.environ.get("TENANT_SESSION_ROLE_ARN", "").strip() or None
    if table and not role:
        raise NotConfigured("CHECKPOINT_TABLE needs TENANT_SESSION_ROLE_ARN: checkpoints are only reached as the tenant.")
    return Settings(
        region=os.environ.get("CORTEX_REGION", "").strip() or os.environ.get("AWS_REGION", "").strip() or "eu-west-2",
        model_id=_required("MODEL_ID"),
        effort=os.environ.get("MODEL_EFFORT", "").strip() or "medium",
        gateway_url=_required("GATEWAY_URL"),
        cognito_issuer=_required("COGNITO_ISSUER").rstrip("/"),
        cognito_client_ids=frozenset(
            client.strip() for client in os.environ.get("COGNITO_CLIENT_IDS", "").split(",") if client.strip()
        ),
        checkpoint_table=table,
        tenant_session_role_arn=role,
        checkpoint_ttl_days=int(os.environ.get("CHECKPOINT_TTL_DAYS", "") or 30),
    )
