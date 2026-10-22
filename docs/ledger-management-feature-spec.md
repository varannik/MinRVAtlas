# Ledger Management — Feature Specification

**Audience:** a product and engineering team adding carbon-credit ledger management to another project.  
**Purpose:** explain what ledger management is, the rules that govern it, and the feature surface required to implement it.  
**Reference implementation:** MinRV Ledger workspace (`/ledger`, `/api/ledger`). This document describes the feature, not MinRV file layout.  
**Registry in scope:** Isometric Registry API. The design is registry-aware so Puro.earth and Verra can be added later without rewriting the product.

---

## 1. What ledger management is

Monitoring, reporting, and verification (MRV) proves that a removal happened and gets credits **issued**. Ledger management is what the organisation does with those credits **after issuance**.

A ledger is the organisation’s inventory of issued carbon credits, plus the legal actions that move or retire that inventory:

| Action | What it means | Effect on inventory |
|--------|----------------|---------------------|
| **Hold** | Credits sit in the organisation’s account as active batches | Unchanged |
| **Deliver** | Fulfil a buyer’s existing order by sending credits to that buyer | Active quantity decreases; those credits are marked delivered |
| **Transfer** | Change ownership to another organisation, outside an order | Active quantity decreases; recipient holds the credits |
| **Retire** | Permanently claim the climate benefit so the credits can never be sold or transferred again | Active quantity decreases; retired total increases |
| **Buy** | Purchase additional credits (Stripe checkout on Isometric) | New credits arrive later as inventory; this does not spend existing batches |

Ledger management is **not** project setup, data collection, GHG accounting, or certification submission. Those stay in the MRV workspace. The ledger reads and mutates the **registry**, which is the system of record for ownership and retirement.

The product is a workspace on top of the registry:

- Show the organisation’s balance and batches.
- Let an authorised user deliver, transfer, retire, or buy.
- Show a single history of those transactions, with links to registry certificates.
- Keep every action inside one registry. Credits from two registries are never combined in one transaction.

---

## 2. How it relates to the rest of the product

```
MRV workspace                         Ledger workspace
─────────────────────────             ─────────────────────────────
Connect registry credentials    →     Uses those credentials
Submit project / removal data         Does not edit MRV data
Registry issues credit batches  →     Lists those batches
                                      Deliver / transfer / retire / buy
                                      Activity + certificates
```

**Credential setup lives outside the ledger.** The ledger only works after the tenant has connected the registry (access token, client secret, organisation id, supplier id) for an environment (`sandbox` or `production`). If the registry is not connected, the ledger shows a connection prompt and does not render transaction forms.

**The registry is the source of truth for balances and transactions.** The application may cache batches for display and for sandbox fallback, but a delivery, transfer, or retirement is not “done” until the registry accepts it. After a successful mutation, refresh balance, batches, and activity from the registry.

---

## 3. Vocabulary

| Term | Meaning |
|------|---------|
| **Registry** | External system that issues credits and records ownership (Isometric, later Puro or Verra). |
| **Organisation** | The account that owns credits. Identified by the connected credentials. |
| **Supplier** | The party that issued or sells the credits. Required on transfer and retirement payloads. Taken from stored credentials, not typed by the user. |
| **Credit** | One tonne of CO₂e. Display unit. |
| **Kilogram (`credit_kgs`)** | Canonical storage and API unit. 1 credit = 1,000 kg. All mutation quantities are positive integers in kilograms. |
| **Credit batch** | A discrete slice of inventory with an id, serial number, status, size, project, and owner. Transactions always name specific batches and a kilogram quantity from each. |
| **Active batch** | A batch that can still be delivered, transferred, or retired. Only `ACTIVE` batches appear in transaction forms. |
| **Order** | A commercial agreement with a buyer for a quantity of credits. Delivery fulfils an order. It does not create one. |
| **Transferee** | An organisation the registry allows you to transfer credits to. Chosen from a directory, not free text. |
| **Beneficiary** | The organisation in whose name credits are retired. Defaults to the connected organisation (“self”). |
| **Retirement purpose** | Why the credits are being retired. At least one is required. |
| **Certificate** | A registry URL returned on a successful delivery, transfer, or retirement. The user can open it as proof. |
| **Environment** | `sandbox` or `production`. Credentials, balances, and transactions are isolated per environment. |
| **Tenant** | The customer account. Credentials and audit logs are scoped to the tenant. |

