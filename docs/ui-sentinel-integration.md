# UI × Data Sentinel — how 3DMinRV talks to the quality engine

This is the current integration. Browser never talks to FastAPI. Next.js is the only operator UI and the only place that holds `SENTINEL_SERVICE_TOKEN`.

Related: [data-sentinel-isometric-integration.md](./data-sentinel-isometric-integration.md) (A–G plan and Isometric), [aws-eu-west-2-system-design.md](./aws-eu-west-2-system-design.md) (ECS topology).

---

## 1. What is connected

Three processes. Two operator surfaces. One quality engine.

| Layer | Where | Port | Role |
| --- | --- | --- | --- |
| Control room | `apps/web` `/` | 3000 | Globe, requirement board, intake popup. Runs quality for **one slot**. |
| Quality Console | `apps/web` `/quality/*` | 3000 | Configure and inspect Sentinel (rules, runs, V&V). **No WebGL.** |
| Next BFF | `apps/web/src/app/api/sentinel/` | 3000 | Tenant gate, allowlist, project-id rewrite, service token. |
| Data Sentinel | `apps/sentinel` FastAPI + Celery | 8000 | Step-1 DQA, Step-2 anomaly, Step-4 document V&V. |

Step-3 (MASIP, bubble-point, CO₂-water, cadence) is **not** Sentinel. It runs in Next (`apps/web/src/lib/registries/isometric/step3.ts`) after DQA. Certify write is a **separate** `POST /api/registry/submit` and never starts from a failed DQA.

```
Browser (3DMinRV only)
    │  x-tenant-id: fourfourone
    │  never holds SENTINEL_SERVICE_TOKEN or Isometric secrets
    ▼
Next.js  :3000
    ├─ GET/POST/…  /api/sentinel/<path>     allowlisted proxy  ──►  FastAPI :8000 /api/<path>
    ├─ POST        /api/sentinel/pipeline   orchestrator       ──►  FastAPI (upload, run, anomaly, V&V)
    └─ POST        /api/registry/submit     Certify (after READY) — not Sentinel
```

In AWS the same diagram holds: `dmrv-web` → internal ALB → `sentinel-api:8000`. The public ALB never exposes FastAPI.

---

## 2. Trust boundary

| Secret / identity | Lives in | Reaches the browser? |
| --- | --- | --- |
| `SENTINEL_SERVICE_TOKEN` | Next server env / ECS secret | No. Injected as `Authorization: Bearer` on the upstream call. |
| `SENTINEL_BASE_URL` | Next server | No |
| `SENTINEL_PROJECT_ID` | Next server | No. Rewrites catalog `fujairah-mineral` → Sentinel UUID. |
| `x-tenant-id` | Request header | Yes — required on every BFF call. Quality Console always sends `fourfourone`. |
| Sentinel user JWT / `/api/v1/auth` | FastAPI only | **Blocked** by the allowlist (403). |
| Isometric tokens | Next server (`ISOMETRIC_*`) | No. Unrelated to Sentinel. |

Local token if the Sentinel host is `localhost` / `127.0.0.1` and env is empty: `local-sentinel-m2m-token`. Must match compose `SENTINEL_SERVICE_TOKEN`.

Without `x-tenant-id`, or with a tenant other than `SENTINEL_TENANT_ID` (default `fourfourone`), the BFF returns **403**.

---

## 3. Two Next entry points

Next App Router: the **static** `pipeline` route wins over the catch-all. Do not fold pipeline into `[...path]`.

### 3.1 Allowlisted proxy — Quality Console

`apps/web/src/app/api/sentinel/[...path]/route.ts` → `proxySentinel()`.

Browser helper: `apps/web/src/lib/sentinel/browser.ts`.

```
GET  /api/sentinel/v1/rules?project_id=…
     │
     ▼
Next  tenant check → allowlist → rewrite project_id → Bearer token
     │
     ▼
GET  ${SENTINEL_BASE_URL}/api/v1/rules?project_id=<uuid>
```

`health` is special: `/api/sentinel/health` → `/api/health` (no `/api/v1`). Health does not require a service token.

Allow (fail-closed) — `apps/web/src/lib/sentinel/allowlist.ts`:

`health`, `v1/datasets`, `v1/runs`, `v1/rules`, `v1/corrections`, `v1/anomaly`, `v1/knowledge-base`, `v1/ml`, `v1/schedules`, `v1/audit`, `v1/reports`, `v1/violations`, `v1/projects`, `v1/status`, `v1/rule-studio`, `v1/ai`, `v2/vv`, `v2/protocols`.

Deny even if someone tries a similar prefix: `v1/auth`, `v2/reviewer`, `v1/connectors`, `v1/api-keys`, `v1/webhooks`, `v1/ingest`.

