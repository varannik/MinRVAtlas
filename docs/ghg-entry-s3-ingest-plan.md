# GHG entry — S3 source ingest (implementation plan)

Status: **implementation in progress.** Infra: data + compute (+ `config.ts` / `stage.ts`). Seed: `make -C infra seed-stream-s3`. BFF: `GET`/`POST /api/registry/ghg-source`. UI: Fetch beside CSV upload. Stream bucket is **not deployed** until `make -C infra deploy`. Related: [modules.md](./modules.md) (tenant ≠ registry ≠ project ≠ desk), [cognito-tenant-identity-plan.md](./cognito-tenant-identity-plan.md) (grants carry a registry argument), [isometric-insitu-mineralization-submit-path.md](./isometric-insitu-mineralization-submit-path.md) (§7b carbon accounting), [data-sentinel-isometric-integration.md](./data-sentinel-isometric-integration.md) (DQA still needs bytes), [ui-sentinel-integration.md](./ui-sentinel-integration.md), [aws-eu-west-2-system-design.md](./aws-eu-west-2-system-design.md) (evidence bucket is **not** the stream store).

---

## 0. What you are building

Today a GHG entry is created only after the operator **uploads a CSV in the browser**. Quality check and Certify write already exist.

The product need:

1. **A dedicated S3 bucket for stream data**, shared per **stage**, partitioned by **tenant → registry → project**. Realtime *or* offline jobs **write** objects there. MinRV does **not** hold a live socket to the plant. It only **fetches** objects for the **current tenant, the project’s registry, that project, and the selected dates**.
2. **A Makefile seed** that **asks for tenant, registry, and project id**, then writes sample timeseries only under an **existing** project (catalog row or live Certify id this tenant already owns). It must not invent `demo-facility` / `other-mineral-site`. Isolation tests use a **second catalog project** (e.g. `terrafix` / Isometric / `north-sea-dac`).
3. **Timeseries layout + a required-data contract** per registry/methodology. Fetch always returns a **missing-data report** (days, metrics, attributes, gaps) and the panel **shows** it. Silent empty cells are not enough.

A tenant has many registries. A registry connection has many projects. A project has **one** tenant and **one** registry. Stream keys follow that join. `fourfourone` / Fujairah / Isometric is the **first fixture**, not the data model.

```
Plant / ETL / make seed-stream-s3     MinRV (no realtime link)
         │  PUT …/{tenant}/{registry}/{project}/dt=…/
         ▼
   one stream bucket per stage
         │
         └── GET only that prefix ∩ [periodStart, periodEnd] ──► that project’s desk
```

The date range is the **period selected at the start of the desk** (`SubmissionChain` start → end). Fetch is that closed interval only.

```
1. Session tenant (not a client-picked org)
2. Registry desk from the selected **project.registry** (Isometric GHG ≠ Puro facility)
3. Choose **that** project (one of many on the desk)
4. Choose reporting period  ←  dates for **this** project
5. Insert data — **choose one**:
      A. Upload CSV (already built — do not change)
      B. Fetch existing stream objects for tenant + registry + project + dates
6. Same path from there: quality check (Sentinel) → desk write (`createGhgEntry`)
```

S3 fetch **does not replace or wrap** CSV upload. Both land `File` objects in the same draft slot. **Run quality check**, the overlay, `POST /api/sentinel/pipeline`, `ghg-csv-feed`, and create-entry stay as they are today.

**v1 desk:** Isometric GHG entry (`createGhgEntry`). The **bucket and prefix scheme must already be multi-registry** so a second tenant or a Puro project does not require a new bucket. Do not call the Isometric assemble/submit path for a Puro project.

---

## 1. What already works (do not rebuild)

| Piece | Where | Reuse |
| --- | --- | --- |
| Period picker (YYYY-MM-DD start/end) | `submission-chain.tsx` + `period-store.ts` | Fetch window = `batch.periodStart` / `batch.periodEnd`; drafts are **per project** |
| Tenant + project + registry on the catalog | `tenants.ts`, `Project.tenantId`, `Project.registry` | Prefix and `resolveOwnedProject` — do not invent a second id scheme |
| GHG panel + local CSV upload | `ghg-entry-panel.tsx` | **Keep as-is.** Add a second insert choice (Fetch). Same `draftKey` / `addFiles` / quality button |
| Filter CSV rows to the period | `ghg-csv-feed.ts` `filterRowsByPeriod` (`timestamp_utc`) | Apply after S3 concat |
| Map CSV → LCA component inputs | `ghg-csv-feed.ts` | Unchanged |
| Quality overlay (DQA / anomaly / Step-3) | `ghg-quality/quality-overlay.tsx` → `POST /api/sentinel/pipeline` | **No change.** Still reads `getDraftFiles(draftKey)`, `origin: "operator-upload"` |
| Create entry | `POST /api/registry/accounting` `action=create-entry` | **No change.** FormData still appends the same draft files |
| Certify sources + datapoints + entry | `isometric/write.ts` `createGhgEntry` | Unchanged |
| Evidence bucket | `minrv-ew2-{stage}-evidence-{account}` | **Leave it.** DQA/V&V uploads + Object Lock. Not the stream store. |
| Sample GHG CSVs | `apps/web/test-data/ghg-entry/` | Seed **pivots** these to long `observations.csv` + `attributes.json` |

Sentinel still scores bytes. It does **not** list the stream bucket. Next BFF lists and gets objects, then calls Sentinel with the assembled file.

---

## 2. Invariants