---

## 4. Credit lifecycle

```
Issued by the registry
        │
        ▼
   ACTIVE batch  ─────────────────────────────────────────┐
        │                                                 │
        │  partial quantity selected                      │
        ▼                                                 │
   Registry SPLITS the batch                              │
   (original is no longer selectable)                     │
        │                                                 │
        ├── remainder stays ACTIVE                        │
        │                                                 │
        └── moved quantity goes to one of:                │
              DELIVERED   (fulfils an order)              │
              transferred (new owner; their batch)        │
              RETIRED     (permanent; beneficiary claim)  │
                                                          │
   BUY creates new inventory through checkout ────────────┘
   (does not consume ACTIVE batches)
```

### Batch statuses

| Status | Selectable in a wizard | Meaning |
|--------|------------------------|---------|
| `ACTIVE` | Yes | Owned and available |
| `SPLIT` | No | Parent batch was divided. Children hold the quantities. |
| `DELIVERED` | No | Sent to a buyer against an order |
| `RETIRED` | No | Permanently claimed |

When the user takes **part** of a batch, send that kilogram amount. The registry splits the batch. Do not split batches in application code. After the call succeeds, the old batch id must not be reused; reload the active list.

A transaction may include **several batches**, each with its own quantity. Every batch in one request belongs to the **same registry**.

---

## 5. The operations

### 5.1 Credit overview (read)

Show the connected organisation’s position:

- **Active** credits (still holdable).
- **Retired** credits (already claimed).
- Optional breakdown **by project**.

Display quantities as tonnes (`tCO₂e`) with three decimal places. Example: `125,632 kg` → `125.632 tCO₂e`.

If the user selects “all connected registries”, the overview is **read-only**. Show one card per registry. Do not add kilograms from different registries into a single number unless a conversion policy exists. Clicking a registry card switches the workspace to that registry so actions become available.

### 5.2 Credit batches (read)

A filterable table of batches for the active registry:

- Serial number and batch id
- Status
- Size
- Project
- Vintage or sequestration date, when the registry provides it
- Registry badge

Status filter includes all statuses. This screen is for inspection. Wizards use a separate query that returns only `ACTIVE` batches.

List endpoints are **cursor-paginated** (`first`, `after`, and optionally `last`, `before`), matching the registry’s Relay-style pages.

### 5.3 Deliver credits (write)

Fulfil an open buyer order.

**Steps**

1. **Select order.** Load the organisation’s orders. Offer only orders whose status is `PLACED` or `IN_PROGRESS`. Show buyer name and kilograms ordered.
2. **Select batches.** User picks one or more `ACTIVE` batches and a quantity from each, in tonnes in the UI, stored as integer kilograms. Total kilograms must be at least 1 and must not exceed **remaining on the order** (`credits_ordered − credits_delivered`). A single line must not exceed that batch’s size.
3. **Confirm.** Show order, buyer, batch count, total, and optional notes (max 256 characters). Warn that submission is final. On confirm, submit.

**Request**

```json
{
  "order_id": "ord_…",
  "notes": "optional",
  "credit_batch_quantities": [
    { "credit_batch_id": "ctb_…", "credit_quantity_kg": 1000 }
  ]
}
```

The user does not choose a buyer. The order already identifies the buyer. The user does not send organisation or supplier ids; the backend adds any ids the registry requires from stored credentials.

**Success:** show the delivery id and a link to the certificate URL. Offer “deliver more”, which reloads orders and batches.

### 5.4 Transfer credits (write)

Move ownership to another organisation. This is not an order fulfilment.

**Steps**

1. **Select recipient.** Search the registry transferee directory (name, and domain when present). Free-text organisation ids are not accepted in the UI.
2. **Select batches.** Same batch selector as delivery, without an order cap. Total must be at least 1 kg. Each line must be within the batch size.
3. **Confirm.** Warn that a transfer cannot be undone. Optional notes, max 256 characters.

