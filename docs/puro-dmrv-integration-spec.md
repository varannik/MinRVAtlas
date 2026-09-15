# Puro.earth dMRV Connect — Integration Specification

**For:** adding Puro.earth as a second registry target alongside the existing Isometric integration
**Audience:** platform engineering, carbon methodology/MRV team, product
**Status of source material:** Puro dMRV Connect is in **public Beta**; Puro state plainly that the documentation is still being revised as the beta progresses. Everything below should be re-validated against the live OpenAPI spec before a sprint is committed.
**Compiled:** September 2026

---

## 0. How to read this document

- **Part 1** explains Puro.earth as a *registry* — the certification process, the actors, and the rules that constrain what an integration can and cannot do. Read this first. Most integration surprises come from the process, not the API.
- **Part 2** is the API reference: auth, domain model, endpoint inventory, and the five workflows.
- **Part 3** maps Puro concepts onto Isometric concepts and calls out where the two registries are genuinely incompatible.
- **Part 4** is the proposed implementation design for our platform.
- **Part 5** lists open questions that need answers from Puro before build.
- **Appendices** hold the endpoint table, glossary and sources.

Throughout, blocks marked **⚠ Verify** are items where the public documentation is ambiguous, self-contradictory, or where we are inferring. Do not build on these without confirmation.

---

# Part 1 — Puro.earth as a registry

## 1.1 Why this matters for a dMRV integration

Isometric was designed from the ground up as a digital-native registry: the API *is* the primary interface, and the carbon accounting itself (LCA, components, uncertainty) lives inside the registry's data model. Puro.earth is a classic standard-and-registry body that has retrofitted a machine interface onto an established, document-and-audit-centric certification process.

That difference drives almost every design decision in this integration. With Puro you are not "submitting removals" — you are **assembling an audit package** that an independent third-party auditor will read, and you are doing it inside a compliance structure that predates the API.

## 1.2 The actors

| Actor | Role |
|---|---|
| **CO2 Removal Supplier** | The account holder that owns a registered Production Facility. Legally responsible for the data. In API terms, the *Supplier*. |
| **dMRV Partner** | Us. An entity that submits audit data on the Supplier's behalf, under delegated access. |
| **Issuing Body** | Puro.earth Oy. Reviews submissions, appoints auditors, issues CORCs, operates the registry. |
| **Auditor / VVB** | Independent third-party Validation & Verification Body. Appointed *by Puro*, not chosen by the supplier. |
| **Advisory Board** | Governs the Puro Standard and approves methodologies. |
| **Registry Operator** | Also Puro.earth Oy. Executes issuance, transfer, retirement, withdrawal. |

A structural point worth internalising: **Puro appoints the auditor and pays for the audit.** The supplier does not contract the VVB directly. This is different from the Isometric model, where the VVB relationship is visible to the supplier throughout and Isometric runs an RFP that the supplier is introduced into. For us it means the auditor assignment is an opaque, server-side decision we cannot influence or predict.

## 1.3 The certification journey

Puro's own framing of the supplier journey has eight stages:

1. **Initial qualification** — Puro assesses the facility's readiness and eligibility against a Puro Standard, CRCF or CCS+ methodology.
2. **Platform Agreement signature** — onboarding, KYC verification, and payment of the annual €1,400 Account Holder fee, which unlocks Puro Registry and certification infrastructure access.
3. **Facility Registration** — the production facility and removal activity are registered in the Puro Registry.
4. **Preliminary Assessment** *(optional)* — an expert pre-review to find gaps early.
5. **Audit Preparation** — assemble and submit the Audit Document Package. Puro reviews it *before* a VVB is engaged, to catch gaps and improve first-time pass rate.
6. **VVB Facility Audit** — independent audit confirming the facility, technology and operating processes meet certification requirements. **Valid up to five years once approved.**
7. **VVB Output Audit** — independent audit of CO₂ actually removed and stored during a reporting period. For suppliers on Puro Issuance Plus, output audits and issuance happen on-demand.
8. **CORC Issuance** — certificates are issued into the Puro Registry.

**Only stages 4–7 are in scope for the dMRV Connect API.** Stages 1–3 are commercial/legal onboarding done by the supplier in the MyPuro portal, and stage 8 is a registry transaction. Our platform cannot onboard a supplier to Puro; the supplier must already be an account holder with a registered facility before they can grant us access.

### The formal two-phase structure

Under the General Rules the process splits into two named phases that map onto ISO/CCP terminology:

**Design Validation** = Production Facility Audit → Production Facility Review
- The Facility Audit starts only once the supplier has completed KYC, signed the Platform Agreement, submitted facility registration, and submitted facility audit documentation that Puro deems complete.
- Minimum documentation is the project description, which must cover: facility name/location/methodology/supplier; a non-technical description; a technical description of the activity and technology; net CO₂ removal quantification including uncertainty; reversal risk estimation and monitoring; demonstrated conformity to the methodology; the monitoring and reporting plan; baseline and additionality assessment; stakeholder consultation; environmental and social safeguards; and positive SDG impacts.
- A person with legal signing authority at the supplier must attest to accuracy.
- Design validation must complete within **three years of the Commitment Date**.
- Review outcome is success (facility becomes certified) or failure with non-conformities. On failure the supplier gets a **30-day window and one resubmission**.

**Performance Verification** = Output Audit → Output Review
- Starts when an Output Report has been submitted for a facility for a given Monitoring Period.
- Includes a desk study **and a site visit** (which may be remote).
- Same 30-day / one-resubmission rule on failure.
- On success: the supplier can move to CORC issuance, and the audit report, statement and facility documentation are **published publicly in the registry**.

**Combined audits.** Puro may combine design validation and performance verification, in which case the supplier submits all documents for both in one package and the auditor evaluates concurrently. The API's workflow guidance assumes this is the normal path for a new facility: Preliminary Assessment first, then a **Combined Facility and Output Audit**.

## 1.4 Rules that directly constrain the integration

These are the ones that will bite.

| Rule | Implication for us |
|---|---|
| **Crediting Period** begins on the first date of the first Monitoring Period and lasts 5 years by default (methodology may vary). Renewable twice via a new Facility Audit. Crediting periods must not overlap. | Monitoring periods are not free-floating. Our scheduler must know the crediting period bounds and refuse to create periods outside them. |
| **An Output Report must be submitted at least once every 12 months**, and may cover up to **18 months** of facility performance. | Hard deadline logic. We need alerting well before the 12-month mark. |
| **Late > 12 months → facility suspended. Late > 18 months → facility deregistered**, requiring a whole new Facility Audit including baseline re-evaluation to re-register. | This is a catastrophic, non-recoverable-without-cost failure mode. Deadline monitoring is a P0 feature, not a nice-to-have. |
| **Issuance frequency is tiered by volume** (from the fee schedule): 60,000+ CORCs/facility/rolling-365-days → 12 output reports/year; 30,000–59,999 → 6; 20,000–29,000 → 4; 10,000–19,000 → 2; below 9,999 → 1. | Our period-generation logic must be volume-aware. Creating monthly monitoring periods for a small biochar site is not permitted. |
| **CORCs are issued as whole integers**; any remainder under 1 tonne is carried into the next issuance. | Don't model expected issuance as a float and don't reconcile on exact decimals. |
| **Snapshot on approval** — once an auditor approves or fails a framework or model, the whole framework/model is snapshotted and further edits are blocked. | Our objects must have an immutable state. Any local edit after this point must be rejected client-side, not discovered as a 4xx. |
| **Facility Audit validity is up to 5 years**; crediting period renewal requires full re-evaluation including baseline and assumptions. | Long-horizon scheduling state we must persist. |
| **Simultaneous registration with another CDR crediting program is prohibited** for the same activity. Transfers between programs require non-overlapping monitoring periods and a deregistration document. | ⚠ **Commercially critical.** If our platform serves a supplier who is on both Isometric and Puro, we must not allow the same facility/activity to be certified on both for overlapping periods. This needs a hard constraint in our data model, not a policy document. |
| **Reversal events must be notified to Puro within 5 days of detection.** | If our platform ingests sensor/monitoring data that could evidence a reversal, we inherit a 5-day clock. |

### On buffers and conservativeness

Older General Rules versions (v2.x) defined a **default 10% buffer**, i.e. 100 t of output → 90 CORCs issued. **General Rules v4.4 no longer carries a generic buffer chapter.** Conservativeness is now handled through (a) methodology-level uncertainty quantification and deduction, and (b) supplier liability for reversals, with compensation by depositing equivalent CORCs — or, as of v4.4, EU/UK emission allowances in jurisdictions with statutory reversal liability such as the EEA and UK.

⚠ **Verify:** do not hard-code a 10% buffer. Confirm per-methodology whether an uncertainty deduction or buffer applies, and whether Puro expects us to apply it in the model or whether Puro applies it at issuance.

## 1.5 What a CORC is

One CORC = **1 metric tonne of net CO₂ removal stored long-term** (long-term defined as ≥100 years). Each CORC carries:

- Unique identifier
- Issuance date
- Methodology and version
- A durability label: **CORC100+ / CORC200+ / CORC1000+**
- Production facility identifier, name, location
- Host country and sector
- Monitoring period first and last dates from the Output Report
- Methodology-specific attributes

**Vintage** = the calendar year the removal occurred; if it spans years, the *latest* year wins. (A mid-2024 to mid-2025 monitoring period is vintage 2025.)

Compare with Isometric, where the credit is tied to a *GHG entry* under a protocol version, with uncertainty discounting applied at the entry level. Same tonne-denominated unit, different provenance object.

## 1.6 Methodologies currently exposed to dMRV Connect

The API's framework table currently lists five:

| Methodology | Code | Frameworks | Models |
|---|---|---|---|
| Biochar 2022 | `C03000000` | Facility, Output | LCA & CORC Report |
| Biochar 2025 | `C03202501` | Facility, Output, Preliminary Assessment | LCA & CORC Report |
| Terrestrial Storage of Biomass | `C06000000` | Facility, Output, Preliminary Assessment | LCA & CORC Report |
| Carbonated Materials | `C09000000` | Facility, Output, Preliminary Assessment | LCA & CORC Report |
| Microalgae Carbon Fixation and Sinking | `M03202501` | Facility | LCA & CORC Report |

