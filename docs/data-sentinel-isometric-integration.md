# Data Sentinel × 3DMinRV × Isometric — implementation plan

Status: **Steps A–G implemented** (BFF + `/quality` + operator pipeline + Step-3 + Isometric live read/write). Data Sentinel stays a **sidecar HTTP service**. 3DMinRV (Next.js) is the **only operator UI** and the **BFF**. Do not copy Python engines into Next.js API routes.

Primary sources:

- [Isometric API introduction](https://docs.isometric.com/api-reference/introduction)
- [Certify concepts](https://docs.isometric.com/user-guides/certify/key-certify-concepts.md)
- [Uploading sources](https://docs.isometric.com/api-reference/certify/uploading-sources.md)
- [Project design (PDD)](https://docs.isometric.com/user-guides/certify/project-design.md)
- [Time series upload](https://docs.isometric.com/api-reference/certify/time-series-data-upload.md)
- Quality service: `apps/sentinel/` (FastAPI + Celery; no UI in this tree)
- Control room: `apps/web/` (Next.js)
- **UI × Sentinel (how the screens call FastAPI):** [ui-sentinel-integration.md](./ui-sentinel-integration.md)

AWS topology: [aws-eu-west-2-system-design.md](./aws-eu-west-2-system-design.md).

---

## 0. Snapshot (today)

| Piece | State |
| --- | --- |
| Control room | Globe, requirement board, right sidebar, intake popup, site pin. Popup parks the board left (faded), shade click / Esc / Cancel closes. B1–B3 ribbon hides while the popup is open. |
| Intake | `classifyRequirement` maps kind → payload + engines. Files live in a **session draft**. **Run quality check** posts `POST /api/sentinel/pipeline`. **Submit to Certify** is a separate `POST /api/registry/submit` after READY. Failed DQA never writes. |
| Next BFF | `GET /api/registry/requirements`, `POST /api/registry/submit`, `GET`/`PUT /api/projects/locations`, allowlisted **`/api/sentinel/[...path]`**, plus Next-only **`POST /api/sentinel/pipeline`**. |
| Sentinel | FastAPI on `:8000`. Next injects `SENTINEL_SERVICE_TOKEN`. Catalog `fujairah-mineral` maps to `SENTINEL_PROJECT_ID` (UUID). |
| Isometric | Live read (Step E) plus explicit write (Step F): sources + bytes, optional datapoints, monitoring submissions when the board is live, GHG statement last. **No source-byte pull for DQA.** Fujairah parquet is attached as a source (no DAC/biochar time-series job). |
| Vite UI | **Removed.** Operator UI is `apps/web` `/quality` only. |
| Quality Console | **Only** quality UI. `/quality/*` in 3DMinRV. Talks only to `/api/sentinel`. |

In-house: **one tenant (`fourfourone`)**, registries **Puro.earth + Isometric**. Do not design the first cut as a marketplace.

---

## 1. What we are combining

Three layers, one operator journey.

| Layer | Role today | Role after this plan |
| --- | --- | --- |
| **3DMinRV** | 3D control room. Reads Isometric monitoring requirements over M2M. | Orchestrator, tenant gate, **control room** (upload + pipeline status) and **Quality Console** (configure Sentinel). Holds registry adapters and the “ready to submit” gate. |
| **Data Sentinel** | Standalone DQA + HU/ST/ML anomaly + document V&V. | **Internal quality service** on `:8000`. Steps 1, 2 and 4. Rules, models, protocols, V&V packs stay in Sentinel’s DB. |
| **Isometric** | Catalogue of *what* to file; later Certify destination. | Live + bundled requirements; later fetch of sources/datapoints; write-back only after gates are green. |

Pipeline **before** registry submission (screenshot numbers: V&V = Step-4, registry math = Step-3):

```
MRV data + supporting docs
        │
        ├──────────────────────────────┐
        ▼                              ▼
  Step-1 DQA                     Step-4 V&V (docs)
  (detect / correct)             extract → verify → first-GO pack
        ▼
  Step-2 Anomaly (HU / ST / ML)
        ▼
  Qualified + cleaned data
        ▼
  Step-3 Registry rules & thresholds  ←── 3DMinRV adapter (Isometric / Puro)
        │
        ├─ pass → submit to Certify / registry   (later phase)
        └─ fail → correct data or documents and re-run
```

V&V of documents can start as soon as files are classified. **Registry submit is blocked until DQA, anomaly, V&V, and Step-3 all pass.**

---

## 2. Architecture decision

**Do not** rewrite `DQAEngine`, Isolation Forest, PDF extract, or Celery in TypeScript. **Do not** embed Postgres in the Next process.

“Replicate Data Sentinel in the Next app” means: **every capability is reachable from 3DMinRV** (BFF + UI). The engines keep running in FastAPI.

```
Browser (3DMinRV only)
    │  never holds Sentinel JWT or Isometric secrets
    ▼
Next.js BFF
    ├─ GET /api/registry/requirements
    ├─ GET/PUT /api/projects/locations
    ├─ POST /api/registry/submit   Certify write (after READY)
    ├─ /api/sentinel/[...path]     allowlisted proxy
    ├─ POST /api/sentinel/pipeline  orchestrator (popup)
    └─ Isometric M2M (isometric/server.ts)
              │
              ├─► Data Sentinel :8000   DQA │ anomaly │ V&V │ rules │ models
              └─► Certify MRV + Registry
```

| System of record | Owner |
| --- | --- |
| Raw injection / plant series | Operator upload (until Certify has a time-series **read** API) |
| What the registry wants | Isometric live list + bundled PDD/V&V spec |
| Quality outcomes (run ids, pass/fail) | Sentinel, referenced from the board item |
| Methodology thresholds (MASIP, bubble point, CO₂-water ratio) | 3DMinRV registry adapter (Step-3) |

**Identity**

| Today | Target |
| --- | --- |
| 3DMinRV `x-tenant-id` (`fourfourone`) | Unchanged for operators |
| Sentinel cookie JWT | Browser never uses it |
| `SENTINEL_SERVICE_TOKEN` on the web task | BFF only |
| `SENTINEL_PROJECT_ID` | One Sentinel project per 3DMinRV project (start: `fujairah-mineral`) |

Local: `SENTINEL_BASE_URL=http://localhost:8000`. AWS: internal ALB `:8000` (already on the web task).

Data Sentinel’s `IsometricConnector` (`backend/app/integrations/isometric.py`) talks to fictional `/v1/verifications` paths. **Do not reuse it.**

---

## 3. Two UIs in one product

Do **not** put Rule Manager, Model Hub, or Protocol Manager on the 3D globe or inside the requirement popup.

| Surface | Who | Route | Job |
| --- | --- | --- | --- |
| **Control room** | Operators | `/` | Globe, board, sidebar, intake popup. Upload for **one requirement**, see engine chips, later trigger the pipeline. |
| **Quality Console** | QA / methodology / admin | **`/quality/*`** | Configure and inspect the Sentinel **service**: rules, corrections, models, protocols, V&V packs, datasets, schedules. **Only** quality UI. |

Quality Console is a **separate App Router tree** (2D, dense tables). It does not share the WebGL canvas. Do not CSS-`translateZ` the canvas.

### 3.1 Control room (already in the app)

- Board + list remain the overview. Click a row or chip.
- Right sidebar stays mounted; it slides off while a requirement is open and returns on close.
- Intake is a **floating popup** on the right, slight overlap on the receded board. Full-screen shade; click shade / Esc / Cancel / Back closes.
- Receded board stays **left, smaller, transparent**. B1–B3 ribbon is **hidden** while the popup is open.
- `classifyRequirement` (`apps/web/src/lib/requirement-payload.ts`) maps kind → `payload` + `engines` + accept list.
- Until Phase C, files stay in `requirement-draft-store`. Staging does not write Certify or Sentinel.

### 3.2 Quality Console — information architecture

This is the **best place** to configure Data Sentinel.

**Operate** (also linked from the board later)

| Console route | Sentinel (Vite) | APIs |
| --- | --- | --- |
| `/quality/datasets` | Datasets | `/api/v1/datasets` |
| `/quality/runs` | Run DQA | `/api/v1/runs` |
| `/quality/violations` | Violations | `/api/v1/violations` |
| `/quality/workbench` | Correction workbench | `/api/v1/corrections` |
| `/quality/anomaly` | Anomaly detection | `/api/v1/anomaly` |
| `/quality/schedules` | Schedules | `/api/v1/schedules` |

**Configure**

| Console route | Sentinel (Vite) | What it configures |
| --- | --- | --- |
| `/quality/rules` | Rule Manager | 28 DQA rules, dimensions, hard gates |
| `/quality/corrections` | Correction Manager (Rule Studio) | Rule ↔ fix pairs |
| `/quality/correction-rules` | Correction Rules | Apply / approve policy |
| `/quality/knowledge` | Knowledge Base | GenAI recommendation text |
| `/quality/models` | AI Model Hub + ML Model Hub | Retrain DQA/anomaly, feedback, status |
| `/quality/protocols` | Protocol Manager | Registry protocols + V&V checkpoints |
| `/quality/vv` | V&V projects | Document packs, extract, verify, RFIs/CARs |

**Compliance:** `/quality/audit`, `/quality/reports`.

**Admin (after roles exist):** settings, users, system status. In-house, tenant `fourfourone` plus an admin flag is enough.

**Out of Quality Console for in-house (supplier-only)**

- Reviewer platform (`/api/v2/reviewer`)
- Fictional registry connectors
- Sentinel self-registration / MFA UI (BFF uses the service token)

Optional later: from a board chip, “Open in Quality Console” → `/quality/runs/{id}`.

---

## 4. Next.js BFF

### 4.1 Allowlisted proxy

` /api/sentinel/[...path] `

- Require `x-tenant-id` (same gate as `/api/registry/requirements`).
- Inject `Authorization: Bearer ${SENTINEL_SERVICE_TOKEN}`.
- Forward method, query, body, multipart.
- Substitute Sentinel `project_id` from `SENTINEL_PROJECT_ID` (never send `fujairah-mineral` as a UUID).
- **Allow:** `/api/v1/datasets`, `/runs`, `/rules`, `/corrections`, `/anomaly`, `/knowledge-base`, `/ml`, `/schedules`, `/audit`, `/reports`, `/api/v2/vv`, `/api/v2/protocols`, and other quality prefixes as needed.
- **Deny:** `/api/v1/auth/register`, password reset, arbitrary user create, reviewer stubs, until tenancy is designed.

This is how “all Sentinel functionality” becomes requestable from 3DMinRV without copying routers.

### 4.2 Pipeline orchestrator (control room)

`POST /api/sentinel/pipeline`

The popup must not call 15 raw Sentinel URLs. One orchestrated job per requirement + batch:

1. Classify with `classifyRequirement`.
2. **Data:** `POST /api/v1/datasets/upload` → `POST /api/v1/runs` → poll → optional corrections.
3. **Anomaly** on the **corrected** dataset: `POST /api/v1/anomaly/run/{dataset_id}`.
4. **Docs:** V&V project documents → `verify`.
5. **Registry-rules:** 3DMinRV adapter (not Sentinel’s Puro stub).
6. Persist `{ datasetId, runId, anomalyId, vvProjectId, status }` keyed by `tenant + project + slotId + batch`.

Order: DQA → anomaly on cleaned frame → V&V (can overlap once files are classified) → Step-3 on qualified totals.

### 4.3 Classification contract

Already sketched in `classifyRequirement`; persist `origin` when wiring the pipeline:

```
payload: "data" | "document" | "both"
engines: ("dqa" | "anomaly" | "vv" | "registry-rules")[]
origin: "operator-upload" | "isometric-source" | "isometric-datapoint" | "bundled-gap"
```

| Kind | Payload | Engines |
| --- | --- | --- |
| `sensor-stream` | data | dqa, anomaly, registry-rules |
| `dataset` | both (if file) | dqa, vv if workbook/PDF, registry-rules |
| `document` / `attestation` | document | vv |
| Monitoring submission with `source_id` | both | by MIME/extension |

---

## 5. Implementation steps

Work **in order**. Each step has an exit criterion. Do not start Certify write (Step F) before C and D are green on Fujairah.

### Step A — Sentinel as a service (no new operator UI)

**Goal:** Next can reach FastAPI. Engines still run in Python.

- [x] Run Sentinel locally (`apps/sentinel` API `:8000`).
- [x] Document `.env`: `SENTINEL_BASE_URL`, `SENTINEL_SERVICE_TOKEN`, `SENTINEL_PROJECT_ID`, map `fourfourone` / `fujairah-mineral` → that UUID.
- [x] Implement `/api/sentinel/[...path]` with tenant gate, allowlist, service token.
- [x] `GET /api/sentinel/health` (or proxy `/api/health`).
- [x] Smoke script: multipart CSV → `datasets/upload` → `runs` → print violations. **Not** wired to the globe yet.

Local:

```bash
# Sentinel API only — :3000 is Next.js (apps/web)
docker compose -f apps/sentinel/docker-compose.yml up postgres redis backend worker beat

npm run dev
npm run sentinel:smoke
```

Paste the printed UUID into `.env` as `SENTINEL_PROJECT_ID` so later calls can send `fujairah-mineral` and the BFF rewrites it.

**Exit:** From the Next server, a Fujairah-shaped CSV produces a DQA run id. Browser still has no token.

### Step B — Quality Console (configure first)

**Goal:** QA can change rules, protocols, and models **inside 3DMinRV** without Vite.

- [x] `/quality` shell (left nav, project picker, no R3F; `fixed inset-0` over `overflow: hidden` body)
- [x] `/quality/rules` — Rule Manager (seed + PATCH severity/weight/active/parameters)
- [x] `/quality/corrections` — Rule Studio pairs
- [x] `/quality/protocols` — living protocol checkpoints
- [x] `/quality/models` + anomaly thresholds
- [x] `/quality/vv` — create project, upload documents, verify, PATCH checkpoint
- [x] `/quality/datasets`, runs, violations, workbench, schedules, knowledge
- [x] Audit + reports
- [x] Control-room top bar → `/quality`

Each page talks only to `/api/sentinel/...`. Match Sentinel’s existing JSON; do not invent a parallel rules schema.

**Exit:** An admin can edit a DQA rule and a V&V checkpoint in `/quality` and see the change on the next run. Vite can be ignored for 44.01 QA.

### Step C — Operator pipeline on the board

**Goal:** Upload in the popup is checked against Sentinel.

- [x] Column map: Fujairah / MinRV tags (`WHP_*`, `INJ_RATE_*`, `CO2_TOTAL_*`, `WATER_CO2_RATIO`, …) → `CO2_RULES` / anomaly `DEFAULT_THRESHOLDS`.
- [x] `POST /api/sentinel/pipeline` from the popup (replace session-only `queued` as the terminal state).
- [x] Persist run ids; colour DQA → anomaly → V&V → registry-rules chips from real status.
- [x] Board item shows engine pass/fail.
- [ ] Optional: fetch-from-Isometric vs upload-local (not required for Step E; E is metadata only).

Verified on Fujairah: `STR1_FAIL_2024-03-15.csv` on “Injection & annulus pressure telemetry” → DQA **fail** (gate fail, violations from current `/quality/rules`), anomaly fail, registry-rules **deferred**, board puck **rejected**. Registry-rules math is Step D. Corrections are not auto-applied (M2M four-eyes). Step E lists Certify metadata; it does not feed source bytes into DQA.

**Exit:** Operator drops a CSV on “Injection & annulus pressure telemetry”, sees a DQA result that reflects `/quality/rules`. Nothing is posted to Certify.

### Step D — Step-3 registry rules in 3DMinRV

**Goal:** Methodology math lives next to the adapter, not in the Puro stub.

- [x] Implement in-situ mineralisation checks (MASIP, monthly bubble-point, CO₂-water ratio, cadences) in the 3DMinRV adapter.
- [x] Gate pipeline: DQA hard-fail or critical anomaly or V&V critical checkpoint or Step-3 fail → no “ready to submit”.
- [ ] Optional later: Sentinel ruleset `ISOMETRIC_INSITU_MINERALIZATION` sharing the same checkpoint ids.

Verified: `STR1_PASS` on injection telemetry → DQA + anomaly + Step-3 pass, `readyToSubmit: true` (Certify still off). Same telemetry with WHP 165.4 bar (below DQA 300, above MASIP 150) → DQA **pass**, Step-3 **fail**, board **rejected** / `STEP-3 FAIL`. `STR1_FAIL` still blocks Step-3 until DQA passes. Bubble-point on `STR1_PASS` fails Step-3 (missing P_bubble / monthly cadence) after a clean DQA run.

**Exit:** A pack can be “quality-clean” and still fail Step-3 on a methodology threshold, with a clear board state.

### Step E — Expand Isometric **read** (still no submit)

Extend `apps/web/src/lib/registries/isometric/server.ts`:

- [x] List datapoints for the project.
- [x] Resolve each submission `source_id` to filename + fetchability.
- [x] Registry `GET /projects/{id}/documents` for published PDD / reports.
- [x] Surface 403 / beta-not-opted-in / 429 as spec meta (same pattern as bundled fallback).

Keep credentials server-side. Pagination cap already exists (`MAX_PAGES`, page size 50). Source **bytes** and `private_url` are not fetched. Enrichment failures (sources / datapoints / documents) become `meta.warnings` and do not drop the live requirement list.

Verified locally without `ISOMETRIC_*`: `GET /api/registry/requirements?projectId=fujairah-mineral` is **200** with `origin: bundled` and `fallbackReason: credentials-missing`. Fujairah board shows **BUNDLED SPEC** / credentials missing; intake still asks for an operator CSV; no fake “already on file” rows; no Certify writes. A fixture through `toRequirementSpec` covers filename, fetchability, leftover datapoints (`DP`), published docs (`REG` + public `href`), and 403/beta/429 classification. Live metadata lands on the board when `ISOMETRIC_*` is set.

**Exit:** Board can show “already on file at the registry” from live metadata; DQA still prefers operator CSV until a time-series GET exists.

### Step F — Certify **write** (explicit, last)

Only after C+D are green for that slot. The pipeline never posts to Certify.

- [x] `POST /sources` + PUT bytes (private by default; 50 MB cap).
- [x] `POST /datapoints` with `source_ids` when the operator sends a quantity list.
- [x] Time series: Fujairah has **no** DAC/biochar/WAE job type — parquet/CSV attach as sources. Biochar types are refused for this project.
- [x] Monitoring submission (beta) when the board is a live Certify requirement id; bundled spec skips with a warning.
- [x] GHG statement submit last (`POST /ghg_statements/{id}/submit`) after mandatory slots are written; needs `ISOMETRIC_GHG_STATEMENT_ID` + verifier-accessible report URL.

**Never** auto-push from a failed DQA run. The BFF re-checks engines first, then confirms the DQA run with Sentinel when DQA is in the classification.

Verified locally without `ISOMETRIC_*`: a DQA-fail pipeline is **409** (`DQA hard-gate fail`) and does not call Certify; a READY pipeline is **409** credentials-missing. Fujairah popup shows **Submit to Certify** only after READY.

**Exit:** Operator can push a quality-clean slot to Certify on purpose; a red DQA cannot.

### Step G — Retire Vite

- [x] Internal users use `/quality` only (control-room **Quality** link + Quality Console nav).
- [x] Sentinel Compose/ECS stays **API + worker + beat**. Frontend service removed from `docker-compose.yml`.
- [x] Do not deploy a Sentinel UI to the public ALB (CDK compute has web + api + worker + beat only). Vite tree is not in `apps/sentinel`.

Not ported on purpose: reviewer UI, login/MFA, user admin, registry-connector stubs, AI chat, trend dashboard.

Verified: Compose config has no `frontend` service; `/quality` routes in the Quality Console nav load.

**Exit:** 44.01 QA never needs the Vite container. FastAPI remains the engine.

---

## 6. Gating (screenshot green / red)

1. DQA hard gates fail → do not run Step-3 as a pass; corrections required.
2. Anomaly critical flags → human acknowledge or correct before Step-3.
3. V&V critical checkpoints fail → documents go back (“Failed, go back and correct your documents”).
4. Step-3 methodology thresholds fail → data goes back (“Not verified — correct your data”).
5. All green → “Pass to submit to registry” (Step F).

Correction policy (in-house default, confirm before coding apply-all): auto-apply **non-hard-gate** DQA fixes; **never** auto-apply anomaly rewrites.

---

## 7. Isometric: two APIs, two jobs

Isometric publishes OpenAPI REST APIs. There is **no official SDK**.

- Certify (MRV): `https://api.isometric.com/mrv/v0/mrv.openapi.json`
- Registry: `https://api.isometric.com/registry/v0/openapi.json`

Hosts: production `https://api.isometric.com/`, sandbox `https://api.sandbox.isometric.com/`. Credentials do **not** carry across environments.

Auth ([authentication](https://docs.isometric.com/api-reference/authentication)):

- `X-Client-Secret` — this integration, per environment.
- `Authorization: Bearer <org JWT>` — one organisation’s private data. Tokens last one year.

Rate limit: stay near **120 requests/minute**; back off on `429`. Already in `apps/web/src/lib/registries/isometric/server.ts`.

| API | Base path | What it is for | What it is **not** |
| --- | --- | --- | --- |
| **Certify / MRV** | `/mrv/v0` | Sources, datapoints, components, GHG, sensors, samples, storage, monitoring requirements | Credit inventory, retirement, public credit batches |
| **Registry** | `/registry/v0` | Projects, issuances, deliveries, retirements, **published** project documents | Working MRV files, draft datapoints, PDD drafting checklist |

3DMinRV already uses Certify **monitoring requirements** (beta). Step E lists datapoints, source metadata, and published Registry documents. Step F writes sources (and monitoring/GHG when gated) from an explicit operator submit.

---

## 8. Data vs documents — how Isometric models it

Isometric does not label requirements “data” or “doc”. Split by **payload**, then map to board `ItemKind` (`document | dataset | sensor-stream | attestation`).

### 8.1 Certify resource graph

```
Source (file or website) ──attached via source_ids──► Datapoint (numeric value)
                                                          │
                                                          ▼
                                              Component (blueprint equations)
                                                          │
                                                          ▼
                                              GHG entry → GHG statement (submit)
```

| Resource | Data or document? | Operator meaning |
| --- | --- | --- |
| **Datapoint** | Data | Measured or calculated value. Optional σ for uncertainty. |
| **Source** (`DOCUMENT`) | Document (file may contain data) | Evidence. Private by default. |
| **Source** (`WEBSITE`) | Document / reference | URL, not a file. |
| **Component** | Data (derived) | CO₂e flux from blueprint + datapoints. |
| **GHG entry / statement** | Data pack + submit gate | Net removal for a period. |
| **Sensor + time-series parquet** | Data (sensor-stream) | Aggregated stats per interval. |
| **Measurement sample** | Data | Discrete lab / field sample. |
| **Monitoring requirement** | Requirement (neither) | What to monitor, cadence, phase. |
| **Monitoring submission** | Both | Validity window + `source_id`. |
| **Storage location / unit** | Structure | Sites that requirements hang off. |

Supported **source file types** (Certify): txt, pdf, doc/docx, jpeg/png/heic/tiff, csv, parquet, xls/xlsx, json, geojson, ipynb, kml, gpkg, shapefile bundle. That covers the screenshot pack plus DQA tabular formats.

### 8.2 Project Design (PDD)

[Project design](https://docs.isometric.com/user-guides/certify/project-design.md) is a **Certify UI checklist**, not a documented REST resource.

Treat PDD as:

- **Document-class** on the board (bundled rulebook: `pdd`, safeguards, VVB reports).
- Evidence that exists as `Source` objects can still be listed/downloaded.
- After publication, a redacted PDD often appears as a **Registry project document**.

### 8.3 Fujairah / in-situ classification

Live Certify rows: classify by **frequency** (`transform.ts`): `continuous` / daily → sensor-stream; periodic → dataset; once / optional → document.

#### Need **data**

| Requirement (local id) | Kind | Typical Isometric objects | Engines |
| --- | --- | --- | --- |
| Injection & annulus pressure | sensor-stream | Sensors + parquet; datapoints | DQA + anomaly |
| CO₂ & water flow and temperature | sensor-stream | Same | DQA + anomaly |
| Bubble point & solubility check | dataset | Datapoints + workbook source | DQA (+ V&V if file) |
| Injectate composition | dataset | Samples + lab CSV/PDF | DQA; V&V on PDFs |
| Cumulative injected mass & CO₂-water ratio | dataset | Datapoints; annual report | DQA → Step-3 |
| Near-surface gas monitoring | sensor-stream | Sensors / surveys | DQA + anomaly |
| USDW geochemistry & aquifer pressure | dataset | Samples + series | DQA |
| Induced seismicity (if in permit) | sensor-stream | Sensors | DQA + anomaly |
| GHG Statement numbers | dataset | GHG entries / statement | Step-3 |
| Raw data & quality justification | dataset | csv/parquet + datapoints | DQA |
| LCA inputs | dataset | Datapoints + workbook | V&V + Step-3 |
| Certify API MRV stream | sensor-stream | Time series upload path | DQA + anomaly |
| Leakage & reversal monitoring | dataset | Datapoints + MMV files | DQA + V&V |

Injection-batch cadence (`once_per_injection_batch`, `continuous`) is **data** even when the submission is a file.

#### Need **documents**

| Requirement (local id) | Kind | Typical objects | Engines |
| --- | --- | --- | --- |
| Internal mechanical integrity | document | Source PDF | V&V |
| External integrity & pressure fall-off | document | Source PDF/logs | V&V |
| Reservoir model review | document | Report (+ model files) | V&V |
| Storage site conformance | document | Source pack | V&V |
| Project Design Document | document | Certify UI + Registry doc | V&V |
| GHG Statement Report (narrative) | document | Source | V&V |
| Validation / verification reports | document | Registry documents | V&V (read-only once published) |
| Environmental & social safeguards | document | PDD + sources | V&V |
| Permits, NOCs, contracts, stakeholder records | document | Sources | V&V |
| Public data disclosure set | attestation | Policy + published subset | V&V / attestation |

#### Need **both**

| Pattern | Example | Treatment |
| --- | --- | --- |
| Tabular source | Injected-mass CSV as a Source | DQA/anomaly as data; keep file in V&V pack |
| Workbook | LCA `.xlsm` | V&V extracts; DQA/Step-3 use numbers |
| Monitoring submission | `source_id` + window | Cadence in metadata; bytes by MIME |
| Lab PDF with a table | Injectate composition | V&V on PDF; optional extract → dataset |

**Rule of thumb:** if the registry would accept a number without a file, it is data. If a verifier must open a file, it is a document. If the number lives *inside* a file, run **both** engines.

---

## 9. Can we fetch data and documents from Isometric?

**Yes, for the organisation the token belongs to — with holes.**

### 9.1 Pull today

| Asset | Fetch | Endpoints | Notes |
| --- | --- | --- | --- |
| Monitoring requirement list | Yes (beta) | `GET /mrv/v0/projects/{id}/monitoring_requirements` | Implemented. |
| Monitoring submissions | Yes (beta) | `GET .../submissions` | `source_id`, not bytes. |
| Source metadata | Yes | `GET /mrv/v0/sources` | Step E: filename + fetchability. No `private_url`. |
| Source **bytes** | If allowed | Public `url` or `GET .../private_url` | **Not used in Step E.** DQA still uses operator CSV. |
| Datapoints | Yes | `GET /mrv/v0/datapoints?project_id=` | Step E: listed as metadata, not DQA input. |
| Components, GHG entries, statements | Yes | `/mrv/v0` | Step-3 “what Certify already calculated”. |
| Sensors | Yes | `GET /mrv/v0/sensors` | Catalogue, not parquet. |
| Samples / locations | Yes | GET samples | Discrete measurements. |
| Published project documents | Yes | `GET /registry/v0/projects/{id}/documents` | Step E: public `url` on the board. |

### 9.2 Do not treat as fetchable

| Asset | Fetch? | Consequence |
| --- | --- | --- |
| PDD checklist + rich-text answers | No public API | Bundled rulebook until Isometric exposes it. |
| Raw time-series parquet **download** | Not documented | DQA ingest = operator upload first. |
| Another org’s draft sources | No | Token is org-scoped. Never cross tenants. |
| Issued pack bytes | Usually filename only | Need supplier token, not public Registry. |
| Verifier-only views | Only if this token is the VVB | In-house is **supplier**, not a VVB product. |

### 9.3 Pull vs push

| Direction | When | APIs |
| --- | --- | --- |
| **Pull** | Seed DQA/V&V; reconcile the board | GET requirements, submissions, sources, datapoints, registry documents |
| **Push** | After Steps 1–4 pass (Step F) | POST source + PUT bytes; datapoints; parquet upload; monitoring submission; GHG submit |

Do not push dirty series into Certify to “have them in Isometric”. Clean in Sentinel, then write.

**Practical:** documents — metadata always, bytes when `url_info` allows. Data — datapoints/GHG/sensor catalogue yes; **injection series for DQA from the operator** until a measurements GET exists.

---

## 10. Data Sentinel — reuse map

Path: `apps/sentinel/`. FastAPI + Postgres + Redis/Celery. Call over HTTP.

| Screenshot | Module | Entry | Strength | Gap |
| --- | --- | --- | --- | --- |
| Step-1 DQA | `engines/dqa` | `POST /api/v1/datasets/upload`, `/api/v1/runs`, corrections | 28 CO₂ injection rules, hard gates | Column names STR1/STR2-oriented — map Fujairah tags |
| Correction rules | `api/v1/rules.py`, Rule Studio | PATCH per project | Tunable thresholds | Not methodology equations |
| Step-2 Anomaly | `engines/anomaly/engine.py` | `/api/v1/anomaly` | HU / IQR-Z / Isolation Forest (0.30 / 0.35 / 0.35) | “Correct” is recommend, not apply-to-series |
| Step-4 V&V | `engines/vv` | `/api/v2/vv` | Multi-file extract, checkpoints, RFIs/CARs | Isometric ruleset is **biochar**; CCS/mineralisation = **Puro CCS** + 3DMinRV module |
| Step-3 | Not the same | V&V checkpoints + `engines/registry/puro_earth.py` stub | Document completeness | Does **not** score injection totals vs Isometric quantification |
| Reviewer → training | `/api/v2/reviewer` | CARs, statements | Exists | Real Isometric connector is a stub — skip in-house |

Allowed V&V uploads already match Certify sources: csv/xlsx/pdf/docx/txt/html/pptx/json/png/jpg.

### What 3DMinRV already has that Sentinel does not

- Live Isometric monitoring list (`isometricLiveAdapter`).
- Fujairah in-situ mineralisation list.
- Tenant-scoped M2M (`x-tenant-id`, env credentials).
- Bundled GHG / PDD / VVB groups.

Those stay in 3DMinRV. Sentinel does not become the registry adapter.

---

## 11. In-house vs commercial

| | In-house (now) | Commercial (later) |
| --- | --- | --- |
| Tenancy | 44.01 (`fourfourone`) | Multi-tenant SaaS |
| Registries | Puro.earth + Isometric | Puro, Isometric, ONP, Gold Standard, … |
| Data | Proprietary injection/emission + docs | Isolate Sentinel DB and Isometric tokens per tenant |
| Models | Train on 44.01 series | Per-tenant or pooled models with legal review |
| Config UI | `/quality` in 3DMinRV | Same, plus roles |

Steps A–G assume in-house. Multi-tenant Sentinel is a hard cut: `tenant_id` on every Sentinel row, or one Sentinel per tenant.

---

## 12. What not to do

- Rewrite engines in Next.js or embed Celery/Postgres in the Next process.
- Put Rule Studio / Model Hub / Protocol Manager on the 3D board or in the intake popup.
- Deploy Sentinel Vite to the public ALB.
- Expose Sentinel `/auth/register` or MFA through the BFF.
- Reuse `IsometricConnector` `/v1/verifications`.
- Treat V&V `registry-submit` stubs as Certify write.
- Use Isometric **biochar** V&V ruleset for Fujairah.
- CSS-`translateZ` the WebGL canvas (breaks raycast). Recede the board in Three.js only.
- Auto-submit to Certify from a failed DQA run.
- Send `fujairah-mineral` as Sentinel `project_id`.

---

## 13. Open questions (resolve before the step they block)

1. **Isometric monitoring beta** — Fujairah opted in? If not, board stays on bundled spec (blocks live submissions; not Step A).
2. **Time-series read** — any undocumented GET for measurements? Until then, operator-upload-first (Step C).
3. **PDD API** — if Isometric exposes requirement responses, Step-4 can score live PDD (still no public checklist API).
4. **Source of injection CSV** — historian, MinRV export, or Certify sources? DQA still uses operator upload after Step E metadata.
5. **Correction policy** — confirm auto-apply non-hard-gate DQA only (Step C).
6. **VVB role** — supplier-only (skip reviewer UI) unless product says otherwise.
7. **Step-3 home** — Next adapter first (Step D); optional shared IDs in Sentinel later.
8. **Retention of private source bytes** — out of scope for Step E (no `private_url`). Revisit only if we ever cache Certify bytes.

---

## 14. Reference — current 3DMinRV paths

| Piece | Path | Today |
| --- | --- | --- |
| Live client | `apps/web/src/lib/registries/isometric/server.ts` | Requirements, submissions, sources, datapoints, registry documents |
| Wire types | `apps/web/src/lib/registries/isometric/api.ts` | Frequency, Source, Datapoint, ProjectDocument |
| Enrichment | `apps/web/src/lib/registries/isometric/enrich.ts` | Filename, fetchability, leftover datapoints, published docs |
| Board mapping | `apps/web/src/lib/registries/isometric/transform.ts` | Frequency → `ItemKind`; evidence = filename + fetchability |
| Classification | `apps/web/src/lib/requirement-payload.ts` | payload + engines + accept |
| Intake popup | `apps/web/src/components/dashboard/requirement-workspace.tsx` | Session drafts; quality check + **Submit to Certify** |
| Draft store | `apps/web/src/store/requirement-draft-store.ts` | Files in module `Map`; metadata in zustand |
| Pipeline store | `apps/web/src/store/pipeline-store.ts` | Run ids + engine status in sessionStorage |
| Submit store | `apps/web/src/store/registry-submit-store.ts` | Certify source/submission ids in sessionStorage |
| Pipeline API | `apps/web/src/app/api/sentinel/pipeline/route.ts` | Next orchestrator; talks to FastAPI, not the BFF loop |
| Certify write | `apps/web/src/lib/registries/isometric/write.ts` | Sources, datapoints, monitoring, GHG last |
| Submit BFF | `apps/web/src/app/api/registry/submit/route.ts` | Tenant gate; quality gate before credentials |
| Step-3 adapter | `apps/web/src/lib/registries/isometric/step3.ts` | MASIP, bubble-point, CO₂-water, cadences |
| Bundled GHG + V&V | `apps/web/src/lib/registries/isometric/rulebook.ts` | PDD, reports, statement, LCA |
| Bundled mineralisation | `apps/web/src/lib/registries/isometric/methodologies.ts` | Fujairah monitoring list |
| Connection | `apps/web/src/lib/registries/connections.ts` | `fourfourone` + `fujairah-mineral` |
| Requirements BFF | `apps/web/src/app/api/registry/requirements/route.ts` | Tenant header, no client secrets |
| Locations BFF | `apps/web/src/app/api/projects/locations/route.ts` | Operator pin; SSM in AWS |
| Sentinel BFF | `apps/web/src/app/api/sentinel/[...path]/route.ts` | Tenant + allowlist + service token |
| Sentinel client | `apps/web/src/lib/sentinel/` | Path allowlist, UUID map, proxy, browser fetch |
| Quality Console | `apps/web/src/app/quality/*`, `apps/web/src/components/quality/` | 2D config UI; no R3F |
| Sentinel smoke | `scripts/sentinel-smoke.mjs` | Health, deny auth, DQA upload + run |

---

## 15. AWS

Production topology (`eu-west-2`): [aws-eu-west-2-system-design.md](./aws-eu-west-2-system-design.md).

- `dmrv-web` (Next) orchestrates and serves `/` + `/quality`.
- `sentinel-api` + `worker` + `beat` remain the quality service.
- Internal ALB `:8000` from web only. No `0.0.0.0/0` on Sentinel.
- Do not add a Sentinel UI task or resurrect us-east-1 CloudFront/static UI.

---

## 16. Isometric links

- [API introduction](https://docs.isometric.com/api-reference/introduction)
- [Authentication](https://docs.isometric.com/api-reference/authentication)
- [Certify introduction](https://docs.isometric.com/api-reference/certify/certify-introduction)
- [Registry introduction](https://docs.isometric.com/api-reference/registry/registry-introduction)
- [Get datapoints](https://docs.isometric.com/api-reference/certify/get-datapoints.md)
- [Get sources](https://docs.isometric.com/api-reference/certify/get-sources.md) / [private URL](https://docs.isometric.com/api-reference/certify/get-source-private-url.md)
- [Monitoring requirements](https://docs.isometric.com/api-reference/certify/get-project-monitoring-requirements.md) (beta)
- [Registry project documents](https://docs.isometric.com/api-reference/registry/project-documents.md)
- [Docs index](https://docs.isometric.com/llms.txt)