1. **Browser never talks to S3.** No Cognito Identity Pool, no temporary AWS keys in JS. The GHG panel calls a Next route; the web task uses IAM.
2. **Dates first.** No fetch without `periodStart` and `periodEnd` on the selected batch. Reject inverted or empty ranges.
3. **Tenant ∩ registry ∩ project.** Every list/get uses `session.tenantId` (today: `x-tenant-id` until ACL lands), `project.registry`, and `project.id`. The client must not pass a registry or tenant that disagrees with `resolveOwnedProject`. Empty grant on a registry means **no fetch**, not “all prefixes”.
4. **One project, one registry.** Do not store or fetch the same series under two registry slugs. Fujairah Isometric and a Puro facility are different prefixes even if they share a site name.
5. **Fetch is not registry submit.** S3 ingest fills the draft + quality pipeline. Isometric `createGhgEntry` still needs DQA. A future Puro submit is a different module (`registry.submit` + `registry: Puro.earth`).
6. **Do not pull Certify (or Puro) private URLs for DQA.** This feature reads **our** stream bucket.
7. **Quality engines stay in Sentinel.** Sentinel is not tenant-isolated today; Next must only proxy runs for the owned project. Do not list S3 from FastAPI.
8. **Desk-local assemble.** Shared: `list/get` by prefix. Isometric: GHG CSV assemble in `registries/isometric/`. Puro does not import that file.
9. **No realtime connection.** Writers land files whenever they want. Fetch is on-demand list/get for the selected dates.
10. **Stream bucket ≠ evidence bucket.** One stream bucket **per stage** (all tenants). Isolation is the key prefix, not a bucket per customer.
11. **Registry is not Cognito.** No groups `isometric` / `puro`. Prefix slug is product routing, same as [modules.md](./modules.md).
12. **Seed only existing projects.** `make seed-stream-s3` must **prompt** (or require env) for tenant, registry, and project id, then **refuse** unless that triple matches `PROJECTS` or a live registry project this tenant can already resolve. No invented ids, no default that skips the prompt when stdin is a TTY.
13. **Show missing data** (S3 path only). Fetch never implies completeness. Coverage is returned by the BFF and rendered **when the operator chose Fetch**. CSV upload does not use this report and must not be blocked by it.
14. **CSV upload is untouched.** Do not remove, hide, or re-route the existing file input. Fetch is another way to fill the same draft. After files are in `requirement-draft-store`, insert → quality is the **same code path** for both choices.
15. **Historian is S3 files, not database rows.** Stream samples are not inserted into Aurora or Sentinel Postgres. v1 objects are CSV (`observations.csv`) plus small JSON sidecars. After Fetch, quality still sees a CSV **file**, same as upload.

### 2.1 Three axes (do not collapse)

| Axis | Identity | Stream prefix | Product |
| --- | --- | --- | --- |
| Tenant | `fourfourone` today; more later | First path segment | Org isolation. Session tenant only. |
| Registry | `Project.registry` | Second segment (`isometric`, `puro`, …) | Desk + adapter. Grants: `period.write` **and** `registry: {that}`. |
| Project | `Project.id` | Third segment | Periods, fetch window, DQA bind, Certify write. |

Wrong: one prefix `fourfourone/streams/` for every 44.01 registry. Wrong: `ISOMETRIC_PROJECT_ID` as the only S3 project. Wrong: listing Certify projects and fetching Puro keys because the tenant is the same.

---

## 3. Operator flow (UI)

### 3.1 Beginning of the desk (already there)

`SubmissionChain` already collects:

- `periodStart` / `periodEnd` (`YYYY-MM-DD`)
- contiguous, non-overlapping drafts (`period-store.addDraft`)

Periods are **per project** (`period-store.byProject`). Fetching Fujairah’s window must not read another project’s `dt=` keys, even in the same tenant and registry.

That pair **is** the ingest duration for **this** project. Fetch uses it as the S3 window. CSV upload does not need a stream object for those dates; quality still uses the files in the draft.

### 3.2 Insert data — choose source (do not fork quality)

On `GhgEntryPanel` (only when `project.registry === "Isometric"`; other desks do not mount this panel).

The operator **chooses one insert**:

| Choice | What happens | What does not change |
| --- | --- | --- |
| **Upload CSV** | Existing button, `accept` list, `addFiles(draftKey, files)` | Quality overlay, pipeline, create-entry |
| **Fetch from stream** | BFF assembles a CSV → `addFiles(draftKey, [file])` | Same |

They are alternatives, not a pipeline. Copy: “Upload a CSV, or fetch existing data from the stream store for this period.” Fetch is **not** “primary”; upload is **not** “fallback.”

Rules so Fetch cannot interfere with upload:

1. Keep the current **Upload CSV for this GHG entry** control (layout can sit beside Fetch; do not nest upload inside a fetch wizard).
2. **One set of files in the slot.** Choosing Fetch **replaces** draft files for that `draftKey` (do not append stream CSV on top of a USB file). Choosing Upload **replaces** a previous fetch (clear `coverage` from the panel). Removing the last file returns to “no source yet.”
3. **Run quality check** stays enabled iff `files.length > 0`, same as today — including after a USB upload when the stream bucket is empty or Fetch failed.
4. Do not call `/api/registry/ghg-source` on upload. Do not require `STREAM_S3_BUCKET` for the CSV path. If the bucket is unset, **only** disable Fetch; upload still works.
5. `GhgQualityOverlay` stays on `getDraftFiles` + `origin: "operator-upload"` + `slot_id` `ghg-entry:{batchId}`. Do not add `origin: s3` or a second overlay.
6. **Missing-data block (§4.6)** only after a Fetch. CSV upload keeps today’s “Missing inputs” line from the calculation tree; it is not gated on S3 `coverage.complete`.
7. Create-entry: existing `canCreate` (files + DQA passed/skipped + monitored inputs). Extra: if the current files came from Fetch and `coverage.complete === false`, disable create-entry until they Fetch a complete window **or** they switch to a CSV upload. A USB CSV that passed quality must not stay blocked because an earlier Fetch had gaps.

Empty Fetch (no keys in range) is an error on the Fetch choice only. It must not wipe a CSV the operator already uploaded unless they confirmed replacing the source (default: failed Fetch leaves existing files).

### 3.3 Source configuration

Convention first: prefix from `(tenantId, registrySlug, projectId)` — **no env var that pins one 44.01 project**.