Notes:
- **Biochar 2022 has no Preliminary Assessment framework.** Facilities on the older edition go straight to Facility + Output.
- **Microalgae currently exposes only a Facility framework.** ⚠ Verify whether Output is genuinely unavailable via API or simply undocumented — this determines whether that pathway is integrable at all.
- Notably absent from the API surface: **Geologically Stored Carbon** and **Enhanced Rock Weathering**, both of which are live Puro methodologies. If our supplier base includes ERW or DAC-to-geology, dMRV Connect does not yet cover them.

## 1.7 Commercial model (context for product)

Worth knowing because it shapes supplier behaviour and therefore our feature priorities:

- **€1,400/year** account holder fee.
- **No audit costs to the supplier** — Puro manages and pays the VVB.
- Service fee is **per CORC**, tiered on volume reported over the trailing 364 days, from €10.00/CORC at tier 2 down to €0.40/CORC at tier 37 (9–10M CORCs).
- Facilities **below the tier-1 minimum (≤1,000 CORCs)** pay a **flat €12,000** per audit instead, invoiced when the audit is booked.
- **0% secondary trading fee.** €0.25/CORC retirement fee, waivable for reported long-term offtake agreements.
- **Complexity premium** on the service fee by methodology: Biochar 0%, Geologically Stored Carbon 0%, Carbonated Materials 6%, Terrestrial Storage of Biomass 12%, Enhanced Rock Weathering 12%. Each SDG beyond SDG 13 adds 2.5%.
- **5% discount** for paying the service fee at issuance.
- **€2,000/facility/year** pooling admin fee where volumes are pooled.

The flat-fee cliff at 1,000 CORCs is the interesting one: small suppliers pay €12,000 per audit regardless. That pushes small operators toward **fewer, larger monitoring periods** — which our period-planning UX should reflect rather than defaulting to monthly.

---

# Part 2 — dMRV Connect API

## 2.1 Status, environments, protocol

| Item | Value |
|---|---|
| Product name | Puro dMRV Connect |
| Status | **Beta** |
| Production base URL | `https://api.portal.puro.earth/` |
| Portal (human UI) | `https://portal.puro.earth` |
| UAT / sandbox | **Not available.** Puro state UAT is not yet available for dMRV Connect. |
| API version prefix | `/v0` |
| Auth | HTTP Bearer |
| Spec | OpenAPI 3, published as a browsable page with JSON/YAML download |
| Support | `tech-support@puro.earth`; partner onboarding via `product@puro.earth` |

> ### ⚠ The single biggest operational risk
> **There is no test environment.** The production API is wired directly to live MyPuro data. Every call we make during development mutates a real supplier's certification record. Deletes are documented as cascading and irreversible — deleting a monitoring period destroys its frameworks, documents, evidence requests and field values.
>
> Mitigations to agree before writing code:
> 1. Ask Puro directly for a sandbox tenant or a throwaway test organisation. Their launch materials referenced "access to a dedicated test environment" for partners; the docs say UAT is unavailable. **Resolve this contradiction first.**
> 2. Until resolved, build against a local mock generated from the OpenAPI spec, and gate all destructive verbs (`DELETE`, and `POST /audit-packages`) behind an explicit, per-environment feature flag.
> 3. Never let an automated test suite run against production credentials.

Also absent from the public docs and needing confirmation: **webhooks/callbacks, rate limits, pagination parameters, idempotency keys, and bulk endpoints.** Assume we must poll, assume we must be gentle, and assume we must build our own idempotency.

## 2.2 Authentication and delegated access

Three distinct credential types. Getting these confused is the most likely early integration error.

| Credential | Prefix | Held by | Used for |
|---|---|---|---|
| **Partner Client Secret** | `pcs_` | Us (the dMRV Partner) | *Only* to redeem authorisation codes at `POST /v0/partners/auth/access-tokens` |
| **Authorization Code** | *(opaque)* | Generated by Supplier | Single-use, exchanged for a Partner Access Token |
| **Partner Access Token** | `poa_` | Us, scoped per supplier | Every other endpoint |

A supplier integrating directly (not via a partner) instead receives a single access token from Puro support, and self-service token generation is on the roadmap but not yet shipped.

### The delegation flow

**Step 1 — Supplier grants access (manual, in MyPuro).**
The supplier logs into the portal, goes to **Settings → API Access**, clicks **"+ Add Partner Access"**, fills the form, and receives a generated authorisation code. Puro are explicit that **the code is shown once and not shown again**, and the supplier must share it with us securely.

**Step 2 — We redeem it.**

```bash
curl -X POST "https://api.portal.puro.earth/v0/partners/auth/access-tokens" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PARTNER_CLIENT_SECRET" \
  -d '{ "authorizationCode": "auth_code_from_supplier" }'
```

Response:

```json
{ "accessToken": "poa_abc123xyz..." }
```

**The access token is also shown only once.** Lose it and the supplier must generate a fresh authorisation code.

### Constraints to design around

- **Authorization codes expire after 3 days** if unredeemed. Our onboarding UX must therefore be a tight loop: we must not ask a supplier to generate a code and then sit on it. Build an in-product "paste your Puro authorisation code" step that redeems immediately and reports success/failure synchronously.
- **Revocation is immediate and silent from our side.** If the supplier revokes access, the token stops working at once. If they change which facilities we can see, facilities simply appear or disappear from `GET /v0/facilities` responses. There is no notification. **We must treat facility list drift as a first-class event** and surface it, not silently reconcile it away.
- **No documented refresh mechanism and no documented expiry** for `poa_` tokens. ⚠ Verify. Plan for rotation anyway.
- **Token scope is per-supplier-organisation.** Multi-tenant storage: one `poa_` per supplier org, encrypted at rest, never logged.

### Credential smoke test

Puro document a neat trick: POST to the access-tokens endpoint with **no body**. A valid Partner Client Secret returns **400**; an invalid one returns **401**. Use this as a health check for our stored `pcs_` without burning an authorisation code.

### First authenticated call

```bash
curl -X GET "https://api.portal.puro.earth/v0/facilities" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $PARTNER_ACCESS_TOKEN"
```

```json
{
  "data": [
    {
      "id": "01283643-c947-7c8d-be81-b650b219a369",
      "label": "Supplier Facility 1",
      "description": null,
      "organizationId": "7d79e878-ab16-406d-89b7-20b868376740"
    }
  ],
  "pageInfo": {
    "startCursor": "01283643-c947-7c8d-be81-b650b219a369",
    "endCursor": "01283643-c947-7c8d-be81-b650b219a369",
    "hasPreviousPage": false,
    "hasNextPage": false
  }
}
```

Note the envelope: `{ data: [], pageInfo: { startCursor, endCursor, hasPreviousPage, hasNextPage } }`. **Cursor-based pagination.** ⚠ The query parameter names (`after`/`before`/`first`/`last`?) are not documented in the guides — pull them from the OpenAPI spec.

Empty list = the supplier hasn't granted facility-level access. That's a supplier-side fix, and our error copy should say so explicitly rather than showing a generic "no data".

## 2.3 Domain model

This is the heart of it. Puro's model is a **compliance-requirements graph**, not a measurement graph.

```
Organization (Supplier)
└── Facility
    └── Monitoring Period          (start/end dates; the audit unit of time)
        ├── Framework Instance  ──▶ Framework      (Preliminary Assessment | Facility | Output)
        ├── Document Instance   ──▶ Document       (a compliance requirement)
        │   ├── Expected Field                     (NUMERIC | TEXT | DATE | BOOLEAN | AGGREGATE_REF)
        │   └── Evidence Request                   (STANDARD | BATCH)
        │       ├── Evidence (file)  ──▶ Evidence Template (CSV column schema)
        │       └── Expected Field Value           (optionally per batchItemId)
        ├── Batch                                  (a quantifiable unit of carbon removal)
        └── Model                ──▶ Model Template (LCA & CORC Report)
            └── Section
                ├── Formula                        (references Fields/Formulas)
                └── Field Library
                    └── Field                      (references Expected Fields)

Facility ──▶ Audit Package  (subjects: FRAMEWORK_INSTANCE | MODEL)
             └── Audit  (IN_PROGRESS | APPROVED | REJECTED)
                 └── Audit Report
```

### The "template vs instance" pattern

Puro consistently separate a **global catalogue object** from a **per-monitoring-period instantiation**:

| Catalogue (global, read-only) | Instance (per monitoring period, ours) |
|---|---|
| Framework | Framework Instance |
| Document | Document Instance |
| Model Template | Model |
| Evidence Template | *(referenced by Evidence at upload)* |

Catalogue objects are Puro's; we `GET` them and pick IDs. Instances are ours; we create, patch and delete them. **Our persistence layer should mirror this split** — cache the catalogue with a TTL, own the instances.

### Object definitions

| Object | Definition |
|---|---|
| **Facility** | A physical or operational location where environmental activities occur. |
| **Monitoring Period** | A time frame within a facility during which CDR activities are tracked and reported. Has start date, end date, facility, optional description. |
| **Framework** | A structured list of requirements a project must meet to demonstrate compliance with a Puro methodology. Defines what evidence and documentation must be submitted. |
| **Document** | A compliance requirement defining what evidence must be submitted. Documents are the foundational building block and are **mapped across frameworks, independent of facilities or monitoring periods**. |
| **Model** | Performs project-level calculations referencing Expected Field Values within a framework. Carries the LCA and system boundary. |
| **Expected Field** | A defined data input within a Document Instance that can be referenced in a Model. |
| **Expected Field Value** | The actual submitted value for an Expected Field, optionally scoped to a batch. |
| **Evidence Request** | A request for specific data for a given collection period within a Document Instance. Defines whether collection is one-time or per-batch, plus due dates and status. |
| **Evidence** | An uploaded file attached to an Evidence Request, optionally validated against an Evidence Template. |
| **Batch** | A quantifiable unit of carbon removal with a unique identifier, linked to specific sequestration metrics. |
| **Audit Package** | The final bundle of frameworks and models submitted for review by Puro and the VVB. |

### A critical subtlety: Preliminary Assessment ↔ Facility Audit document sharing

