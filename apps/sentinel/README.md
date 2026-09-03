# Data Sentinel — quality sidecar

FastAPI + Postgres + Redis/Celery for **Step-1 DQA**, **Step-2 anomaly**, and **Step-4 document V&V**.

This is not a standalone product. The operator UI is **3DMinRV** (`/` control room, `/quality` Quality Console). The browser never talks to FastAPI. Next.js injects `SENTINEL_SERVICE_TOKEN` and proxies allowlisted `/api/sentinel/*`.

Production topology: [`docs/aws-eu-west-2-system-design.md`](../../docs/aws-eu-west-2-system-design.md) and [`infra/`](../../infra/). CDK builds this image from `backend/Dockerfile` (`sentinel-api` + `sentinel-worker` + `sentinel-beat`).

```
Browser → 3DMinRV :3000  →  FastAPI :8000
          /quality            DQA / anomaly / V&V
          POST /api/sentinel/pipeline
```

## Run locally

From this directory (copy `.env.production.template` → `.env.production` if you do not have one):

```bash
docker compose up postgres redis backend worker beat
# or: ./start.sh
```

Then from the **repo root**: `npm run dev`.

| Surface | URL |
| --- | --- |
| Control room | http://localhost:3000/ |
| Quality Console | http://localhost:3000/quality |
| FastAPI (engine only) | http://localhost:8000/api/health · `/api/docs` |

Smoke (repo root, both apps up): `npm run sentinel:smoke` — uses `data/sample_data/STR1_FAIL_2024-03-15.csv`.

```bash
docker compose logs -f backend
docker compose down          # stop
docker compose down -v       # stop + wipe DB
```

## What 3DMinRV uses here

| Piece | Path |
| --- | --- |
| HTTP API | `backend/app/api/v1/` datasets, runs, rules, corrections, anomaly, knowledge-base, ml, schedules, audit, reports, violations, projects, status, rule-studio, ai · `v2/vv`, `v2/protocols` |
| Engines | `backend/app/engines/dqa`, `anomaly`, `correction`, `vv` |
| Workers | `backend/app/tasks/` (Celery worker + beat) |
| Schema | `backend/alembic/` + `backend/migrations/init.sql` |
| Image | `backend/Dockerfile` |
| Sample CSVs | `data/sample_data/` |

Optional: `./seed_knowledge_base.sh` after the DB is up (Quality Console → Knowledge).

V&V ruleset notes: `PURO_EARTH_CCS_FRAMEWORK.md`, `REGISTRY_VV_FRAMEWORK.md`. Fujairah injection math lives in 3DMinRV (`apps/web/src/lib/registries/isometric/step3.ts`), not here. Do not treat Sentinel’s registry-submit stubs as Certify write.

## Quality Console (first DQA)

1. `/quality/rules` — select project, seed CO₂ rules.
2. `/quality/datasets` — upload a CSV from `data/sample_data/`.
3. `/quality/runs` — execute DQA.
4. `/quality/violations` · `/quality/workbench` — review and correct.

Or run quality from the control-room intake popup (**Run quality check** → `POST /api/sentinel/pipeline`).

## Auth

Local M2M token (must match Next `SENTINEL_SERVICE_TOKEN`): `local-sentinel-m2m-token`.

Do not expose FastAPI on a public ALB. Do not proxy `/api/v1/auth` through the BFF.

## Not in this tree

Vite UI, us-east-1 CloudFront/ECS taskdefs, and one-off patch scripts were removed. They are not part of the platform.
