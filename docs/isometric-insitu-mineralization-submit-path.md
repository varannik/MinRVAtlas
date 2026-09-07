# In-situ mineralisation — how to submit data to Isometric

Plain-English path from **create the project** to **submit a GHG statement**, for CO₂ stored by injecting it into mafic or ultramafic rock (basalt, peridotite, ophiolite).

This is how **Isometric Certify** works. 3DMinRV can help collect and quality-check files; it does not replace these Certify steps.

**Current science documents (as of September 2026)**

- Storage rules: [CO₂ Storage via In-situ Mineralization in Mafic and Ultramafic Formations v1.2](https://registry.isometric.com/module/in-situ-mineralization/1.2) (v1.0 is still cited in 3DMinRV’s bundled board; use v1.2 with Isometric)
- Capture / net tCO₂e maths: usually [Direct Air Capture Protocol v1.3](https://registry.isometric.com/protocol/direct-air-capture/1.3) (the module can also hang off BiCRS v1.4 or Direct Ocean Capture v1.1)
- Platform: [Create a project](https://docs.isometric.com/user-guides/certify/create-project.md), [Project design](https://docs.isometric.com/user-guides/certify/project-design.md), [LCA](https://docs.isometric.com/user-guides/certify/lca.md), [GHG entries](https://docs.isometric.com/user-guides/certify/ghg-entry.md), [GHG statements](https://docs.isometric.com/user-guides/certify/ghg-statement.md), [Storage sites](https://docs.isometric.com/user-guides/certify/storage-sites.md)
- API: [Your first GHG entry](https://docs.isometric.com/api-reference/certify/your-first-ghg-entry.md)

---

## 1. One idea to keep in mind

Isometric does **not** have a standalone “mineralisation protocol.”

You always pick **two things**:

| Piece | What it is | What it decides |
| --- | --- | --- |
| **Protocol** | How CO₂ was **captured** (DAC, BiCRS, ocean capture, …) | How you calculate **net tCO₂e**: capture mass, energy, transport, leakages |
| **This module** | How CO₂ is **stored** in rock | Permits, wells, pressures, tracers, USDW, well integrity |

Credits are issued when CO₂ is **injected into the reservoir and isolated from the air** — not years later when it has all turned into carbonate. Mineralisation still has to be **monitored and proven**. A **2% buffer pool** is set aside (very low reversal risk).

There are **two clocks**:

1. **Validation (once).** Prove the *design* is allowed: site, wells, PDD, LCA.
2. **Verification (every reporting period).** Prove the *numbers* for that period: monitoring files + GHG entries + statement.

You cannot skip clock 1 and jump to clock 2.

---

## 2. The whole path (one picture)

```
0. Supplier agreement + Certify account
        │
        ▼
1. Create project in Certify
   (pathway + protocol + in-situ mineralisation module)
        │
        ▼
2. Add the storage site (the well / formation)
        │
        ▼
3. Write the Project Design Document (PDD)
   + attach permits, models, baseline surveys
        │
        ▼
4. Build the Life Cycle Assessment (LCA)
   (project operations + project emissions, then freeze a GHG entry template)
        │
        ▼
5. Isometric pre-screen → 10-day public comment → VVB validation
        │
        ▼
6. Operate the plant. Collect monitoring data as you inject.
        │
        ├──────────────────────────────────────┐
        ▼                                      ▼
7a. File MONITORING                    7b. File CARBON ACCOUNTING
    (evidence the well is safe)            (net tCO₂e for the period)
    source file + dates                    sources → datapoints → GHG entry
    against each requirement               using the LCA template
        │                                      │
        └──────────────────┬───────────────────┘
                           ▼
8. Create GHG statement for the reporting period
   (entries + monitoring pack + written report)
                           ▼
9. Submit statement → VVB verifies → credits issued
```

Monitoring (7a) and accounting (7b) are **different uploads**. A pressure CSV is not a GHG Statement. A net tCO₂e workbook is not well-integrity evidence.

---

## 3. Step by step

### Step 0 — Be allowed to use Certify

1. Sign a supplier agreement with Isometric. New Certify accounts start in **Preview** with limits.
2. Meet your **Registry Operations Manager (ROM)**. They walk the validation process and Certify.
3. If you integrate by API (3DMinRV / a dMRV partner), request **sandbox** credentials: `X-Client-Secret` plus an organisation **Bearer** token. Tokens last one year. Production secrets do not work in sandbox.

You also need, **outside** Certify:

- A **well permit** that names CO₂ as an allowed injectant (example: US EPA **Class VI**, or the local equivalent). If the country has no clear rules, follow US UIC or EU CCS directives and say so in the PDD.
- The well **must not** be used for enhanced hydrocarbon recovery.
- Site characterisation (cations in the rock, porosity, permeability, confining / impermeable layer, seismic study, baseline USDW, soil gas, and so on). That pack becomes PDD evidence.

---

### Step 1 — Create the project in Certify

In Certify: **Create a new project**.

Fill in:

- Short title (do not put the protocol name in the title)
- Description (up to 400 characters)
- Country of operation

Then:

1. Choose the **pathway** and **protocol** (for Fujairah-style capture + rock storage this is typically **Direct Air Capture**).
2. Select **modules**. Tick **CO₂ Storage via In-situ Mineralization in Mafic and Ultramafic Formations**. Required modules may already be ticked.
3. Click **Create project**.

Certify gives you a project id like `prj_…` and an Overview of remaining tasks.

This protocol does **not** have extra “project settings” like biochar durability or enhanced-weathering plot models. Settings lock after validation or after data is uploaded — set them before you upload.

**API note:** project creation is a Certify **UI** step. The MRV API is for sources, datapoints, GHG entries, monitoring submissions — not for inventing the project from scratch in 3DMinRV.

---

### Step 2 — Add the storage site

A storage site here is the **geological formation** you inject into (the well / reservoir), not a farm field.

1. In **Storage sites**, add the site: name, unique reference, storage method, geometry (point or GeoJSON).
2. Certify can generate **monitoring requirements** from the storage module. For mineralisation this may still need **Isometric’s team** to switch on / configure (storage monitoring is in beta; listed “out of the box” modules today are biomass / bio-oil geological storage and similar — **ask the ROM**).
3. Open the site:
   - **Requirements** tab — one-off validation evidence (plans, characterisation).
   - **Reversal monitoring** tab — frequencies “as per site,” monitoring method, then ongoing submissions.

You cannot file monitoring data until the site exists.

---

### Step 3 — Write the Project Design Document

Certify **Project Design** is a checklist, not a Word template you email. Requirements come from:

1. The Isometric Standard  
2. Your capture protocol  
3. This mineralisation module  

Tabs: Project setup → Protocol & monitoring → Environmental & social → Stakeholder input → Pathway specific.

For **each** requirement:

1. Write the answer in the form.
2. **Upload source files** (permit, lab XRD/XRF, reservoir model, seismic study, monitoring plan, well construction records). Pick a category (permit, lab result, model, operational record, …) and page numbers.
3. Mark the row **Ready for Submission**.

Run **Remi** (Isometric’s review agent) if you want early comments. When every row is ready, click **Request validation**.

That is **pre-screen**, not yet credits.

Typical mineralisation evidence in this step (module Appendix 1, pre-injection):

| What | Why | How often |
| --- | --- | --- |
| Divalent cations (Mg, Ca, Fe) in the rock | Enough rock to mineralise CO₂ | Once |
| Porosity, permeability, injectivity, reservoir volume | The formation can take the planned volume | Once |
| Confining / impermeable layer | Buoyant CO₂ or gas cannot rise | Once |
| Formation fluid pH, T, conductivity, DIC, tracers | Baseline vs later samples | Once before injection |
| USDW chemistry + aquifer pressure | Drinking-water baseline | Once |
| Soil gas / ecosystem imaging / geophysics | Leak baseline | Once |
| Well construction records | Casing, cement, CO₂-resistant materials | Once |
| Reservoir models | Predicted mineralisation and plume | Once, then every 5 years |

---

### Step 4 — Build the LCA, then freeze a GHG entry template

The LCA is the **carbon-accounting recipe**: capture, energy, transport, embodied emissions, and **sequestration** (here: mass of CO₂ injected and isolated).

Certify splits that recipe across **two screens**. They are one validation job, not two stages. Do them in this order:

1. Open **LCA**. Start from the default template for your protocol. Fill **Project operations** (running the plant): electricity, heat, transport, injected/isolated mass. Each line is a **component** from a **blueprint** (an equation). Example: transport emissions = mass × distance × factor.
2. Open **Project emissions** (Certify may say “You’ll need to create project emissions before you can calculate net negativity”). These are **one-off** establishment and end-of-life GHGs: well construction, plant steel, decommissioning — not this month’s kWh. Pick an **amortization rule** (spread over lifetime, over expected tonnes, or dump on the first statement). They feed back into the LCA automatically.
3. Return to **LCA**. Net negativity can calculate only after both halves exist:  
   **net = sequestration − operational emissions − project emissions** (and counterfactuals if the template has them).
4. **Fixed** inputs (emission factors) live on the LCA. **Monitored** inputs (this period’s kWh, this period’s injected tonnes) you will fill later on each GHG entry.
5. Run Certify **data checks**. They are warnings, not a hard gate, but they must be cleared before validation.
6. When the structure is right: **Convert into a new template** under Project operations.

That template is the **only official “data template”** for net tCO₂e. It is **not** a CSV of “emissions, removals, counterfactuals.” It is a list of components and required datapoints. You can also read it later via:

`GET /projects/{project_id}/ghg_entry_templates`

Do **not** use the blueprint `dac_mineralized_co2` (“CO₂ stored via mineralization”) for **in-situ** wells. That blueprint is **ex-situ** (weigh carbonated solids before and after). In-situ credits the **injected, isolated mass**, then monitors mineralisation separately.

---

### Step 5 — Get the project validated

1. Isometric scientists pre-screen PDD + LCA and leave issues in Certify. You fix and re-request review.
2. PDD is published for a **10-day public comment** (you can redact commercial bits).
3. Isometric picks a **VVB**. Site visit. Validation report.
4. After the validation report is accepted, the project may **submit GHG statements**.

Until this is done, treat operational uploads as **practice / sandbox**, not credit-grade.

---

### Step 6 — Operate and collect data

While you inject, the module wants a **testing and monitoring plan** (also required by the well permit). Record as you go — do not reconstruct later.

**Always on (continuous)**

- Injection (wellhead or bottomhole) pressure — stay below **MASIP** in the permit  
- Annulus pressure and annulus fluid volume  
- Injection rate and volume / mass  
- Reservoir temperature and pressure  
- Wellhead gas detectors + automatic shut-off  
- Overlying **aquifer pressure** (if required)

**On a clock**

| Cadence | What |
| --- | --- |
| Monthly | Bubble-point calculation (e.g. PHREEQC). Reservoir pressure must stay **> 5 bar above** bubble point so dissolved CO₂ stays dissolved. Injectate density if dissolving CO₂. Dissolved-gas composition if dissolved injection. Formation-fluid tracers in ops are often weekly in Appendix 1 — follow the **permit** if it is stricter. |
| Every 6 months | Internal mechanical integrity (corrosion, wall loss) of injection **and** monitoring wells. Formation-water density. |
| Yearly | External integrity (temperature / noise / oxygen-activation log). Pressure fall-off test. Report cumulative injected volume to the competent authority. Injectate composition summary. |
| Every 2 years | Surface CO₂ / H₂ / CH₄ flux survey vs baseline. |
| As in the permit | USDW sampling (pH, T, conductivity, major ions, dissolved gas, DIC). |
| Every 5 years | Compare reservoir models to real plume / pressure. Reassess reversal risk (buffer). |

**Dissolved-CO₂ extra:** CO₂-water ratio proving **full dissolution**; water-table if you use groundwater.

**Supercritical extra:** confining layer; impurities (As, H₂S, Hg); geophysical imaging of the plume (often every 5 years).

**If the seismic study said so:** continuous seismicity (traffic-light). Events ≥ magnitude **2.7** in the area of review force a plume re-evaluation.

Keep raw logs **at least 10 years** after injection.

---

### Step 7a — File monitoring evidence (the well is behaving)

This is **not** the GHG Statement.

**In the Certify UI**

1. Open the storage site → the requirement (for example “injection pressure”).
2. **Add submission**.
3. Attach a **source** file (CSV, Excel, PDF, parquet, … — any [supported source type](https://docs.isometric.com/api-reference/certify/uploading-sources.md)).
4. Set **valid from** / **valid to** so the dates cover the GHG statement period.
5. Add notes (example: “pages 14–21 of the monthly report”).

One file can be linked to **several** requirements.

**By API**

```
POST /sources                          → get signed_upload_url
PUT  {signed_upload_url}               → bytes of the file (max 50 MB)
POST /projects/{prj}/monitoring_requirements/{mnr}/submissions
     { source_id, valid_from, valid_to, notes }
```

Certify does **not** parse the CSV and check “this is wellhead pressure.” It stores the file against that requirement id. The VVB opens it.

**Honest product gap:** there is **no per-requirement column template** on `GET /monitoring_requirements`. You only get name, phase, frequency, notes. The **module Appendix 1** is the real content list. 3DMinRV’s quality check (Sentinel DQA + Step-3 MASIP / bubble-point / CO₂-water) is an **extra** gate before you push the same file to Certify.

Certify **time-series parquet** jobs (`POST /data-upload-submissions`) exist only for **DAC facility / DAC saline aquifer / biochar / WAE**. In-situ mineralisation in mafic rock is **not** one of those job types. Send well telemetry as a **source** (CSV/parquet attached to the monitoring requirement), not as a DAC time-series job.

When you later open a GHG statement, the **Monitoring** tab shows, per site:

- **Valid** — every requirement covered for the whole period  
- **Partial** — some dates missing  
- **Missing** — nothing in the period  

Submissions whose validity window overlaps the statement period are **pulled in automatically**. You do not paste them into the GHG entry.

---

### Step 7b — File carbon accounting (net tCO₂e)

This is how “emissions, removals and counterfactuals in net tCO₂e” actually enter Certify. You do **not** upload one spreadsheet with three columns.

For **each** removal batch / injection period you want to credit:

1. **Sources** — bills, meter exports, lab certificates, energy invoices (same `POST /sources` + PUT).
2. **Datapoints** — one number + unit + `source_ids`. Example: “CO₂ injected this week = 128.4 t”, unit `t`. Optional standard deviation for uncertainty.

   `POST /datapoints`

3. **GHG entry** from the **template** you froze in step 4.

   `GET /projects/{id}/ghg_entry_templates`  
   `POST /ghg_entries`  (template id + **monitored** datapoint ids)

   Certify copies **fixed** factors from the template. You only send this period’s monitored values.

4. If this week’s plant does not match the template, add/remove **components** (`POST /components`, `PATCH` the entry).

A GHG entry must be **net negative** (more removal than emissions) to be creditable. Typical contents:

- **Sequestration** — mass of CO₂ injected and isolated (DAC protocol §7.4.1.4: calibrated flow meter + density, continuous, calibration records).  
- **Activities (emissions)** — electricity, heat, transport, well construction amortisation, MRV sampling.  
- **Counterfactuals** — only if the protocol/template includes them.  
- **Leakages / reversals** — if anything came back out.

Certify **computes** net tCO₂e. You do not type the net number as the proof.

Practical grain: one GHG entry per injection batch, or per day/week of continuous injection — whatever matches how you operate. Vintage = calendar year of the entry’s **end date**.

---

### Step 8 — Create the GHG statement

A statement is the **folder for one reporting period**. All GHG entries whose `completed_on` falls in the period go in. Periods must be **contiguous** (no overlap, no gap).

**UI:** GHG statements → Create → set end date (start is inferred).

**API:**

```
POST /ghg_statements
{ "project_id": "prj_…", "end_on": "2026-03-31" }
```

Then:

1. Confirm GHG entries on the **Entries** tab.  
2. Confirm **Monitoring** is Valid (step 7a).  
3. Add reporting-period emissions if something is not on an entry.  
4. First statement: run **sensitivity analysis**.  
5. Write the **GHG Statement Report** (narrative). Put it on a drive the VVB and Isometric can open. This is the qualitative report — separate from the numbers.

The Standard’s wording: emissions, removals and leakages **together in net metric tonnes of CO₂e**. That presentation is the **statement + report**, not a monitoring CSV.

---

### Step 9 — Submit, verify, get credits

1. Run Certify **data checks** on the statement.  
2. **Submit GHG statement** and paste the **report URL**.

   `POST /ghg_statements/{ggs_…}/submit`  
   `{ "ghg_statement_report_url": "https://…" }`

3. VVB verifies **historical** data (materially correct vs protocol + module).  
4. Isometric reviews. Credits issue. ~2% of issuable mass goes to the **buffer pool** for this module.

After submit, the verifier can see sources. If you add extra sources later, **tell Registry Operations** — they are not notified automatically.

To change a submitted statement: edit entries or dates → a new **version** → resubmit with a note.

---

## 4. “What file do I attach?” — cheat sheet

| You have | It belongs in | Certify object |
| --- | --- | --- |
| Permit, PDD narrative, well construction, 5-year model review | Validation / PDD | Project Design source |
| Continuous WHP / annulus / rate CSV | Operational monitoring | Monitoring **submission** + source |
| Monthly PHREEQC bubble-point workbook | Operational monitoring | Monitoring submission + source |
| Lab injectate composition | Operational monitoring | Monitoring submission + source |
| 6-month integrity / annual fall-off PDF | Operational monitoring | Monitoring submission + source |
| USDW / soil-gas survey | Operational monitoring | Monitoring submission + source |
| Calibrated **injected mass** for the period | Carbon accounting | **Datapoint** on a GHG entry (plus source) |
| kWh, diesel, sorbent, truck-km | Carbon accounting | Datapoints on GHG entry components |
| Net tCO₂e for the period | Carbon accounting | **Calculated** on the GHG entry / statement |
| Written explanation of the period | Statement | Report URL at submit |

If you drop the injected-mass CSV on “GHG Statement” and skip datapoints + template, Certify has **not** received a GHG Statement.

---

## 5. After injection stops (later)

Not needed for the first credit, but the module requires a **post-injection** plan:

- Same kinds of measurements, often slower.  
- Integrity tests yearly for 3 years, then every 5 years until plugging.  
- Prove mineralisation / plume stability (tracers, cores, models out 50 years, geophysics if supercritical).  
- Independent review by a registered / chartered geologist, then decommission to the regulator’s rules.  
- If the regulator is silent, **minimum 50 years** of post-injection monitoring unless mineralisation is proven sooner.

---

## 6. How this maps to 3DMinRV (short)

| Isometric step | 3DMinRV today |
| --- | --- |
| Live monitoring requirement list | `GET /projects/{id}/monitoring_requirements` on the board (or bundled Fujairah list if credentials are missing) |
| Quality of a CSV before Certify | `POST /api/sentinel/pipeline` — DQA / anomaly / V&V; Step-3 MASIP, bubble-point, CO₂-water |
| File as monitoring evidence | `POST /api/registry/submit` → source + monitoring submission |
| GHG entry from `ghg_entry_templates` | **Not built** — do this in Certify UI or a later API integration |
| Submit statement | Needs `ISOMETRIC_GHG_STATEMENT_ID` + report URL; last, after mandatory slots |

Related: [ui-sentinel-integration.md](./ui-sentinel-integration.md), [data-sentinel-isometric-integration.md](./data-sentinel-isometric-integration.md).

---

## 7. Who to ask when Certify is silent

The mineralisation module is specific. Certify product docs are written mainly for biochar / DAC saline / biomass storage.

Ask your **ROM** or `support@isometric.com` if:

- The in-situ module does not appear at project create.  
- Storage-site **monitoring requirements** were not generated.  
- You need the LCA default components for **injected mass** (not ex-situ `dac_mineralized_co2`).  
- You need sandbox API access as a dMRV integrator.

Do not guess a CSV layout for “GHG Statement.” Pull **`ghg_entry_templates`** for *that* project — that is the template.