Puro state that Preliminary Assessments **share the same Documents** as Facility Audits, and that documents are mapped between them — so completing a document for the Preliminary Assessment automatically applies it to the Facility Audit *if they are in the same Monitoring Period*.

But they also warn: **always submit the correct Framework type in the Audit Package**, even though documents are shared.

Implication for us: the Preliminary Assessment is genuinely a cheap dry run — data entered there is reusable — but the *audit package* is where the framework type matters, and getting it wrong is a submission-level error. Our submission builder must select framework instances explicitly and never infer them.

## 2.4 Workflow A — Bootstrapping access

```
1. Puro issues us a Partner Client Secret (pcs_)        [one-time, manual, per-partner]
2. Supplier generates an authorization code in MyPuro    [manual, per-supplier, 3-day TTL]
3. We POST /v0/partners/auth/access-tokens               [→ poa_ token, shown once]
4. We GET /v0/facilities                                 [confirm scope]
5. We cache the facility list and begin drift monitoring
```

**Design notes.**
- Step 1 is a business relationship, not code. Start it now — it gates everything.
- Step 2–3 must be a single uninterrupted user flow. Do not persist an unredeemed code.
- Store the `poa_` token against `(our_tenant_id, puro_organization_id)`.
- Re-run step 4 on a schedule (hourly is plenty) and diff. Facility appearing/disappearing = access grant changed = notify.

## 2.5 Workflow B — Setting up a Monitoring Period

Puro's recommended path for a new facility:

```
Preliminary Assessment monitoring period
        │  (data is reusable downstream)
        ▼
Combined Facility + Output Audit monitoring period
        │
        ▼
Subsequent Output Audit monitoring periods (recurring)
```

### B.1 Create the monitoring period

```bash
curl -X POST "$BASE/v0/monitoring-periods" \
  -H "Authorization: Bearer $POA" -H "Content-Type: application/json" \
  -d '{
    "facilityId": "facility-uuid",
    "startDate": "2026-01-01T00:00:00Z",
    "endDate":   "2026-01-31T23:59:59Z",
    "description": "2026 January Monitoring Period"
  }'
```

Schema: `id`, `description` (nullable), `startDate`, `endDate` (both `date-time`), `facilityId`.

Other verbs: `GET /v0/monitoring-periods`, `GET /v0/monitoring-periods/{id}`, `PATCH /v0/monitoring-periods/{id}`, `DELETE /v0/monitoring-periods/{id}`.

> **Delete cascades.** Deleting a monitoring period also deletes its frameworks, documents, evidence requests and field values, irreversibly.

### B.2 Apply frameworks

List the catalogue: `GET /v0/frameworks` → `{ id, label, description }`. Detail: `GET /v0/frameworks/{id}`.

Instantiate:

```bash
curl -X POST "$BASE/v0/monitoring-periods/{id}/framework-instances" \
  -H "Authorization: Bearer $POA" -H "Content-Type: application/json" \
  -d '{ "frameworkId": "framework-uuid" }'
```

Which frameworks to apply:

| Audit type | Frameworks |
|---|---|
| Facility audit only | Facility Audit |
| Output audit only | Output Audit |
| **Combined Facility and Output Audit** | **Both** |
| Preliminary assessment | Preliminary Assessment |

Puro's guidance: **always use the latest version of each framework** unless the account manager says otherwise. Since `GET /v0/frameworks` returns only `id`/`label`/`description`, version selection is presumably encoded in the label. ⚠ Verify how framework versions are expressed and how we programmatically pick "latest".

Also: `GET /v0/framework-instances`, `GET /v0/framework-instances/{id}`, `DELETE /v0/framework-instances/{id}` (removes all associated requirements and evidence submissions).

### B.3 Apply the model

`GET /v0/model-templates` → `{ id, label, description }`.

```bash
curl -X POST "$BASE/v0/monitoring-periods/{id}/models" \
  -H "Authorization: Bearer $POA" -H "Content-Type: application/json" \
  -d '{ "label": null, "description": null, "templateId": "model-template-uuid" }'
```

> **`label` and `description` MUST be `null` when creating from a template.** Not omitted — explicitly null. This is a documented restriction and a likely source of confusing 4xx errors. You can rename afterwards with `PATCH /v0/models/{id}`.

Puro's instruction is unambiguous: **include the LCA & CORC Report model in every submission** unless told otherwise.

Also: `GET /v0/monitoring-periods/{id}/models`, `GET /v0/models/{id}`, `PATCH /v0/models/{id}`, `DELETE /v0/models/{id}` (cascades to sections, formulas, field libraries, fields).

### B.4 Instantiate documents

`GET /v0/documents` → `{ id, label, description }`. `GET /v0/documents/{id}` returns the full detail **including guidance and templates** — Puro explicitly tell integrators to read this guidance carefully and refer back to the methodology when in doubt.

```bash
curl -X POST "$BASE/v0/document-instances" \
  -H "Authorization: Bearer $POA" -H "Content-Type: application/json" \
  -d '{ "documentId": "document-uuid", "monitoringPeriodId": "mp-uuid" }'
```

Also: `GET /v0/document-instances`, `GET /v0/document-instances/{id}`.

> **Document pinning is not supported via the API.** In the MyPuro UI, a pinned facility-level document can pull in evidence requests from a different document instance. We cannot do this programmatically. If a supplier uses pinning in the UI, our view of their data will be incomplete.

### B.5 Define expected fields

```bash
curl -X POST "$BASE/v0/expected-fields" \
  -H "Authorization: Bearer $POA" -H "Content-Type: application/json" \
  -d '{
    "type": "NUMERIC",
    "documentInstanceId": "di-uuid",
    "label": "Total Production Weight",
    "unit": "kg",
    "minValue": "0",
    "maxValue": "1000000"
  }'
```

| Type | Extra attributes |
|---|---|
| `NUMERIC` | `unit`, `minValue`, `maxValue` (**strings, not numbers**) |
| `TEXT` | — |
| `DATE` | `minDate`, `maxDate` (ISO 8601) |
| `BOOLEAN` | — |
| `AGGREGATE_REF` | Aggregated calculation (SUM, AVG) over evidence template columns |

Response schema: `type` (default `NUMERIC`), `unit`, `minValue`, `maxValue`, `id`, `documentInstanceId`, `label`.

> **On `PATCH /v0/expected-fields/{id}` you must include `type`, matching the original type.** Same rule applies to patching expected field *values*. Our client should always send type on update — treat it as part of the identity, not an optional field.

Numeric bounds are strings. Round-trip them as strings; do not parse to float and re-serialise, or you will introduce precision drift on values like `0.000001`.

Also: `GET /v0/expected-fields`, `GET /v0/expected-fields/{id}`, `DELETE /v0/expected-fields/{id}`.

### B.6 Evidence templates (CSV schemas)

`GET /v0/evidence-templates` → `{ id, label, columns[] }` where columns are a union of `NumericEvidenceTemplateColumn`, `TextEvidenceTemplateColumn`, `DateEvidenceTemplateColumn`. `GET /v0/evidence-templates/{id}` for detail.

Each column carries `id`, `label`, `type`, `required`. Puro note this is geared toward UI/Excel workflows but usable programmatically. For us, evidence templates are how we make CSV exports from our own data land cleanly — **we should generate CSVs from the fetched template schema rather than hard-coding column orders.**

### B.7 Duplicating instead of rebuilding

```bash
curl -X POST "$BASE/v0/monitoring-periods/{id}/duplicate" \
  -H "Authorization: Bearer $POA" -H "Content-Type: application/json" \
  -d '{
    "targetFacilityId": "facility-uuid",
    "startDate": "2026-02-01T00:00:00Z",
    "endDate":   "2026-02-28T23:59:59Z"
  }'
```

This copies frameworks, documents, models and their customisations into a new period. Puro present this as a genuine architectural fork:

> **Option 1 — Configure once, then duplicate.** Set up one period perfectly, duplicate it each cycle, then only submit values. Fewer API calls, less drift risk, but the configuration is a black box we didn't author programmatically.
>
> **Option 2 — Programmatically recreate customisations each period.** Deterministic, reproducible from our own source of truth, fully diffable. More calls, more code, more exposure to Puro-side schema changes.

**Recommendation: Option 2, with duplicate as a fallback.** Rationale in §4.3.

## 2.6 Workflow C — Model customisation

This is where a Puro integration differs most sharply from Isometric, and where most of our engineering effort will go.

In Isometric, the carbon accounting shape is largely given: you pick a protocol, the LCA builder gives you a template with component groups, and you populate components from blueprints. In Puro, **you construct the calculation graph yourself** via a small expression language.

### C.1 Hierarchy

```
Model
└── Section          "top level; defines how the Model is organized"
    ├── Formula      references other Fields and/or Formulas
    └── Field Library
        └── Field    references Expected Fields, can calculate
```

Typical sections Puro cite:
- **CORCs Equation** — total net CO₂ removed over the monitoring period
- **C_Stored** — gross carbon stored, calculated **at batch level**
- **E_Production** — operational lifecycle emissions during the period

### C.2 Endpoints

| Verb | Path | Body |
|---|---|---|
| POST | `/v0/models/{id}/sections` | `{ label, description }` |
| GET | `/v0/models/{id}/sections` | → `{ id, label, description }` |
| GET/PATCH/DELETE | `/v0/model-sections/{id}` | |
| POST | `/v0/model-sections/{id}/field-libraries` | `{ label, description }` |
| GET | `/v0/model-sections/{id}/field-libraries` | → `{ id, label, description, sectionId }` |
| DELETE | `/v0/field-libraries/{id}` | cascades to fields |
| POST/GET | `/v0/field-libraries/{id}/fields` | |
| GET/PATCH/DELETE | `/v0/fields/{id}` | |
| GET | `/v0/fields/{id}/values` | computed value(s) |
| POST/GET | `/v0/model-sections/{id}/formulas` | |
| GET/PATCH/DELETE | `/v0/formulas/{id}` | |
| GET | `/v0/formulas/{id}/values` | computed value(s) |

### C.3 The expression language

Every Field and Formula carries:

| Attribute | Meaning |
|---|---|
| `expression` | The mathematical expression, referencing variables by **escaped refId** |
| `variables[]` | The variable bindings |
| `emissionImpactType` | `"EMISSION"` \| `"SEQUESTRATION"` \| `null` |
| `label`, `description` | Human-readable |

