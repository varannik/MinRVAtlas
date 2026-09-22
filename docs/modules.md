# 3DMinRV — modules: tenants, registries, and desks

Status: **architecture map**. Describes how the repo is organised today, which boundaries are already modular, and the desk pattern required for real multi-registry UI. It is not a sprint plan.

Related: [cognito-tenant-identity-plan.md](./cognito-tenant-identity-plan.md) (identity + ACL), [puro-dmrv-integration-spec.md](./puro-dmrv-integration-spec.md) (Puro process ≠ Isometric process), [data-sentinel-isometric-integration.md](./data-sentinel-isometric-integration.md) (Certify live path), [ui-sentinel-integration.md](./ui-sentinel-integration.md) (Quality Console), [aws-eu-west-2-system-design.md](./aws-eu-west-2-system-design.md) (ECS / secrets).

---

## 0. Verdict

| Axis | Modular in code? | Fit for multi-tenant / multi-registry? |
| --- | --- | --- |
| Registry **rulebook adapters** | Yes | Four registries implement one client contract. The 3D board can render any of them. |
| Registry **live I/O** | Partial | Only Isometric has `server.ts` + `RegistryLiveAdapter`. |
| Registry **desk UI / flow** | No | Control room always mounts Isometric-shaped charter, setup, periods, GHG, submit. Puro is a filter + bundled board. |
| Tenancy | Shaped, not enforced | Cognito session carries `tenantId`. APIs still trust `x-tenant-id`. One live connection (`fourfourone` ↔ Isometric). |
| Quality | Yes, as a sidecar | Sentinel has no registry desk. Step-3 and Certify write stay in Next. |

**Read this as three separate modules that must not collapse into one another:**

1. **Tenant** — who the operator belongs to.
2. **Registry connection** — which issuing body that tenant is wired to.
3. **Registry desk** — the UI and submission flow for that issuing body.

A project sits at the intersection: it belongs to **one tenant** and **one registry**. Switching registry is not a theme toggle. It is a different product surface.

---

## 1. Invariants

These are the rules the code should keep. Violating them is how the platform becomes a single-registry app with extra enums.

1. **Tenant ≠ registry ≠ project.** A tenant may connect many registries. A registry connection may list many projects. A project never belongs to two registries.
2. **The browser never holds registry credentials.** Connections name env vars / secret ARNs. Values resolve only in the Next BFF (`server-only`).
3. **Registry is not Cognito.** Do not add `custom:registry` or groups `isometric` / `puro`. Groups are **roles**. Registry membership is a connection + a grant. See the identity plan.
4. **Same module name, required registry argument.** `authorize("registry.submit", { registry: "Isometric", projectId })` is not Puro submit. Do not invent `registry.submit.isometric` string soup.
5. **Different registries get different desks.** Isometric Certify (GHG entries, statements, monitoring slots) and Puro dMRV (facility audit package, output reports, CORCs) do not share a submit wizard. Shared chrome is the globe, rail, and requirement board **shape**. Flow, artefacts, and copy live in the desk.
6. **Sentinel is the quality engine, not the registry product.** Do not copy Python engines into Next. Do not add a Sentinel UI. Do not log operators into FastAPI.
7. **Next owns product routing.** `apps/web/` is the only place registry desks, BFF routes, and session ACL live. `apps/sentinel/` scores data. `infra/` ships images and secrets.

---

## 2. Three axes

```
                    Cognito session
                    tenantId + role
                           │
                           ▼
              ┌────────────────────────┐
              │        TENANT          │  44.01, later customer orgs
              │  membership + grants   │
              └───────────┬────────────┘
                          │  many
                          ▼
              ┌────────────────────────┐
              │  REGISTRY CONNECTION   │  (tenant, Isometric)  (tenant, Puro)
              │  secret ref, env, org  │
              └───────────┬────────────┘
                          │  many
                          ▼
              ┌────────────────────────┐
              │        PROJECT         │  exactly one registry
              │  catalog id or prj_…   │
              └───────────┬────────────┘
                          │
                          ▼
              ┌────────────────────────┐
              │     REGISTRY DESK      │  UI + API flow for that registry
              └────────────────────────┘
```