The proxy copies status, `content-type`, and `content-disposition` (reports download). Timeout 120s → 502. Missing `SENTINEL_BASE_URL` → 503.

### 3.2 Pipeline orchestrator — control room popup

`POST /api/sentinel/pipeline` — `apps/web/src/app/api/sentinel/pipeline/route.ts`.

The popup **must not** call DQA / anomaly / V&V itself. It posts one multipart form. Next runs `runOperatorPipeline()` via `sentinelUpstream()` (same token + UUID rewrite, **not** looping through the public BFF).

Form fields: `project_id` (catalog id, e.g. `fujairah-mineral`), `slot_id`, `batch_id`, `kind`, `label`, `notes`, optional `period_start` / `period_end`, one or more `file`.

`kind` is one of `document` | `dataset` | `sensor-stream` | `attestation`. Unknown project or tenant mismatch → 403/404.

---

## 4. Two project id spaces

Never send `fujairah-mineral` to FastAPI. Sentinel `project_id` is a Postgres UUID.

| Surface | Id the UI holds | What FastAPI receives |
| --- | --- | --- |
| Control room / pipeline | Catalog id `fujairah-mineral` | `SENTINEL_PROJECT_ID` UUID (rewrite of `project_id` / `projectId` in query, JSON, and multipart) |
| Quality Console | UUID from `GET /api/sentinel/v1/projects` | That UUID as-is (already a Sentinel id) |

Rewrite lives in `apps/web/src/lib/sentinel/rewrite.ts`. Map: `SENTINEL_PROJECT_ID` → Fujairah; optional `SENTINEL_PROJECT_MAP` JSON for extra catalog ids. Unmapped catalog id → **400**.

Quality Console stores the chosen UUID in `sessionStorage` (`minrv-quality-project-id`). Prefer a Sentinel project whose name contains “fujairah” when nothing is stored.

---

## 5. Quality Console (`/quality`)

2D App Router tree. Layout: `apps/web/src/app/quality/layout.tsx` → `QualityShell`. Redirect `/quality` → `/quality/rules`. Top-bar **Quality** link on the globe. Do not put Rule Manager on the globe or in the intake popup. Do not CSS-`translateZ` the WebGL canvas.

Every page uses `sentinelJson` / `sentinelRequest` / `sentinelDownload` only. Paths below are **browser** paths (no `api/` prefix); the BFF prefixes `/api/` toward FastAPI.

### Configure

| Route | UI | Sentinel |
| --- | --- | --- |
| `/quality/rules` | Seed / toggle DQA rules | `v1/rules`, `v1/rules/seed/{project}` |
| `/quality/corrections` | Rule Studio pairs | `v1/rule-studio/pairs/…`, `auto-pair` |
| `/quality/correction-rules` | Apply policy | `v1/corrections/rules` |
| `/quality/protocols` | Protocol checkpoints | `v2/protocols/protocols` |
| `/quality/models` | Retrain DQA / anomaly | `v1/ml/status`, `v1/ml/retrain/{kind}`, `v1/anomaly/thresholds` |
| `/quality/knowledge` | Recommendation copy | `v1/knowledge-base/` |
| `/quality/vv` | V&V projects | `v2/vv/projects` |
| `/quality/vv/[id]` | Documents, verify, checkpoints | `v2/vv/projects/{id}/…` |

### Operate

| Route | UI | Sentinel |
| --- | --- | --- |
| `/quality/datasets` | Upload CSV / workbook | `v1/datasets`, `v1/datasets/upload` |
| `/quality/runs` | Execute DQA | `v1/runs`, `v1/runs/project/{id}` |
| `/quality/violations` | Latest run findings | `v1/violations?run_id=` |
| `/quality/workbench` | Approve / reject corrections | `v1/corrections/suggestions`, `generate`, `approve`, `reject` |
| `/quality/anomaly` | Isolation Forest / HU / ST | `v1/anomaly/run/{datasetId}` |
| `/quality/schedules` | Recurring runs | `v1/schedules` |

### Compliance

| Route | UI | Sentinel |
| --- | --- | --- |
| `/quality/audit` | Audit log | `v1/audit/?limit=100` |
| `/quality/reports` | Excel / PDF | `v1/reports/export/{projectId}?format=` |

Not in this UI (by design): reviewer platform, login/MFA, user admin, registry-connector stubs, AI chat, trend dashboard.

---

## 6. Control room pipeline

Intake popup: `apps/web/src/components/dashboard/requirement-workspace.tsx`.

1. Operator attaches files to a **session draft** (`requirement-draft-store`). Nothing hits Sentinel yet.
2. `classifyRequirement` (`requirement-payload.ts`) chooses engines from item `kind`:

| Kind | Engines |
| --- | --- |
| `sensor-stream` | DQA → anomaly → Step-3 |
| `dataset` | DQA → V&V → Step-3 |
| `document`, `attestation` | V&V |

3. **Run quality check** `POST /api/sentinel/pipeline` with `x-tenant-id`.
4. Next, per engine (server, `pipeline.ts`):
   - CSV column remap (`column-map.ts`) onto Sentinel CO₂ tags, then `POST /api/v1/datasets/upload`.
   - `POST /api/v1/runs` and poll until `completed` / `failed` (90s).
   - `POST /api/v1/anomaly/run/{datasetId}` — **fail** only if `summary.critical > 0`.
   - Docs: create V&V project (`registry_slug: puro_earth_ccs`), upload, `verify`, poll checkpoints (25s).
   - Step-3 in-process on the remapped CSV. **Skipped** if DQA or anomaly failed. Not a FastAPI call.
5. JSON `PipelineResult` returns. Client `put`s it in `pipeline-store` (sessionStorage `minrv-pipeline-results`).
6. `overlayBatches` paints board chips in **both** `dashboard.tsx` and `dmrv-scene.tsx` from `pipelineKey(projectId, batchId, slotId)`.

Board state from the result: running → `pending`; DQA / anomaly / V&V / Step-3 fail → `rejected`; `readyToSubmit` → `complete`.

`readyToSubmit` is true only if every classified engine **passed** (DQA, anomaly, and Step-3 when they ran). V&V skipped because there were no docs does not block. Failed DQA never proceeds to Certify (`submit-gate.ts` + BFF re-check).

**Submit to Certify** is not a Sentinel call.

---

## 7. What the UI must never do

- Fetch `http://localhost:8000` (or the internal ALB) from the browser.
- Put `SENTINEL_SERVICE_TOKEN` in `NEXT_PUBLIC_*` or client code.
- Call `POST /api/v1/runs` from the popup (use `/api/sentinel/pipeline`).
- Send catalog slug `fujairah-mineral` as Sentinel `project_id` without rewrite.
- Proxy `/api/v1/auth`, reviewer, connectors, ingest, api-keys, webhooks.
- Auto-submit Certify from a red DQA run.
- Mount Quality Console inside the R3F canvas.
- Copy Python engines into Next route handlers.

---

## 8. Run it

Env: `apps/web/.env.local` (Next loads env from the app directory).

```
SENTINEL_BASE_URL=http://localhost:8000
SENTINEL_SERVICE_TOKEN=local-sentinel-m2m-token
SENTINEL_TENANT_ID=fourfourone
SENTINEL_PROJECT_ID=<uuid from smoke or Quality project picker>
```

```bash
# repo root
npm run sentinel:up          # postgres redis backend worker beat
npm run dev                  # :3000
npm run sentinel:smoke       # health, deny auth, CSV upload + run
```

Smoke CSV: `apps/sentinel/data/sample_data/STR1_FAIL_2024-03-15.csv`.

| Check | Expect |
| --- | --- |
| `GET /api/sentinel/health` without tenant | 403 |
| same with `x-tenant-id: fourfourone` | 200 `{ status, service }` |
| `GET /api/sentinel/v1/auth/me` | 403 Path is not allowed |
| `/quality/rules` | 200, **no** `<canvas>` |
| `/` after a pipeline run | Board chip matches DQA / Step-3 |

---

## 9. Code map

| Piece | Path |
| --- | --- |
| Browser client | `apps/web/src/lib/sentinel/browser.ts` |
| Allowlist | `apps/web/src/lib/sentinel/allowlist.ts` |
| Proxy | `apps/web/src/lib/sentinel/proxy.ts` |
| Catch-all BFF | `apps/web/src/app/api/sentinel/[...path]/route.ts` |
| Pipeline BFF | `apps/web/src/app/api/sentinel/pipeline/route.ts` |
| Orchestrator | `apps/web/src/lib/sentinel/pipeline.ts` |
| Env + UUID map | `apps/web/src/lib/sentinel/config.ts` |
| Upstream (server→FastAPI) | `apps/web/src/lib/sentinel/upstream.ts` |
| Column remap | `apps/web/src/lib/sentinel/column-map.ts` |
| Board overlay | `apps/web/src/lib/sentinel/overlay.ts` |
| Kind → engines | `apps/web/src/lib/requirement-payload.ts` |
| Intake | `apps/web/src/components/dashboard/requirement-workspace.tsx` |
| Quality shell / nav | `apps/web/src/components/quality/shell.tsx`, `nav.ts` |
| Pipeline session | `apps/web/src/store/pipeline-store.ts` |
| Quality project | `apps/web/src/store/quality-store.ts` |
| FastAPI | `apps/sentinel/backend/app/` |