**The escaping rule — get this exactly right:**

1. Take the variable's `refId` (a UUID).
2. Replace every dash `-` with an underscore `_`.
3. Prefix with a single underscore `_`.

```
refId:   307d545b-6b93-4df9-8b09-4290150efd60
escaped: _307d545b_6b93_4df9_8b09_4290150efd60
```

Example:

```json
{
  "label": "Emission Factor Calculation",
  "expression": "_307d545b_6b93_4df9_8b09_4290150efd60 * _451e2f3c_0c8e_4d2a_9f4b_123456789abc * 100",
  "emissionImpactType": "EMISSION",
  "variables": [
    { "refId": "307d545b-6b93-4df9-8b09-4290150efd60", "type": "FIELD_OR_FORMULA" },
    { "refId": "451e2f3c-0c8e-4d2a-9f4b-123456789abc", "type": "FIELD_OR_FORMULA" }
  ]
}
```

**Write a single `escapeRefId()` helper and an `buildExpression()` builder. Never string-concatenate expressions by hand anywhere else in the codebase.** A one-character escaping bug here produces a silently wrong LCA, which is the worst possible failure class in this domain.

### C.4 Variable types

| Type | Used in | Shape |
|---|---|---|
| `EXPECTED_FIELD` | Fields | `{ type, refId, aggregateFn }` where `aggregateFn` ∈ `sum`, `mean` |
| `FIELD_OR_FORMULA` | Fields and Formulas | `{ type, refId }` |
| `MONITORING_PERIOD_START_DATE` | Both | `{ type, refId: <monitoring-period-uuid> }` |
| `MONITORING_PERIOD_END_DATE` | Both | `{ type, refId: <monitoring-period-uuid> }` |

`emissionImpactType` should be set **only on direct emissions or sequestrations**, not on intermediary calculations. Getting this wrong won't throw an error — it will double-count or omit a flux. This needs a validation pass in our model builder.

### C.5 Build order

Puro describe the construction as strictly bottom-up:

```
Expected Fields  (must exist first)
      ▼
Fields           (bind to Expected Fields via EXPECTED_FIELD variables)
      ▼
Formulas         (compose Fields and other Formulas)
```

And their explicit prerequisite: **create documents and set up Expected Values before configuring the model.** Evidence itself doesn't need to be uploaded yet — creating the documents early lets the model update dynamically as data arrives.

So the full dependency chain is:

```
Monitoring Period → Framework Instances → Document Instances → Expected Fields
                 → Model → Sections → Field Libraries → Fields → Formulas
                 → Evidence Requests → Batches → Evidence + Values
                 → Audit Package
```

Our orchestrator must respect this ordering and be resumable at every step.

### C.6 Common patterns

```
Simple multiplication:   "_quantity * _factor"
Sum with conversion:     "(_value_a + _value_b) * 0.001"
Percentage:              "(_numerator / _denominator) * 100"
Conditional logic:       build separate fields per condition, combine in a formula
```

⚠ **The expression grammar is not formally documented.** We know `+ - * / ( )` and numeric literals work. Unknown: operator precedence guarantees, unary minus, exponentiation, `min`/`max`, division-by-zero behaviour, floating point precision and rounding. **Ask Puro for the grammar.** Until then, keep expressions simple and push complexity into extra Fields rather than clever single expressions.

### C.7 Carried-forward emissions

A real pattern Puro document: emissions from batches produced in an earlier monitoring period but *used* in the current one.

```json
{
  "label": "Carried Forward Production Emissions",
  "description": "Emissions from previous period batches used in current period",
  "expression": "_prev_emissions * _fraction_used",
  "emissionImpactType": "EMISSION",
  "variables": [
    { "type": "EXPECTED_FIELD", "refId": "previous-period-emissions-uuid", "aggregateFn": "sum" },
    { "type": "EXPECTED_FIELD", "refId": "fraction-material-used-uuid" }
  ]
}
```

These values are applied proportionally, multiplied by the fraction of material produced in the originating period that is used in the current one.

**This implies cross-period state that our platform must own.** Puro does not appear to carry it forward automatically — we must compute the previous period's per-batch emissions and the fraction used, and inject them as Expected Field Values in the current period. This is a genuine data-modelling requirement, not a detail.

## 2.7 Batch accounting — the mechanism that makes Puro work

Batches are the reason Puro's model is more complex than a naïve period total, and understanding them is essential.

### Why batch-level

Puro's reasoning:
- Summing or averaging metrics across batches over a monitoring period produces inaccurate results.
- Not all batches produced in a period are necessarily applied in that period.
- Total production emissions should be reduced by the percentage of material that remains ineligible.
- Ineligible batches must be excluded from the carbon stored formula.

### The two fractions

When a document is configured as a **Batch Request** and referenced in a model, Puro create **Batch Fields** and **Batch Formulas**. Two fractions are tracked per batch:

**1. Fraction of material produced *and applied* per batch**

```
(Date Produced >= Monitoring Period Start)
AND (Date Applied <= Monitoring Period End)
AND (Weight by Batch / sum(Weight by Batch))
```
- **Can be less than 1** — not all produced material is necessarily applied.
- Multiplied into emissions related to batch production and material sourcing.

**2. Fraction of total material *applied* per batch**

```
(Date Applied >= Monitoring Period Start)
AND (Date Applied <= Monitoring Period End)
AND (Weight by Batch / sum(Weight by Batch))
```
- **Always sums to 1** across all batches.
- Multiplied into all other steps in the formula.

This is the mechanism that keeps production-side emissions and application-side accounting from double-counting across period boundaries. Our data model needs `dateProduced`, `dateApplied` and `weight` per batch as first-class, non-nullable fields for any batch-based methodology.

### Batch endpoints

```bash
# Create (returns the batch ID)
POST /v0/monitoring-periods/{id}/batches        # ⚠ documented with NO request body

# List batches available to an evidence request
GET  /v0/evidence-requests/{id}/batch-items     # → { id, type: "BATCH"|"GROUP", label }

# Delete
DELETE /v0/batches/{id}
```

⚠ **Two open questions here.**
1. `POST .../batches` is documented with no body, yet `batch-items` responses carry a `label`. **How is a batch labelled or correlated to our internal batch identifier?** If we cannot set a label, we must maintain our own `(our_batch_id → puro_batch_id)` mapping table — which we should do regardless, but we need to know whether human auditors will see meaningful batch names.
2. `batch-items` returns `type: "BATCH" | "GROUP"`. **`GROUP` is undocumented.** Ask what it is and when it appears.

Deleting a batch affects all evidence and field values associated with it **across all documents in the monitoring period**.

## 2.8 Workflow D — Submitting data

### D.1 Evidence Requests

An Evidence Request is a request for specific data for a collection period within a Document Instance. It determines whether collection is one-time or per-batch, and tracks due dates and status.

```bash
POST /v0/evidence-requests
{
  "type": "STANDARD",                              # or "BATCH"
  "documentInstanceId": "di-uuid",
  "dueDate":             "2026-12-31T23:59:59Z",
  "collectionStartDate": "2026-01-01T00:00:00Z",
  "collectionEndDate":   "2026-12-31T23:59:59Z"
}
```

Only `documentInstanceId` is required. `type` defaults to `STANDARD`.

| Type | Behaviour |
|---|---|
| `STANDARD` | Individual file uploads or field value submissions |
| `BATCH` | Evidence and values organised by `batchItemId` |

**Statuses:**

| Status | Meaning |
|---|---|
| `PENDING` | Initial state; collection in progress |
| `READY_FOR_REVIEW` | Submitted and ready for review |
| `APPROVED` | Reviewed and approved |
| `SKIPPED` | Intentionally skipped, with a reason |

> **These statuses are internal tracking only and are not visible to the Reviewer or Auditor.** They're a workflow aid for us and the supplier, not a signal to Puro. Don't build supplier-facing copy implying an auditor sees them.

Skipping:

```bash
PATCH /v0/evidence-requests/{id}
{ "status": "SKIPPED", "reasonSkipped": "Not applicable for this monitoring period" }
```

Puro are firm: **always supply `reasonSkipped`**, so auditors understand why evidence is absent. Make it a required field in our UI, not an optional one.

Also: `GET /v0/evidence-requests`, `GET /v0/evidence-requests/{id}`, `DELETE` (removes all associated evidence files and values).

Response schema: `type`, `status`, `id`, `dueDate`, `collectionStartDate`, `collectionEndDate`, `reasonSkipped`.

### D.2 Uploading evidence files

```
POST /v0/evidence-requests/{id}/evidence
```

Parameters: `file` (required), `evidenceTemplateId` (optional — supply it if the file follows a template structure).

Response: `id`, `evidenceRequestId`, `evidenceTemplateId`, `validationErrors[]`.

> ⚠ **Documentation inconsistency.** The prose says evidence files are uploaded using **`multipart/form-data`**, but the curl examples show a JSON body with a `"file"` string. The examples are auto-generated and misleading. **Implement multipart/form-data**, confirm against the OpenAPI spec, and test the first upload manually.

**Validation.** If the file matches an evidence template, Puro validate the structure and return problems in `validationErrors`. This is a **200-with-errors** pattern, not a 4xx. Our client must inspect `validationErrors` on every successful upload and surface non-empty arrays as failures. Missing this is an easy way to think we've submitted clean data when we haven't.

**File naming.** Puro give explicit guidance and it is not cosmetic — a human auditor reads these filenames:

- ✅ `Puro Project Description [Facility Name].docx`
- ✅ `LCA_Report_FacilityA_2024.pdf`
- ✅ `Batch_Production_Data_Q4_2024.xlsx`
- ❌ `Puro Project Description.docx` (too generic)
- ❌ `document1.pdf` (unclear purpose)

Include facility name, document type/purpose, and time period where relevant; avoid special characters; keep the format consistent. **We should auto-generate filenames to a template rather than passing through whatever the supplier uploaded.** This is cheap to build and materially reduces audit friction.

### D.3 Submitting Expected Field Values

```bash
POST /v0/evidence-requests/{id}/values
{
  "type": "NUMERIC",
  "expectedFieldId": "ef-uuid",
  "value": "1250.5",
  "batchItemId": null          # or a batch UUID for BATCH-type requests
}
```