Later: optional override row per connection (`registry_connections` / SSM) if a historian uses a custom prefix. Still keyed by tenant + registry + project. `admin.tenant` connects a registry; it does not share another tenant’s prefix. Do not put bucket names in the client bundle.

---

## 4. Stream bucket (provision this)

### 4.1 Why a new bucket

The evidence bucket is for **operator/Sentinel uploads** (KMS + Object Lock). Stream data is a **standing store**: realtime pipeline or offline loaders `PutObject` as they like; MinRV later `GetObject` for a date window. Mixing the two fights Object Lock, IAM, and lifecycle.

Provision in `infra/lib/data-stack.ts` next to evidence/logs:

| | Value |
| --- | --- |
| Name | `minrv-ew2-{stage}-stream-{account}` via `streamBucketName()` in `config.ts` |
| Region | eu-west-2 |
| Encryption | Same CMK as evidence (`alias/minrv-ew2-{stage}`), bucket key on |
| Public access | Block all; HTTPS only |
| Versioning | On (historian retries / seed re-runs) |
| Object Lock | **Off** — daily files may be replaced when the stream re-exports a day |
| Lifecycle | Abort incomplete MPU 7d; expire noncurrent versions like evidence (90d sandbox / 365d prod) |
| Output | `StreamBucketName` / `StreamBucketArn` on the data stack |

Web task env: `STREAM_S3_BUCKET` (one name per stage). Not a bucket per tenant.

**As of this repo:** the stream bucket is **not** in CDK yet. `data-stack.ts` only creates evidence + logs. The web task has **no** `ListBucket`/`GetObject` on historian keys and **no** `STREAM_S3_BUCKET`. Fetch cannot run on the live landing zone until Phase 0 deploys.

### 4.1.0 CDK stacks — change these, leave the rest

Do **not** add a new CloudFormation stack. Reuse `data` + `compute` (compute already depends on data). Same CMK from **security** (`alias/minrv-ew2-{stage}`): the web task already has `kms:Decrypt` / `kms:DescribeKey` on that key.

| Stack / file | Change? | What |
| --- | --- | --- |
| `infra/lib/config.ts` | **Yes** | `streamBucketName(stage)` → `minrv-ew2-{stage}-stream-{account}` (same pattern as `evidenceBucketName`) |
| **data** `data-stack.ts` | **Yes** | New `streamBucket` next to evidence/logs; `exportValue` + CfnOutputs `StreamBucketName` / `StreamBucketArn`; Object Lock **off**; versioning on; bucket key on |
| `stage.ts` | **Yes** | Pass `this.data.streamBucket` into `ComputeStack` (today compute only gets `logsBucket` from data) |
| **compute** `compute-stack.ts` | **Yes** | Web container `STREAM_S3_BUCKET={streamBucket.bucketName}`; web **task** role `s3:ListBucket` + `s3:GetObject` on stream only; **no** Put/Delete/Abort on stream; keep `DenyEvidenceWrites` |
| **security** | No | Reuse existing CMK. Do not mint a second key for stream |
| **network / identity / edge / CloudFront / observability / pipeline / registry** | No | No ALB, Cognito, WAF, or pipeline artifact change |
| **compliance** | No for v1 | Keep Config on evidence + logs. Optional later: record the stream bucket |
| Aurora / Valkey in **data** | No | No table, no proxy, no extra secret for stream samples |
| Sentinel task role | No | Keep evidence R/W only. Do **not** grant stream |

Deploy order: `make -C infra deploy` updates **data then compute** (existing `compute.addStackDependency(this.data)`). Do not deploy compute alone after adding the bucket — `STREAM_S3_BUCKET` would be empty.

`infra/Makefile` + `infra/scripts/seed-stream-s3.ts` are **not** stacks. Seed uses the operator/deploy principal after the data stack is `CREATE_COMPLETE` / `UPDATE_COMPLETE`. Historian IAM user (scoped Put) is Phase 4, out of band.

Why not reuse evidence: sandbox/prod evidence can use Object Lock; web is denied Put; Sentinel already writes DQA bytes there. Mixing daily historian overwrites with compliance lock + mixed IAM is the failure mode this bucket avoids.

### 4.1.1 Store CSV objects, not DB rows

| Store | What | Why |
| --- | --- | --- |
| **Stream S3** (this feature) | One `observations.csv` per UTC day (long rows: timestamp, metric, value, unit, quality) + `_schema.json` + `attributes.json` | Historian / ETL already writes files. List by `dt=` for a period. No realtime DB ingest. |
| **Not Aurora / Sentinel Postgres** | Do **not** COPY telemetry into a `samples` table for Fetch | Cardinality (2‑minute tags × wells × days) belongs in object storage. Sentinel DB is quality **runs**, not the plant series. Identity Aurora is tenants/grants, not WHP. |
| **Draft / quality** | Assembled **wide CSV `File`** in the browser draft | Same bytes DQA already expects from upload. Not a second database. |
| **Evidence S3** | Still only DQA/V&V uploads | Unchanged |

v1 file format is **CSV** because seed, `filterRowsByPeriod`, and the GHG overlay already speak CSV. The rows inside that file are tidy timeseries (one metric per row), not a wide GHG submit table.

Do not add Timescale/Aurora “so we can SQL the historian” in this ticket. If a later product needs ad-hoc queries, keep S3 as source of truth and add Athena/Glue on the same `dt=` layout — still not app-DB rows.

Parquet (same columns, same partitions) is v2 only.

### 4.2 Who writes vs who reads

| Actor | When | Access |
| --- | --- | --- |
| Historian / ETL | Per plant | `PutObject` on **that** `{tenantId}/{registrySlug}/{projectId}/*` (IAM user per tenant when you have more than one writer) |
| `make seed-stream-s3` | Mock | Write only after operator picks an **existing** tenant / registry / project |
| Next web task | Fetch | `ListBucket` + `GetObject` on the whole stream bucket; **app** must still prefix-lock to the session project |
| Sentinel | Never | Evidence only |

