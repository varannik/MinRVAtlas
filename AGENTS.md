# 3DMinRV — agent notes

Directory monorepo. Next.js is **not** at the repo root.

- **Web:** `apps/web/` — Next.js 16 App Router, React 19. Read `apps/web/node_modules/next/dist/docs/` before writing routes. `params` is a `Promise`. Route handlers live in `apps/web/src/app/api/.../route.ts`. `export const dynamic = "force-dynamic"` on those routes. `next dev` may rewrite `apps/web/AGENTS.md`.
- **Sentinel:** `apps/sentinel/` — FastAPI + Celery. Quality engine only. Do not copy Python engines into Next. Do not add a Sentinel UI.
- **Infra:** `infra/` — CDK eu-west-2. Images: `apps/web/Dockerfile` and `apps/sentinel/backend/Dockerfile`. App releases: AWS CodePipeline (`docs/cicd.md`), not GitHub Actions.

Identity: `x-tenant-id: fourfourone`. Local Sentinel token: `local-sentinel-m2m-token`.