| Type | `value` format |
|---|---|
| `NUMERIC` | String, e.g. `"1250.5"` |
| `TEXT` | String |
| `DATE` | ISO 8601, e.g. `"2026-06-15T10:30:00Z"` |
| `BOOLEAN` | Native boolean `true` / `false` |

> **Note the asymmetry: numerics are strings, booleans are native JSON booleans.** Our serialiser must special-case this per type.

Also: `GET /v0/expected-field-values`, `GET /v0/expected-field-values/{id}`, `PATCH /v0/expected-field-values/{id}` (**must include `type`**), `DELETE /v0/expected-field-values/{id}`.

### D.4 Reading computed values back

```
GET /v0/fields/{id}/values
GET /v0/formulas/{id}/values
```

Returns either a single value (non-batch fields) or a **paginated list of values per batch** (batch fields).

**This is our verification hook and we should use it hard.** Before submitting an audit package, pull the computed values for the top-level CORC formula and compare against our own independently-calculated figure. A mismatch means our model construction is wrong, and catching it here — rather than in an auditor's revision request weeks later — is worth a great deal.

### D.5 Evidence export

```bash
POST /v0/evidence/export
{
  "merge": false,
  "evidenceTemplateIds": ["template-uuid"],
  "monitoringPeriodIds": ["mp-uuid"],
  "facilityIds": ["facility-uuid"],
  "evidenceRequestStatuses": []
}

GET /v0/evidence/export/{id}
# → { id, status: "PENDING"|"COMPLETED"|"FAILED", signedUrl }
```

All filters optional. `merge: true` combines evidence files sharing a template into one file. Asynchronous job — **poll `GET` until `COMPLETED`, then use `signedUrl`.** Useful for supplier-facing "download everything we submitted" and for our own audit trail snapshots.

## 2.9 Workflow E — Audit package submission and the review loop

### E.1 What happens after submission

Puro describe the downstream chain:

1. Puro.earth reviews for errors and inconsistencies.
2. If approved, it's forwarded to the appointed verification body.
3. The auditor reviews and may request revisions.
4. On approval, credits can be issued.

Note that Puro's own pre-review sits *before* the VVB. This is deliberate — it's the "Audit Preparation" stage of the certification journey, designed to raise first-time pass rates.

### E.2 Pre-submission consistency check

Puro publish a checklist and it is genuinely worth encoding as automated or semi-automated gates in our platform:

**Cross-document consistency**
- Are financial additionality assumptions aligned with LCA assumptions?
- Do facility design documents match feedstock details in the LCA model?
- Is the monitoring plan consistent with the LCA model?
- Is the project description aligned with all documentation?
- Have supporting files been uploaded to explain deviations or missing documents?

**File naming** — all files, especially templates, clearly and consistently renamed, reflecting facility name and purpose.

**Confidential information** — publicly published documents free of confidential content; files destined for the public Puro Registry free of sensitive or proprietary material.

**Completeness** — all required documents populated; all Expected Field Values submitted; all Evidence Requests either completed or properly skipped with reasons.

> **The confidentiality check deserves special attention.** Under the General Rules, audit statements, audit reports, registrations and project descriptions are **published publicly** in the registry on successful review. Suppliers may request redaction of confidential or personal information, subject to Puro approval. Our platform should flag documents heading for publication and require an explicit supplier confirmation, because an accidental disclosure of a proprietary process is irreversible and is our reputational problem too.

The completeness checks map directly onto API state and should be fully automated:

```
✓ every Document Instance has ≥1 Evidence Request
✓ every Evidence Request is APPROVED/READY_FOR_REVIEW, or SKIPPED with reasonSkipped
✓ every Expected Field has ≥1 Expected Field Value
✓ for BATCH requests: every (expectedField × batch) pair has a value
✓ every top-level Formula returns a non-null computed value
✓ computed CORC total matches our independent calculation within tolerance
```

### E.3 Creating the audit package

```bash
POST /v0/facilities/{id}/audit-packages
{
  "subjects": [
    { "id": "framework-instance-uuid", "type": "FRAMEWORK_INSTANCE" },
    { "id": "model-uuid",              "type": "MODEL" }
  ]
}
```

Subject types: `FRAMEWORK_INSTANCE`, `MODEL`.

> **Two automatic server-side behaviours to know about:**
> - **The auditor is selected automatically based on the package's subjects.** We have no influence and cannot predict the assignment.
> - **All acknowledgement fields for those subjects are set to `true` automatically.** We are not prompted to attest — submission *is* the attestation. Given that the General Rules require an individual with legal signing authority at the supplier to attest to accuracy, **our platform must capture that human attestation before we call this endpoint.** A dMRV partner clicking submit on a supplier's behalf without recorded sign-off is a compliance gap. Design a mandatory, logged supplier confirmation step.

Retrieval: `GET /v0/audit-packages`, `GET /v0/audit-packages/{id}`.

Response schema: `primaryAuditorOrganization` (object), `secondaryAuditorOrganizations` (array or null), `id`, `facilityId`, `startDate`, `endDate`, `audits[]`, `fields[]` (AuditPackageField), `createdAt`.

### E.4 Monitoring the review

**Audit statuses:** `IN_PROGRESS`, `APPROVED`, `REJECTED`.

> ⚠ **There is no webhook.** Puro say suppliers receive *in-platform* notifications for comments and revision requests, and advise checking the portal regularly. That means:
> - We must **poll** `GET /v0/audit-packages/{id}` and inspect `audits[].status`.
> - **Auditor comments and revision requests do not appear to be exposed via the API at all.** They live in MyPuro. This is a significant functional gap — our platform cannot be the supplier's single pane of glass during review. Be honest about this in the product: during the review phase, the supplier must check MyPuro.
> - Ask Puro whether comments are on the roadmap for API exposure. This is the highest-value missing capability.

Suggested polling: every 15–30 minutes during an active audit, with backoff. Persist status transitions so we can show a timeline even though we can't show comment text.

### E.5 Responding to feedback

Puro's guidance: review comments, make changes (corrected files, updated field values, adjusted model calculations), document what changed, and **resubmit if required — which may mean creating a new audit package.**

> **Immutability.** Once the auditor approves or fails a framework or model, **the full framework or model is snapshotted and no further edits are allowed.**
>
> Our local objects must carry a `locked` flag mirroring this. Attempting an edit post-approval should fail in our UI with a clear explanation, not bubble up a Puro 4xx.

### E.6 Audit exports and reports

```bash
POST /v0/audits/{id}/export          # async; currently Framework Audits only
GET  /v0/audits/export/{id}          # → { id, status, signedUrl }

GET  /v0/audit-reports
GET  /v0/audit-reports/{id}
```

Audit report schema: `id`, `packageId`, `publishedAt`, `publishedBy`, `confirmations[]` (AuditReportConfirmation), `files[]`, `fields[]` (AuditReportField).

**Final outcome.** The auditor submits a **Verification Outcome Report**, available from the Audits tab in the facility. It contains the final approve/reject outcome, the number of credits issued (if any), and the auditor's findings and recommendations.

⚠ Verify whether the Verification Outcome Report is retrievable via `GET /v0/audit-reports/{id}` or is portal-only.

### E.7 What the API does *not* cover

To be explicit, because it shapes scope:

- **CORC issuance.** Not in dMRV Connect. Issuance is a registry transaction performed by Puro after a successful Output Review.
- **Transfers, retirements, withdrawals.** These belong to **Registry Connect**, a separate API.
- **Account/organisation management, facility registration, KYC.** MyPuro portal, with some coverage in the **mypuro API**.
- **Auditor comments and revision request text.** Portal only.

If our product promises "end-to-end from measurement to retired credit," we will need **Registry Connect** in addition to dMRV Connect. Scope that separately.


---

# Part 3 — Puro vs Isometric: mapping and incompatibilities

## 3.1 Why a naïve adapter will fail

The temptation is to treat "registry" as an interface with `submitRemoval()` and write two implementations. That will not survive contact with Puro, because the two registries disagree about **what the fundamental submitted object is**.

- **Isometric:** the unit is a **GHG entry** — a series of activities resulting in CO₂e removed or reduced. Entries are structured by a **template defined in your LCA**, divided into component groups, populated with **components** built from **blueprints**, which consume **datapoints**, which reference **sources**. A **GHG statement** bundles removals and is submitted for verification. Uncertainty discounting happens at the GHG entry level and the API returns CO₂e both with and without discounting.
- **Puro:** the unit is an **audit package** — a bundle of framework instances and models, backed by document instances, evidence requests, evidence files and expected field values, with the LCA expressed as a hand-built **expression graph** of sections, field libraries, fields and formulas.

Isometric hands you a carbon-accounting framework and asks you to fill it. Puro hands you a spreadsheet engine and an evidence filing cabinet, and asks you to build the framework.

## 3.2 Concept mapping

| Concept | Isometric | Puro.earth | Compatible? |
|---|---|---|---|
| Standard body | Isometric | Puro.earth Oy (Issuing Body) | — |
| Rule set | Isometric Standard + Protocol | Puro Standard General Rules + Methodology | Conceptually yes |
| Versioned rules | Protocol versioning (major/minor/patch) | Methodology editions + General Rules versions | Different semantics |
| Project | **Project** | **Facility** (+ its Crediting Period) | Close, but Puro's is a physical facility |
| Site / geography | Sites, project assets, GeoJSON | Facility location only | ⚠ **Puro dMRV has no geospatial model** |
| Reporting window | GHG statement period | **Monitoring Period** | Close |
| Carbon accounting unit | **GHG entry** | Rows in a **Model** (Fields/Formulas) | ✗ Structurally different |
| Calculation template | **Component blueprint** (Isometric-authored equations) | **Model Template** + hand-built expressions | ✗ Puro requires us to author the maths |
| Calculation node | **Component** (blueprint + datapoint inputs) | **Field** / **Formula** | Partial |
| Input value | **Datapoint** (value + std dev + source ref) | **Expected Field Value** | Partial — see §3.3 |
| Evidence | **Source** (document backing a datapoint) | **Evidence** (file on an Evidence Request) | Close |
| Evidence schema | — | **Evidence Template** (CSV columns) | Puro-only |
| Compliance checklist | PDD requirements checklist | **Framework** + **Documents** | Puro's is a first-class API object |
| Production unit | Production batch, feedstock batch | **Batch** | Close in spirit |
| Uncertainty | Variance propagation from datapoint std devs, discounting at entry level | Methodology-level, not in the dMRV model surface | ✗ **Major divergence** |
| Submission for verification | `POST /ghg_statements/{id}/submit` | `POST /facilities/{id}/audit-packages` | Analogous |
| Verifier assignment | VVB selected via Isometric RFP; supplier introduced | Auditor auto-assigned by Puro from package subjects | ✗ Opaque in Puro |
| Public comment | 10-day public comment on PDD | Public publication of audit reports post-review | Different stage, different mechanism |
| Issuance | Registry API: issuances, credit batches | Not in dMRV Connect; Registry Connect | Separate API |
| Credit | Credit / credit batch | **CORC** (CORC100+/200+/1000+) | Both 1 tCO₂e-denominated |
| Retirement/transfer | Registry API | Registry Connect | Separate API |
| External ID hook | **Supplier Reference ID** | ⚠ none documented | ✗ **See §3.4** |
| Auth | Client secret → JWT access token | `pcs_` → auth code → `poa_` token | Both OAuth-ish |
| Sandbox | Available | **Not available** | ✗ |
| Machine-readable protocol | Blueprints, templates via API | Frameworks/documents via API | Both good |