The Fargate role cannot be a different IAM policy per Cognito user. **Tenant isolation is enforced in the BFF** by building the prefix from `resolveOwnedProject`, never from a raw `prefix=` query param.

### 4.3 Key convention

```
s3://minrv-ew2-{stage}-stream-{account}/
  {tenantId}/
    {registrySlug}/
      {projectId}/                 # MUST be an existing catalog or live id
        _schema.json               # contract for this prefix (version, cadence, required fields)
        attributes.json            # period-level required data (not high-frequency)
        dt=YYYY-MM-DD/
          observations.csv         # timeseries for that UTC day
```

| `Registry` (product) | `registrySlug` (S3) |
| --- | --- |
| Isometric | `isometric` |
| Puro.earth | `puro` |
| Verra VCS | `verra` |
| Gold Standard | `gold-standard` |

List prefix **exactly** `{tenantId}/{registrySlug}/{projectId}/`. Never list `{tenantId}/` alone from a project fetch.

Keep objects whose `dt=` is inside `[periodStart, periodEnd]`. Then still filter observation rows on `timestamp_utc` so a file that spills past midnight cannot leak into the wrong GHG entry.

Hive-style `dt=` is enough for v1. Keys without a date: skip (fail closed). Do not scan whole objects to guess the day.

v1 seed example (only after the prompt accepts this catalog row):

`fourfourone/isometric/fujairah-mineral/dt=2026-09-01/observations.csv`

A second **existing** project is another prefix in the same bucket, e.g. `terrafix/isometric/north-sea-dac/…`.

### 4.4 Timeseries schema (store this way)

S3 is a **historian buffer**, not a dump of the GHG submit CSV. Use one layout for every desk so “any required data” is extra metrics/attributes, not a new folder shape.

**`dt=YYYY-MM-DD/observations.csv`** — long (tidy) timeseries, UTF-8, header row:

| Column | Required | Rule |
| --- | --- | --- |
| `timestamp_utc` | yes | ISO-8601 UTC (`2026-09-01T00:00:00Z`). No local time, no timezone-less stamps. |
| `metric` | yes | Contract id (`whp_well_a_bar`, `inj_rate_ft01_m3h`, …). Snake case, stable. |
| `value` | yes | Number, or empty when this sample is missing (do not invent 0). |
| `unit` | yes | SI / contract unit (`bar`, `m3/h`, `degC`). |
| `quality` | yes | `ok` \| `missing` \| `estimated` \| `flag`. |
| `source` | no | `historian` \| `seed`. |

One row = one metric at one timestamp. Wide “one column per sensor” files are **assemble-time only** (Isometric GHG panel / DQA). Do not store a second wide copy in S3.

**`attributes.json`** — slowly changing / period constants the desk also needs (Isometric GHG accounting headers, emission factors, masses). Not a timeseries. Shape:

```json
{
  "schemaVersion": 1,
  "periodStart": "2026-09-01",
  "periodEnd": "2026-09-03",
  "values": { "FEEDSTOCK_MASS_t": 12500, "GRID_EMISSION_FACTOR_kg_per_kWh": 0.42 }
}
```

**`_schema.json`** — contract for this project prefix (written by seed / historian):

```json
{
  "schemaVersion": 1,
  "kind": "timeseries",
  "timezone": "UTC",
  "cadence": "PT2M",
  "registry": "Isometric",
  "methodologyKey": "isometric-insitu-mineralization",
  "requiredSeries": ["whp_well_a_bar", "inj_rate_ft01_m3h"],
  "requiredAttributes": ["FEEDSTOCK_MASS_t", "GRID_EMISSION_FACTOR_kg_per_kWh"]
}
```

v1 Isometric in-situ: `requiredSeries` = telemetry tags from `generate.mjs` / `GHG_SERIES_LABELS`; `requiredAttributes` = `GHG_ACCOUNTING_HEADERS`. Other methodologies swap the arrays; they do not change the key layout.

Parquet in v2: same columns, same `dt=` partitions. Convert server-side; do not require the browser to parse Parquet.

Max assembled **wide** CSV in memory: **50 MB**. If the window is larger, fail with “narrow the period or partition by day” rather than OOM.

### 4.5 Required data (any desk)

Required fields are **not** hard-coded to Fujairah. Resolve them from `(project.registry, project.methodologyKey)` in `stream-schema.ts`:

- Unknown extra metrics in S3 are **kept** (forward compatible).
- Missing **required** series or attributes are **listed**, never filled with defaults.
- A Puro (or Verra) project uses the same observations/attributes files with a different `_schema.json`.
- Isometric assemble (`ghg-s3.ts`) pivots long observations + attributes → the wide CSV `ghg-csv-feed` already consumes. Other desks get their own assembler.

### 4.6 Missing-data report (must show)

Every `GET`/`POST` `/api/registry/ghg-source` returns `coverage` (JSON on GET; JSON sidecar or `X-Stream-Coverage` + CSV on POST). The panel renders this list; do not collapse it to “gaps: 2”.

| Field | Meaning |
| --- | --- |
| `daysExpected` | Every calendar day in `[periodStart, periodEnd]` |
| `daysPresent` | Days that have an `observations.csv` object |
| `daysMissing` | Expected days with **no object** |
| `seriesMissing` | `requiredSeries` with no rows in the window |
| `attributesMissing` | `requiredAttributes` absent, null, or non-numeric in `attributes.json` |
| `gaps` | Per metric, expected cadence slots (`cadence` in `_schema.json`) with no `ok` sample |
| `nullSamples` | Rows where `value` is empty or `quality=missing` |
| `complete` | `true` only if required series, attributes, and days are all present |

If `_schema.json` is missing, treat the v1 Isometric in-situ contract as default **only** for `registry === "Isometric"`; otherwise `complete=false` and `seriesMissing` = “schema unknown — cannot verify required data”.

