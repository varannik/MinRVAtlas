# 3DMinRV — Cognito identity, tenant isolation, and access control

Status: **implementation plan** (no code in this document). Use this to sequence work. Related: [ui-sentinel-integration.md](./ui-sentinel-integration.md), [aws-eu-west-2-system-design.md](./aws-eu-west-2-system-design.md), [data-sentinel-isometric-integration.md](./data-sentinel-isometric-integration.md).

| | Decision |
| --- | --- |
| Identity provider | **Amazon Cognito user pool** (eu-west-2) |
| Session owner | **Next.js BFF** (`apps/web`) — HttpOnly cookie |
| Tenant id | **Verified claim** on the session, never a client header |
| Registry | **Not Cognito.** A tenant has **many** registries. Registry is product routing + ACL after login |
| Authorization | **Cognito groups = roles**. Fine-grained module, **registry**, and project access lives in **app tables** |
| Data Sentinel | Stays a **sidecar**. Operators do **not** log into FastAPI. M2M token stays server-side |

The current in-house cut is one live operator org (`fourfourone`). This plan keeps that as tenant zero and makes the platform a real multi-tenant **and multi-registry** SaaS without turning Sentinel into a second identity system. One login, one tenant, several registry desks.

**Nothing in this identity design exists in AWS yet.** CDK in `infra/` is source, not a live landing zone. There is no `eu-west-2` user pool, no hosted UI domain, no `session-key` secret, no public ALB/WAF, no Aurora for `identity` tables. First `make deploy` **creates** those resources in account `625239230739` / `eu-west-2`. Do not import, click-ops, or assume an existing Cognito pool. Same emulation rule as [aws-eu-west-2-system-design.md](./aws-eu-west-2-system-design.md): **real AWS only. No LocalStack, no Cognito emulator, no `AWS_ENDPOINT_URL`, no Compose-as-AWS.**

---

## 1. What you are solving

Four problems, not one:

1. **Who is signed in?** There is no operator login on 3DMinRV today.
2. **Which organisation (tenant) do they belong to?** Tenant is a client-side default plus a spoofable `x-tenant-id` header.
3. **Which registries and projects may they work?** One tenant already holds projects on different registries, each with a different control-room flow. Access is not “the platform” — it is a desk on a registry.
4. **What may they open and mutate on that desk?** There is no per-user access to Control Room vs Quality Console vs registry submit. Quality Console runs as a Sentinel **admin** machine user.

Cognito answers (1). A tenant claim plus server-side membership answers (2). Registry + project grants answer (3). An application permission model answers (4). Cognito alone cannot express “this analyst may run DQA on Fujairah (Isometric) but cannot see the Puro desk or submit to Certify.”

---

## 2. How it works today

### 2.1 3DMinRV has no user session

| Check | Result |
| --- | --- |
| Login / logout / `/auth/*` routes | None |
| Next `middleware.ts` | None |
| Session / auth cookies | None |
| Cognito / Amplify / next-auth | Not in `apps/web/package.json` |
| Root layout gate | Renders children with no user |

Anyone who can reach the public ALB (or `localhost:3000`) gets the globe, Quality Console, and every BFF route.

Tenant is a **Zustand field**, default `fourfourone`:

```50:50:apps/web/src/store/dashboard-store.ts
  tenantId: DEFAULT_TENANT_ID,
```

`setTenant()` exists but **is never called**. The top bar shows the tenant name; it does not switch tenants. Demo orgs in `apps/web/src/lib/tenants.ts` (`verdant`, `helios`, `terrafix`, `fourfourone`) are a static catalog for the globe, not authenticated workspaces.

### 2.2 The header that pretends to be a tenant

Every mutating BFF reads:

```
x-tenant-id: <id>
```

and checks the id against the hardcoded `TENANTS` array. That is the entire “authn”:

| Route | Tenant gate | Extra gate |
| --- | --- | --- |
| `/api/registry/*` (projects, requirements, definition, setup, periods, accounting, submit) | Header ∈ `TENANTS` | Project must be owned by that tenant; Isometric connection for live registry |
| `/api/projects/locations` | Header ∈ `TENANTS` | Overlay keys filtered to owned projects |
| `/api/quality/projects` | Header ∈ `TENANTS` | Bind to Sentinel only if tenant = `SENTINEL_TENANT_ID` |
| `/api/sentinel/pipeline` | Header ∈ `TENANTS` | Same Sentinel tenant pin |
| `/api/sentinel/[...path]` | Header ∈ `TENANTS` | Same pin + path allowlist |

Quality Console **ignores** the dashboard store and always sends `fourfourone`:

```30:30:apps/web/src/lib/sentinel/browser.ts
  headers.set("x-tenant-id", DEFAULT_TENANT_ID);
```

**Risk:** the browser chooses the tenant. A client can send `x-tenant-id: verdant` or `fourfourone` and the server will honour it. There is no user to bind the choice to.

### 2.3 What “session” means in this repo today

Two different things, neither of them identity.

**A. Operator UI scratch (browser `sessionStorage` + Zustand)**

| Store | Key | What it holds |
| --- | --- | --- |
| `pipeline-store` | `minrv-pipeline-results` | Quality-run results for board chips |
| `quality-store` | `minrv-quality-catalog-project-id` | Last Quality Console project |
| `period-store` | (session) | Reporting-period drafts |
| `registry-submit-store` | (session) | Certify source / submission ids |
| `ghg-quality-review-store` | memory only | Fullscreen GHG review overlay |
| `dashboard-store` | memory only | Selected project, tenant, filters |

This is **tab working state**. It is not a login. It is not tenant-safe on a shared browser. After real auth, key these by `userId:tenantId` or drop them on logout.

**B. Data Sentinel user JWT (FastAPI only)**

Sentinel already has a full IdP leftover from the removed Vite UI:

| Piece | Behaviour |
| --- | --- |
| Cookie | `ds_session` HttpOnly, SameSite=Lax, Secure in production |
| Token | HS256 JWT, `sub` = email, `role`, `jti`, `iat`, 480 minutes |
| Login | `POST /api/v1/auth/token` (password) + TOTP MFA |
| SSO | Microsoft Entra: `GET /api/v1/microsoft/login` → `{FRONTEND_URL}/auth/callback` |
| Logout | Clear cookie + `jti` denylist |
| Users | Postgres `users`: role, `platform_access` JSONB (`dqa` / `anomaly` / `vv` / `reviewer`) |
| Project ACL | `project_members` (owner / analyst / viewer) |

**Operators never use this.** The Next allowlist **denies** `v1/auth`. The BFF injects `SENTINEL_SERVICE_TOKEN`, and FastAPI treats that token as admin user `m2m@3dminrv.internal`. Quality Console therefore runs with **full admin** on Sentinel, including listing every project in that database.

Entra on Sentinel is wired in CDK (`EntraSecret` → `MICROSOFT_*`) and points `FRONTEND_URL` at the Next origin. Next has **no** `/auth/callback` page. That SSO path is dead for 3DMinRV.

ECS also sets Sentinel `TENANT_ID=fourfourone`. Python does **not** read a SaaS `TENANT_ID` setting. `User` and `Project` have **no** `tenant_id` column. Isolation in Sentinel is “Next only proxies when the header matches `SENTINEL_TENANT_ID`,” plus catalog→UUID mapping tagged `config.tags.catalog_id`.

### 2.4 Tenant isolation that *does* exist (data, not identity)

| Layer | How |
| --- | --- |
| Catalog projects | Each `Project.tenantId` in `apps/web/src/lib/projects.ts` |
| Globe / rail | `use-visible-projects` filters by Zustand `tenantId` |
| Registry connections | `REGISTRY_CONNECTIONS` — only `fourfourone` has Isometric M2M |
| Owned project resolve | `resolveOwnedProject(tenantId, projectId)` on registry + pipeline routes |
| Locations overlay | GET/PUT filtered to projects that tenant owns; storage is **one** SSM parameter / local file for the whole stage |

Isometric and Sentinel secrets are **one set per environment**, not per tenant. That matches “one live tenant” and will break as soon as a second operator org is onboarded. They are also **one set per environment, not per registry** — only Isometric is wired.

### 2.5 Multi-registry is already a product fact (not a future idea)

The platform is **one tenant → many registries → many projects**. Registry is not the same as tenant and is not Cognito.

| Registry | In the catalog today | Live M2M | Control-room flow |
| --- | --- | --- | --- |
| **Isometric** | Yes (`fourfourone` Fujairah + live Certify list) | Yes — only `REGISTRY_CONNECTIONS` row | Charter / PDD setup, live requirements, GHG statement, period desk, Certify submit, Step-3 in-situ math |
| **Puro.earth** | Bundled adapter + globe filter | No (`supportsLiveRequirements: false`) | Board from bundled rulebook. Future desk is **not** a Certify clone — facilities, output reports, dMRV Connect ([puro-dmrv-integration-spec.md](./puro-dmrv-integration-spec.md)) |
| **Verra VCS** | Bundled adapter, demo catalog tenants | No | Board from bundled VCS rulebook |
| **Gold Standard** | Bundled adapter, demo catalog tenants | No | Board from bundled GS rulebook |

How the UI already branches:

- Top-bar **registry select** is `Isometric` \| `Puro.earth` (`registry-select.tsx`). Zustand `registryFilter` defaults to Isometric. The globe/rail then shows only that registry’s projects for the current tenant (`use-visible-projects`).
- **Charter badge / project setup** render only when `project.registry === "Isometric"`.
- **Definition, setup, periods, accounting, submit** APIs return bundled-empty or `409` unless the project is Isometric **and** the tenant has an Isometric connection.
- Requirement board always works: `getAdapter(project.registry).buildSpec()` — four adapters, live fetch only on Isometric.
- Quality Console is mostly **registry-agnostic** (Sentinel). Step-3 and Certify write are **not**. Pipeline V&V currently stamps `registry_slug: puro_earth_ccs` even on Isometric jobs — that is an engine default, not tenant ACL.

So: a user who can “use the control room” is underspecified. They might be allowed Isometric Certify write, Puro board-only, or neither. Identity work must carry **registry** as a grant dimension. It must **not** put `Isometric` / `Puro.earth` into Cognito groups or custom attributes — those change as the tenant connects registries, and one user can hold mixed access.

Puro vs Isometric are not a theme toggle. The Puro spec forbids treating them as interchangeable submit targets (cadence, object model, double-registration). Auth should make the wrong desk **invisible / 403**, not merely restyled.

### 2.6 Platform surfaces (what users will need access to)