## 3.3 The divergences that actually cost engineering time

### (a) Uncertainty has no home in Puro's dMRV model

Isometric's datapoints carry a standard deviation and feed a variance-propagation uncertainty analysis, with the final discounting applied at the GHG entry level. Puro's Expected Fields carry `minValue`/`maxValue` — **validation bounds, not statistical uncertainty**. The General Rules require conservative, methodology-specific uncertainty estimation, but the dMRV API exposes no field for it.

**What this means:** uncertainty deduction for Puro must be either (i) built into the expression graph ourselves as explicit discount fields, or (ii) handled by Puro at issuance. **This is a blocking question for the methodology team** — see §5. Our internal data model should keep uncertainty as a first-class attribute regardless, and the *adapter* decides how to express it per registry.

### (b) Puro has no geospatial model in dMRV Connect

Isometric has sites, project areas, measurement locations, GeoJSON/shapefile/raster/LiDAR standards, and FAIR principles for geospatial data. Puro's dMRV Connect has a facility with a label and an org ID. Any spatial data goes in as an **evidence file**.

**What this means:** all our geospatial richness collapses to attachments for Puro. Fine for biochar; potentially a real limitation for enhanced weathering or biomass storage. Our export pipeline needs a "flatten geospatial to evidence document" path.

### (c) Isometric's blueprints vs Puro's blank canvas

Isometric's blueprint library means the equations are the registry's responsibility and are consistent across suppliers. Puro requires us to construct fields and formulas — which is more flexible and far more dangerous. **We own the correctness of the LCA implementation for every Puro supplier.**

**Mitigation — and this is the single most important architectural recommendation in this document:** build a **versioned, reviewable, testable internal library of Puro model definitions per methodology**, expressed as declarative config, not code. Each definition is authored once by the methodology team, reviewed, unit-tested against known-good worked examples, version-pinned, and then *rendered* into API calls by our orchestrator. Never let per-supplier onboarding involve hand-writing expressions.

### (d) No supplier reference IDs

Isometric supports **Supplier Reference IDs** — externally defined IDs so we can query Isometric using our own identifiers. Puro has no documented equivalent.

**What this means:** we must own the full correspondence table ourselves:

```
(tenant_id, internal_entity_type, internal_id) ↔ (puro_org_id, puro_entity_type, puro_uuid)
```

Every single Puro object we create needs a row. Make this a core table with a unique constraint, not an afterthought bolted onto a sync job. Without it, a partially-failed orchestration run is unrecoverable and will create duplicates.

### (e) Cross-period state

Puro's carried-forward emissions pattern requires the previous period's per-batch figures. Nothing suggests Puro computes this for us. **Our platform is the system of record for cross-period batch continuity on Puro.** Isometric's amortisation of establishment and end-of-life emissions handles a related problem differently and internally.

### (f) Cadence mismatch

Isometric is built for **monthly** verification and issuance. Puro's default is **annual**, tiered up to 12× per year only for facilities above 60,000 CORCs/year, with Issuance Plus requiring at least 1,000 credits per audit. A supplier used to monthly Isometric issuance will find Puro's cadence slower unless they are large.

**Product implication:** do not present the two registries as interchangeable options with a toggle. They suit different supplier profiles. The UI should make cadence and cost consequences explicit at the point of choosing.

### (g) The double-registration prohibition

Puro's rules forbid simultaneous registration of the same CO₂ removal activity with another crediting programme, and require non-overlapping monitoring periods plus a deregistration document when transferring between programmes.

**This is the most serious compliance risk in a multi-registry platform.** If our product makes it easy to submit the same facility's data to both Isometric and Puro, we have built a double-counting machine. Required controls:

1. A hard constraint: one active registry certification per `(facility, period)`. Enforced in the database, not in application logic alone.
2. An explicit, logged "switching registries" workflow requiring the deregistration document.
3. Blocking — not warning — on attempted overlap.

## 3.4 Summary: which abstraction actually holds

Only these generalise cleanly across both registries:

- Supplier / organisation
- Facility or project
- Reporting period
- Batch / production unit
- Measurement value with provenance
- Evidence document
- A submission event
- A verification outcome
- A credit-denominated result in tCO₂e

Everything below that — the calculation graph, uncertainty, the compliance checklist, the geospatial model — is registry-specific and belongs behind the adapter, not in the shared core.

---

# Part 4 — Implementation design

## 4.1 Target architecture

```
┌────────────────────────────────────────────────────────────┐
│                     Our Platform Core                       │
│  Suppliers · Facilities · Periods · Batches · Measurements  │
│  Evidence · Calculated Results · Certification State         │
│     (registry-agnostic; single source of truth)              │
└──────────────────────────┬─────────────────────────────────┘
                           │  RegistryAdapter interface
        ┌──────────────────┴──────────────────┐
        ▼                                     ▼
┌──────────────────┐                ┌──────────────────────┐
│ Isometric        │                │ Puro Adapter          │
│ Adapter (built)  │                │ ┌──────────────────┐ │
│                  │                │ │ Auth manager     │ │
│                  │                │ │ Catalogue cache  │ │
│                  │                │ │ Model renderer   │ │
│                  │                │ │ Orchestrator     │ │
│                  │                │ │ ID map           │ │
│                  │                │ │ Poller           │ │
│                  │                │ └──────────────────┘ │
└──────────────────┘                └──────────────────────┘
```

### The adapter interface

Keep it coarse-grained and lifecycle-shaped. Fine-grained CRUD parity across two such different registries is a trap.

```
interface RegistryAdapter {
  // Access
  connectSupplier(credentials) -> Connection
  listFacilities(connection) -> Facility[]
  checkConnectionHealth(connection) -> Health

  // Configuration
  listAvailableMethodologies(connection) -> Methodology[]
  provisionReportingPeriod(facility, period, methodology, config) -> PeriodHandle
  //   Isometric: create project / GHG entry template
  //   Puro:      monitoring period + framework instances + model
  //              + document instances + expected fields + sections
  //              + field libraries + fields + formulas

  // Data
  submitBatches(periodHandle, batches[]) -> BatchHandle[]
  submitMeasurements(periodHandle, measurements[]) -> void
  submitEvidence(periodHandle, documents[]) -> EvidenceHandle[]

  // Verification
  validateReadiness(periodHandle) -> ReadinessReport
  fetchComputedResults(periodHandle) -> CalculatedResult
  submitForVerification(periodHandle, attestation) -> SubmissionHandle
  pollVerificationStatus(submissionHandle) -> VerificationStatus
  fetchOutcome(submissionHandle) -> Outcome
}
```

`provisionReportingPeriod` doing ~8 API calls for Puro and ~1 for Isometric is correct and expected. The asymmetry belongs inside the adapter.

## 4.2 Data model additions

New tables:

**`registry_connections`**
`id, tenant_id, registry (enum: isometric|puro), external_org_id, credential_ref (KMS/vault pointer), status, connected_at, last_health_check_at, last_health_status`

**`registry_object_map`** — the correspondence table; non-negotiable
`id, connection_id, internal_type, internal_id, registry, external_type, external_id, created_at, last_synced_at, locked (bool)`
Unique index on `(connection_id, internal_type, internal_id, external_type)` and on `(connection_id, registry, external_type, external_id)`.

**`puro_model_definitions`** — the versioned LCA library
`id, methodology_code, methodology_version, definition_version, definition (JSONB), status (draft|reviewed|active|deprecated), reviewed_by, reviewed_at`

**`registry_submissions`**
`id, connection_id, period_id, registry, external_submission_id, submitted_at, attested_by_user_id, attested_at, attestation_evidence, status, status_history (JSONB), outcome (JSONB)`

**`puro_catalogue_cache`**
`registry_object_type (framework|document|model_template|evidence_template), external_id, payload (JSONB), fetched_at, etag`

Extensions to existing tables:

- `facilities`: `puro_crediting_period_start`, `puro_crediting_period_end`, `puro_facility_audit_valid_until`, `puro_max_output_reports_per_year`
- `periods`: `registry_locked_at`, `registry_snapshot_ref`
- `batches`: `date_produced`, `date_applied`, `weight_kg` — **required for any Puro batch methodology**, and used to derive the two fractions

## 4.3 The Puro model renderer

The core of the Puro adapter. Turns a declarative definition into an ordered API call plan.

**Definition format (sketch):**