UI copy **after Fetch**: named lists (e.g. “Missing days: 2 Sep 2026”, “Missing series: inj_rate_ft02_m3h”, “Missing attributes: GRID_EMISSION_FACTOR_kg_per_kWh”). Quality overlay can still add DQA codes (`C-01`, `C-03`); this block is the **ingest** view of the same facts. **Do not show this block on a CSV-only insert.**

---

## 5. BFF design

### 5.1 New route (prefer explicit)

`apps/web/src/app/api/registry/ghg-source/route.ts`  
`export const dynamic = "force-dynamic"`

| Method | Action |
| --- | --- |
| `GET` | Preview: list keys + **coverage** (§4.6). Query: `projectId`, `periodStart`, `periodEnd`. Always JSON. |
| `POST` | Fetch + assemble wide CSV for the desk **and** return the same `coverage` object. Body: project, period, optional narrow dates. |

Simplest v1 for the existing panel: `POST` returns `multipart/mixed` or JSON `{ filename, csv, coverage, rowCount }`. The client `addFiles` the CSV **and** renders `coverage`. Do not return CSV-only (that hides missing data).

Do not stream S3 to the browser as a zip of raw historian files unless needed; one period CSV is what quality and `createGhgEntry` already consume.

`projectId` in the query is the **only** client-supplied identity. Tenant comes from the session (header today). Registry comes from `resolveOwnedProject` — reject if the client also sends `registry` and it does not match the project row.

### 5.2 Server modules

Shared (any desk that reads the stream bucket), `server-only`:

`apps/web/src/lib/stream-s3.ts`

- `registrySlug(registry: Registry)` — table in §4.3
- `sourcePrefix(tenantId, registry, projectId)` → `{tenantId}/{slug}/{projectId}/`
- `listTelemetryKeys({ tenantId, registry, projectId, from, to })` → `ListObjectsV2` **only** that prefix
- `getObjectBytes(key)` — **reject** the key unless it starts with `sourcePrefix(...)` (path-traversal / confused-deputy)
- `buildCoverage({ schema, observations, attributes, from, to })` → §4.6 payload

Contract:

`apps/web/src/lib/stream-schema.ts`

- `requiredFor(project: Project)` → `requiredSeries`, `requiredAttributes`, `cadence`
- v1 tables: Isometric in-situ + Isometric DAC (reuse series; DAC can start with a subset). Other registries: empty required arrays is **not** “all good” — `complete` stays false until a contract exists.

Isometric assemble (GHG CSV only):

`apps/web/src/lib/registries/isometric/ghg-s3.ts`

- `assemblePeriodCsv(observations, attributes, from, to)` → pivot long → wide (telemetry columns + `GHG_ACCOUNTING_HEADERS`), then `filterRowsByPeriod`
- Must not be imported from a Puro route

AWS SDK v3 `@aws-sdk/client-s3` in the web app (server-only). Region `eu-west-2`. Bucket from `STREAM_S3_BUCKET`.

### 5.3 Authz

Same as `accounting/route.ts` for v1: tenant ∈ `TENANTS`, `resolveOwnedProject` (tenant **and** `registry === "Isometric"`). When `authorize.ts` exists: `period.write` + `registry: Isometric` + `projectId`. Empty `registries` grant → 403, not another tenant’s prefix.

A second tenant’s Isometric project uses the same route and slug `isometric`, different first path segment.

### 5.4 IAM (CDK) — current vs required

**Today (compute web task):** secrets + SSM locations + Cognito admin + `kms:Decrypt` on the stage CMK + **deny** `PutObject`/`DeleteObject`/`AbortMultipartUpload` on **evidence**. No S3 read on any bucket. Sentinel: evidence List/Get/Put/Delete only.

**Required for Fetch:**

Keep `DenyEvidenceWrites`. Add stream **read** only. Do not grant the web task Put on stream (seed/historian write; web must not overwrite plant files).

The web **task role is shared across tenants**. Do not IAM-scope `fourfourone/` on that role if a second tenant will use the same ECS service. Scope in code (`sourcePrefix` + key prefix check). Optional later: historian IAM **users** with `…/object/{theirTenant}/*` Put only.

| Principal | Actions | Resource |
| --- | --- | --- |
| Web task | `s3:ListBucket` | bucket |
| Web task | `s3:GetObject` | `arn:…:object/*` |
| Web task | **No** `PutObject` / `DeleteObject` | — |
| Sentinel task | **None** | — |
| Deploy / `make seed-stream-s3` | `PutObject`, abort, delete | objects under the CLI tenant/registry/project |
| Optional historian IAM user | `PutObject` | `{tenantId}/{registrySlug}/{projectId}/*` only |

Set `STREAM_S3_BUCKET` on the web **container** in `compute-stack.ts` from `props.streamBucket.bucketName`. KMS: no extra statement if the bucket uses the existing stage CMK (web already decrypts it). Confirm `bucketKeyEnabled: true` on the new bucket (same as evidence).

---

## 6. Makefile: seed sample stream data

Purpose: **init the stream bucket with mock timeseries** so Fetch can be tested without a plant feed. Seed must land **required series + required attributes** for that project’s contract, and can also land a **gaps** pack so missing-data UI can be verified.

### 6.1 Ask tenant, registry, project id

`make seed-stream-s3` runs `infra/scripts/seed-stream-s3.ts`. The script **must ask** for all three before any `PutObject`.

On a TTY (interactive):

1. Print tenants from `TENANTS` (`fourfourone`, `verdant`, `helios`, `terrafix`, …). Prompt: `Tenant id:`.
2. Print registries that have at least one **existing** project for that tenant. Prompt: `Registry slug (isometric|puro|verra|gold-standard):`.
3. Print matching catalog projects (`id` + name). Prompt: `Project id:`.
4. Confirm the triple (`fourfourone` / Isometric / `fujairah-mineral`) and the S3 prefix. Prompt: `Write N day(s)? [y/N]`.