**Request**

```json
{
  "to_organisation_id": "org_…",
  "notes": "optional",
  "credit_batch_quantities": [
    { "credit_batch_id": "ctb_…", "credit_quantity_kg": 500 }
  ]
}
```

The backend sets `from_organisation_id` and `supplier_id` from the tenant’s credentials. The client must not be trusted to name the sender.

**Success:** transfer id and certificate link.

### 5.5 Retire credits (write)

Permanently remove credits from circulation and record who benefits and why.

**Steps**

1. **Purpose and beneficiary.**
   - At least one purpose:
     - `corporate_targets` — Corporate targets
     - `product_and_services` — Product and services
     - `events` — Events
     - `business_operations` — Business operations
     - `other` — Other
   - Beneficiary: default to the connected organisation, labelled “(self)”. Also list beneficiaries returned by the registry. Do not allow an empty beneficiary.
2. **Select batches.** Same rules as transfer.
3. **Confirm.** Show a strong warning: retirement is permanent and cannot be undone. Show beneficiary, purposes, batch count, and total. Optional notes, max 256 characters. Require an explicit confirm action (modal), not only the wizard’s last Next button.

**Request**

```json
{
  "beneficiary_organisation_id": "org_…",
  "retirement_purposes": ["corporate_targets"],
  "notes": "optional",
  "credit_batch_quantities": [
    { "credit_batch_id": "ctb_…", "credit_quantity_kg": 1000 }
  ]
}
```

The backend sets `owner_organisation_id` and `supplier_id` from credentials.

**Success:** retirement id and certificate link. Retired credits increase the retired total and disappear from the active balance.

### 5.6 Activity (read)

One feed that merges three registry lists:

- Deliveries
- Transfers
- Retirements

Sort by event time, newest first. Each row shows type, date, counterparty (buyer, recipient, or beneficiary), notes, and a certificate link when the registry returned a URL.

Page size is 20 per underlying list. “Load more” advances each list with its own cursor. A row is kept when any of the three lists still has a next page.

Delivery rows include a quantity (`credit_batch_size_total`). Transfer and retirement list payloads often omit quantity. If the activity table must show tonnes for those rows, load `…/transfers/{id}/credit-batches` or `…/retirements/{id}/credit-batches` and sum them. Do not display a silent zero as if the registry reported no credits.

### 5.7 Buy credits (write, Isometric only)

Purchase credits. This spends money and creates a checkout session. It does not select existing batches.

**Flow**

1. Ask the backend whether Stripe checkout is enabled for this registry. If it is not, show that buying is unavailable.
2. User enters quantity in tonnes (minimum 0.001 t, which is 1 kg), frequency (`one_time`, `monthly`, or `yearly`), and accepts both the registry terms and the supplier terms.
3. Backend creates a checkout session and returns a URL. The browser navigates to that URL.
4. Success and cancel URLs return the user to the ledger (`tab=buy-success` or `tab=buy-cancel`) with the same registry selected.

The backend forces the terms flags and the redirect URLs. The browser does not choose the return URLs.

Buying is an Isometric capability. Another registry adapter should omit it, and the UI should hide the Buy entry when the adapter does not list `buy` in its supported operations.

---

## 6. Units

Use kilograms in every API payload and in stored quantities. Use tonnes only in the interface.

| Helper | Rule |
|--------|------|
| Kilograms → tonnes | `kg / 1000` |
| Tonnes → kilograms | `round(tonnes × 1000)` |
| Display | `125.632 tCO₂e` (three decimal places, locale grouping) |
| Parse a registry quantity | Prefer `credit_kgs` when present; otherwise `credits × 1000` |
| Mutation quantity | Integer ≥ 1 |

Never send fractional kilograms. Never let the UI submit a quantity above the batch size or, for delivery, above the order remainder.

---

## 7. Architecture

```
Browser (ledger UI)
    │  session auth only — no registry secrets
    ▼
Application API  /api/ledger/…
    │  resolve tenant + environment
    │  load that tenant’s registry credentials
    │  authorize writes
    │  validate payload
    ▼
Registry adapter  (one per registry)
    │
    ▼
Registry HTTP API  (Isometric Registry v0)
```

