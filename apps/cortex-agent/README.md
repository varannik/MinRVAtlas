# Cortex agent

Answers questions on the Cortex page from the knowledge Cortex holds, citing the rule, document and page.
It runs on Amazon Bedrock AgentCore Runtime in eu-west-2 (`infra/lib/cortex/agent-stack.ts`).

- **Model:** Claude through the Anthropic SDK's Bedrock client, on the EU inference profile, so prompts stay in EU regions. The model is `CORTEX_AGENT_MODEL` in `infra/lib/config.ts`.
- **Steps:** a LangGraph graph (`cortex_agent/graph.py`). Claude thinks, Cortex tools act, and this repeats until Claude answers, with at most four rounds of tool calls per question.
- **Tools:** the Cortex tool gateway, called with the signed-in user's own token. The gateway checks the tenant and project grant on every call. Claude has two:
  - `search_knowledge` (`knowledge___search`): registry, organisation and project documents, cited by rule and page.
  - `journey_status` (`journey___status`): where the project stands on its saved journey, what is left and what Cortex flagged.
- **Tool list per conversation:** a conversation keeps the tools it began with (`prompt.py`). A conversation begun before `journey_status` keeps searching only, so its thinking blocks stay valid.
- **Conversations:** LangGraph checkpoints in DynamoDB, reached only through the tenant-session role tagged with the user's tenant.
- **Answer log:** one `cortex_answer` JSON line per question. It records who asked, what was searched, the passages read and the ones cited. It never records the question or answer text.

## Request and events

Request: `POST /invocations` with `Authorization: Bearer <Cognito access token>` and this body:

```json
{"question": "How long is the crediting period?", "project_id": "fujairah-mineral", "conversation_id": "<uuid>"}
```

The answer comes back as server-sent events. Each one is a JSON object with one of these types:

| Type | Meaning |
| --- | --- |
| `status` | What Cortex is doing, for example "Searching: crediting period". |
| `sources` | The passages a search found, with rule number, section, document and page. |
| `text` | Part of the answer, as Claude writes it. |
| `reset` | Drop the text written so far: it came before a search. |
| `done` | The answer is complete. Lists the turn number and the ids of the sources it cited. |
| `error` | A message that is safe to show. The stream ends after it. |

The browser never calls the agent directly. `apps/web/src/app/api/cortex/ask/route.ts` checks the project grant, then forwards the user's token.

## Tests

```bash
cd apps/cortex-agent
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt pytest
.venv/bin/python -m pytest -q
```

## Run it locally

The local agent uses your AWS credentials for Bedrock and the real tool gateway. Conversations are kept in memory unless you set `CHECKPOINT_TABLE` and `TENANT_SESSION_ROLE_ARN`.

```bash
export MODEL_ID=eu.anthropic.claude-sonnet-4-6
export GATEWAY_URL=$(aws cloudformation describe-stacks --stack-name minrv-ew2-sandbox-cortex-agent \
  --query "Stacks[0].Outputs[?OutputKey=='GatewayUrl'].OutputValue" --output text)
export COGNITO_ISSUER=https://cognito-idp.eu-west-2.amazonaws.com/<user pool id>
export COGNITO_CLIENT_IDS=<web app client id>
.venv/bin/python -m cortex_agent.main      # listens on http://127.0.0.1:8080
```

To make the web app on localhost use the local agent, set `CORTEX_AGENT_URL=http://127.0.0.1:8080/invocations` in `apps/web/.env.local`.

## Release

The pipeline builds and pushes the image (`linux/arm64`) on every push to main. To roll a build out to the runtime:

```bash
make deploy CORTEX_AGENT_IMAGE_TAG=<commit sha>
```

A plain `make deploy` keeps the image the runtime runs now.