Non-TTY (CI / pipes): do **not** invent defaults. Require:

`STREAM_TENANT` + `STREAM_REGISTRY` + `STREAM_PROJECT`

Exit non-zero with “set STREAM_TENANT, STREAM_REGISTRY, STREAM_PROJECT (must be an existing project)” if any are missing.

Same style as `seed-cognito`: real eu-west-2, no LocalStack. Add to `infra/Makefile` `.PHONY` next to `seed-cognito`.

```bash
cd infra
make seed-stream-s3
# TTY: answers tenant / registry / project id from the printed lists

# CI / isolation (still existing catalog ids only):
#   APP=minrv-ew2-sandbox \
#   STREAM_TENANT=fourfourone \
#   STREAM_REGISTRY=isometric \
#   STREAM_PROJECT=fujairah-mineral \
#   STREAM_FROM=2026-09-01 STREAM_TO=2026-09-03 \
#   STREAM_PACK=pass \
#   make seed-stream-s3

# second existing Isometric catalog project (prefix isolation only; GHG panel v1 is in-situ):
#   STREAM_TENANT=terrafix STREAM_REGISTRY=isometric STREAM_PROJECT=north-sea-dac \
#   make seed-stream-s3
# existing Puro catalog project:
#   STREAM_TENANT=terrafix STREAM_REGISTRY=puro STREAM_PROJECT=nordic-biochar \
#   make seed-stream-s3
```

### 6.2 Resolve against existing projects — refuse otherwise

After the prompt / env:

1. Map `STREAM_REGISTRY` slug → product `Registry` (`isometric` → `Isometric`). Refuse display names (`Isometric`, `puro.earth`).
2. Load catalog `PROJECTS`. Accept only if `project.id === STREAM_PROJECT` **and** `project.tenantId === STREAM_TENANT` **and** `project.registry` matches the slug.
3. Optional: if `STREAM_PROJECT` looks like Certify `prj_…`, accept only when `resolveOwnedProject(tenant, id)` would succeed for that tenant’s Isometric connection (live list). Still refuse random strings.
4. If the triple does not match: print the valid ids for that tenant+registry and **exit 1**. Never mkdir a prefix for a project the product does not know.

Do not fall back to `fujairah-mineral` when the operator types a typo.

### 6.3 Script behaviour

`infra/scripts/seed-stream-s3.ts`:

1. Resolve bucket from data-stack output `StreamBucketName` (fail if the stack is not `CREATE_COMPLETE` / `UPDATE_COMPLETE`).
2. Resolve the project as §6.2. Load `requiredFor(project)` (§4.5).
3. Build mock observations from `apps/web/test-data/ghg-entry/` (wide PASS/FAIL CSVs → **long** observations):
   - `STREAM_PACK=pass` (default) → complete required series + all `GHG_ACCOUNTING_HEADERS` in `attributes.json`
   - `STREAM_PACK=fail` → same shape, implausible values (`GHG_ACCOUNTING_FAIL`)
   - `STREAM_PACK=gaps` → omit one calendar day **and** drop one required series **and** omit one required attribute (to prove the missing-data panel)
   - if the source CSV is missing, run `node apps/web/test-data/ghg-entry/generate.mjs` first
4. Split observations by UTC calendar day of `timestamp_utc`. `PutObject`:

   `{tenant}/{registrySlug}/{projectId}/_schema.json`  
   `{tenant}/{registrySlug}/{projectId}/attributes.json`  
   `{tenant}/{registrySlug}/{projectId}/dt=YYYY-MM-DD/observations.csv`

5. Print: bucket, prefix, project name, key count, date span, required series/attributes counts.
6. Connectivity: `HeadBucket` + `ListObjectsV2` **that prefix only** + `GetObject` of `_schema.json` and one observations object. Exit non-zero if any call fails. Do not list the tenant root.

Idempotent: overwrite the same keys (versioning keeps history).

### 6.4 What “required for submission” means

PASS pack must satisfy `_schema.json` for that project so Fetch can show `complete: true`:

- every `requiredSeries` has `ok` samples on each day in the seed window
- every `requiredAttribute` is numeric in `attributes.json`
- `timestamp_utc` + cadence (v1: 2 minutes, matching Sentinel C-01)

That is a **mock of stream + period accounting**, not a live Certify template. Certify create-entry still needs a live GHG template on the project.

### 6.5 Local laptop

If `STREAM_S3_BUCKET` is unset and the stack is missing, the script fails loudly. Do not silently write to the evidence bucket.

---

## 7. How this plugs into quality and Certify

Insert (upload **or** fetch) only fills `requirement-draft-store` for `draftKey = {projectId}:{batchId}:ghg-entry:{batchId}`.

**From that point the flow is the existing one.** Do not add a second quality button, a second pipeline origin, or a create-entry that reads S3.

```
File[] in draft  (USB CSV  —or—  assembled stream CSV)
  → same “Run quality check”
  → GhgQualityOverlay (existing)
  → POST /api/sentinel/pipeline
       slot_id = ghg-entry:{batchId}
       origin  = operator-upload
       files   = getDraftFiles(draftKey)
  → ghg-csv-feed fills calculation tree
  → POST /api/registry/accounting action=create-entry
       FormData files = the same draft files
       started_on / completed_on = period
```

S3-only extras (Fetch choice):

- Show `coverage` before create-entry.
- Quality may still run on a gappy assemble so DQA can confirm C-01 / C-03.
- Do not skip the ingest list because DQA will also mention those codes.

CSV-only extras: none. No coverage fetch, no `STREAM_S3_BUCKET` check.

Sentinel pipeline bind must use **this** `projectId` (and tenant header). Do not reuse a default `SENTINEL_PROJECT_ID` for another project’s fetch.

---

## 8. Implementation phases

### Phase 0 — Stream bucket (CDK)

None of this is in the landing zone until this phase deploys. Product Fetch will 503/disabled until then; CSV upload stays up.

