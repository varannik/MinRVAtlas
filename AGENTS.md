# 3DMinRV — agent notes

Directory monorepo. Next.js is **not** at the repo root.

- **Web:** `apps/web/` — Next.js 16 App Router, React 19. Read `apps/web/node_modules/next/dist/docs/` before writing routes. `params` is a `Promise`. Route handlers live in `apps/web/src/app/api/.../route.ts`. `export const dynamic = "force-dynamic"` on those routes. `next dev` may rewrite `apps/web/AGENTS.md`.
- **Atlas data:** the web gets every project, 3D site model, practice journey and demo MRV history from the backend (`/api/atlas/*`, DynamoDB + S3, `apps/web/src/lib/atlas/`). Nothing is bundled and nothing is kept in browser storage. Demo data lives in `apps/web/seed/` (`npm run backend:up && npm run seed` locally; sources in `apps/web/scripts/seed/sources/`). `apps/web/src/legacy/` is the old project page, frozen and unreachable.
- **Sentinel:** `apps/sentinel/` — FastAPI + Celery. Quality engine only. Do not copy Python engines into Next. Do not add a Sentinel UI.
- **Cortex agent:** `apps/cortex-agent/` — LangGraph agent on AgentCore Runtime (linux/arm64). Claude via the Anthropic SDK's Bedrock client, EU inference profile. The web reaches it only through `/api/cortex/ask` with the user's Cognito token.
- **Infra:** `infra/` — CDK eu-west-2. Every `make` target lives in `infra/Makefile` (deploy, pipeline-start, seed, logs, …); run them in `infra/`. There is no root Makefile. Images: `apps/web/Dockerfile` and `apps/sentinel/backend/Dockerfile`. App releases: AWS CodePipeline (`docs/cicd.md`), not GitHub Actions.

Identity: `x-tenant-id: fourfourone`. Local Sentinel token: `local-sentinel-m2m-token`.