```
Browser
  ├─ Control room `/`  (shared chrome: globe, rail, registry filter)
  │    then a **registry desk** chosen by project.registry:
  │      Isometric → charter, live spec, GHG, period close, Certify submit
  │      Puro      → bundled board today; later facility / output-report desk
  │      Verra/GS  → bundled board only
  └─ Quality Console `/quality/*`  (shared; not a registry product)
       Configure / Operate / Compliance
```

There is no admin UI, no user management, no tenant switcher, no reviewer product in this tree (Sentinel `/v2/reviewer` is allowlist-denied).

---

## 3. Risks if you only “add Cognito”

1. **Leaving `x-tenant-id` as the tenant source** — login without binding tenant is theatre. Spoofing still works.
2. **Logging operators into Sentinel** — second cookie, second user table, browser closer to FastAPI, fights the BFF trust boundary.
3. **Putting tokens in `localStorage` / Zustand** — XSS can steal them. The existing `sessionStorage` stores are already the wrong pattern for secrets (they are fine for UI scratch only).
4. **Cognito groups as tenants** — AWS documents this as a possible pool-model trick. Do not. Groups are for **roles**. Tenant is a **custom attribute** (SaaS Factory pattern). Group limits (10k/pool, 100/user) and “user in two orgs” become painful.
5. **Keeping M2M-as-admin forever** — once you have a `viewer` in tenant A, the BFF still calls Sentinel as admin and can read tenant B’s quality data unless Next *and* Sentinel filter by tenant.
6. **Identity Pools (Cognito federated identities)** — not required for v1. Uploads already go through Next. Do not add IAM-for-the-browser unless you later do direct-to-S3 uploads.
7. **One “registry.submit” / “project_setup” permission for every registry** — Certify write, Puro output-report submit, and a bundled Verra board are different privileges and different UIs. A user granted Isometric submit must not call a future Puro submit route.
8. **Cognito groups per registry** — same trap as groups-as-tenants. Registry membership belongs on `registry_connections` + `grants`, not in the user pool.

---

## 4. Target architecture

```
Operator browser
    │  no Cognito tokens in JS storage
    │  cookie: minrv_session (HttpOnly, Secure, SameSite=Lax)
    ▼
Next.js  :3000   ← only public surface
    │  middleware: must have session (except /login, /auth/callback, health)
    │  every /api/* : getSession() → tenantId + userId + permissions
    │  tenantId comes from the verified cookie / JWT, header is ignored
    │  registry + project come from the resource (never from a client “active registry” header)
    │
    ├─ Cognito hosted UI  (authorization code + PKCE)
    ├─ App DB (Aurora): tenants, memberships, grants, audit
    ├─ Secrets Manager: per-tenant registry credentials (later)
    └─ Internal ALB → Sentinel :8000
           Authorization: Bearer SENTINEL_SERVICE_TOKEN
           plus actor/tenant tags for audit and row filters
```

Hard rules (same as today’s trust boundary, plus identity):

1. Internet → public ALB → **Next only**.
2. Browser never holds `SENTINEL_SERVICE_TOKEN`, Isometric secrets, or Cognito **client secret**.
3. Browser never talks to FastAPI.
4. **Do not** proxy `/api/v1/auth` or Sentinel SSO.
5. Tenant on a request = session tenant. Client `x-tenant-id` is not trusted. During a transition you may still *echo* it for old clients, but the server must reject mismatch with the session.
6. Registry on a request = **the project’s registry** (or the connection being used). Do not trust a client `x-registry` / Zustand filter for authorization. The globe filter is UX only.
7. Sentinel remains quality engine + its own Postgres. It is not the operator IdP. It is not a registry.

---

## 5. Cognito model (recommended)

AWS Cognito SaaS patterns: **silo** (user pool per tenant), **pool** (one shared pool), **bridge** (shared pool + some per-tenant clients / IdPs).

**v1: one user pool in eu-west-2, pool model, custom tenant attribute, groups for roles.**

| Why this, not pool-per-tenant | |
| --- | --- |
| One domain, one ALB, one Next task | Routing users to N pools needs a tenant-hint screen and N app clients |
| Same password / MFA policy is acceptable | Carbon-operator SaaS, not white-label banks |
| Users belong to **one** operator org in v1 | No “same email, two tenants, two roles” yet |
| CDK already one stack family | One pool is operable; N pools need provisioning automation first |

**When to add a pool or app client per tenant later (bridge):**

- Tenant brings their own Entra/SAML with a distinct MFA or branding requirement
- You need a second hosted-UI domain
- A tenant must be able to reuse an email that already exists in another org

### 5.1 User pool settings

| Setting | v1 value |
| --- | --- |
| Region | `eu-west-2` |
| Feature plan | **Essentials** (hosted UI, MFA, access-token customization) |
| Sign-in | Email (username = email, case-insensitive) |
| MFA | Optional at pool, **required** for `tenant_admin` and `platform_admin` via app policy (Cognito TOTP) |
| Custom attributes | `custom:tenant_id` (immutable after create), optional `custom:tenant_name` |
| Standard attributes | email (required, verified), name |
| Groups | `platform_admin`, `tenant_admin`, `operator`, `quality_engineer`, `viewer` |
| App client | Confidential server client for Next (authorization code). **No** client secret in `NEXT_PUBLIC_*` |
| Callback URLs | `https://<domain>/auth/callback`, `http://localhost:3000/auth/callback` |
| Logout URLs | `https://<domain>/login`, `http://localhost:3000/login` |
| Refresh token | 1–7 days sandbox / 1 day prod (start strict; you can lengthen) |
| Access / ID token | 15–60 minutes |
| Hosted UI | Cognito managed login (do not build a password form that talks to `InitiateAuth` from the browser in v1) |
| Lambda | Pre-token generation **V2_0**: copy `custom:tenant_id` onto the **access** token; add `role` from primary group |
| Advanced | Compromised-credentials / adaptive auth on Plus later, not a v1 blocker |

Do **not** use one Cognito group per tenant. Tenant = `custom:tenant_id`. Role = group.

### 5.2 Registry is not a Cognito resource

Do not add `custom:registry` or groups `isometric` / `puro`. A tenant connects and disconnects registries over time. One user can be Isometric operator and Puro viewer. Hosted UI, MFA, and `sub` stay registry-agnostic.

After login, `GET /api/auth/me` returns `tenantId`, `role`, **`registries: [...]`**, `projects`, `modules`. The client uses that to:

- populate the registry select (hide registries the user cannot see)
- skip Isometric-only chrome (charter, GHG) when the grant does not include `isometric`
- keep Quality Console available if they have quality modules, even with no registry write

Cognito Identity Pools stay out of scope (same as §3). Registry APIs are called by Next with **tenant-owned** secrets, not with the user’s Cognito token.

### 5.3 “Cognito for tenant” — what that actually means

Cognito has no Tenant resource. You represent a tenant as:

1. **Claim** — `custom:tenant_id` on every user (identity).
2. **Row** — `tenants` table (billing name, plan, Sentinel provisioned, status).
3. **Secrets path** — `minrv/ew2/{stage}/tenants/{tenantId}/{registry}` (Isometric, later Puro partner token, never one blob for all registries).
4. **Optional later** — dedicated app client or user pool if that tenant federates Entra.

44.01 staff who must see more than one tenant are `platform_admin`. v1: they still pick **one** tenant per session (impersonation / tenant-switcher stored in the encrypted cookie after a server-side check). Do not put `tenantId=*` in a JWT.

### 5.4 Federation (Entra)

Move Entra **from Sentinel to Cognito** when a tenant needs Microsoft SSO:

- User pool → Identity providers → Entra (OIDC) or SAML
- Prefer a **per-tenant app client** so IdP list is not global
- Pre-signup / pre-token Lambda: reject if Entra tenant / email domain is not mapped to `custom:tenant_id`
- Do not auto-grant Quality Console or **any** registry submit on first SSO (mirror today’s Sentinel behaviour: new SSO users start with no platform buckets). Registry desks stay off until `tenant_admin` grants them.

Until then, Cognito native users + invite is enough.

---

## 6. Session design (Next.js)

### 6.1 Flow

```
1. GET /login                  → 302 Cognito hosted UI (PKCE: code_verifier in short HttpOnly cookie)
2. User authenticates          → Cognito redirects to /auth/callback?code&state
3. GET /auth/callback          → verify state, exchange code (server), fetch userinfo
4. Load membership + grants    → Aurora
5. Set minrv_session           → encrypted envelope, HttpOnly
6. 302 / or /quality           → first allowed surface
7. middleware on every request → decrypt cookie, if access token near expiry, refresh
8. POST /auth/logout           → revoke refresh (Cognito RevokeToken), clear cookies
```

Use **authorization code + PKCE**. Do not use implicit flow. Do not put access tokens in the document.

### 6.2 Cookie

| | |
| --- | --- |
| Name | `minrv_session` |
| Contents (encrypted) | `sub`, `email`, `tenantId`, `role`, `accessToken`, `refreshToken`, `accessExp`, `sessionId` |
| Flags | `HttpOnly`, `Secure` (prod), `SameSite=Lax`, `Path=/` |
| Encryption | AES-GCM with a key from Secrets Manager (`minrv/ew2/{stage}/session-key`), not Cognito’s JWT secret |
| CSRF | Lax is enough for top-level navigations. For cookie-authenticated `POST`/`PUT`/`PATCH` from `fetch`, require `Origin` / `Sec-Fetch-Site` same-origin (or a CSRF token). Do not use `SameSite=None` |

Optional split: `minrv_at` (short access) + `minrv_rt` (refresh, `__Host-` prefix, path `/auth/refresh` only). Slightly better theft surface; more moving parts. Encrypted envelope is enough for v1.

Verify JWTs with `aws-jwt-verify` (issuer, audience, JWKS). Do not parse tokens without signature check.

### 6.3 Middleware vs route handlers

- **Edge / `middleware.ts`:** is there a cookie? is it decryptable? is `exp` ok? redirect to `/login` for pages; `401` for `/api/*`. Keep this **coarse**. Edge should not hit Aurora on every request.
- **Route handlers / server components:** `getSession()` then **authorize** (module + registry + project). This is the real ACL. The registry select in the top bar is not an authorization signal.

Next 16 App Router: `params` is a `Promise`; route handlers stay under `apps/web/src/app/api/.../route.ts` with `export const dynamic = "force-dynamic"`. Read `apps/web/node_modules/next/dist/docs/` before adding `middleware.ts` (Next has been iterating the middleware / proxy filename).

### 6.4 Replace `x-tenant-id`

```
Today:   browser → x-tenant-id: fourfourone → BFF trusts list membership
Target:  browser → Cookie: minrv_session    → BFF reads session.tenantId
```

Migration:

1. Add session; still *accept* header if it matches session tenant (so existing `fetch` helpers keep working).
2. Change `sentinelRequest` / registry hooks to **stop sending** the header.
3. Reject requests whose header disagrees with the session.
4. Delete the header from the public contract.

`resolveRequestTenant(request)` becomes `session.tenantId`. Unknown / missing session → 401, not 403 “Unknown tenant”.

### 6.5 Client state after login

- `useDashboard().tenantId` is initialized from `GET /api/auth/me`, not `DEFAULT_TENANT_ID`.
- Quality client uses the same tenant (no hardcoded `fourfourone`).
- On logout: `sessionStorage.clear()` for `minrv-*` keys, Zustand reset.
- Prefix remaining keys with `minrv:{tenantId}:{sub}:…` if you keep them.

---

## 7. Authorization model

Four layers. All four are required.

| Layer | Source | Question |
| --- | --- | --- |
| 1. Authentication | Cognito | Is this a signed-in user? |
| 2. Tenant membership | `custom:tenant_id` + `tenant_members` | Are they in this org? Active? |
| 3. Registry access | `registry_connections` + `grants.registry` | Which registry desks may they open? |
| 4. Authorization | Role + `grants` | Which modules / projects / actions on that desk? |

A grant is evaluated as **tenant ∩ registry ∩ project ∩ module**. Missing any axis is deny. Do not infer Puro access from an Isometric project ACL, or submit access from `control_room.read`.

### 7.1 Roles (Cognito groups + `tenant_members.role`)

Keep the list short. Map from Sentinel’s vocabulary so Quality people recognise it.

| Role | Intended human | Default modules |
| --- | --- | --- |
| `platform_admin` | 44.01 staff | All modules, tenant switcher, provision tenants |
| `tenant_admin` | Customer admin | Users + grants in own tenant, all product modules |
| `operator` | MRV / control-room | Control room on **granted registries**, project setup where that registry has a setup desk, pipeline run; **no** Quality configure; **no** registry submit unless granted |
| `quality_engineer` | DQA / V&V | Quality configure + operate + compliance; control room read on granted registries; **no** registry submit unless granted |
| `viewer` | Auditor / guest | Control room read on granted registries, Quality compliance read; no pipeline, no submit, no rule edits |

Role is a **bundle of defaults**, not the only switch. `tenant_admin` can tighten or widen a user via grants.

### 7.2 Modules (parts of the platform)

Align to routes that already exist.

Shared modules (registry-agnostic or scoped by the project they touch):

| Module id | UI | APIs / proxy prefixes |
| --- | --- | --- |
| `control_room.read` | Globe, rail, board for **granted registries** | `GET` registry projects/requirements/locations |
| `control_room.write` | Pins, intake drafts | locations PUT |
| `pipeline.run` | “Run quality check” | `POST /api/sentinel/pipeline` |
| `quality.configure` | Rule Manager, corrections, protocols, models, knowledge, V&V projects | `v1/rules`, `v1/rule-studio`, `v1/corrections/rules`, `v1/ml`, `v1/knowledge-base`, `v2/protocols`, `v2/vv` writes |
| `quality.operate` | Datasets, runs, workbench, anomaly, schedules | `v1/datasets`, `v1/runs`, `v1/violations`, `v1/corrections` (suggestions), `v1/anomaly`, `v1/schedules` |
| `quality.compliance` | Audit, reports | `v1/audit`, `v1/reports` |
| `admin.users` | (new) invite / disable / grants | `/api/admin/users` |
| `admin.tenant` | (new) tenant settings, **registry connections** | `/api/admin/tenant` |

Registry-desk modules (same name, **must** carry a registry id on the grant):

| Module id | Isometric desk (built) | Puro desk (planned) | Verra / Gold Standard |
| --- | --- | --- | --- |
| `registry.read` | Live Certify requirements, periods, accounting GET | Catalogue / facility read when wired | Bundled rulebook only |
| `project_setup` | Charter / PDD `/api/registry/setup` | Facility registration artefacts (not Certify PDD) | n/a unless you add a hub |
| `period.write` | Period close, GHG entry | Output-report period / batch desk | n/a |
| `registry.submit` | `POST /api/registry/submit` to Certify (highest risk today) | Output report / dMRV Connect submit (different route when built) | n/a |

`authorize("registry.submit", { registry: "Isometric", projectId })` is a different check from `authorize("registry.submit", { registry: "Puro.earth", projectId })`. Implement that as a required `registry` argument on those modules, not as `registry.submit.isometric` string soup.

If the tenant has no `registry_connections` row for Puro, **no user** in that tenant can receive a Puro grant. Connecting a registry is `admin.tenant`; using it is a user grant.

Sentinel `platform_access` buckets map approximately:

| Sentinel bucket | 3DMinRV module |
| --- | --- |
| `dqa` | `quality.configure` (rules) + `quality.operate` (runs/datasets) |
| `anomaly` | `quality.operate` (anomaly) + models |
| `vv` | `quality.configure` (V&V / protocols) |
| `reviewer` | **out of product** until you add a UI |

Do not implement reviewer access in 3DMinRV v1. Keep the allowlist deny.

### 7.3 Registry scope, then project scope

A user is never “on the platform”; they are on **registry desks inside a tenant**, then **projects on those desks**.

| Scope | Meaning |
| --- | --- |
| `registries` | Explicit list (`Isometric`, `Puro.earth`, …). Empty = none, not all |
| `tenant` (projects) | All current and future projects **in the granted registries** |
| `projects` | Explicit catalog / Certify / future Puro facility ids |

`viewer` on Fujairah (Isometric) must not:

- open another tenant’s globe pins
- bind Quality Console to another catalog id
- switch the top-bar filter to Puro and see Puro projects they were not granted
- call `/api/registry/submit` because they can open the Isometric board

Enforce on:

- `resolveOwnedProject` (already tenant-scoped — add **user** registry + project set; confirm `project.registry` matches the grant)
- `GET /api/registry/projects` (today this is Isometric-only live list — still require `registry.read` + `Isometric`)
- `listQualityProjects` (filter to projects whose registry the user may see)
- `proxySentinel` rewrite: UUID must belong to session tenant **and** user’s project set
- Locations overlay (today the SSM blob is global; filter on read **and** namespaced write — see §8)
- Registry-specific routes (`setup`, `accounting`, `submit`): 403 if the project’s registry is not granted, even if the tenant connection exists

Globe `registryFilter` is a client convenience. Server lists must not return other registries because the user “had the filter on Isometric.”

**Double-registration** (Puro spec: one active certification per facility/period) is a **compliance constraint**, not a Cognito feature. Identity still matters: `registry_submissions.attested_by_user_id` must be the Cognito `sub`, and a user without `registry.submit` on that registry cannot attest. Do not rely on the UI hiding the other desk.

### 7.4 Enforcement points (fail closed)

| Place | Must check |
| --- | --- |
| `middleware.ts` | Authenticated |
| `apps/web/src/lib/auth/authorize.ts` | Module + **registry** + project for this path |
| Each `app/api/**/route.ts` | Call `authorize()` — UI hide is not security |
| `proxySentinel` | Map path prefix → module; rewrite UUID → tenant+project |
| Quality `nav.ts` / Control room buttons / registry select | Hide what `GET /api/auth/me` says they lack (UX only) |
| `POST /api/registry/submit` | `registry.submit` + **Isometric** + project + existing quality gate |
| Future Puro submit | Same module name, `registry: Puro.earth`, different route |

Example: a `viewer` must get **403** from `POST /api/sentinel/pipeline` even if they forge the fetch.

### 7.5 Why not Cognito groups for every checkbox

Cognito groups have no metadata, 100 groups/user, and a token size limit. “Anomaly yes, seed-rules no, Isometric submit no, Puro board yes, Fujairah only” is **relational data**. Put it in Aurora. Optionally put a **permissions version** (`pv`) on the access token via pre-token Lambda so you can reject stale cookies after a grant change without waiting for expiry (compare `pv` to Redis/`grants.updated_at`).

Amazon Verified Permissions (Cedar) is optional later if the matrix explodes. Do not add it in v1.

---

## 8. Data model (Aurora — owned by Next, or a small `identity` schema)

Sentinel’s `users` table is the wrong place for operator identity. Add tables the BFF reads. Same cluster is fine (`dmrv` database, schema `identity`).

```
tenants
  id              text PK          -- 'fourfourone'
  name, short, plan, accent
  status          active | suspended
  sentinel_enabled boolean
  created_at