Quality Console hangs off the **project**, not the desk. A quality engineer can run DQA on Fujairah without a Certify submit grant.

---

## 3. Monorepo ownership

Directory monorepo. Next.js is **not** at the repo root.

| Module | Path | Owns | Must not own |
| --- | --- | --- | --- |
| **Web / BFF** | `apps/web/` | Operator UI, Cognito session, registry adapters, registry desks, `/api/registry/*`, Sentinel proxy | Python DQA engines, Sentinel screens |
| **Sentinel** | `apps/sentinel/` | DQA, anomaly, V&V, Celery workers | Operator login, registry submit, globe |
| **Infra** | `infra/` | CDK eu-west-2, secrets, ECS, Cognito pool, pipeline | Product enums, adapter logic |
| **Docs** | `docs/` | Contracts between the three | Runtime behaviour (code wins) |

Identity hint for the live operator cut: tenant `fourfourone`. Local Sentinel M2M: `local-sentinel-m2m-token`. Releases: AWS CodePipeline, not GitHub Actions.

### Surfaces the operator actually opens

```
Browser
  ├─ Landing / login     `/` unauthenticated, Cognito popup
  ├─ Control room        `/` after session — shared chrome + **registry desk**
  └─ Quality Console     `/quality/*` — shared, registry-agnostic
```

There is no admin UI and no tenant switcher in the tree yet.

---

## 4. Product modules (ACL + nav)

A user is never “on the platform”. They are on **registry desks inside a tenant**, then **projects on those desks**. Align grants to routes that already exist. Full role table: identity plan §7.

### 4.1 Shared (registry-agnostic, or scoped only by project)

| Module id | UI | Code |
| --- | --- | --- |
| `control_room.read` | Globe, rail, board for granted registries | `components/dashboard.tsx`, `GET /api/registry/projects`, `GET /api/registry/requirements`, `GET /api/projects/locations` |
| `control_room.write` | Pins / location overlay | `PUT /api/projects/locations` |
| `pipeline.run` | Run quality check on a slot | `POST /api/sentinel/pipeline` |
| `quality.configure` | Rules, protocols, models, V&V | `/quality/rules`, `/quality/protocols`, `/quality/models`, `/quality/vv` → Sentinel allowlist |
| `quality.operate` | Datasets, runs, workbench, anomaly | `/quality/datasets`, `/quality/runs`, … |
| `quality.compliance` | Audit, reports | `/quality/audit`, `/quality/reports` |
| `admin.users` | Not built | Planned `/api/admin/users` |
| `admin.tenant` | Not built | Planned registry **connections** |

### 4.2 Registry-desk modules (same id, **registry required**)

| Module id | Isometric desk (built) | Puro desk (specified, not built) | Verra / Gold Standard |
| --- | --- | --- | --- |
| `registry.read` | Live Certify requirements, periods, accounting | Catalogue / facility read when wired | Bundled rulebook only |
| `project_setup` | Charter / PDD `/api/registry/setup` | Facility registration artefacts — **not** Certify PDD | n/a |
| `period.write` | Period close, GHG entry | Output-report period / batch desk | n/a |
| `registry.submit` | `POST /api/registry/submit` → Certify | Output report / dMRV Connect — **different route** | n/a |

Hide the wrong desk in the UI. Still **403 on the API**. Nav is not authorization.

---

## 5. Registry adapter module (already the right shape)

Path: `apps/web/src/lib/registries/`.

This layer answers: **what does this registry expect, and can we read it live?** It does not answer: **which screens to show.** That is the desk (section 6).

### 5.1 Two halves, never mixed

| Half | Importable from | Contract | What it may do |
| --- | --- | --- | --- |
| **Client adapter** | Browser + server | `RegistryAdapter` | Bundled rulebook + methodology → `RequirementSpec` |
| **Live adapter** | Server only (`server-only`) | `RegistryLiveAdapter` | HTTP to the issuing body with org credentials |

```33:45:apps/web/src/lib/registries/types.ts
export interface RegistryAdapter {
  registry: Registry;
  rulebookVersion: string;
  submissionLabel: string;
  platform: string;
  docsUrl?: string;
  supportsLiveRequirements: boolean;
  sources: string[];
  buildSpec(project: Project): RequirementSpec;
}
```

```112:116:apps/web/src/lib/registries/types.ts
export interface RegistryLiveAdapter {
  registry: Registry;
  fetchSpec(request: LiveSpecRequest): Promise<LiveSpecResult>;
}
```

Client map (`index.ts`) registers all four. Live map (`server.ts`) currently registers **only Isometric**. Missing live adapter ⇒ board uses `buildSpec` and `LiveSpecMeta.origin = "bundled"`.

### 5.2 Folder layout (one registry = one folder)

```
apps/web/src/lib/registries/
  types.ts              contracts
  index.ts              REGISTRY_ADAPTERS (client-safe)
  server.ts             LIVE_ADAPTERS + credential resolve + owned-project
  connections.ts        tenant ↔ registry bindings (env names, not secrets)
  assemble.ts           rulebook + methodology → RequirementSpec
  rulebook.ts           RegistryRulebook type
  submit-gate.ts        quality gate before any registry write
  step3.ts              dispatch to methodology math (today: Isometric in-situ)
  isometric/            live + bundled + write + setup + map
  puro/                 bundled only
  verra/                bundled only
  gold-standard/        bundled only
```

Inside a live registry folder, keep the same split:

| File | Role |
| --- | --- |
| `index.ts` | `RegistryAdapter` (rulebook) |
| `rulebook.ts` / `methodologies.ts` | Transcribed published requirements |
| `server.ts` | `RegistryLiveAdapter` + HTTP client |
| `api.ts` | Wire types for that issuing body’s API |
| `write.ts` / `setup-write.ts` | Mutations for **this** registry only |
| `project-map.ts` | External ids → `Project` |

A Puro live adapter must not import `isometric/write.ts`. Shared types live in `lib/types.ts` (`RequirementSpec`, `Project`). Shared quality gate lives in `submit-gate.ts`.

### 5.3 Connection (tenant × registry)

```17:33:apps/web/src/lib/registries/connections.ts
export const REGISTRY_CONNECTIONS: RegistryConnection[] = [
  {
    id: "conn-4401-isometric-sandbox",
    tenantId: "fourfourone",
    registry: "Isometric",
    environment: "sandbox",
    projectIds: [] as string[],
    externalProjectId: null,
    transport: "machine-to-machine",
    credentials: {
      accessTokenEnv: "ISOMETRIC_ACCESS_TOKEN",
      clientSecretEnv: "ISOMETRIC_CLIENT_SECRET",
      projectIdEnv: "ISOMETRIC_PROJECT_ID",
    },
  },
];
```

Empty `projectIds` means the org token may list every project it can see. `ISOMETRIC_PROJECT_ID` is a **preferred pin**, not a hard ACL.

**Target:** this array becomes Aurora `registry_connections` + a Secrets Manager ARN per `(tenant, registry)`. Env-var names on a singleton secret are a single-tenant scaffold.

Deployed secrets today (per **stage**, not per tenant):

| Secret | Keys | Injected into |
| --- | --- | --- |
| `minrv/ew2/{stage}/isometric` | `ISOMETRIC_CLIENT_SECRET`, `ISOMETRIC_ACCESS_TOKEN`, `ISOMETRIC_PROJECT_ID` | ECS **web** task only |
| Local | same names in `apps/web/.env.local` | `next dev` |

Host for sandbox is `https://api.sandbox.isometric.com`. The live client currently keys off `connection.environment`, not `ISOMETRIC_API_HOST` (that env is informational on the task).

### 5.4 What each registry adapter does today

| Registry | Client adapter | Live adapter | Writes |
| --- | --- | --- | --- |
| Isometric | Yes — monitoring list from rulebook + methodology | Yes — Certify MRV + Registry HTTP | Setup, sources, datapoints, GHG, statements |
| Puro.earth | Yes — bundled Puro rulebook | No | No |
| Verra VCS | Yes — bundled | No | No |
| Gold Standard | Yes — bundled | No | No |

`Registry` union (`lib/types.ts`): `"Verra VCS" \| "Gold Standard" \| "Puro.earth" \| "Isometric"`.

---

## 6. Registry desk module (the missing piece)

Adapters share a **requirement board**. Desks do not share a **flow**.

Puro’s own spec is explicit: you are not submitting the same object under a different logo. Isometric is digital-native GHG accounting inside Certify. Puro is an audit-package process (facility audit, output report, CORC issuance) with a different object model and cadence. Restyling Isometric screens as “Puro” would be a product defect.

### 6.1 Shared chrome vs desk

| Shared (control room shell) | Per-registry desk |
| --- | --- |
| Globe (`DmrvScene`) | Charter / facility header |
| Top bar, tenant label, search | Setup / PDD **or** facility registration |
| Portfolio rail (projects of **this** registry) | Reporting period model |
| Requirement board **frame** (`PeriodDesk` layout, 3D slots) | Slot actions, GHG vs output-report, submit button |
| Registry filter (which desk’s projects to show) | Live API routes for that registry |

### 6.2 Target contract

Do not put `if (project.registry === "Isometric")` in `dashboard.tsx`. Register a desk:

```
apps/web/src/lib/registries/<name>/desk.ts     // capabilities
apps/web/src/components/desks/<name>/          // UI
```

Suggested capability flags (desk declares them; shell only mounts what is true):

| Capability | Isometric | Puro (planned) | Bundled Verra/GS |
| --- | --- | --- | --- |
| `liveProjects` | Certify `GET /projects` | Facilities via dMRV Connect | Catalog only |
| `charter` | Project design / PDD | Facility registration pack | No |
| `setupWorkspace` | Sites, feedstocks, measurements | Methodology model + evidence templates | No |
| `reportingPeriods` | GHG statement windows | Output-report monitoring period | Synthetic from catalog |
| `accounting` | LCA / GHG entries | Calculated results from Puro models | No |
| `submit` | Certify sources → statement last | Audit package / output report | No |
| `step3` | In-situ mineralisation math in Next | Not this adapter | No |

Shell algorithm:

1. Resolve `project` (must include `tenantId` + `registry`).
2. `desk = getDesk(project.registry)`.
3. If the session has no grant for that registry → empty rail / 403, not a fallback Isometric panel.
4. Render `desk.Header`, `desk.Board`, `desk.Workspace`.

### 6.3 What the control room does today (honest)

`components/dashboard.tsx` always:

- loads **Isometric** live projects (`useIsometricProjects`);
- mounts `ProjectCharter` for every selected project;
- mounts `PeriodDesk` (periods / GHG / submit chrome);
- mounts `ProjectSetupWorkspace` (Isometric PDD tabs).

Hard branches elsewhere:

| Location | Behaviour |
| --- | --- |
| `registry-select.tsx` | Options hardcoded `Isometric \| Puro.earth` |
| `top-bar.tsx` `CharterBadge` | `if (project.registry !== "Isometric") return null` |
| `use-project-definition.ts` | Fetch only for Isometric |
| `/api/registry/setup`, `periods`, `accounting`, `submit` | Isometric connection required; others 409 / empty |
| `dashboard-store` | `registryFilter` defaults to `"Isometric"`; `setupTab` typed as Isometric `SetupTabId` |

So: **filter** is multi-registry; **desk** is not. A Puro project still sits in an Isometric-shaped layout with an empty charter.

### 6.4 BFF routes should follow the desk, not the other way around

| Route | Today | Target |
| --- | --- | --- |
| `GET /api/registry/projects` | Isometric list + bundled catalog | Dispatcher: `desk.listProjects(connection)` |
| `GET /api/registry/requirements` | Live Isometric or bundled `buildSpec` | Same dispatcher; bundled remains the fallback |
| `GET/POST /api/registry/setup` | Isometric PDD | `/api/registry/{isometric\|puro}/setup` **or** one route that 404s if the desk has no setup |
| `GET/POST /api/registry/periods` | Certify GHG windows | Desk-specific period type |
| `GET/POST /api/registry/accounting` | Certify GHG | Desk-specific |
| `POST /api/registry/submit` | Certify write | Do **not** reuse this body for Puro. New route or `registry` discriminator that cannot call the wrong writer. |

Prefer **explicit paths** over a mega-handler with a hidden switch. Wrong-desk submit must be impossible by construction.

---

## 7. Projects

`Project` (`lib/types.ts`) is the join row:

| Field | Meaning |
| --- | --- |
| `id` | Catalog slug (`fujairah-mineral`) or live external id (`prj_…`) |
| `tenantId` | Owning org. Required. |
| `registry` | Owning issuing body. Required. **One value.** |
| `methodologyKey` | Key into that registry’s methodology modules |
| `externalProjectId` | Certify `prj_…` when known |
| `origin` | `"catalog"` \| `"isometric"` (extend with `"puro"` when live list exists) |

Rules:

- A project is listed only if `project.tenantId === session.tenantId`.
- A project is shown on a desk only if `project.registry === desk.registry`.
- `resolveOwnedProject(tenantId, projectId)` is the server gate: catalog row must match tenant, or the id must be a Certify id the tenant’s **Isometric** connection may read. Extend this per live registry; do not let an Isometric token authorise a Puro facility id.

Catalog: `apps/web/src/lib/projects.ts`. Live Isometric rows: `isometric/project-map.ts` (Fujairah catalog row may alias onto one `prj_…`).

`origin: "catalog"` vs `"registry-api"` on list/spec responses is **where the requirement set came from**, not which tenant.

---

## 8. Tenancy module

| Piece | Path | Today | Target |
| --- | --- | --- | --- |
| Catalog | `lib/tenants.ts` | Four hardcoded orgs | `fourfourone` + real customers in Aurora |
| Session | `lib/auth/session.ts` | Cookie holds `tenantId` from Cognito `custom:tenant_id` | **BFF uses this**, never the client header |
| Client store | `store/dashboard-store.ts` | `tenantId` default `fourfourone`; `setTenant` unused | Hydrate from `GET /api/auth/me` |
| API gate | every `/api/**` | `x-tenant-id` ∈ `TENANTS` | `getSession().tenantId` + `authorize()` |
| Quality header | `lib/sentinel/browser.ts` | Always `fourfourone` | Session tenant |
| Sentinel pin | `SENTINEL_TENANT_ID` | One org per stage | Per-tenant mapping / tags |

Demo tenants `verdant`, `helios`, `terrafix` exist so the globe looks multi-tenant. They have **no** `REGISTRY_CONNECTIONS` and **no** Cognito isolation. Do not treat them as a security boundary.

---

## 9. Quality module (sidecar)

| Concern | Owner |
| --- | --- |
| Bind catalog project → Sentinel UUID | Next `lib/sentinel/*` |
| Run DQA / anomaly / V&V | Sentinel FastAPI + Celery |
| Overlay chips on the board | `lib/sentinel/overlay.ts` |
| Block Certify submit on failed DQA | `lib/registries/submit-gate.ts` |
| Step-3 (MASIP, bubble-point, cadences) | Next `lib/registries/step3.ts` — **not** Sentinel |

Sentinel’s Python `engines/registry/*` (including a Puro stub) is leftover V&V modelling. It is **not** the product adapter. Do not dual-write registry logic there.

---

## 10. Dependency direction

Allowed:

```
UI desk  →  adapter (client)  →  types
UI desk  →  BFF route  →  adapter (live)  →  issuing-body HTTP
BFF      →  session / authorize
BFF      →  Sentinel proxy (M2M)
infra    →  secrets, images, Cognito
```

Forbidden:

```
Sentinel  →  Next types / Cognito session
Client component  →  isometric/server.ts or secrets
Isometric write.ts  →  Puro client (or the reverse)
dashboard.tsx  →  Certify wire types (desk folder only)
Cognito groups  →  registry names
```

---

## 11. Maturity

| Capability | Now | Next modular step |
| --- | --- | --- |
| Bundled board for 4 registries | Done | Keep |
| Live project list | Isometric, one tenant | `desk.listProjects`; per-tenant secret |
| Live requirements | Isometric | `RegistryLiveAdapter` per live registry |
| Desk UI | Isometric bolted to shell | `getDesk(registry)` |
| Session login | Done (Cognito / landing) | Drive tenant from cookie |
| Grants | Not built | `authorize.ts` + Aurora |
| Puro live + desk | Spec only | New folder `registries/puro/server.ts` + `components/desks/puro` |
| Per-tenant secrets | No — `minrv/ew2/{stage}/isometric` | `minrv/ew2/{stage}/tenants/{tenantId}/{registry}` |

---

## 12. How to add a registry

Do this in order. Skip a step and the shell will silently show the wrong desk.

1. **Process first.** Write or update a spec (see Puro doc). If the submission artefact is not a Certify GHG statement, it is a new desk.
2. **Union.** Add the name to `Registry` in `lib/types.ts` and to `REGISTRIES` if the catalog needs it.
3. **Client adapter.** `registries/<id>/rulebook.ts`, `methodologies.ts`, `index.ts` implementing `RegistryAdapter`. Register in `REGISTRY_ADAPTERS`.
4. **Connection.** One `RegistryConnection` per tenant that is allowed to use it (later: DB row + secret ARN). Credential **names** only.
5. **Live adapter (optional).** `registries/<id>/server.ts` → `LIVE_ADAPTERS`. List/map external objects to `Project` with `registry` set correctly.
6. **Desk UI.** `components/desks/<id>/` + capability flags. Register in `getDesk`. Do not extend `ProjectSetupWorkspace` with a Puro tab.
7. **BFF.** Routes named for that desk’s verbs. `submit` is a new handler. Reuse `submit-gate.ts` for quality, not Isometric write helpers.
8. **Grants.** Desk modules require `{ registry: "<id>" }`. Connecting the registry is `admin.tenant`; using it is a user grant.
9. **Filter.** Registry select options come from **granted connections**, not a hardcoded two-item list.
10. **Infra.** New secret path; inject only into the web task; never into Sentinel.

---

## 13. How to add a tenant

1. Cognito user with `custom:tenant_id` = new id (identity plan).
2. Catalog or Aurora tenant row (replace `TENANTS` array).
3. `registry_connections` for each issuing body they use — **separate secrets**. Do not reuse `fourfourone`’s Isometric token.
4. Projects: catalog rows and/or live list under that `tenantId`.
5. Grants per user: registries, projects, modules.
6. Sentinel: bind quality projects with tenant tags; stop using a single `SENTINEL_TENANT_ID` pin as the only wall.

Until step 3 exists, a second tenant can log in and still only see whatever the client puts in `x-tenant-id`. That is not multi-tenant.

---

## 14. File map

### Tenancy and session

| Path | Role |
| --- | --- |
| `apps/web/src/lib/tenants.ts` | Static tenant catalog |
| `apps/web/src/lib/auth/session.ts` | Sealed `minrv_session` |
| `apps/web/src/middleware.ts` | Cookie required; no ACL yet |
| `apps/web/src/app/api/auth/me/route.ts` | Public session JSON |
| `infra/lib/identity-stack.ts` | Cognito pool, `custom:tenant_id`, role groups |

### Registry kernel

| Path | Role |
| --- | --- |
| `apps/web/src/lib/types.ts` | `Registry`, `Tenant`, `Project`, `RequirementSpec` |
| `apps/web/src/lib/registries/types.ts` | Adapter / connection / live contracts |
| `apps/web/src/lib/registries/index.ts` | Client adapters |
| `apps/web/src/lib/registries/server.ts` | Live adapters, credentials, ownership |
| `apps/web/src/lib/registries/connections.ts` | Tenant–registry wiring |

### Isometric (reference live module)

| Path | Role |
| --- | --- |
| `apps/web/src/lib/registries/isometric/index.ts` | Bundled adapter |
| `apps/web/src/lib/registries/isometric/server.ts` | Certify + Registry HTTP |
| `apps/web/src/lib/registries/isometric/write.ts` | Submit path |
| `apps/web/src/lib/registries/isometric/setup*.ts` | PDD desk data |
| `apps/web/src/lib/registries/isometric/project-map.ts` | `prj_…` → `Project` |

### Control room UI (to split into desks)

| Path | Role |
| --- | --- |
| `apps/web/src/components/dashboard.tsx` | Shell — should dispatch desks |
| `apps/web/src/components/dashboard/registry-select.tsx` | Filter |
| `apps/web/src/hooks/use-visible-projects.ts` | Tenant + registry filter + live merge |
| `apps/web/src/components/dashboard/project-charter.tsx` | Isometric charter |
| `apps/web/src/components/dashboard/project-setup/` | Isometric setup |
| `apps/web/src/components/dashboard/period-desk.tsx` | Board + period chrome |

### Quality

| Path | Role |
| --- | --- |
| `apps/web/src/app/quality/` | Console routes |
| `apps/web/src/lib/sentinel/` | BFF client, allowlist, overlay |
| `apps/sentinel/backend/` | Engines and workers |

---

## 15. Anti-patterns

| Do not | Why |
| --- | --- |
| `if (registry === "Isometric")` in the shell for every new feature | Belongs in the desk. The shell will become unreviewable. |
| One `POST /api/registry/submit` body for every issuing body | Certify write ≠ Puro output report. Wrong object, wrong privilege. |
| Share Isometric tokens across tenants | Org-scoped JWT. That is another supplier’s data. |
| Put registry names in Cognito groups | Connections come and go; users have mixed desks. |
| Trust `x-tenant-id` after login exists | Spoofable. Session is the tenant. |
| Import `isometric/server.ts` from a client component | Secrets and tokens leak into the bundle. |
| Implement Puro as a restyle of charter / GHG | Different legal process; see Puro spec Part 1 and Part 3. |
| Teach Sentinel the Certify API | Duplicate engine, second identity, fights AGENTS.md. |
| Empty `registries` grant meaning “all” | Empty means **none**. |
| Keep demo tenants in a production ACL | `verdant` / `helios` / `terrafix` are globe fixtures. |

---

## 16. One-page picture

```
                    ┌─ isometric desk ─ Certify API
Control room chrome ┼─ puro desk      ─ dMRV Connect   (not built)
                    └─ bundled desk   ─ rulebook only  (Verra / GS)

Quality Console ────────────────────── Sentinel (M2M)

Session cookie ── tenantId ── grants ── which desks + which projects
Secrets Manager ── per tenant × registry ── web task only
```

**Bottom line:** the **adapter kernel** is already the right module. Multi-registry **product** work is to extract **desks** (UI + routes + writers) and to finish **tenancy** (session + connections + grants). Until those two exist, the repo is a well-factored Isometric control room with a multi-registry catalog around it — not yet a multi-tenant, multi-registry platform.