- `streamBucketName()` in `config.ts`
- Bucket + outputs on **data** (`data-stack.ts`); `public readonly streamBucket`
- `stage.ts`: pass `streamBucket` into compute
- **compute:** `STREAM_S3_BUCKET` on the web container; web task List/Get on stream; no web Put; Sentinel unchanged; keep evidence deny
- `make -C infra deploy` (data **then** compute). Do not reuse evidence. Do not add a ninth stack suffix.

### Phase 1 — Seed + connectivity

- Not a stack: `infra/scripts/seed-stream-s3.ts` + `make seed-stream-s3` (`.PHONY` next to `seed-cognito`)
- TTY prompts for tenant, registry, project id; CI requires the three env vars
- Refuse ids that are not in `PROJECTS` (or live Certify for that tenant)
- PASS pack: `_schema.json` + `attributes.json` + `dt=…/observations.csv` (long) under the chosen existing project
- `STREAM_PACK=gaps` against the same project to populate missing days/series/attributes
- Isolation: second run with **existing** `terrafix` / `isometric` / `north-sea-dac`
- Script must `GetObject` `_schema.json` **under that prefix** before exiting 0

### Phase 2 — BFF fetch

- `stream-s3.ts` + `stream-schema.ts` + isometric `ghg-s3.ts` + `GET/POST /api/registry/ghg-source`
- Unit tests: `sourcePrefix`; tenant A vs B; two **catalog** projects; `dt=` filter; long→wide assemble; coverage for missing days/series/attributes; empty window; size cap; GetObject key that does not match prefix → reject
- Manual: seed then `curl` with tenant header + that `projectId` (must not return the other seeded prefix); JSON includes `coverage.daysMissing` / `seriesMissing` / `attributesMissing`

### Phase 3 — GHG panel (Isometric only)

- Two insert choices on **Sources and quality**: existing Upload CSV **and** Fetch from stream
- Fetch disabled if bucket unset; upload still works
- Missing-data list only after Fetch
- Browser: (1) USB CSV → quality → create entry, same as today; (2) seed + Fetch → quality → create entry
- Switching insert choice replaces draft files; switching project clears files
- `STREAM_PACK=gaps` → Fetch lists omitted fields; operator can still **upload CSV instead** and quality/create follow the CSV path

### Phase 4 — Source config / hardening

- Optional per-connection prefix override
- Session tenant from Cognito (drop header-as-tenant)
- Historian IAM user per tenant
- Puro (or other) desk assembler **in that registry’s module**, same timeseries layout + its own `requiredFor`

Do not start Phase 4 until Phase 3 has been used on a seeded **Isometric** window.

---

## 9. File map (when you code)

| Path | Change |
| --- | --- |
| `infra/lib/config.ts` | `streamBucketName()` |
| `infra/lib/data-stack.ts` | New `streamBucket` + outputs (evidence/logs/Aurora/Valkey **unchanged**) |
| `infra/lib/stage.ts` | Pass `streamBucket` into compute |
| `infra/lib/compute-stack.ts` | Accept bucket; web `STREAM_S3_BUCKET`; web List/Get; no web Put; Sentinel IAM **unchanged** |
| `infra/lib/security-stack.ts` | **No change** (reuse CMK) |
| `infra/lib/network-stack.ts` / `identity-stack.ts` / `edge-stack.ts` / `cloudfront-stack.ts` / `observability-stack.ts` / `pipeline-stack.ts` / `compliance-stack.ts` | **No change** |
| `infra/scripts/seed-stream-s3.ts` | **New** (not a stack) |
| `infra/Makefile` | `seed-stream-s3` target |
| `apps/web/src/lib/stream-s3.ts` | **New** prefix + list/get + coverage |
| `apps/web/src/lib/stream-schema.ts` | **New** `requiredFor(project)` contracts |
| `apps/web/src/lib/registries/isometric/ghg-s3.ts` | **New** long→wide GHG assemble |
| `apps/web/src/app/api/registry/ghg-source/route.ts` | **New** BFF (Isometric + owned project + coverage JSON) |
| `apps/web/src/components/dashboard/ghg-entry-panel.tsx` | Add Fetch **beside** existing upload; same `draftKey` / quality button |
| `apps/web/src/components/dashboard/ghg-quality/**` | **No change** (still `getDraftFiles` + `operator-upload`) |
| `apps/web/src/lib/ghg-csv-feed.ts` | Reuse |
| `apps/web/src/lib/registries/isometric/write.ts` | No change if files still arrive as `PipelineFile[]` |
| `apps/web/src/lib/tenants.ts` / `types.ts` | Reuse `TENANTS` + `Project.tenantId` + `Project.registry` |
| `apps/sentinel/**` | No change (no S3 list) |
| Evidence bucket | Unchanged |

---

## 10. Test plan

Write these as you implement.