```yaml
methodology: C03202501            # Biochar 2025
definition_version: 3
documents:
  - catalogue_match: "Production Data"
    evidence_request: { type: BATCH }
    expected_fields:
      - key: batch_weight
        type: NUMERIC
        label: "Batch Weight"
        unit: kg
        min: "0"
        max: "1000000"
      - key: date_produced
        type: DATE
        label: "Date Produced"
model:
  template_match: "LCA & CORC Report"
  sections:
    - key: c_stored
      label: "C_Stored"
      field_libraries:
        - key: production
          label: "Production Data"
          fields:
            - key: total_weight
              label: "Total Batch Weight"
              expression: "{{batch_weight}}"
              variables:
                - { type: EXPECTED_FIELD, ref: batch_weight, aggregateFn: sum }
      formulas:
        - key: c_stored_total
          label: "Total Carbon Stored"
          expression: "{{total_weight}} * {{carbon_fraction}} * 3.664"
          emissionImpactType: SEQUESTRATION
          variables:
            - { type: FIELD_OR_FORMULA, ref: total_weight }
            - { type: FIELD_OR_FORMULA, ref: carbon_fraction }
```

**Renderer responsibilities:**

1. Resolve `catalogue_match` / `template_match` against the live catalogue by label. ⚠ Label matching is brittle; ask Puro for stable codes.
2. Topologically sort the dependency graph and reject cycles at authoring time.
3. Create objects bottom-up, recording every returned UUID in `registry_object_map`.
4. Substitute `{{key}}` placeholders with escaped refIds **only after** the referenced object exists and its UUID is known.
5. Emit the ordered call plan; execute idempotently.

**Why this over `POST /monitoring-periods/{id}/duplicate`:** duplication is fewer calls, but the resulting configuration is opaque, undiffable and unversioned. When a methodology is revised — and Puro revise methodologies — we would have to reconstruct by hand in the UI. With a declarative definition we bump `definition_version`, review the diff, and re-render. The extra calls are a small price.

Keep `duplicate` implemented as a fallback for periods whose configuration originated in MyPuro rather than from us.

## 4.4 Orchestration and idempotency

Puro document no idempotency keys, so we build our own.

**Pattern: durable, resumable job with pre-flight lookup.**

```
for each step in ordered_plan:
    existing = registry_object_map.lookup(connection, step.internal_key)
    if existing:
        continue                      # already created
    response = puro.create(step.payload)
    registry_object_map.insert(step.internal_key, response.id)   # same txn as job state
```

Rules:
- One job per `(connection, period)`, serialised. No concurrent provisioning of the same period.
- Write the ID map row in the same transaction as the job checkpoint.
- Retries are safe because of the pre-flight lookup.
- On unrecoverable failure, **do not auto-rollback with DELETE.** Deletes cascade destructively. Surface a manual remediation task.

**Rate limiting.** Undocumented. Default to a conservative token bucket (start at ~5 req/s, per connection), exponential backoff with jitter on 429/5xx, and a circuit breaker. Ask Puro for the real limits.

## 4.5 State machine

```
NOT_CONNECTED
  └─▶ CONNECTED                      (poa_ token held, facilities visible)
        └─▶ PERIOD_PROVISIONING      (renderer running)
              ├─▶ PROVISION_FAILED   (manual remediation)
              └─▶ PERIOD_READY       (config complete, awaiting data)
                    └─▶ COLLECTING   (batches, values, evidence flowing)
                          └─▶ VALIDATING        (readiness checks)
                                ├─▶ VALIDATION_FAILED
                                └─▶ AWAITING_ATTESTATION
                                      └─▶ SUBMITTED           (audit package created)
                                            ├─▶ IN_REVIEW     (audits IN_PROGRESS)
                                            │     ├─▶ REVISION_REQUIRED  (portal-detected)
                                            │     └─▶ APPROVED  → LOCKED (snapshotted)
                                            └─▶ REJECTED
```

`REVISION_REQUIRED` is dashed in reality: **we cannot detect it from the API**, only a status change or the supplier telling us. Model it, but expect it to be entered manually or by the supplier.

## 4.6 Deadline and compliance monitoring

Given the severity of the 12/18-month rules, this is a P0 subsystem.

| Monitor | Trigger | Action |
|---|---|---|
| Output report due | 90 / 60 / 30 / 14 / 7 days before the 12-month deadline | Escalating notification to supplier + our CS |
| Suspension risk | 12-month deadline passed | Critical alert |
| Deregistration risk | 15 months elapsed | Critical alert + CS intervention |
| Facility audit expiry | 12 / 6 / 3 months before the 5-year validity ends | Renewal planning |
| Crediting period end | 12 months before | Renewal or new facility audit |
| Issuance frequency | On period creation | Block if it exceeds the volume-tiered allowance |
| Double registration | On any period creation | Block if the facility has an overlapping active period on another registry |
| Reversal notification | On reversal-indicative data ingest | 5-day clock, escalate hard |
| Access drift | Hourly facility-list diff | Notify on appearance/disappearance |

## 4.7 Phasing

| Phase | Scope | Exit criteria |
|---|---|---|
| **0 — Discovery** *(2–3 wks, starts now)* | Obtain `pcs_`; download the OpenAPI spec; generate a client; resolve the sandbox question; get §5 answers from Puro; pick one pilot supplier and one methodology (**recommend Biochar 2025 / `C03202501`** — fullest framework coverage, 0% complexity premium) | Written answers from Puro; spec in the repo; sandbox resolved |
| **1 — Read-only** *(2 wks)* | Auth flow, catalogue sync, `GET /facilities`, cursor pagination, health checks, ID map schema | We can connect a real supplier and list their facilities in our UI |
| **2 — Provisioning** *(4–5 wks)* | Model definition format, renderer, orchestrator, idempotency; provision a full Preliminary Assessment period end-to-end | A Preliminary Assessment period provisioned entirely by API, verified in MyPuro |
| **3 — Data submission** *(4 wks)* | Batches, expected field values, multipart evidence upload, `validationErrors` handling, readiness checks, computed-value cross-check | Computed CORC total from `GET /formulas/{id}/values` matches our independent figure |
| **4 — Submission & review** *(3 wks)* | Attestation capture, audit package creation, polling, status timeline, locking | One real combined Facility + Output audit package submitted and tracked to outcome |
| **5 — Hardening** *(3 wks)* | Deadline monitoring, double-registration guard, access-drift alerting, evidence export, runbooks | Compliance monitors live and alerting |
| **6 — Scale** *(ongoing)* | Additional methodologies; **Registry Connect** for issuance/retirement | — |

**Rough total to first real submission: ~16–18 weeks**, assuming Phase 0 answers arrive promptly and the sandbox question resolves favourably. Add 3–4 weeks if we must build entirely against a mock.

## 4.8 Testing without a sandbox

1. **Contract tests against a mock** generated from the OpenAPI spec (Prism or equivalent). Covers shape, not semantics.
2. **Golden-file tests on the renderer.** Given definition X, assert the exact ordered call plan. This is where most correctness lives and it needs no network.
3. **Expression unit tests.** `escapeRefId` and `buildExpression` get exhaustive property-based tests. Round-trip every UUID form.
4. **Independent LCA oracle.** Implement the methodology calculation separately from the renderer, in our own code, and assert the two agree on worked examples from the methodology documentation. This catches expression-graph errors that a mock never will.
5. **Production canary with a consenting pilot supplier**, destructive verbs disabled, on a monitoring period explicitly created for testing.
6. **Never** run automated suites against production credentials.

---

# Part 5 — Open questions for Puro

Send these to `product@puro.earth` / `tech-support@puro.earth` in Phase 0. Roughly ordered by how much they block.

**Blocking**

1. **Is a sandbox/UAT environment available to dMRV partners?** The docs say UAT is unavailable; the launch announcement referenced a dedicated test environment for partners. Which is correct, and if unavailable, what is the recommended safe development path?
2. **How should uncertainty deduction be represented?** Expected Fields expose only min/max validation bounds. Does Puro apply methodology uncertainty deductions at issuance, or must we encode them as explicit discount fields in the model?
3. **Is there a default buffer?** Older General Rules defined a 10% default; v4.4 has no buffer chapter. Per methodology, what applies, and who applies it?
4. **What is the formal expression grammar?** Supported operators and functions, precedence, unary minus, exponentiation, min/max/conditionals, division-by-zero behaviour, numeric precision and rounding.
5. **Evidence upload content type** — confirm `multipart/form-data` and the exact field names, since the prose and the curl examples disagree.

**High**

6. **Rate limits** — documented limits, burst allowance, 429 semantics, `Retry-After`.
7. **`poa_` token lifetime and rotation** — do they expire? Is there a refresh or rotation endpoint? How should we rotate without asking the supplier for a new authorisation code?
8. **Batch creation** — `POST /monitoring-periods/{id}/batches` is documented with no body. Can we set a label or external reference? What does `type: "GROUP"` mean in `batch-items`?
9. **Framework versioning** — how is "latest version" expressed in `GET /v0/frameworks`? Is there a stable code separate from the display label?
10. **Stable catalogue identifiers** — are Framework/Document/Model Template UUIDs stable across time, or should we match on label? (Label matching is fragile for us.)
11. **Webhooks** — any plan to notify on audit status change, auditor comment, or revision request?
12. **Auditor comments via API** — are review comments and revision requests exposed anywhere, or portal-only? This is our biggest functional gap.
13. **Pagination parameters** — exact query parameter names and max page size.

**Medium**

14. **Idempotency** — is there or will there be an idempotency key header?
15. **Methodology coverage** — when will Geologically Stored Carbon and Enhanced Rock Weathering be available via dMRV Connect? Is Microalgae genuinely Facility-framework-only?
16. **Verification Outcome Report** — retrievable via `GET /v0/audit-reports/{id}`, or portal-only?
17. **Preliminary Assessment reuse** — confirm that PA data automatically carries into the Facility Audit only within the *same* monitoring period, and what happens across periods.
18. **Double-registration checks** — does Puro validate against other registries at registration, or is the obligation entirely on the supplier and us?
19. **Document pinning** — any plan for API support? How should we handle suppliers who pin documents in the UI?
20. **Registry Connect** — access process and timeline for issuance/transfer/retirement coverage.
21. **Combined audits** — is the combined Facility + Output path selected purely by including both framework instances in the audit package, or is there a separate flag?
22. **Carried-forward emissions** — confirm that the previous period's per-batch emissions and fraction-used must be supplied by us as Expected Field Values, and that Puro does not compute this.

---

# Appendix A — Endpoint reference

Base: `https://api.portal.puro.earth`. All endpoints require `Authorization: Bearer`.

### Auth
| Method | Path | Token | Notes |
|---|---|---|---|
| POST | `/v0/partners/auth/access-tokens` | `pcs_` | Redeem auth code → `poa_`. Empty body returns 400 if secret valid, 401 if not. |