tenant_members
  tenant_id       fk
  user_sub        text             -- Cognito `sub`
  email
  display_name
  role            tenant_admin | operator | quality_engineer | viewer
  status          invited | active | disabled
  project_scope   tenant | projects   -- always intersected with granted registries
  created_at
  unique (tenant_id, user_sub)

grants
  id
  tenant_id
  user_sub
  module          text             -- see §7.2
  registry        text null        -- required for registry-desk modules; null = n/a (quality, admin)
  effect          allow | deny
  project_id      text null        -- null = all projects in the granted registries

project_acl
  tenant_id
  user_sub
  registry
  project_id                       -- catalog slug, prj_…, or future Puro facility id

registry_connections               -- already the product model; identity depends on it
  tenant_id
  registry                         -- Isometric | Puro.earth | …
  secret_arn
  project_ids[]                    -- empty = whole org on that registry
  status
```

Seed tenant `fourfourone` from today’s `TENANTS` row. Seed one Isometric connection. Puro/Verra/GS connections stay absent until live credentials exist — bundled globe pins for demo tenants are not a connection.

Keep `verdant` / `helios` / `terrafix` as **demo catalog data** behind a `platform_admin` flag or delete them from production so they cannot be selected via a leftover header.

**Locations:** today’s one SSM parameter is a cross-tenant blob. Move to `project_locations(tenant_id, project_id, lat, lng)` or prefix SSM keys `/minrv/ew2/{stage}/tenants/{id}/locations`.

**Registry connections:** replace `apps/web/src/lib/registries/connections.ts` constants with the table above. **One secret per (tenant, registry).** Do not reuse the Isometric token for Puro. Web task reads by `session.tenantId` + `project.registry`.

---

## 9. Sentinel after Cognito

Keep M2M. Change what it is allowed to see.

| Change | Why |
| --- | --- |
| Tag every Sentinel project `config.tags.tenant_id` (and keep `catalog_id`) | Row-level tenant |
| Optionally tag `config.tags.registry` from the catalog project | Stops an Isometric UUID being bound from a Puro id |
| `ensureSentinelUuid` writes `tenant_id` | New binds cannot leak |
| Proxy refuses UUID whose tag ≠ session tenant | Defence in depth if M2M stays admin |
| Pass `X-Actor-Sub`, `X-Actor-Email`, `X-Tenant-Id` on upstream calls (signed or only on the internal ALB) | Audit log today often records the M2M admin, not the operator |
| Do **not** open `v1/auth` on the BFF | Avoid two logins |
| Leave Sentinel password/MFA/Entra in place but unused | Or disable Entra env in a later cleanup so `FRONTEND_URL` is not a dangling SSO |

`ProjectMember` in Sentinel is bypassed by M2M-as-admin. Either:

- **v1:** Next is the ACL; Sentinel stays admin M2M but only ever receives UUIDs Next already authorised, **or**
- **v1.1:** create a non-admin M2M per tenant, or pass a user-scoped token. More work; do it when a second tenant shares the same Sentinel DB.

Prefer tagging + Next ACL first. Shared Postgres with admin M2M is acceptable for **one** Sentinel-provisioned tenant (`fourfourone`). Before onboarding tenant two onto the same FastAPI, you need the tag filter **inside** Sentinel list/get endpoints even for the M2M user.

---

## 10. Infra (CDK, eu-west-2)

**Create, do not attach.** There is no Cognito user pool, identity stack, or session secret in the account today. CDK must **synthesize new** `AWS::Cognito::*` (and the rest of `minrv-ew2-sandbox`) on first deploy. Do not `fromUserPoolId` / `fromUserPoolArn` a pool that is not there. Do not create the pool in the console and then try to wrap it. Do not point at Ireland (`eu-west-1`) Cognito or `minrv-dev-*`.

Add to `infra/` (identity + security + compute). Same deploy path as [infra/README.md](../infra/README.md): `make deploy` one CloudFormation stack at a time in real `eu-west-2`. Identity stack comes **after** security (needs the CMK) and **before** compute (web task needs pool id / client secret).

| Resource | Notes |
| --- | --- |
| `AWS::Cognito::UserPool` | Email, custom attrs, MFA TOTP optional — **created by this stack** |
| `UserPoolClient` | Confidential, code flow, refresh rotation if available |
| `UserPoolDomain` | `minrv-ew2-{stage}` prefix / custom domain later |
| Groups | Five roles |
| Lambda `preToken` | V2_0 access token claims: `tenant_id`, `role` |
| Secrets | `cognito` client id/secret, `session-key`; keep Isometric **web-task only** |
| Web task env | `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_DOMAIN`, `COGNITO_REDIRECT_URI` |
| Web task secret | client secret + session key |
| IAM | Web task: `cognito-idp:AdminCreateUser`, `AdminAddUserToGroup`, `AdminDisableUser` for invite UI (lock down to this pool ARN) |
| WAF | Created with the public ALB (edge stack). On that **new** ACL, rate-limit `/auth/*` |
| Callback URLs | Must match the ALB / CloudFront domain that this deploy creates (plus `http://localhost:3000/auth/callback`) |

Do **not** attach the Sentinel task role to Cognito admin APIs.

Forbidden: LocalStack, `awslocal`, `cognito-local`, Docker Cognito, `AWS_ENDPOINT_URL` aimed at a fake IdP.

Seed **after** the stack is `CREATE_COMPLETE`: one `platform_admin` for 44.01 (your email) in tenant `fourfourone` via a script against the **real** pool. No open sign-up. `AllowAdminCreateUserOnly`. You cannot seed users before the pool exists.

---

## 11. Implementation phases

Each phase should be mergeable. Do not start Phase 4 before Phase 2 is live — an admin UI on a spoofable tenant header makes things worse.

**CloudFormation before app.** Any stack change is written in CDK first, then `make deploy`. Next.js login is not step one.

### Phase 0 — decisions (this doc)

- [ ] Confirm pool model (one user pool) for v1
- [ ] Confirm no operator login to Sentinel
- [ ] Confirm module list in §7.2 (add/remove before coding)
- [ ] Confirm registry-desk grants are **per registry** (Isometric submit ≠ Puro submit)
- [ ] Confirm MFA required for admins
- [ ] Confirm first users are invite-only (no self-serve signup)

### Phase 1a — CDK / CloudFormation (first)

**Outcome:** templates include Cognito. `make deploy` can create the pool. No operator login UI required in this step.

- Add `infra/lib/identity-stack.ts`; wire `stage.ts`; insert `identity` in `STACK_ORDER` after `security`, before `compute`
- Session-key secret on security stack; Cognito env/IAM on **web** task; web → RDS Proxy on first data/network deploy; WAF `/auth/*` on new edge ACL
- Then `make deploy` in `eu-west-2` (creates `minrv-ew2-sandbox-identity` and the rest of the landing zone)
- Seed `AdminCreateUser` only after that stack is `CREATE_COMPLETE`

### Phase 1b — Next.js session, still single tenant

**Outcome:** nobody reaches `/` or `/quality` or `/api/*` without a cookie. Tenant is still `fourfourone` for everyone.

- `apps/web/src/app/login/page.tsx` (button → hosted UI)
- `apps/web/src/app/auth/callback/route.ts`
- `apps/web/src/app/auth/logout/route.ts`
- `apps/web/src/app/api/auth/me/route.ts`
- Cookie encrypt/decrypt + `aws-jwt-verify`
- Middleware: unauthenticated → `/login`
- Ship via CodePipeline, not `make deploy`
- Local Next can use `AUTH_DEV_USER` (localhost only) if the pool is not up yet. Full hosted-UI login needs the **real** sandbox pool after 1a. Never a local fake Cognito.

**Do not** remove `x-tenant-id` yet. Session existence is the gate.

### Phase 2 — tenant from session

**Outcome:** spoofing `x-tenant-id` cannot change data.

- `getSession().tenantId` is the only tenant
- `resolveRequestTenant` / every registry + sentinel + locations route
- Quality browser client stops hardcoding `DEFAULT_TENANT_ID`
- Dashboard store hydrates from `/api/auth/me`
- Header mismatch → 403
- Then delete header from clients

### Phase 3 — RBAC

**Outcome:** roles and modules enforced on API + nav.

- `identity` tables + seed `fourfourone` members
- `authorize(module, { registry?, projectId? })`
- Map allowlist prefixes → modules in `proxySentinel`
- Hide Quality nav items, Control room **Submit**, charter/GHG, and **registry select options** from `me.permissions`
- `registry.submit` default deny except `tenant_admin` / explicit grant **on that registry**
- Tests: viewer 403 on pipeline and submit; operator 403 on `v1/rules` seed; Isometric-only user 403 on a Puro project id if one exists

### Phase 4 — users and grants UI

**Outcome:** `tenant_admin` can invite, disable, set role, set modules, set **registries**, set project scope.

- `/settings/users` (or `/admin/users`) in Next — not Sentinel’s user admin
- Invite: `AdminCreateUser` + `custom:tenant_id` + group + `tenant_members` row + temp password / invite email
- Disable: Cognito disable + `status=disabled` (defence in depth)
- Grant changes bump `pv` / revoke session id in Redis so access drops immediately

### Phase 5 — Sentinel tenant tags + actor

**Outcome:** quality rows are tagged; audit shows the operator, not `m2m@3dminrv.internal`.

- Write `tenant_id` on bind/create
- Filter list/get in Next rewrite; add FastAPI filter before tenant two
- Forward actor headers; map into `AuditLog.actor_id` (string sub) or a sidecar column

### Phase 6 — real multi-tenant SaaS

**Outcome:** a second operator org can sign in and cannot see `fourfourone` projects, locations, Isometric org, or Sentinel UUIDs.

- Tenant provision playbook (CDK script or admin API): row + secret paths **per registry**
- Per-tenant Isometric secret; web task reads by `session.tenantId` + registry
- When Puro goes live: separate secret, separate connection row, same grant table
- `SENTINEL_TENANT_ID` becomes a **set** or `tenants.sentinel_enabled`
- Namespace locations
- Drop demo tenants from production catalog (or `platform_admin` only)
- Optional: per-tenant Cognito app client + Entra IdP

### Phase 7 — cleanup

- Remove dead Sentinel SSO usage from compute (or document it as engine-debug only)
- Remove `setTenant` as a public client API
- SessionStorage key prefix
- Security review / Bugbot on auth files

---

## 12. Local development

Laptop Next + Sentinel compose are **not** a substitute AWS. Cognito, ALB, WAF, and Aurora appear only when CDK creates them in `eu-west-2`.

| Mode | When | How |
| --- | --- | --- |
| App-only (pool not deployed yet) | Before first identity/landing-zone deploy | `AUTH_DEV_USER` mints the same `minrv_session` cookie. Guard: `NODE_ENV !== production` **and** hostname `localhost`. Lets Phase 2–3 UI/API work without an IdP. |
| Full login | After sandbox identity stack is `CREATE_COMPLETE` | Real Cognito hosted UI in `eu-west-2`. `.env.local` gets the **real** user-pool id, client id/secret, domain. Callback `http://localhost:3000/auth/callback` on that app client. |
| Playwright / smoke | Always | Prefer `AUTH_DEV_USER`. `AUTH_DISABLED=1` **forbidden in AWS**. |
| Sentinel | Always | Unchanged compose + `local-sentinel-m2m-token`. Do not use FastAPI `/token` from the Next UI. |

Never: LocalStack, `cognito-local`, mocked JWKS on `:4566`, or copying Ireland pool ids.

`npm run sentinel:smoke` must grow a case: no cookie → 401 on `/api/sentinel/health` (today 403 without header is the check).

---

## 13. Test plan (write these as you implement)

**Authn**

- [ ] Unauthenticated `/` → login
- [ ] Unauthenticated `/api/registry/projects` → 401
- [ ] Callback with bad `state` → 400, no cookie
- [ ] Logout clears cookie; refresh token cannot mint a new session
- [ ] Expired access token refreshes once; revoked refresh → login

**Tenant**

- [ ] User A (`fourfourone`) cannot read locations / projects for another tenant by header spoof
- [ ] Quality bind refuses a catalog id from another tenant
- [ ] Sentinel proxy refuses a UUID tagged to another tenant

**Modules**

- [ ] `viewer`: GET board data 200; POST pipeline 403; POST submit 403; `/quality/rules` 403
- [ ] `operator`: pipeline 200; rules seed 403; submit 403 unless granted
- [ ] `quality_engineer`: rules + runs 200; submit 403
- [ ] `tenant_admin`: invite + grants 200; cannot list another tenant’s users
- [ ] User granted only `Isometric`: globe/API omit Puro projects; Isometric submit still 403 until `registry.submit` is granted
- [ ] User granted `registry.submit` on Isometric: 403 on a future Puro submit route (and the reverse)
- [ ] Charter / setup APIs 403 for a Puro (or non-Isometric) project even if the user has `project_setup` on Isometric

**Session hygiene**

- [ ] Tokens absent from `sessionStorage` / `localStorage`
- [ ] Logout clears `minrv-*` UI keys
- [ ] Disabled user rejected even with an old cookie (Cognito + `tenant_members.status`)

---

## 14. Suggested code map (when you start)

| New | Role |
| --- | --- |
| `infra/lib/identity-stack.ts` | User pool, client, domain, Lambda, groups |
| `apps/web/src/lib/auth/cognito.ts` | Discovery, token exchange, revoke |
| `apps/web/src/lib/auth/session.ts` | Cookie seal/unseal, `getSession()` |
| `apps/web/src/lib/auth/authorize.ts` | Module + registry + project |
| `apps/web/src/lib/auth/tenants.ts` | Replace static `TENANTS` as the **runtime** source (keep file as seed/fallback for demos) |
| `apps/web/src/middleware.ts` | Coarse login gate |
| `apps/web/src/app/login/page.tsx` | Hosted UI start |
| `apps/web/src/app/auth/callback/route.ts` | Code exchange |
| `apps/web/src/app/api/auth/me/route.ts` | Hydrate client |

| Existing — must change | How |
| --- | --- |
| Every `app/api/**/route.ts` that reads `x-tenant-id` | Session tenant + `authorize` |
| `apps/web/src/lib/sentinel/proxy.ts` | Authn + module + UUID tenant tag |
| `apps/web/src/lib/sentinel/browser.ts` | Cookie session (same-origin); drop hardcoded tenant |
| `apps/web/src/lib/sentinel/config.ts` | `resolveRequestTenant` |
| `apps/web/src/store/dashboard-store.ts` | Hydrate tenant from `me`; stop defaulting independently |
| `apps/web/src/components/quality/nav.ts` | Filter by permissions |
| `apps/web/src/components/dashboard/registry-select.tsx` | Options from `me.registries`, not a hardcoded pair |
| `apps/web/src/lib/registries/connections.ts` | Tenant + **registry**-scoped secrets (Phase 6) |
| `infra/lib/compute-stack.ts` | Cognito env/secrets on **web** task |
| `infra/lib/security-stack.ts` | Session key (+ Cognito secret if not identity stack) |

Do not add Cognito SDK calls in `apps/sentinel`. Do not copy Python auth into Next.

---

## 15. Open decisions (resolve in Phase 0)

1. **Self-serve signup?** Recommendation: **no**. Invite only.
2. **Can a user belong to two tenants?** Recommendation: **not in v1**. One `custom:tenant_id`. Revisit with pool-per-tenant or a tenant picker that mints a new session.
3. **Where do identity tables live?** Recommendation: Aurora `dmrv`, schema `identity`, accessed only from Next. Not Sentinel ORM.
4. **Direct Cognito from the browser (Amplify)?** Recommendation: **no** for v1. BFF code exchange keeps the refresh token off `localStorage`.
5. **Custom domain for hosted UI?** `auth.<product-domain>` vs `minrv-ew2-sandbox.auth.eu-west-2.amazoncognito.com`. Custom domain needs ACM + Route53; can follow Phase 1.
6. **Session length for operators on the globe?** Recommendation: 8 hour idle max via refresh; require re-login overnight. Registry submit is a privileged action — optional step-up MFA later.
7. **Demo tenants in production?** Recommendation: strip `verdant` / `helios` / `terrafix` from prod catalog so the globe is not a fake multi-tenant story.
8. **Default registries for a new `fourfourone` operator?** Recommendation: Isometric `registry.read` + `control_room` + `pipeline.run` on that tenant’s Isometric projects. No `registry.submit` until explicitly granted. No Puro desk until a Puro connection exists.
9. **Does Quality Console need a registry grant?** Recommendation: **no** for v1. Quality is engine configuration. Project bind still respects the user’s project/registry set so they cannot point DQA at a desk they cannot see.

---

## 16. One-page sequence

```
Now     Public UI, header tenant, M2M admin, demo catalog, Isometric live + Puro filter
        CDK in git has no Cognito; AWS has no London stacks
Phase 1a Refine CDK (identity stack + STACK_ORDER + web env) then make deploy
Phase 1b Next login cookie (CodePipeline). AUTH_DEV_USER until 1a exists
Phase 2 Tenant is the session, header cannot spoof
Phase 3 Roles gate Control Room / Quality / per-registry submit and desks
Phase 4 Admins invite users and set registry + project access
Phase 5 Sentinel rows know tenant; audit knows person
Phase 6 Second CFN pass: per-tenant **and per-registry** secrets, then make deploy
```

Stop shipping features that assume `x-tenant-id: fourfourone` is identity, or that “control room access” means every registry desk. Treat Phase 2 as the security baseline; Phase 3 as the product baseline; Phase 6 as “we are actually a multi-tenant SaaS.”