### Rules that should not be relaxed

1. **The backend is the only registry client.** Access tokens and client secrets stay in server-side storage, scoped by tenant and environment. The browser calls the application API.
2. **One adapter per registry.** UI and routes speak a stable ledger API. Isometric-specific URLs, id prefixes, and extra fields stay inside the Isometric adapter.
3. **Writes go through one mutation path** that calls the adapter, writes an audit log, and schedules a batch resync. Do not let controllers call the registry ad hoc for deliveries, transfers, retirements, or checkout.
4. **Reads prefer the live registry.** In sandbox only, if the live batch list is empty, fall back to a local mirror so demos still render. Production does not substitute stale mirror rows for a failed live call.
5. **A transaction names one registry.** The route parameter (`/api/ledger/isometric/…`) is the registry. Validation rejects batches that do not belong to it.
6. **Ledger UI is a separate workspace from MRV.** Switching into the ledger does not change MRV screens. Registry connection is a prerequisite, not a screen inside each wizard.

### Adapter operations

An adapter reports what it supports:

```text
isometric → balance, batches, deliver, transfer, retire, buy
```

The UI shows a wizard only when the active registry supports that operation. Unknown registry codes return HTTP 404, “Registry not supported for ledger operations”.

### What the Isometric adapter fills in

| Client sends | Adapter adds from credentials |
|--------------|--------------------------------|
| Delivery: `order_id`, notes, batch quantities | Calls the registry with that body once organisation and supplier credentials exist |
| Transfer: `to_organisation_id`, notes, batch quantities | `from_organisation_id`, `supplier_id` |
| Retirement: beneficiary, purposes, notes, batch quantities | `owner_organisation_id`, `supplier_id` |
| Checkout: `quantity_kg`, `frequency` | Success and cancel URLs, registry terms accepted |

If organisation id or supplier id is missing, fail with HTTP 422 before calling the registry.

---

## 8. Normalized model

Screens consume these shapes. Adapters and normalizers map registry payloads into them so the UI does not branch on Isometric field names.

```ts
type RegistryCode = "isometric" | "puro" | "verra";

interface NormalizedCreditQuantity {
  registry: RegistryCode;
  creditKgs: number;
  displayTonnes: number;
  displayLabel: string; // "125.632 tCO₂e"
}

interface NormalizedCreditBatch {
  registry: RegistryCode;
  id: string;
  serialNumber?: string;
  status: "ACTIVE" | "SPLIT" | "RETIRED" | "DELIVERED" | string;
  creditKgs: number;
  projectId?: string;
  projectName?: string;
  registryProjectId?: string;
  vintage?: string;
  methodology?: string;
}

interface NormalizedCreditBalance {
  registry: RegistryCode;
  activeTotal: NormalizedCreditQuantity;
  retiredTotal: NormalizedCreditQuantity;
  byProject?: { projectId: string; active: NormalizedCreditQuantity }[];
}

interface BatchSelection {
  batchId: string;
  creditQuantityKg: number; // integer ≥ 1
}

type ActivityType = "delivery" | "transfer" | "retirement";

interface NormalizedActivityItem {
  id: string;
  type: ActivityType;
  date?: string;
  creditKgs: number;
  counterparty?: string;
  certificateUrl?: string;
  notes?: string;
}
```

Isometric balance mapping:

- `total.active_credits_total` → `activeTotal`
- `total.retired_credits_total` → `retiredTotal`
- `project_balances[].project_id` + `active_credits_total` → `byProject`

Isometric batch mapping:

- `id` → `id` (prefix `ctb_`)
- `serial_number` → `serialNumber`
- `status` uppercased → `status`
- `size.credit_kgs`, or `size.credits × 1000` → `creditKgs`

---

## 9. Workspace and navigation

The ledger is its own mode, with its own menu:

| Menu key | Screen |
|----------|--------|
| `overview` | Credit overview |
| `batches` | Credit batches |
| `deliver` | Deliver credits |
| `transfer` | Transfer credits |
| `retire` | Retire credits |
| `activity` | Activity |
| `buy` | Buy credits |

