"""Where conversations are kept between requests.

LangGraph checkpoints go to the Cortex checkpoints table in DynamoDB. The
agent's own role cannot touch that table: it assumes the tenant-session role
with the caller's tenant_id and project_id as session tags, and that role may
only use items whose key starts with the tenant (knowledge-stack.ts,
OwnTenantCheckpointsOnly). Thread ids therefore start "{tenant}#{project}#".

Without CHECKPOINT_TABLE (a local run) conversations are kept in memory.
"""

import asyncio
import time
from dataclasses import dataclass

import boto3
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver
from langgraph_checkpoint_aws import DynamoDBSaver

from .identity import Caller
from .settings import Settings

SESSION_SECONDS = 900
RENEW_BEFORE_SECONDS = 120


def thread_id(caller: Caller, project_id: str, conversation_id: str) -> str:
    """One conversation of one user on one project. The user's sub keeps it theirs."""
    return f"{caller.tenant_id}#{project_id}#{caller.sub}#{conversation_id}"


@dataclass
class _Held:
    saver: BaseCheckpointSaver
    renew_at: float


class Checkpoints:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._memory = InMemorySaver()
        self._held: dict[tuple[str, str], _Held] = {}
        self._sts = boto3.client("sts", region_name=settings.region) if settings.checkpoint_table else None

    async def saver(self, caller: Caller, project_id: str) -> BaseCheckpointSaver:
        if not self.settings.checkpoint_table:
            return self._memory
        key = (caller.tenant_id, project_id)
        held = self._held.get(key)
        if held and held.renew_at > time.time():
            return held.saver
        saver = await asyncio.to_thread(self._tenant_saver, caller, project_id)
        self._held[key] = _Held(saver, time.time() + SESSION_SECONDS - RENEW_BEFORE_SECONDS)
        return saver

    def _tenant_saver(self, caller: Caller, project_id: str) -> DynamoDBSaver:
        credentials = self._sts.assume_role(
            RoleArn=self.settings.tenant_session_role_arn,
            RoleSessionName=f"cortex-agent-{caller.sub}"[:64],
            DurationSeconds=SESSION_SECONDS,
            Tags=[{"Key": "tenant_id", "Value": caller.tenant_id}, {"Key": "project_id", "Value": project_id}],
        )["Credentials"]
        session = boto3.Session(
            aws_access_key_id=credentials["AccessKeyId"],
            aws_secret_access_key=credentials["SecretAccessKey"],
            aws_session_token=credentials["SessionToken"],
            region_name=self.settings.region,
        )
        return DynamoDBSaver(
            table_name=self.settings.checkpoint_table,
            session=session,
            region_name=self.settings.region,
            ttl_seconds=self.settings.checkpoint_ttl_days * 86400,
            enable_checkpoint_compression=True,
        )