1. **Seed prompt:** TTY `make seed-stream-s3` asks tenant, registry, project id; garbage id exits 1 with the valid list.
2. **Seed existing only:** `STREAM_PROJECT=demo-facility` or a project whose `tenantId` does not match `STREAM_TENANT` → exit 1, no PutObject.
3. **Seed keys:** writes `{tenant}/{registry}/{project}/_schema.json`, `attributes.json`, `dt=…/observations.csv` (long columns §4.4).
4. **Key filter:** objects `dt=2026-09-01` … `dt=2026-09-30` listed for period 2–3 Sep → only those keys.
5. **Tenant isolation:** tenant A’s fetch cannot list or assemble tenant B’s keys.
6. **Registry / project isolation:** `fujairah-mineral` vs catalog `north-sea-dac` — each fetch returns only its prefix.
7. **Coverage — missing days:** `STREAM_PACK=gaps` → `coverage.daysMissing` includes the omitted day; panel lists it by date.
8. **Coverage — missing series / attributes:** `STREAM_PACK=gaps` → named lists after **Fetch**; create-entry disabled **on that Fetch**. Upload CSV afterwards → coverage cleared, create-entry follows existing quality gates.
9. **Row filter:** observations spanning 1–30 Sep, period 2–3 → only those days in the assembled wide CSV.
10. **Empty Fetch window:** no `dt=` objects → error on Fetch; **Upload CSV still works**; do not auto-run quality on empty fetch.
11. **Too large:** 50 MB+ assemble → 413; upload of a smaller CSV still works.
12. **Quality (fetch):** seeded PASS pack opens the **same** overlay and can reach `readyToSubmit`.
13. **Quality (upload):** with Fetch unused, USB CSV still opens overlay, feeds the tree, and can create-entry (regression: do not require stream bucket).
14. **Create entry (fetch):** `started_on`/`completed_on` match the period; blocked when Fetch `coverage.complete` is false.
15. **Same pipeline:** both choices use `slot_id` `ghg-entry:{batchId}` and `origin: "operator-upload"`.
16. **IAM:** web task `PutObject` on the stream bucket is denied; seed uses the operator/deploy principal.
17. **CDK:** after deploy, data stack has `StreamBucketName`; web task env `STREAM_S3_BUCKET` matches; Sentinel task policy has **no** stream ARN; `DenyEvidenceWrites` still present.
18. **No subscribe:** no WebSocket, SQS consumer, or S3 event on the web task for this feature.
19. **Confused deputy:** `GET` with another tenant’s `projectId` while header is `fourfourone` → 403.

---

## 11. Open decisions

| Decision | Default if nobody answers |
| --- | --- |
| Dedicated stream bucket vs evidence prefix | **Dedicated bucket** (this revision). Do not put stream objects on evidence |
| Date in key (`dt=`) vs only in CSV | **Both**: list by `dt=`, still filter rows |
| One CSV per day vs one monthly blob | **Per day** (`dt=` + `observations.csv`) |
| Wide CSV in S3 vs long timeseries | **Long in S3**; wide only after assemble |
| Seed default project without asking | **No.** Always prompt (TTY) or require three env vars |
| Fetch vs CSV upload | **Choose one insert.** Same quality path after files land. Do not replace upload |
| Narrow-window UI vs period only | **Period only** until Fetch is proven |
| Historian IAM user | Out of band. Makefile seed is the mock writer |
| CSV files vs database rows for stream data | **CSV (and JSON sidecars) on the stream bucket.** Not Aurora/Sentinel row ingest |
| One bucket vs bucket-per-tenant | **One bucket per stage.** Prefix isolation. Revisit only if a customer requires a dedicated bucket for compliance |

---

## 12. Anti-patterns

| Do not | Why |
| --- | --- |
| Presign S3 for the browser | XSS + wrong tenant prefix |
| Open a realtime plant / MQTT / SSE pipe into Next | Out of scope; S3 is the buffer |
| Fetch inside Sentinel | Wrong module |
| Call Isometric time-series GET | Not available for in-situ |
| Use `POST /api/registry/submit` for this | Monitoring slots, not GHG accounting |
| Skip quality because “it came from S3” | Same DQA overlay and pipeline as a USB CSV |
| Replace or hide **Upload CSV** | Fetch is the other insert, not a new desk |
| Change pipeline `origin` to `s3` | Forks Sentinel / overlay; keep `operator-upload` |
| Require stream bucket before quality | Breaks CSV-only operators |
| Merge USB files with a Fetch assemble | Operator chose one source; replace the draft |
| New CloudFormation stack for stream | Use existing **data** + **compute**. `STACK_ORDER` stays |
| Grant Sentinel the stream bucket | Quality still scores draft bytes; Sentinel stays on evidence |
| Put series on the evidence bucket | Object Lock + `DenyEvidenceWrites` + mixed IAM |
| Deploy compute without data | `STREAM_S3_BUCKET` missing; Fetch stays disabled |
| Silent fallback to bundled Fujairah CSV | Wrong month / wrong tonnes / wrong project |
| Seed into evidence “to save a bucket” | Breaks the split in §4 |
| Seed a made-up `projectId` (`demo-facility`, `other-mineral-site`) | Prefix will never match Fetch / `resolveOwnedProject` |
| Silent default to `fujairah-mineral` on TTY | Operator must choose tenant, registry, and project |
| Store only a wide GHG CSV in S3 | Cannot add a metric without rewriting files; missing series become empty columns instead of a report |
| Fill missing metrics with `0` | 0 is a real measurement; use empty `value` + `quality=missing` and list it |
| Hide coverage behind DQA only | Ingest must **show** missing days/series/attributes on the panel |
| Hard-code `ISOMETRIC_PROJECT_ID` as the stream project | Other Isometric projects on the same tenant never fetch |
| Client-supplied `tenantId` / `registry` / `prefix` | Confused deputy; ignore except `projectId` |
| One S3 prefix for all 44.01 registries | Tenant ≠ registry |
| Cognito group `isometric` to pick the prefix | Registry is product routing, not IdP |
| Reuse Isometric GHG assemble on a Puro project | Wrong desk; different schema |
| Insert stream samples into Postgres/Aurora | Wrong store; Fetch would become a SQL dump; quality still wants a CSV file |
| Bucket per tenant in v1 | Operational sprawl; prefix is enough until a contract requires otherwise |

---

## 13. Suggested first ticket

1. CDK: `config.ts` + **data** stream bucket + `stage.ts` wire + **compute** web env/IAM. Deploy data then compute.  
2. `make seed-stream-s3` that **asks** tenant / registry / **existing** project id, writes long timeseries + `_schema.json` + `attributes.json`.  
3. `stream-s3.ts` + coverage + `ghg-source` + Fetch **next to** existing Upload CSV on `GhgEntryPanel` (same quality button).  

Prove: (1) upload CSV → quality → create, unchanged; (2) seed `fujairah-mineral` → Fetch → same quality overlay. `STREAM_PACK=gaps` names missing fields on Fetch only. A USB CSV must still work if Fetch is unused or failed. Stop until both inserts share one quality path.