URL shape:

```text
/ledger?tab=overview&registry=isometric
/ledger?tab=deliver&registry=isometric
/ledger?tab=buy-success&registry=isometric
/ledger?tab=buy-cancel&registry=isometric
```

`buy-success` and `buy-cancel` highlight the Buy menu item. They are outcomes, not extra menu rows.

A registry selector sits at the top of every ledger screen. Today only Isometric is active. Puro and Verra appear as not yet available. Changing the registry updates the URL. Transaction screens that receive `registry=all` act on the default connected registry (Isometric) rather than mixing inventories.

Persist the last tab and last registry in local storage so a refresh returns the user to the same place. The URL remains the source of truth on load.

### Connection guard

On entry, call `GET /api/ledger/connected`.

- If Isometric is absent, show a single message: connect the registry in credential setup. Do not mount wizards.
- If present, render the selected tab.

The connected payload includes environment, supported operations, and token expiry when the credential row has a generation time (treat Isometric access tokens as valid for one year from `token_generated_at`, else `last_verified_at`, else `created_at`). Surface expiry on the overview so an admin can rotate credentials before calls start failing.

---

## 10. Transaction rules

| Rule | Where it is enforced |
|------|----------------------|
| Authenticated session required on every ledger route | API auth middleware |
| Writes require role `SuperAdmin`, `TenantAdmin`, or `ProjectManager` | Role guard on POST routes. Reads stay available to any authenticated user. |
| Delivery `order_id` matches `ord_…` | Request validation |
| Isometric `credit_batch_id` matches `ctb_…` | Request validation |
| `credit_batch_quantities` is a non-empty array | Request validation |
| Each `credit_quantity_kg` is an integer ≥ 1 | Request validation |
| Retirement has at least one purpose from the allowed set | Request validation |
| Transfer has a non-empty `to_organisation_id` | Request validation |
| Retirement has a non-empty `beneficiary_organisation_id` | Request validation |
| Notes, when present, are at most 256 characters | Request validation |
| Checkout `quantity_kg` ≥ 1 and frequency is `one_time`, `monthly`, or `yearly` | Request validation |
| Both checkout term flags are strictly accepted | Request validation; backend sets them |
| Delivery total ≤ order remainder | UI blocks Next; registry will also reject an over-delivery |
| Each selected quantity ≤ that batch’s `creditKgs` | Batch selector |
| Only `ACTIVE` batches are selectable | Batch query used by wizards |
| No mixed-registry batch list | Selector is loaded for one registry |
| Sender, owner, and supplier ids come from credentials | Adapter |
| Every successful write is audited | Mutation service |
| Batch cache is refreshed after a write | Mutation service, asynchronous |

Audit record (append-only):

| Field | Value |
|-------|--------|
| Tenant | Resolved tenant id |
| User | Subject, user id, or email from the session |
| Action | `credit.delivery`, `credit.transfer`, `credit.retirement`, or `credit.stripe_checkout` |
| Entity type | `{registry}_credit` |
| Entity id | Registry id of the created object, or its URL |
| Details | Registry, operation, entity id, batch count (and `quantity_kg` for checkout) |
| IP | Forwarded address when present |

Audit failure must not roll back a registry call that already succeeded. Log the audit error and still return success to the user. The registry is the source of truth; the audit log is the local trail.

---

## 11. API contract

Base path: `/api/ledger`.  
Envelope for success: `{ "success": true, "data": { … } }`.  
Envelope for failure: `{ "success": false, "message": "…", "code": "…", "detail": { … } }`.  
Validation failure: HTTP 422 and `{ "success": false, "errors": [ … ] }`.

Pass `environment` as `sandbox` or `production` (query on GET, body on POST). Default is `sandbox`.

Pagination query, forwarded to the registry and stripped of application-only parameters: `first`, `after`, `last`, `before`.

