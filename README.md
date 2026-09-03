# 3DMinRV

Operator platform for 44.01: 3D control room, Quality Console, and Data Sentinel (DQA / anomaly / V&V). Certify write is explicit after quality gates.

```
apps/web        Next.js 16 — control room `/` and Quality Console `/quality`
apps/sentinel   FastAPI + Celery — quality engine on :8000
infra           AWS CDK (eu-west-2)
docs            Architecture and integration notes
```

The browser talks only to Next. Next injects `SENTINEL_SERVICE_TOKEN` and proxies allowlisted `/api/sentinel/*`. Do not copy Python engines into Next.

How the two UIs call Sentinel: [docs/ui-sentinel-integration.md](docs/ui-sentinel-integration.md).

## Local

```bash
# Quality engine
docker compose -f apps/sentinel/docker-compose.yml up postgres redis backend worker beat
# or: npm run sentinel:up

# Operator UI (repo root)
npm run dev          # http://localhost:3000  ·  /quality
```

Copy `apps/web/.env.example` → `apps/web/.env.local`. Match `SENTINEL_SERVICE_TOKEN` with Sentinel compose (`local-sentinel-m2m-token`).

With both up: `npm run sentinel:smoke`.

| Surface | URL |
| --- | --- |
| Control room | http://localhost:3000/ |
| Quality Console | http://localhost:3000/quality |
| Sentinel API | http://localhost:8000/api/health |

## AWS

[docs/aws-eu-west-2-system-design.md](docs/aws-eu-west-2-system-design.md) · [infra/README.md](infra/README.md) · [docs/cicd.md](docs/cicd.md)

Releases are **CodePipeline**, not GitHub Actions:

```bash
make deploy           # CloudFormation landing zone (not an app release)
make pipeline-start   # build + ECR SHA tag + ECS task-definition deploy
make ecs-status
```

Laptop-only image push (does not update ECS): `make docker-push`.

Do not expose Sentinel `:8000` on the public ALB. Operators use `dmrv-web` `/quality`.