### Facilities
| Method | Path |
|---|---|
| GET | `/v0/facilities` |

### Monitoring periods
| Method | Path | Notes |
|---|---|---|
| GET | `/v0/monitoring-periods` | |
| POST | `/v0/monitoring-periods` | `facilityId`, `startDate`, `endDate`, `description` |
| GET | `/v0/monitoring-periods/{id}` | |
| PATCH | `/v0/monitoring-periods/{id}` | |
| DELETE | `/v0/monitoring-periods/{id}` | **Cascades destructively** |
| POST | `/v0/monitoring-periods/{id}/duplicate` | `targetFacilityId`, `startDate`, `endDate` |

### Frameworks
| Method | Path | Notes |
|---|---|---|
| GET | `/v0/frameworks` | Catalogue |
| GET | `/v0/frameworks/{id}` | |
| POST | `/v0/monitoring-periods/{id}/framework-instances` | `frameworkId` |
| GET | `/v0/framework-instances` | |
| GET | `/v0/framework-instances/{id}` | |
| DELETE | `/v0/framework-instances/{id}` | Cascades |

### Documents
| Method | Path | Notes |
|---|---|---|
| GET | `/v0/documents` | Catalogue |
| GET | `/v0/documents/{id}` | Includes guidance + templates |
| POST | `/v0/document-instances` | `documentId`, `monitoringPeriodId` |
| GET | `/v0/document-instances` | |
| GET | `/v0/document-instances/{id}` | |

### Evidence templates
| Method | Path |
|---|---|
| GET | `/v0/evidence-templates` |
| GET | `/v0/evidence-templates/{id}` |

### Expected fields
| Method | Path | Notes |
|---|---|---|
| POST | `/v0/expected-fields` | `type`, `documentInstanceId`, `label`, +type-specific |
| GET | `/v0/expected-fields` | |
| GET | `/v0/expected-fields/{id}` | |
| PATCH | `/v0/expected-fields/{id}` | **Must include `type`** |
| DELETE | `/v0/expected-fields/{id}` | |

### Models
| Method | Path | Notes |
|---|---|---|
| GET | `/v0/model-templates` | Catalogue |
| POST | `/v0/monitoring-periods/{id}/models` | **`label`/`description` must be `null`** |
| GET | `/v0/monitoring-periods/{id}/models` | |
| GET | `/v0/models/{id}` | |
| PATCH | `/v0/models/{id}` | |
| DELETE | `/v0/models/{id}` | Cascades |

### Model structure
| Method | Path | Notes |
|---|---|---|
| POST | `/v0/models/{id}/sections` | `label`, `description` |
| GET | `/v0/models/{id}/sections` | |
| GET | `/v0/model-sections/{id}` | |
| PATCH | `/v0/model-sections/{id}` | |
| DELETE | `/v0/model-sections/{id}` | Cascades |
| POST | `/v0/model-sections/{id}/field-libraries` | |
| GET | `/v0/model-sections/{id}/field-libraries` | |
| DELETE | `/v0/field-libraries/{id}` | Cascades |
| POST | `/v0/field-libraries/{id}/fields` | `expression`, `variables`, `emissionImpactType` |
| GET | `/v0/field-libraries/{id}/fields` | |
| GET | `/v0/fields/{id}` | |
| GET | `/v0/fields/{id}/values` | Single value, or paginated per batch |
| PATCH | `/v0/fields/{id}` | |
| DELETE | `/v0/fields/{id}` | |
| POST | `/v0/model-sections/{id}/formulas` | |
| GET | `/v0/model-sections/{id}/formulas` | |
| GET | `/v0/formulas/{id}` | |
| GET | `/v0/formulas/{id}/values` | |
| PATCH | `/v0/formulas/{id}` | |
| DELETE | `/v0/formulas/{id}` | |

### Evidence requests, batches, evidence, values
| Method | Path | Notes |
|---|---|---|
| POST | `/v0/evidence-requests` | `documentInstanceId` required; `type` STANDARD/BATCH |
| GET | `/v0/evidence-requests` | |
| GET | `/v0/evidence-requests/{id}` | |
| PATCH | `/v0/evidence-requests/{id}` | Status, dates, `reasonSkipped` |
| DELETE | `/v0/evidence-requests/{id}` | Cascades |
| GET | `/v0/evidence-requests/{id}/batch-items` | `{ id, type, label }` |
| POST | `/v0/evidence-requests/{id}/evidence` | **multipart/form-data** |
| POST | `/v0/evidence-requests/{id}/values` | `type`, `expectedFieldId`, `value`, `batchItemId` |
| POST | `/v0/monitoring-periods/{id}/batches` | No documented body |
| DELETE | `/v0/batches/{id}` | Affects all associated evidence/values |
| GET | `/v0/expected-field-values` | |
| GET | `/v0/expected-field-values/{id}` | |
| PATCH | `/v0/expected-field-values/{id}` | **Must include `type`** |
| DELETE | `/v0/expected-field-values/{id}` | |
| POST | `/v0/evidence/export` | Async job |
| GET | `/v0/evidence/export/{id}` | `PENDING`/`COMPLETED`/`FAILED` + `signedUrl` |

### Audit packages and reports
| Method | Path | Notes |
|---|---|---|
| POST | `/v0/facilities/{id}/audit-packages` | `subjects[]` of FRAMEWORK_INSTANCE / MODEL |
| GET | `/v0/audit-packages` | |
| GET | `/v0/audit-packages/{id}` | |
| POST | `/v0/audits/{id}/export` | Async; Framework Audits only |
| GET | `/v0/audits/export/{id}` | |
| GET | `/v0/audit-reports` | |
| GET | `/v0/audit-reports/{id}` | |

---

# Appendix B — Enumerations

```
Expected Field type      : NUMERIC | TEXT | DATE | BOOLEAN | AGGREGATE_REF
Aggregate function       : sum | mean
Evidence Request type    : STANDARD | BATCH
Evidence Request status  : PENDING | READY_FOR_REVIEW | APPROVED | SKIPPED
Batch item type          : BATCH | GROUP          (GROUP undocumented)
Emission impact type     : EMISSION | SEQUESTRATION | null
Variable type            : EXPECTED_FIELD | FIELD_OR_FORMULA
                         | MONITORING_PERIOD_START_DATE | MONITORING_PERIOD_END_DATE
Audit status             : IN_PROGRESS | APPROVED | REJECTED
Audit package subject    : FRAMEWORK_INSTANCE | MODEL
Export job status        : PENDING | COMPLETED | FAILED
Framework types          : Preliminary Assessment | Facility Audit | Output Audit
CORC durability labels   : CORC100+ | CORC200+ | CORC1000+
```

---

# Appendix C — Glossary

**Account Holder** — legal entity that has signed the Platform Agreement and holds a registry account.
**Audit Package** — bundle of framework instances and models submitted for review.
**Batch** — quantifiable unit of carbon removal with a unique identifier.
**Commitment Date** — the date the supplier committed to implementing the removal activity. Design validation must complete within 3 years of it.
**CORC** — CO₂ Removal Certificate; 1 tonne of net long-term removal.
**Crediting Period** — period during which verified output can produce CORCs; starts with the first monitoring period, 5 years by default, renewable twice.
**dMRV Partner** — entity submitting audit data on a supplier's behalf. Us.
**Document** — a compliance requirement defining what evidence must be submitted; mapped across frameworks independently of facility or period.
**Evidence Request** — a request for specific data for a collection period within a document instance.
**Expected Field** — a defined data input within a document instance, referenceable by a model.
**Facility / Production Facility** — physical or operational location where removal occurs.
**Field / Formula** — calculation nodes in a model; fields bind to expected fields, formulas compose fields and formulas.
**Framework** — structured list of requirements demonstrating compliance with a methodology.
**Issuing Body** — Puro.earth Oy.
**Leakage** — indirect emissions effects outside the activity boundary.
**Long-term** — minimum 100 years of storage.
**Monitoring Period** — the time between the first and last dates of an Output Report.
**Net CO₂ Removal** — gross removal minus life-cycle process emissions.
**Output / Output Report** — the removal volume for a monitoring period, and the report conveying it.
**Preliminary Assessment** — optional pre-screening of readiness for a facility audit.
**Reversal** — an event cancelling, wholly or partly, the effect of an issued CORC. Notifiable within 5 days.
**Section / Field Library** — organisational levels within a model.
**Supplier** — Puro account holder with a registered facility capable of CO₂ removal.
**Vintage** — calendar year the removal occurred; the later year if it spans years.
**VVB** — Validation and Verification Body; the independent third-party auditor.

---

# Appendix D — Sources

**Puro dMRV Connect documentation** — `https://docs.api.puro.earth/dmrv/`
Overview, Environments, Frameworks, Guides (workflows overview; getting access; redeeming access tokens; fetching facilities; creating monitoring periods; applying frameworks; applying models; configuring documents & templates; creating expected fields; configuring model sections; building fields & formulas; submitting-data prerequisites; creating evidence requests; working with batches; uploading evidence & field values; submitting audit packages), Concepts (authentication, OpenAPI, glossary), and the OpenAPI spec page.

**Puro Standard General Rules v4.4** (approved 7 May 2026) — certification process, registry transactions, supplier requirements, definitions.

**Puro.earth website** — Certification journey; Fees; Puro Issuance Plus; Puro Connect APIs; dMRV Connect launch announcement.

**Isometric documentation** — `https://docs.isometric.com/` — Key Certify Concepts; Validation and verification; API reference index (`llms.txt`); Registry concepts.

---

## Document control

| Field | Value |
|---|---|
| Version | 1.0 |
| Compiled | September 2026 |
| Source status | Puro dMRV Connect is in Beta; documentation actively changing |
| Next review | On receipt of Phase 0 answers from Puro, or on any Puro release-notes update |
| Release notes to watch | `https://docs.api.puro.earth/blog/tags/release` |

> **Standing caveat.** This document was compiled from Puro's published guides, which contain several internal inconsistencies (noted inline as ⚠). The OpenAPI specification is the authoritative source for request/response shapes. Download it, commit it to the repo, generate the client from it, and re-verify every ⚠ item before building on it.