### Reads

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/connected` | Registries with credentials, operations, token expiry |
| GET | `/summary` | Balance rows for every connected registry |
| GET | `/:registry/balance` | Active and retired totals, plus per-project balances |
| GET | `/:registry/batches` | Paginated batches. Optional `projectId` filters a local mirror fallback. |
| GET | `/:registry/orders` | Orders for the connected organisation |
| GET | `/:registry/transferees` | Transfer recipients |
| GET | `/:registry/beneficiaries` | Retirement beneficiaries |
| GET | `/:registry/deliveries` | Delivery history |
| GET | `/:registry/deliveries/:deliveryId` | One delivery |
| GET | `/:registry/deliveries/:deliveryId/credit-batches` | Batches inside a delivery |
| GET | `/:registry/transfers` | Transfer history |
| GET | `/:registry/transfers/:transferId` | One transfer |
| GET | `/:registry/transfers/:transferId/credit-batches` | Batches inside a transfer |
| GET | `/:registry/retirements` | Retirement history |
| GET | `/:registry/retirements/:retirementId` | One retirement |
| GET | `/:registry/retirements/:retirementId/credit-batches` | Batches inside a retirement |
| GET | `/:registry/credit-batches/:batchId` | One batch |
| GET | `/:registry/stripe/config` | Whether checkout is enabled |

### Writes

| Method | Path | Body |
|--------|------|------|
| POST | `/:registry/deliveries` | `order_id`, optional `notes`, `credit_batch_quantities` |
| POST | `/:registry/transfers` | `to_organisation_id`, optional `notes`, `credit_batch_quantities` |
| POST | `/:registry/retirements` | `beneficiary_organisation_id`, `retirement_purposes`, optional `notes`, `credit_batch_quantities` |
| POST | `/:registry/stripe/checkout` | `quantity_kg`, `frequency`, both terms flags |

Write responses return the registry object (id and certificate `url` for the three inventory actions; `url` for checkout).

### Errors

| Situation | HTTP | Notes |
|-----------|------|--------|
| Unknown registry | 404 | No adapter |
| Not signed in | 401 | Application session, not the registry |
| Role cannot transact | 403 | Code `CREDIT_FORBIDDEN` |
| Registry credentials missing or rejected | 403 | Code `REGISTRY_NOT_CONNECTED` when the connection test fails |
| Invalid body | 422 | Field errors |
| Registry rejected the call (including registry HTTP 401) | 502 | A registry auth failure must not be returned as 401, or the client will treat it as a logged-out session |
| Registry other 4xx | Pass through the registry status when it is already a client error other than 401 | Include `detail` from the registry body |

Upstream error text is safe to show in a toast. Do not include tokens in that text or in logs.

---

## 12. UI behaviour worth copying

### Batch selector

Shared by deliver, transfer, and retire.

- Columns: select, serial, available tonnes, quantity input.
- Checking a row selects the **full** available amount.
- The quantity input is in tonnes, converted to kilograms, and clamped to the batch size.
- Entering zero or clearing the input deselects the row.
- Footer shows the running total.
- Delivery passes `maxTotalKg` = order remainder and disables Next while the total exceeds it.
- Empty, loading, and error states are explicit, with retry.

### Confirm modal

The last wizard step reviews the action. The submit button opens a modal that restates the irreversible outcome. Retirement uses an error-styled alert (“Retirement is permanent and cannot be undone.”). Transfer warns that submission is irreversible. Delivery identifies the order. Closing the modal does not clear the form. A double submit is ignored while the request is in flight.

### After success

Replace the wizard with a result panel: title, registry name, transaction id, certificate link, and a button that resets the wizard and reloads source data. Do not leave the user on a stale batch selection.

### Certificates

If the registry returns `url`, render it as an outbound link. If it does not, omit the link. Do not invent a certificate.

### Buy outcome pages

- Success: tell the user the registry will reflect the purchase after payment completes, and link back to overview and buy.
- Cancel: tell the user nothing was purchased, and link back to buy.

---

## 13. Data the host application must already have

The ledger does not create registry accounts. The host application provides:

| Need | Why |
|------|-----|
| Authenticated user and tenant id | Scope credentials, queries, and audit |
| Role on the session (`SuperAdmin`, `TenantAdmin`, `ProjectManager`, and read-only roles) | Write guard |
| Per-tenant, per-environment registry credentials: access token, client secret, organisation id, supplier id | Every registry call |
| A way to test that those credentials work | Connection guard and “not connected” errors |
| Optional batch mirror tables | Sandbox fallback when the live list is empty |
| Append-only audit log | Compliance trail for writes |

Environment isolation is a hard requirement. A sandbox token must never be used for a production ledger call, and the UI should show which environment is active.

---

## 14. Implementation checklist

Build in this order. Each stage is usable on its own.

### Stage A — Shell

- [ ] Ledger route and workspace switch, separate from MRV
- [ ] Tab query (`overview`, `batches`, `deliver`, `transfer`, `retire`, `activity`, `buy`)
- [ ] Registry query, default `isometric`
- [ ] `GET /connected` and a blocked state when Isometric is not connected
- [ ] Unit helpers: kg ↔ tonnes, format, parse

### Stage B — Read inventory

- [ ] `GET /:registry/balance` and overview cards (active, retired, by project)
- [ ] `GET /:registry/batches` and a status-filtered table
- [ ] Normalizers from registry envelopes into the models in section 8
- [ ] Cursor pagination
- [ ] Sandbox mirror fallback only when the live list is empty

### Stage C — Inventory writes

- [ ] Validation and role guard
- [ ] Adapter methods for delivery, transfer, retirement
- [ ] Mutation path: registry call, audit, batch resync
- [ ] Shared batch selector limited to `ACTIVE`
- [ ] Deliver wizard with open-order filter and remainder cap
- [ ] Transfer wizard with transferee search
- [ ] Retire wizard with purposes, self-beneficiary default, and permanent-action warning
- [ ] Success state with certificate link and data refresh

### Stage D — History and purchase

- [ ] Activity feed merging deliveries, transfers, and retirements
- [ ] Detail routes for one transaction and its batches (use these when a list row has no quantity)
- [ ] Stripe config and checkout
- [ ] Redirect URLs back to buy-success and buy-cancel
- [ ] Hide Buy when the adapter does not support it

### Stage E — Hardening

- [ ] Token-expiry hint on overview
- [ ] Production path never serves mirror data in place of a failed live call
- [ ] Confirm 401 from the registry becomes 502
- [ ] Audit rows for all four write operations
- [ ] Sandbox test script: partial delivery (split), transfer, retirement, over-quantity rejection, missing role rejection, disconnected tenant

### Acceptance

A connected sandbox tenant can:

1. Read active and retired totals that match the registry.
2. See only `ACTIVE` batches in a wizard, and all statuses in the batch table.
3. Deliver against an open order for a partial batch, then see the delivery, a reduced remainder, and a split/replaced batch list.
4. Transfer to a listed transferee and open the certificate.
5. Retire with a purpose and beneficiary, and see the retired total increase.
6. Start checkout and land on the success or cancel return URL.
7. Fail closed when the user lacks a write role, the registry is disconnected, or the payload mixes invalid batch ids.

---

## 15. What to leave for a later registry

Do not block the first release on these. Do leave room for them:

- A second adapter (Puro, then Verra) registered beside Isometric.
- The registry selector enabling a registry only when that adapter reports operations.
- Hiding Deliver, Transfer, Retire, or Buy per registry.
- Separate credential storage per registry.
- Portfolio overview that lists registries side by side and never sums incompatible units.
- The same “one registry per transaction” validation when more than one adapter exists.

Isometric id rules (`ord_`, `ctb_`) stay inside the Isometric validation branch. Another registry gets its own id rules in its own branch.

---

## 16. Minimal mental model for implementers

1. Credits arrive as **batches** after MRV issuance. The ledger does not issue them.
2. The registry owns the truth. The app displays it and submits instructions.
3. Every write names **which batches** and **how many kilograms**, inside **one registry**.
4. **Deliver** fulfils an order. **Transfer** changes owner. **Retire** destroys the credit forever and needs a purpose and a beneficiary. **Buy** brings new credits in through checkout.
5. Secrets, sender identity, and supplier identity stay on the server.
6. Partial quantities are allowed; the registry splits the batch. Reload afterwards.
7. Show tonnes. Send kilograms. Confirm anything that cannot be undone.
