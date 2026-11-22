# Puro GSC Production Facility Audit: documents and descriptions checklist (biogenic CO2 from cement kiln co-processing biomass, liquefied, trucked, in-situ mineralisation in mafic/ultramafic rock)

> Status: final (14 Nov 2026). Sources: Puro primary documents downloaded from Puro's document library and parsed locally, plus the local audit package. Puro PDFs and DOCX were fetched as binaries and their text extracted locally. Page numbers cited are PDF page positions. The Clarifications PDF of 06 Nov 2026 could not be parsed and is not covered.

Abbreviations: GSC = Puro "Geologically Stored Carbon" methodology; GR = Puro Standard General Rules; ADI = Audit Document Index; PFA = Production Facility Audit; VVB = validation/verification body (Puro calls it the "Auditor"); LP = local package at `/Users/varanik/Desktop/4401/Apps/MinRVAtlas/docs/1. Final Submission/`.

## Which document editions apply (as of 14 Nov 2026)?

### Takeaway
The current GSC methodology is **Edition 2024 v.5, approved 23 April 2026**. The current General Rules are **v4.4, approved 07 May 2026**. The local package's Audit Document Index is still headed "Edition 2024, Version 1", so it predates v2 to v5. The v2 to v5 changes are mostly LCA attribution, amortisation and renewable-energy rules (sections 5 and 6) plus CO2-ownership transfer (3.3.2). Those sections need re-checking against v.5. Puro has also replaced the separate additionality questionnaire with a combined **Baseline and Additionality Questionnaire v2.0 (Jul 2026)**.

### Cited Findings
- The GSC methodology cover reads "Edition 2024 v. 5 | Approved 23 April 2026 | Status: Approved". — [GSC 2024 v5 PDF](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Geologically_Stored_Carbon_2024_5.pdf)
- GSC document history, p.100 — [GSC 2024 v5](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Geologically_Stored_Carbon_2024_5.pdf):
  - v1 (June 2024): initial release.
  - v2 (Aug 2024): new leakage-mitigation option in 6.2.3(b); typo fixes.
  - v3 (Apr 2025): rule 5.2.12 now attributes capture emissions in mixed capture by mass balance, not in full to the eligible fraction; new subrule 5.2.15(e) on non-amortised embodied emissions when an asset's lifetime changes.
  - v4 (Dec 2025): 5.2.19 clarifies renewable/low-carbon energy supply schemes; 6.2.3 scope clarified; 3.3.2 clarifies transfer of CO2 ownership, especially where local regulation does not mandate it.
  - v5 (23 Apr 2026): 5.2.15(a) amortisation period changed to 15 or 20 years, aligned with the EU CRCF; 5.2.13 now attributes transport and storage emissions by mass balance.
- Current versions listed in the Puro Document Library — [Puro Document Library](https://puro.earth/cdr-infrastructure/methodologies/document-library/):

  | Document | Version | Date |
  |---|---|---|
  | General Rules | 4.4 | May 2026 |
  | Biomass Sourcing Criteria | 1.3 | Sep 2026 |
  | Additionality Assessment Requirements | 2.1 | Jun 2026 |
  | Stakeholder Engagement Requirements | 1.1 | May 2024 |
  | SDG Assessment Requirements | 1.0 | Mar 2024 |
  | Article 6 Procedures | v2 | May 2026 |
  | Project Description template | 2.1 | Apr 2026 |
  | Environmental and Social Safeguards (ESS) Questionnaire | 2.2 | Apr 2026 |
  | SDG reporting template | 1.2 | Apr 2026 |
  | LCA Guidelines for Suppliers | n/a | Mar 2023 |
  | Baseline and Additionality Questionnaire | 2.0 | Jul 2026 |
  | "Clarifications Puro Standard" | n/a | file dated 06 Nov 2026 |

  The library has no separate GSC guidance beyond the methodology editions and the June 2024 consultation summary.
- The General Rules cover reads "Version 4.4 | Approved | 07 May 2026". — [General Rules 4.4](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/General%20Rules%204_4.pdf)
- The Biomass Sourcing Criteria cover reads "Version 1.3 | Approved | 3 September 2026". The criteria apply to GSC Edition 2024. Earlier versions: v1.0 2024-05-30, v1.1 2025-06-12, v1.2 2025-11-27. — [Biomass Sourcing Criteria v1.3](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Clarification/Puro%20Biomass%20Sourcing%20Criteria%20v1.3.pdf)
- The LP's ADI header reads "Methodology — Geologically Stored Carbon, Edition 2024, Version 1". Its README is "Instruction manual for audit packages, Version 1.1" and refers to "General Rules 4.0". — LP files `Audit Document Index - GSC.html`, `Audit Document Index - GSC_Final.xlsx`, `README - Instruction Manual.pdf`.
- The Baseline and Additionality Questionnaire v2.0 cites "Puro Standard General Rules v4.3, section 6.5 and Puro's Additionality Assessment requirements v2.0". — [Baseline and Additionality Questionnaire v2.0](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Puro%20Baseline%20and%20Additionality%20Questionnaire%20-%20v2.0.docx)

### Inferences
- The LP was built from a v1-era ADI. Before submission the supplier should confirm with its Puro account contact which GSC version the audit runs under, and re-check against v5:
  - LCA amortisation (15 or 20 years);
  - mass-balance attribution of capture, transport and storage emissions;
  - renewable-energy claims (5.2.19 and 6.2.3);
  - CO2-ownership transfer wording in contracts (3.3.2).
- The Project Description template v2.1 records "General Rules version" and "Methodology edition and version", so both must be stated explicitly.

### Gaps
- I could not confirm whether Puro has issued a GSC "Edition 2025/2026" draft for consultation. None appeared in the library listing.
- The 06 Nov 2026 Clarifications PDF could not be parsed in time (binary). Any GSC-specific clarifications in it are not captured.

## What does the GSC methodology require on eligibility, quantification, monitoring, leakage, uncertainty and reversal?

### Takeaway
Credits are issued as CORC = C_stored − E_project − E_leakage − E_reversal. C_stored = (C_injected − E_released) × F_eligible × F_supplier.

For this facility type:
- **Eligibility of the CO2 source:** biogenic CO2 from co-processing in a cement kiln is a "mixed source". The biogenic share must be measured by radiocarbon (ISO 13833 or ASTM D6866), at least semi-annually, and multiplied by the eligible-biomass fraction.
- **Storage:** dissolved-CO2 injection into igneous rock is explicitly eligible. Bubble-point pressure must be monitored monthly with a margin of at least 5 bar.
- **Jurisdiction:** the UAE is not pre-approved, so the legal framework must meet all 8 criteria in Table 1, with Puro's written approval before the audit.
- **Reversal:** no default buffer deduction, but a project-specific reversal risk assessment is required (99% retention over 1,000 years).

### Cited Findings
**Eligible activity and crediting**
- 3.2.1: an eligible CO2 Stream must be injected into a suitable reservoir and stored for at least 1,000 years. Eligibility is determined during the PFA. — [GSC v5](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Geologically_Stored_Carbon_2024_5.pdf) (via LP ADI extract)
- 2.2.1: the Production Facility comprises one or several capture sites, the logistic chain and one or several storage sites.
  - Capture sites must be similar in nature, in the same jurisdiction, and operational at the time of the Facility Audit.
  - Storage sites must be operational at the Facility Audit.
  - Any change requires an update of the PFA.
- 2.2.2: the Crediting Period is 15 years from the first date of the first monitoring period, renewable twice by a new PFA. — [GSC v5 p.13](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Geologically_Stored_Carbon_2024_5.pdf)
- 2.3.1: the CORC is created when the CO2 has been injected and the data records can be verified, i.e. a complete end-to-end data trail exists. — [GSC v5 p.14](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Geologically_Stored_Carbon_2024_5.pdf)

**CO2 source and stream**
- 3.2.2: the CO2 Stream must be at least 95% CO2 by volume and comply with local law and with external-operator specifications. It may contain incidental substances, tracers and injection aids, and may be dissolved in water or seawater immediately before or during injection. — LP ADI extract of GSC 3.2.2
- 3.2.3, eligible sources:
  - DAC;
  - biogenic CO2 from thermochemical treatment of biomass;
  - "biogenic CO2 from the incineration of biomass mixed with other substances (e.g. waste + CCS)";
  - biological treatment;
  - "biogenic CO2 from other industrial processes (e.g. oxidation of biogenic materials)".

  All fossil CO2 is ineligible. — LP ADI extract of GSC 3.2.3
- 3.2.5: mixed eligible and ineligible streams may be injected, provided the ineligible fraction is reliably quantified and deducted. — LP ADI extract

**Storage**
- 3.2.6: eligible storage includes "Injection of dissolved CO2 … into subsurface igneous (ultramafic, mafic, intermediate, or silicic) rock formations suitable for rapid mineralization."
  - Pressure at the point of entry must exceed the bubble-point pressure.
  - Reservoir temperature and pressure must prevent degassing.
  - Storage may be onshore or offshore, but must be in the Earth's crust: not the water column and not man-made buried containers.

  — [GSC v5 p.17](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Geologically_Stored_Carbon_2024_5.pdf)
- 3.2.7: depleted hydrocarbon reservoirs need evidence of no further hydrocarbon recovery and pressure no higher than original. This does not apply to mineralisation in igneous rock. — LP ADI extract
- 3.2.8 to 3.2.10: storage sites must be approved by the competent authority and hold injection and storage permits. All installations must comply with local law, be built to national best practice, and be approved and permitted. — LP ADI extract

**Legal framework (3.2.11, Table 1)**
- 3.2.11: storage is allowed only in jurisdictions with a robust legal framework. Pre-approved: USA, EEA states, UK, and Canada (Alberta, Saskatchewan, British Columbia). Any other jurisdiction must show the framework meets all requirements of Table 1 (called "table 3.1" in the ADI). Puro reserves the right to decide, and the Facility Auditor verifies the evidence. — [GSC v5 p.18](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Geologically_Stored_Carbon_2024_5.pdf)
- Table 1 lists 8 requirements, with EU CCS Directive and US 40 CFR 144/146 examples. The framework must:
  1. be designed for permanent storage;
  2. require a permit or licence for storage-site operation;
  3. require storage-site characterisation or minimum suitability criteria;
  4. include a characterisation of an eligible CO2 stream;
  5. require monitoring of the injection facilities, storage complex and surrounding environment;
  6. require at least periodic reporting to a competent authority;
  7. include emergency and remedial response requirements for leakage or irregularities;
  8. include site closure and post-closure management, plus financial responsibility or a comparable mechanism (e.g. transfer of responsibility).

  — [GSC v5 p.19](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Geologically_Stored_Carbon_2024_5.pdf)
- The ADI evidence piece "Legal framework governing storage site" is "Only required when the storage site is not located in a pre-approved jurisdiction". It instructs: "Please, request review and written approval by Puro.Earth of the evidence provided during audit preparation. This is required prior to the audit." — LP `06. Storage Site/6.0 Puro Description/_Legal framework governing storage site.txt`
- 3.2.12 and 3.2.13: no EOR and no temporary storage. Shared infrastructure is allowed with contract evidence and mass-balance data from the infrastructure provider. — LP ADI extract

**Overall CORC equation and C_stored**
- 4.3.1 defines CORC = C_stored − E_project − E_leakage − E_reversal. — [GSC v5 p.30](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Geologically_Stored_Carbon_2024_5.pdf)
  - E_project: total life-cycle emissions of the supply chain (section 4.5).
  - E_leakage: unmitigated ecological, market and activity-shifting leakage (4.6).
  - E_reversal: GHG emissions from the reservoir (4.7).
- 4.2.6: CORCs must not exceed the eligible CO2 captured in the same monitoring period, shown by comparing data records. — [GSC v5 p.30](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Geologically_Stored_Carbon_2024_5.pdf)
- 4.4.1: C_stored = (C_injected − E_released) × F_eligible × F_supplier. — [GSC v5 p.31](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Geologically_Stored_Carbon_2024_5.pdf)
  - C_injected: measured at the last monitoring point, either as mass flow × CO2 mass fraction or as volume × volume fraction × density (4.4.2).
  - E_released: injection leaks downstream of the last monitoring point. It is zero if the flow meter sits directly on the wellhead; otherwise it comes from local rules, operator documentation, direct measurement or conservative estimation (4.4.4). — [GSC v5 p.32](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Geologically_Stored_Carbon_2024_5.pdf)

**F_eligible (4.4.5)**
- F_eligible = F_eligible source × F_eligible biomass.
- F_eligible source can be set to 100% only for DAC or purely biogenic streams backed by operational data. "In all other cases… (e.g. for CO2 from waste + CCS and other mixed sources…)" it must be measured "through radiocarbon (14C) analysis following either the ISO 13833 or the ASTM D6866 standard test methods."
- Footnote: radiocarbon accuracy may be reduced for long-lived wood carbon, so the results need critical assessment.
- F_eligible biomass comes from operational records of the origin, type and sustainability of the biomass (3.7.1 and 3.7.2).

— [GSC v5 p.33](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Geologically_Stored_Carbon_2024_5.pdf)

**Biomass (3.7)**
- 3.7.1 and 3.7.2: biomass feedstock whose origin, type or sustainability cannot be demonstrated is not eligible, and its CO2 share is excluded via F_eligible. This applies whatever the baseline. Demonstration follows the latest Puro Biomass Sourcing Criteria.
- 3.7.3: feedstock is categorised (a) to (o). Category (a) covers mixed MSW and RDF and assimilated industrial waste. Category (c) covers end-of-life wood and textiles.

— LP ADI extract

**Reversals (4.7)**
- 4.7.1 to 4.7.3: reversals are any CO2, GHG or hydrocarbon no longer securely stored. They are measured or conservatively estimated as flux R × duration ΔT. The start date is the last evidence of no reversal. — LP ADI extract
- 7.3.5: for dissolved CO2, monthly bubble-point-pressure monitoring using an equation of state (e.g. Peng-Robinson), with reservoir pressure kept at least 5 bar above bubble point. CO2 injected while the margin is breached counts as a reversal. — LP ADI extract

**Monitoring requirements**
- 7.3.1: continuous mass flow of CO2 entering the reservoir; for dissolved CO2, also continuous water mass flow.
- 7.3.2: continuous downhole temperature and pressure, or a modelled estimate.
- 7.3.3: chemical composition at least quarterly, sampled as close to the wellhead as feasible.
- 7.3.4: CO2 fraction at least quarterly, with frequency increased if successive readings differ by at least 1 percentage point.
- 7.4.1: continuous monitoring of captured CO2.
- 7.4.2: F_eligible at least semi-annually.
- 7.4.3: sorbent/solvent consumption (kg and kg per tCO2).
- 7.4.4(b): for container transport (truck), documentation from the logistics operator on tonnes delivered to the storage site.
- 7.5.3: corrosion monitoring of well materials.
- 7.6.1: monitor the reservoir and surrounding area for release, scoped to the locally defined area. Technologies considered include tracers, groundwater sampling, seismic, pressure and soil gas.
- 7.6.2: normal, alert and threshold values.
- 7.6.3: at least monthly leak inspection with a CO2 detector.
- 7.7.1 to 7.7.5: post-injection monitoring and closure criteria (absence of leakage, predictive models proven, wells plugged, surface equipment removed).

— LP ADI extracts of GSC section 7

**General monitoring and devices**
- 7.2.3: frequency definitions; "continuous" means at least every 15 minutes.
- 7.2.5: the monitoring plan must cover capture, transport and injection across the pre-injection, injection and post-injection periods. It must list parameters, methods, accuracy, locations, frequency, and normal and alert thresholds.
- 7.2.7: contingency monitoring.
- 7.2.8 and 7.2.9: devices calibrated to at most 5% error, with calibration records available. Energy billing meters from unaffiliated suppliers are exempt.

— LP ADI extracts

**Storage-site monitoring emissions (5.2.18)**
- Footnote 59: post-closure monitoring is usually about 20 to 50 years, but "might also be shorter… in the context of projects utilizing rapid mineralization."
- The storage operator must report years of operation (T_o, at least the 15-year crediting period), projected tonnes stored, and years of post-closure monitoring until liability transfer.

— [GSC v5 p.54](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Geologically_Stored_Carbon_2024_5.pdf)

**Uncertainty (4.8)**
- 4.8.1 to 4.8.5: estimates must be conservative.
  - A material uncertainty is one at or above 1% of Output.
  - LCA database emission factors are non-material; other emission factors carry a flat 20% uncertainty.
  - Total uncertainty uses variance propagation or Monte Carlo.
  - It must be assessed before the first Output Audit and updated at least annually.
- The ADI notes uncertainty is "only for declarative purposes and does not affect the volume of CORCs".

— LP ADI and `_Uncertainty quantification approach.txt`

**Risk and permanence (section 8)**
- 8.2: there is no default percentage deduction for reversal risk, because there is no material reversal risk in the General Rules sense.
- 8.5.2: risk assessment per ISO 31000 or equivalent, covering environment, atmosphere, health and safety, and communities. Components: identification, analysis, evaluation and management.
- 8.5.3: assess project-specific factors.
  - (a) Gaseous-phase storage risks must be considered.
  - (b) If retention is likely below 99% over 1,000 years, apply mitigation or a commensurate deduction.
- 8.5.4: update the risk assessment with the monitoring plan.
- 8.5.5: record and disclose risk-realisation events and complaints.

— [GSC v5 p.84](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Geologically_Stored_Carbon_2024_5.pdf); LP ADI extracts

**Leakage (section 6)**
- The Leakage form covers:
  - 6.1.4: leakage sources for the bio-CCS Retrofit baseline;
  - 6.2.2: ecological leakage from biomass;
  - 6.2.6: material and energy sector leakage for Retrofit;
  - 6.2.7: land-sector leakage;
  - 6.3.4 and 6.3.5: quantification, including iLUC factors × attribution factor.

— LP ADI extract

**E&S and water (3.8)**
- 3.8.3: the E&S impact assessment must cover capture, transport and injection. Content:
  - legal framework;
  - baseline conditions;
  - activity description, including decommissioning;
  - impacts on soil, air and water, flora and fauna, health and safety, socio-economics, communities (noise, induced seismicity) and cultural sites;
  - mitigation and monitoring;
  - public consultation.
- 3.8.5: water rights (UN General Comment No. 15).
- 3.8.6: chemical plan covering:
  - (a) listing chemicals such as amines;
  - (b) exposure risks;
  - (c) exposure thresholds;
  - (d) spill pathways;
  - (e) an emergency plan: preventing further damage, clean-up, evacuation zones, first aid.

— LP ADI extracts

**SDGs (3.9)**
- Qualitative SDG descriptions are due before the PFA; quantitative evidence at the Output Audit. — LP ADI extract

### Inferences
- A cement kiln burning RDF, tyres and wood alongside fossil fuel and limestone calcination produces a mixed stream. F_eligible source cannot be 100% and must come from 14C testing; process CO2 from calcination is fossil/geogenic.
  - Auditors will look for a sampling plan that shows representativeness across fuel-mix variability. The schedule must be at least semi-annual, and in practice more often if the fuel mix varies.
  - The plan must also be consistent with the 4.2.6 check that CORCs do not exceed eligible CO2 captured.
- Tyres are not a named Biomass Sourcing Criteria category. Only their natural-rubber fraction is biogenic. The supplier must justify how tyre-derived biogenic carbon is categorised (possibly as assimilated industrial waste under category A) or exclude it via F_eligible biomass. This is a likely audit question.
- Truck transport of liquefied CO2 triggers 7.4.4(b): delivery documentation per load (weighbridge or flow-meter tickets) reconciled against capture and injection quantities.
- Dissolved-CO2 mineralisation storage triggers rules specific to this storage type:
  - 7.3.1 water flow;
  - 7.3.5 bubble point plus 5 bar;
  - 7.6.1 plume/charged-water monitoring (tracers, groundwater sampling);
  - 7.7.3 conformance to the reservoir model;
  - possibly a shorter post-closure period, per footnote 59.

### Gaps
- I did not extract GSC sections 5.2.x (LCA details, e.g. foreground infrastructure amortisation, energy-scheme rules) or section 6.2 subrule details in full.

## What must the Project Description contain (GR 2.2.4.2 and template v2.1)?

### Takeaway
GR 4.4 lists 11 mandatory project-description contents. Puro's Word template v2.1 turns these into tables 1A to 6A with word limits. Several sections must replicate summaries from other evidence (Baseline and Additionality Questionnaire, monitoring plan, LCA model description, SEP report, ESS questionnaire). The document is public and must be submitted as both PDF and Word.

### Cited Findings
- GR 2.2.4.2: "The minimum Production Facility Audit documentation includes the project description." It must include:
  - i. facility name, location, Methodology, supplier;
  - ii. non-technical description;
  - iii. technical description of the activity and technology;
  - iv. net CO2 removal quantification including uncertainty estimation;
  - v. reversal risk estimation and monitoring;
  - vi. demonstrated conformity to the Methodology;
  - vii. monitoring and reporting plan;
  - viii. Baseline and Additionality Assessment Report;
  - ix. stakeholder consultation;
  - x. E&S safeguards;
  - xi. positive SDG impacts description.

  — [General Rules 4.4 p.7](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/General%20Rules%204_4.pdf)
- GR 2.2.4.3: the supplier attests accuracy by the signature of an individual with legal signing authority. — [GR 4.4 p.7](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/General%20Rules%204_4.pdf)
- GR 2.2.4.1: the PFA starts only after KYC, the signed Platform Agreement, Production Facility registration, and audit documentation "determined complete by the Issuing Body". — [GR 4.4 p.6](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/General%20Rules%204_4.pdf)
- GR 2.2.3: design validation must be completed within 3 years of the Commitment Date. — [GR 4.4 p.6](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/General%20Rules%204_4.pdf)
- Project Description template v2.1 contents. Every table is "filled in by the CO2 Removal Supplier and verified by the Auditor". — [Puro Project Description template](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Puro%20Project%20Description.docx)
  - **1A Production Facility:** name, registration date, Facility ID, location, host country, and whether registered in another registry.
  - **1B Supplier:** name, address, Business ID, KYC status.
  - **1C Facility Audit:** audit type, GR version, methodology name, edition and version, deviations granted, audit completion date, conclusion, auditing body, Crediting Period start and end, update flag, PD version.
  - **2A Non-technical description:** at most 200 words.
  - **2B Locations:** facility plus all key locations (storage sites, feedstock sourcing), each with purpose, address and WGS84 coordinates.
  - **2C Operators:** supplier plus each operator (developer, storage operator, etc.), each with name, business ID, address and role.
  - **3A Technical description:** at most 500 words.
  - **3B Illustrations:** up to 3, with publication rights.
  - **4A Methodology deviations:** document, rule, impact, justification, request and approval dates.
  - **4B Scope and project boundary:** at most 250 words, aligned with the methodology boundary.
  - **4C Baseline summary:** at most 250 words, from the Baseline and Additionality Questionnaire.
  - **4D Methodology baseline:** e.g. new built or retrofit.
  - **4E Additionality summary:** at most 250 words, covering baseline removal, regulatory and financial additionality.
  - **4F Filenames:** of the public Baseline and Additionality Questionnaire and extra files.
  - **4G Net CO2 removal quantification:** at most 300 words, including the CORC equation and all life-cycle phases, based on the monitoring plan.
  - **4H Monitoring and reporting plan:** at most 500 words, covering safety, eligibility and precise quantification.
  - **4I Monitoring plan publication:** published "entirely" or "in a redacted version" after the first Facility Audit.
  - **4J LCA:** at most 500 words, covering scope, emission factors, and data acquisition (measurement vs estimates).
  - **4K LCA model description publication:** optional.
  - **5A Stakeholder engagement summary:** at most 250 words, replicated from the SEP report.
  - **5B SEP report:** filename (required, public).
  - **5C/5D E&S summary:** at most 500 words, based on the ESS Questionnaire and monitoring plan. The ESS Questionnaire filename is required and public.
  - **5E Permits:** name, ID, issuer, date, file, URL.
  - **5F EIA:** whether legally required or voluntary; filename; publishable?
  - **5G Environmental Risk Assessment:** same fields as 5F.
  - **5H SDG summary:** at most 150 words.
  - **5I SDG reporting file:** if SDG attributes are certified.
  - **6A:** list of all publicly available files.
- The LP README: the project description should be filled in last, "In some cases, answers provided to in other documents must be reproduced as-is in the project description". Template filenames must be renamed, e.g. "Puro Project Description NameOfFacility.docx". — LP `README - Instruction Manual.pdf`
- The LP ADI instruction for the project description: "fill in the Word template and submit the final version as both PDF and Word files". It "will be publicly available in Puro's Registry once certified". — LP `11. Project description/11.0 Puro Description/_Project Description.txt`
- GR 2.2.5.5: Puro publishes the project description, PFA Report and Statement in the Registry. — [GR 4.4 p.7](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/General%20Rules%204_4.pdf)

### Inferences
- For this facility, the PD must:
  - name the cement plant (capture), the logistics operator, and the storage-site operator and its location, each with business IDs;
  - give WGS84 coordinates for the capture site, storage site/wells and feedstock suppliers;
  - state the bio-CCS Retrofit baseline (4D);
  - state the CORC equation with F_eligible from 14C;
  - summarise the bubble-point, tracer and groundwater monitoring;
  - declare the UAE legal-framework approval as a "methodology deviation/approval" if Puro treats it as such.

### Gaps
- The template does not state whether the Puro Table 1 legal-framework approval must be recorded in 4A. Ask Puro.

## Which templates and tools does Puro provide, and what does each require?

### Takeaway
Each LP module ships Puro templates and .txt instructions. For GSC Facility Audits these are:
- ADI (xlsx and html);
- Contact information to auditor (xlsx);
- Production Facility Definition and Baseline Scenario (xlsx), now partly superseded by the Baseline and Additionality Questionnaire v2.0 (docx);
- Additionality questionnaire;
- Stakeholder Engagement Report template;
- ESS Questionnaire (docx) plus guidance pptx;
- GSC Capture site description input (xlsx);
- Biomass sourcing form;
- Leakage Determination (xlsx);
- LCA model template (xlsm);
- SDG Report template (docx);
- Project Description (docx).

### Cited Findings
- README v1.1:
  - The root of the audit package holds the ADI (xlsx and html), "Contact information to auditor (as .xlsx file)" and, from the 2nd audit, "Disclosure since last audit".
  - The Excel ADI has a supplier "Remarks" column and a Puro "Feedback" column.
  - Existing folders must not be changed. Do not create sub-folders for a single document.
  - Delete blank templates, .txt files and drafts.
  - Rename templates; e.g. "puro_LCA Model template_v2023-09_blank.xlsm" must be renamed.

  — LP `README - Instruction Manual.pdf`
- README pre-submission checklist:
  1. consistency across evidence (financial additionality vs LCA; design and feedstock vs LCA; monitoring plan vs LCA; PD vs the rest);
  2. ADI comments for every evidence piece, explaining deviations, missing documents and file locations;
  3. blank templates, .txt files and drafts deleted;
  4. files renamed;
  5. public files free of confidential information.

  — LP `README - Instruction Manual.pdf`
- README: ESS uses "Environmental and Social Safeguard Questionnaire.docx" with "_Guidance for Environmental and Social Safeguard.pptx". SDG uses "Puro SDG Report Template.docx". The PD uses "Puro Project Description.docx". — LP `README - Instruction Manual.pdf`
- **Production Facility Definition and Baseline Scenario:** "Fill in Excel template provided". It defines the capture, logistics and storage assets audited together and the baseline information. Rules: 2.2.1, 3.2.1, 3.4.1 to 3.4.4. — LP ADI; `02.../_Production Facility Definition and Baseline Scenario.txt`
- **Additionality:** "Fill in and sign Puro's questionnaire on additionality (PDF)", plus "financial models as spreadsheets with formulas (Excel)". The questionnaire, but not its attachments, becomes public. — LP `_Additionality assessment.txt`
- **Baseline and Additionality Questionnaire v2.0 (Jul 2026)** — [Baseline and Additionality Questionnaire v2.0](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Puro%20Baseline%20and%20Additionality%20Questionnaire%20-%20v2.0.docx):
  - Section 1, general questions:
    - 1A: baseline determination table (baseline, project and alternatives, with removals quantified).
    - 1B: does the project lead to higher durable removals?
    - 1C: is it aligned with the net-zero transition? Not aligned: increased fossil extraction, coal power, unabated fossil power.
    - 1D: regulatory additionality.
    - 1E: Commitment Date; "time period between the commitment date and production facility audit is max. 3 years".
    - 1F: TRL 8 or 9 triggers a common-practice analysis (region, similar plants within ±50% output, market penetration rate).
    - 1G: other income sources and subsidies.
  - Then exactly one of three options:
    - Section 2, Simple Cost Analysis: cost structure, spreadsheet with readable unprotected formulas, consistency with investor information and with the LCA.
    - Section 3, Investment Analysis per CDM Tool 27: benchmark IRR or WACC with justification, currency and real/nominal, CORC effect on IRR/NPV, sensitivity analysis, and a confidential-model summary covering capital structure, revenue sources, subsidies, growth assumptions and model duration.
    - Section 4, Barrier Analysis: financial, institutional or information barriers with verifiable evidence; show that an alternative does not face the barrier.
  - Signed declaration by a representative.
  - The document is public in the Registry.
- **Stakeholder Engagement Report:** follows the "Puro Stakeholder Engagement Requirements" and uses Puro's template. It is public, with a confidential appendix for personal data. — LP `_Stakeholder Engagement Report.txt`. Requirements: [v1.1 May 2024](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Puro%20Stakeholder%20Engagement%20Requirements.pdf).
- **ESS Questionnaire:** Word template exported to PDF. It is public, with a confidential appendix. — LP `_Environmental and Social Safeguards.txt`. Current template v2.2 (Apr 2026): [ESS Questionnaire](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Puro_Env_&_Soc_Assess.docx).
- **Capture site description:** "A standard questionnaire describing and characterising the capture site(s) and the operations". Template plus supporting documents. Rules: 3.2.3, 3.8.5, 3.8.6. — LP ADI; `04.../_Capture site description.txt`
- **Biomass sourcing form** (ADI sub-module "04.1 Biomass sourcing"): "A form disclosing the types of biomass that will be processed by the facility and the documentation that will be available to demonstrate type, origin, and sustainability, during Output Audits." Rules: 3.2.4, 3.7.1 to 3.7.3, 6.2.2, 6.3.5. — LP ADI html
- **Leakage Determination form:** filled in for the removal type and baseline. Depending on the answers it requests one-time evidence (Facility Audit) or recurring evidence (Output Audit), and quantification of unmitigated leakage to include in the CORC Report Summary. — LP `_Leakage determination form and associated evidence.txt`
- **LCA:** an LCA report justifying data choices, plus calculation files that can be updated at each Output Audit. Requirements:
  - templates are "highly recommended";
  - foreground separated from background;
  - per-gas breakdown;
  - emission factors identified (name, source, boundary, characterisation);
  - multi-level aggregation tables;
  - embodied and operational emissions split;
  - parameters with units, uncertainty and monitoring information;
  - the LCA computes E_project only.

  — LP `_Life cycle assessment for Facility Audit.txt`. Puro LCA guidelines: [LCA Guidelines for Suppliers (Mar 2023)](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Puro_LCA-Guidelines-for-Suppliers.pdf)
- **SDG Report:** follow the Word template and "Puro SDG Assessment Requirements". Put evidence in a sub-folder per SDG. Public. — LP ADI html. Template v1.2: [SDG reporting template](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Puro%20SDG%20reporting%20template.docx); requirements: [SDG Assessment Requirements v1.0](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Puro_SDG_Assess_Req.pdf)

### Inferences
- The Project Description v2.1 refers to a single "Baseline and Additionality Questionnaire". Under the current templates, the LP's `Puro Additionality HC.pdf` plus the separate PFD and Baseline xlsx may need porting into the v2.0 questionnaire. Confirm with Puro which template set the package version requires.

- **ESS Questionnaire v2.2 (Apr 2026)** contents. It is filled in against GR rule numbers. For most items the supplier answers Yes/No, explains how compliance is known, and lists the "documents or other records that you rely upon to verify compliance". — [ESS Questionnaire](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Puro_Env_&_Soc_Assess.docx)
  - **Section 1, overview and compliance:**
    - 1A: operations and context.
    - 1B: most significant E&S impacts and risks, and how they were assessed.
    - 1C: compliance with national and local law (GR 6.4.1.1.i), including CDR-specific regulations.
    - 1D: human rights and non-discrimination (ii).
    - 1E: rights of indigenous peoples and local communities, UNDRIP and ILO 169 (iii).
  - **Section 2, labour:**
    - 2A: forced or child labour and fair treatment (iv).
    - 2B: OHS hazards and mitigation (iv).
    - 2C: gender equality and equal pay (v).
  - **Section 3, environment:**
    - 3A: pollution to air, water and soil; noise; vibration; waste; hazardous materials; pesticides (vi).
    - 3B: sensitive or protected areas nearby, biodiversity impacts and mitigation (viii).
    - 3C: soil.
    - 3D: water stress (local conditions, water-sourcing agreements and regulations, measures to minimise consumption).
    - 3E: no conversion of natural forest or HCV habitat.
  - **Section 4, social:**
    - 4A: community health and safety, routine and non-routine (vii).
    - 4B: cultural heritage (ix).
    - 4C: forced physical or economic displacement (x).
    - 4D: FPIC if indigenous peoples are affected (sub-items a to h, including the grievance mechanism).
  - **Section 5, biomass sustainability:** 5A, how sustainable sourcing is ensured, cross-referring to the Biomass Sourcing Criteria.
  - **Section 6, indicators:** 6A, E&S indicators to monitor with frequency. "This information is an input to the Monitoring Plan and the Monitoring Report", and must align with the indicator table in the Stakeholder Engagement Report.
- **Stakeholder Engagement Requirements (Edition 2024 v1.1, approved 13 May 2024), Section 2** — [SEP Requirements](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Puro%20Stakeholder%20Engagement%20Requirements.pdf):
  - **When required:**
    - 2.1.1: required for a new Production Facility or substantial design changes.
    - 2.1.2 and 2.1.3: a prior consultation (e.g. one required by local authorities) may suffice. The supplier must then submit how stakeholders were identified and invited, the information provided, the means of consultation, the issues raised, and how feedback was addressed. Puro decides case by case.
    - 2.1.4: a retrofit to an existing site may be exempt from new consultation if no new permits are required and impacts on air, water, biodiversity and communities do not increase. Continuous feedback is still required.
    - 2.1.5: otherwise, host an independent public consultation in a locally common format.
  - **Timing:**
    - 2.2.1: after Puro approves the Production Facility Registration and before the PFA begins.
    - 2.2.2: at least 14 days.
    - 2.2.3 and 2.2.5: all comments consolidated and documented without distortion.
    - 2.2.4: report submitted before the PFA starts.
    - 2.2.7: the report forms part of the project description and is published.
  - **Invitees (2.3.1):**
    - a) local stakeholders;
    - b) land-tenure holders;
    - c) local politicians and authorities;
    - d) local and international NGOs;
    - e) vulnerable and marginalised groups;
    - f) industry experts.
  - **Invitations:**
    - 2.3.3: reach people without internet access.
    - 2.3.4: give a postal address and phone number.
    - 2.3.5: include a sample invitation in the report.
    - 2.3.6: justify any omitted stakeholder group.
  - **Information to share (2.4.1):** non-technical project information and an understandable description of potential positive and negative environmental, economic and social effects.
  - **Grievance mechanism:**
    - 2.5.1 and 2.5.2: a public contact channel that is culturally appropriate and allows anonymous feedback.
    - 2.5.3: respond within a reasonable time.
    - 2.5.4: document the exchanges in the Output Report.
  - FPIC applies if indigenous peoples are affected (2.1.6).
- **GR 6.4.2 to 6.4.4:** E&S documentation must robustly address all material impacts inside and outside the boundary, via an EIA, an environmental permit, an E&S Monitoring Plan, or other documentation approved by Puro. Stakeholder consultation follows local regulation or the Puro SEP Requirements. A policy for continuous stakeholder feedback is required. — [GR 4.4 p.19](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/General%20Rules%204_4.pdf)

### Gaps
- I did not open the SDG reporting template v1.2, the SDG Assessment Requirements or the LCA xlsm template, so their internal fields are not itemised. The ADI says the SDG template "contains all the necessary instructions" and that evidence goes in a sub-folder per SDG.
- I did not review the Additionality Assessment Requirements v2.1 (Jun 2026) text directly. Its requirements are reflected here only through the Baseline and Additionality Questionnaire v2.0.

## Which administrative and legal documents are required?

### Takeaway
Module 01 requires:
- trade registry extracts for the supplier and every operator;
- a signed statement of CO2-removal ownership and audit authorisation;
- contracts or English summaries with operators;
- a host-country NDC/Article 6 evaluation, plus authorisation if needed.

Permits sit in Modules 03, 04, 05 and 06 as "Legal documentation" of the capture site, logistic chain and storage site. Monitoring access rights are needed at every stage.

### Cited Findings
- **Trade registry extract (supplier):** "A certified trade registry extract or similar official document stating that the organization is validly existing" (3.3.1). — LP ADI
- **Trade registry extract (other operators):** for the capture operator, storage operator and logistics operators if different from the supplier (3.3.5). — LP ADI
- **Statement of CO2 Removal ownership and audit authorisation**, signed by the supplier and, if relevant, the operators. It must:
  - acknowledge that (i) the supplier is the sole owner of the removal, (ii) co-products cannot be sold with removal attributes, and (iii) operators cannot make removal claims;
  - say how and where (i) to (iii) are agreed, with contract references and excerpts;
  - assure the Puro-appointed auditor the right to visit and inspect sites.

  Rules: 3.3.2, 3.3.5, 3.6.1. — LP ADI
- **Contractual terms between supplier and operators:** contracts or English summaries highlighting compliance elements (3.2.13, 3.3.3 to 3.3.6). 3.3.4 requires a division of responsibilities and liabilities for:
  - monitoring;
  - preventive and corrective measures in case of leakage or reversal;
  - closure and post-closure costs until transfer of responsibility.

  3.3.5 requires:
  - operators' registry extracts;
  - contractual agreement for permanent removal;
  - documentation that the CO2 delivered to an external storage operator will be stored in an eligible reservoir;
  - proof of ownership and no-claim attestations;
  - the right to audit operator documents and equipment.

  — LP ADI
- 3.3.2 (as clarified in v4, Dec 2025): the supplier retains sole ownership of the stored CO2, except where local regulation requires transfer, and in all cases the sole right to the removal. — LP ADI; v4 change log in [GSC v5 p.100](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Geologically_Stored_Carbon_2024_5.pdf)
- 3.3.3: permits or licences to operate every industrial facility in the boundary, including the storage site, and "evidence of possessing the rights to allow for appropriate monitoring at any stage". — LP ADI
- **Host country:** an evaluation of whether the activity falls within NDCs or net-zero plans (3.6.2). If it does, the supplier requests Article 6 authorisation per the Puro Article 6 Procedures. — LP ADI. Current procedures: [Article 6 Procedures v2 (May 2026)](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Puro%20Earth%20Article%206%20Procedures%20v2.pdf)
- **Legal documentation** of the capture site, logistic chain and storage site: "valid permits, authorizations, licenses, or other equivalent regulatory control documents to operate" (3.2.8 to 3.2.10, 3.3.3, 3.8.2, 7.5.1). 7.5.1 requires a document showing the storage site "is duly approved for permanent geological storage of carbon dioxide to the extent required by local regulation". — LP ADI and `03.../_Legal documentation of the *.txt`
- **GR double registration (3.5.3.2):** the supplier must declare any registration with other programmes, and any rejection with its reason. — [GR 4.4 p.14](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/General%20Rules%204_4.pdf)
- **KYC and Platform Agreement** are preconditions (GR 2.2.4.1). — [GR 4.4](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/General%20Rules%204_4.pdf)

### Inferences
- Tax registration certificates and biomass-supplier trade licences are not explicit ADI items. They support KYC, the existence of operators, and feedstock traceability (supplier identity under Biomass Sourcing Criteria A-O2 and C-O2).

## Which biomass and biogenic-origin evidence is needed?

### Takeaway
At the Facility Audit the supplier submits:
- the Biomass sourcing form, declaring feedstock categories and the evidence available per delivery;
- the CO2 Stream Characterisation (purity plus biogenic share and method).

From the Output Audits onward, the supplier provides per-delivery records (ID, date, amount, waste type, area, delivering entity) and periodic 14C results.

### Cited Findings
- **Biomass Sourcing Criteria v1.3, category A** (mixed MSW and assimilated waste, "as well as refuse derived fuel and assimilated industrial waste"):
  - per delivery: A-O1 ID number, date, amount, waste type (local classification); A-O2 geographic area of supply and name of the delivering entity;
  - the information must be "sufficient to exclude situations where waste is deliberately produced for the purposes of providing biomass for CDR";
  - sustainability criteria: none beyond this.

  — [Biomass Sourcing Criteria v1.3 p.5](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Clarification/Puro%20Biomass%20Sourcing%20Criteria%20v1.3.pdf)
- **Category C** (end-of-life wood, including construction and demolition wood):
  - per delivery: ID, date, amount, material grade (hazardous or not), area, delivering entity;
  - sustainability C-S1: if the wood is hazardous waste, show adequate risk management, evidenced by an authorisation to process hazardous waste (C-E1) or a regulatory framework (C-E2).

  — [Biomass Sourcing Criteria v1.3 p.6](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Clarification/Puro%20Biomass%20Sourcing%20Criteria%20v1.3.pdf)
- Origin and type are demonstrated by "delivery notes, photographic evidence, laboratory analyses, as necessary". — [Biomass Sourcing Criteria v1.3 p.5](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Clarification/Puro%20Biomass%20Sourcing%20Criteria%20v1.3.pdf)
- Chain of custody follows ISEAL models: segregation or mass balance, with only batch-level or site-level mass balance allowed. — [Biomass Sourcing Criteria v1.3 p.29](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Clarification/Puro%20Biomass%20Sourcing%20Criteria%20v1.3.pdf)
- Category P (land-clearing biomass) may be processed, but no CORCs are issued for it. — [Biomass Sourcing Criteria v1.3 p.30](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Clarification/Puro%20Biomass%20Sourcing%20Criteria%20v1.3.pdf)
- **CO2 Stream Characterisation** must cover "i) composition aspects (e.g. purity levels, nature of impurities) and ii) source eligibility (share of fossil and biogenic carbon dioxide…)". It must detail methods and measurement locations, with reference to the monitoring plan (sub-rule 4.4.5c). — LP `04.../_CO2 Stream Characterisation.txt`
- Output Audit module "Biomass" instruction: "Please refer to the Puro Biomass Sourcing Criteria, and upload evidence required for the biomass used." — LP ADI html (Output Audit section)

### Inferences
- **Share of biogenic CO2 in kiln gas:** 14C per ISO 13833 or ASTM D6866 on the captured stream is the required method. Fuel-based estimates alone are not acceptable for mixed sources under 4.4.5(c).
- **F_eligible biomass:** the weighbridge reports per supplier and the deliveries' waste classification are the core records.
- **Tyres:** for tyre-derived fuel, verify that the category and eligibility rationale is accepted by Puro before the audit.

### Gaps
- The Biomass Sourcing Criteria have no explicit category for end-of-life tyres (no "tyre" or "rubber" in v1.3 text). I found no Puro guidance on tyre-derived biogenic carbon.

## Which storage-site evidence is needed for mineralisation?

### Takeaway
Module 06 needs:
- a technical overview of the storage site;
- legal documentation, including a CO2-storage permit or approval (7.5.1);
- site characterisation (7.5.2);
- because the UAE is outside the pre-approved list, a Legal framework dossier against Table 1, approved in writing by Puro before the audit.

Module 07 needs a storage-site monitoring plan covering 7.2.6, 7.3.1 to 7.3.5, 7.5.3, 7.6 and 7.7. The "depleted reservoir" evidence does not apply.

### Cited Findings
- **Storage site description:** "A technical overview of the storage site(s)… in any format, e.g. presentations, maps, flowcharts, engineering drawings." Rules: 3.2.6, 3.2.7, 3.2.11 to 3.2.13. — LP `06.../_Storage site description.txt` and ADI
- **Storage site characterisation (7.5.2):** documentation that the site meets local minimum suitability criteria and how suitability was assessed. Examples:
  - local requirements;
  - experimental and computational methods: capacity, areal and vertical extent, pore space, geomechanical, geochemical and flow properties, seismic and geologic surveys, offset wells, earth models, numerical simulations;
  - a discussion of implications for long-term behaviour (injectivity, trapping) and for monitoring needs.

  Placed in sub-folder "Site characterisation". — LP ADI
- **Storage site monitoring plan:** 7.2.6 requires a detailed description of:
  - operational monitoring of the CO2 stream;
  - "Monitoring the CO2 plume or CO2 charged water";
  - monitoring release pathways based on the risk assessment;
  - environmental monitoring to detect and quantify release.

  — LP ADI
- **Post-injection and closure:**
  - 7.7.1: retain access.
  - 7.7.2: monitor until transfer of responsibility or as local rules require.
  - 7.7.3: pressure decay and charged-water location must match the reservoir model.
  - 7.7.4: closure criteria (a) to (e).
  - 7.7.5: well integrity.

  — LP ADI
- **Emergency:** the chemical plan emergency procedures (3.8.6(e)), and Table 1's requirement for emergency and remedial response in the legal framework. — LP ADI; [GSC v5 p.19](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Geologically_Stored_Carbon_2024_5.pdf)
- **Injection-leak monitoring** (7.6.3): monthly, and **corrosion monitoring** (7.5.3): periodic. — LP ADI

### Inferences
- **MRV of mineralisation rate:** GSC does not require a minimum mineralisation rate or credit only mineralised carbon. Permanence relies on immediate solubility trapping (bubble point plus 5 bar) and on monitoring. Tracer and geochemical monitoring of the charged water nonetheless supports 7.6.1 and 7.7.3 and the risk assessment (8.5.3).

### Gaps
- GSC has no explicit "mineralisation rate" MRV requirement; I found none in the extracted rules.

## Which additionality and baseline evidence is required?

### Takeaway
The supplier must show:
- the baseline selection: bio-CCS Retrofit for an existing kiln, since New-built requires capture within 48 months of the plant's commissioning;
- regulatory additionality;
- that the Commitment Date is no more than 3 years before the PFA;
- financial additionality via exactly one of cost, investment or barrier analysis, with unlocked Excel models;
- consistency with the LCA and with investor information.

### Cited Findings
- 3.4.3(a): the bio-CCS Retrofit baseline means the conversion facility exists but has no capture unit. 3.4.4: New built only if capture is installed within 48 months of the facility's initial commissioning. The supplier must also state whether the transport and storage infrastructure is new or repurposed. — LP ADI extract
- 3.5.1: not required by law, and removals result from carbon finance, per the Additionality Assessment Requirements. — LP ADI; [Additionality Assessment Requirements v2.1](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/Puro%20Standard%20Additionality%20Assessment%20Requirements%20v2.1.pdf)
- GR 6.5.1 to 6.5.4: regulatory, CO2 and financial additionality. The baseline must be "project-specific, conservative, and updated for every renewal of a Crediting Period". — [GR 4.4 p.19](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/General%20Rules%204_4.pdf)
- The Baseline and Additionality Questionnaire v2.0 items (1E Commitment Date at most 3 years; 1F common practice; spreadsheets with readable, unprotected formulas; sensitivity analysis; consistency checks) are listed above. — [Baseline and Additionality Questionnaire v2.0](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Puro%20Baseline%20and%20Additionality%20Questionnaire%20-%20v2.0.docx)

### Inferences
- LP sub-folders "2.1 Evidence of operation in 2007" and "2.3 Capture equipment installation" map to 3.4.4. The capture unit was clearly installed more than 48 months after the kiln's commissioning, so the baseline is Retrofit.
- "Pilot project Cost Analysis.xlsx" maps to Simple Cost Analysis or Investment Analysis.
- Evidence of the Commitment Date is needed, e.g. the equipment purchase contract or capture-unit order.

## Mapping onto the 11 LP sections, and possible gaps

### Takeaway
The LP covers most ADI items. Possible gaps or points to check:
- signed ownership and audit-authorisation statement;
- trade registry extracts for the storage and logistics operators;
- Biomass sourcing form (a Puro template);
- standalone water usage management plan;
- data-system screenshots;
- "Contact information to auditor" xlsx at the root;
- Commitment Date evidence;
- 14C radiocarbon results;
- a Puro written approval of the legal framework;
- host-country Article 6 authorisation decision;
- template-version alignment with GSC v5 and the Baseline and Additionality Questionnaire v2.0;
- leftover .txt and Word duplicates, which must be removed before submission.

### Cited Findings
LP folder listing (`ls -R` of `/Users/varanik/Desktop/4401/Apps/MinRVAtlas/docs/1. Final Submission/`) checked against the ADI evidence pieces in `Audit Document Index - GSC.html`:

| LP section | ADI evidence pieces (rules) | What is in the LP (file names only) | Possible gaps |
|---|---|---|---|
| 01 Administrative | Trade registry: supplier (2.1.1, 3.3.1, 3.3.5); other operators (3.3.5); Statement of ownership and audit authorisation (3.3.2, 3.3.5, 3.6.1); Contractual terms with operators (3.2.13, 3.3.3 to 3.3.6); Host-country evaluation (3.6.2); Host-country authorisation (3.6.2) | Commercial registration, certificate of incorporation, trade and industrial licences, tax registration certificate, executed CO2 offtake agreement, host-country climate objectives evaluation; 1.1 biomass supplier licences (RDF, tyre, wood) | No visible signed statement of CO2-removal ownership and audit authorisation. Registry extract for the storage-site operator and logistics (truck) operator not visible. Contracts or English summaries covering 3.3.4 liabilities (monitoring, leakage response, closure costs), monitoring-access rights and right to audit should be checked. Article 6 authorisation, or the conclusion that none is needed, should be stated in the ADI. The 1.0 Puro Description folder is empty. |
| 02 Additionality and baseline | PFD and Baseline Scenario xlsx (2.2.1, 3.2.1, 3.4.1 to 3.4.4); Additionality questionnaire plus financial model (3.5.1) | PFD and Baseline xlsx, additionality PDF and docx, pilot cost analysis xlsx, evidence of 2007 operation, biomass delivery (weighbridge reports Jan and Jul to Nov 2025), capture-equipment installation (inspection request, mechanical completion, torquing report) | Check against Baseline and Additionality Questionnaire v2.0 (Commitment Date at most 3 years, common practice, net-zero alignment 1C). Commitment Date evidence (equipment contract) not visible. Weighbridge reports Feb to Jun 2025 absent. |
| 03 E&S safeguards | SEP report (3.8.3); ESS questionnaire (3.8.1 to 3.8.3, 3.8.5); Risk assessment (8.5.x); Chemical management plan (3.8.6); Water usage management plan (3.8.5); Legal docs capture, logistics, storage; Other studies | ESS PDF and docx, SEP report PDF and docx, EIA, SIA, uncertainty and risk register, MSDS (solvent, caustic), emergency preparedness SOP, HSE SOPs, NOC, HR policy, labour law, HMR reports | No standalone water usage management plan visible; if it sits in another document, the ADI must say where. Chemical management plan appears as MSDS plus SOPs; check 3.8.6(a) to (e) coverage. Other studies should go in an "Other studies" sub-folder. Logistic-chain legal documents (truck operator dangerous-goods permits) not visible. |
| 04 Capture site | Capture site description template (3.2.3, 3.8.5, 3.8.6); CO2 Stream Characterisation (3.2.2, 4.4.5); Legal documentation of capture site; 04.1 Biomass sourcing form (3.2.4, 3.7.1 to 3.7.3, 6.2.2, 6.3.5) | GSC capture-site input xlsx, CO2 stream characterisation PDF, capture skid process description, technical report, two CCUS NOCs, biomass sourcing summary plus supplier evidence and weighbridge reports | Biomass sourcing form appears as a "summary" rather than Puro's form; confirm template use. Check that 14C (ISO 13833 or ASTM D6866) results or a sampling plan are in the CO2 stream characterisation. |
| 05 Transport and logistics | Logistic chain description (3.2.13); Legal documentation of logistic chain (3.2.9, 3.2.10, 3.3.3, 3.8.3) | Logistic chain PDF and pptx | No legal documents for the logistic chain visible (haulier licence, dangerous-goods or tanker permits, LCO2 intermediate storage permits). |
| 06 Storage site | Storage site description; Legal documentation (3.2.8 to 3.2.10, 3.3.3, 3.8.2, 3.8.3, 7.5.1); Site characterisation (7.5.2); Depleted reservoir (3.2.7, not applicable); Legal framework (3.2.11, required for the UAE) | Storage site PDF and pptx, monitoring programme, NOCs, legal framework PDF and docx, reservoir modelling, emergency SOP, offtake agreement | Puro's written approval of the legal framework should be attached. Characterisation should sit in a "Site characterisation" sub-folder. Confirm a document showing the storage site is approved for permanent CO2 storage (7.5.1). The "Depleted reservoir" .txt should be marked Not Applicable in the ADI. |
| 07 Monitoring plan | Monitoring plan (3.2.5, 3.3.6, 4.x, 5.3.x, 7.2 to 7.6, 8.5.4); Storage monitoring plan (7.2.6, 7.3, 7.5.3, 7.6, 7.7); Data systems (4.2.5, 4.2.7, 7.2.2, 8.5.5); Uncertainty approach plus initial Excel (4.8.x) | Monitoring programme, capture and transport monitoring programme, quantification uncertainty assessment, digitalisation scope of work | Data systems evidence should be screenshots or a schema of a working system; a scope of work may be judged insufficient. Initial uncertainty quantification should be an Excel file; only a PDF is visible. |
| 08 Leakage | Leakage Determination form (4.6, 6.x) | Leakage Determination xlsx plus supporting grid and energy-strategy documents | — |
| 09 LCA | LCA report plus calculation files (4.5, 5.1, 5.2.1 to 5.2.22, 5.3) | LCA report PDF, LCA xlsm, utility lists, packing lists | Re-check against v5 amortisation (15 or 20 years) and mass-balance attribution (5.2.12, 5.2.13). The xlsm must be renamed from the template name. |
| 10 SDGs | SDG report plus evidence per SDG (3.9) | SDG report PDF and docx | Per-SDG evidence sub-folders not visible. The "10.0 Puro Description" .txt duplicates the Project Description text. |
| 11 Project description | Project Description (3.8.3; GR 2.2.4.2) | PD PDF and docx | Confirm template v2.1 (Apr 2026) is used. |
| Root | ADI xlsx and html, README, Contact information to auditor xlsx | ADI xlsx and html, README | **Contact information to auditor .xlsx missing** at the root. |

Further LP notes:
- The README requires deleting .txt files, blank templates and drafts, and avoiding duplicates. Several modules hold both PDF and "Word docs" copies plus "Puro Description" .txt folders. — LP README
- The README says not to create sub-folders for a single document. — LP README

### Inferences
- Puro screens packages for completeness before the VVB sees them (README; GR 2.2.4.1). Missing evidence or comments in the ADI xlsx "Remarks" column will cause revision requests before the audit starts.

## Common reasons for findings or non-conformities on GSC and BECCS facility audits

### Takeaway
No public, text-searchable GSC or BECCS facility-audit reports listing specific findings were found. The one GSC audit report located is a scanned PDF and could not be read.

Puro's own rules show how findings are classified and what Puro checks. Under Certification Procedures v1.1 (24 Aug 2026), a major or critical non-conformity at a validation (Facility) audit means the project is rejected, with re-application allowed after 12 months.

The highest-risk areas for this facility type, per Puro's mandatory review checklist and package instructions, are:
- eligibility of CO2 and biomass sources;
- credit quantification;
- methodology version;
- consistency between additionality, LCA and the monitoring plan;
- missing evidence;
- non-disclosure of other registrations.

### Cited Findings
- Finding types (Certification Procedures v1.1, approved 24 Aug 2026) — [Certification Procedures v1.1](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Clarification/Puro.earth%20Certification%20Procedures%20v1.1.pdf):
  - The VVB may raise clarification requests (CL) and critical, major or minor non-conformities, addressed by corrective action requests (CARs) and forward action requests (FARs).
  - A non-conformity arises when the operator is "insufficiently compliant" or "fails to provide the requested evidence to prove compliance within the agreed timeframe" (6.1.1).
  - Puro confirms the classification (6.1.4).
- Critical non-conformities (6.2.2) include methodology non-compliance, deliberate misstatement of the project description and falsified GHG data. "If a critical non-conformity is identified during a Validation audit, the Project Activity shall be Rejected" (6.2.3). — [Certification Procedures v1.1](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Clarification/Puro.earth%20Certification%20Procedures%20v1.1.pdf)
- Major non-conformities (6.3.3) include:
  - "systematic problems with GHG data reported";
  - "omission of an Operator to declare its participation in other carbon credit certification schemes";
  - "failure to provide relevant information to the VVB".

  "If a major non-conformity is identified during a Validation audit, the Project Activity shall be rejected" (6.3.4). Re-application is possible after 12 months (6.3.8). — [Certification Procedures v1.1](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Clarification/Puro.earth%20Certification%20Procedures%20v1.1.pdf)
- Minor non-conformities (6.4.4) include:
  - insufficient evidence that does not cause a system breakdown;
  - mistakes in assumptions, data or calculations that could influence future results;
  - aspects to verify in the next cycle.

  They are resolved during the audit or waived to the next audit. Remediation is due within 12 months or before the next verification, whichever is earlier. — [Certification Procedures v1.1](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Clarification/Puro.earth%20Certification%20Procedures%20v1.1.pdf)
- Puro's minimum audit-report review (Table 3) checks, for every report:
  - operator, activity and audit type;
  - VVB eligibility and rotation;
  - methodology version;
  - "Eligibility of CO2 sources or biomass sources";
  - credit quantification;
  - critical and major non-conformities;
  - the conclusion.

  A full review adds:
  - additionality;
  - the PAD;
  - LCA;
  - uncertainty and reversal risk;
  - monitoring;
  - stakeholder consultation;
  - E&S safeguards;
  - SDGs;
  - all CLs and CARs and the VVB–operator communication log.

  Full review is always applied for a new client, new methodology or new VVB, and case by case for "Use of renewable energy/biomass" (8.2.5). — [Certification Procedures v1.1](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Clarification/Puro.earth%20Certification%20Procedures%20v1.1.pdf)
- Under GR 4.4, an unsuccessful Production Facility Review lists non-conformities. The supplier has 30 days to address them and one resubmission (2.2.5.2 and 2.2.5.3). — [GR 4.4 p.7](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/General%20Rules%204_4.pdf)
- The GSC audit report for a US ethanol BECCS facility is hosted on CarbonMeld as a scanned PDF without a text layer, so its findings could not be extracted. — [CarbonMeld document](https://carbonmeld.com/docs/red-trail-energy-llc-e3a0d8/b9690b80fdf17bdd.pdf)
- GR 2.2.5.2 and 2.2.5.3: an unsuccessful Production Facility Review lists non-conformities. The supplier gets 30 days to address them and resubmit once for re-review. — [GR 4.4 p.7](https://7518557.fs1.hubspotusercontent-na1.net/hubfs/7518557/Supplier%20Documents/General%20Rules%204_4.pdf)
- Puro's own consistency checklist flags typical failure points: financial additionality inconsistent with LCA assumptions, design or feedstock inconsistent with LCA, monitoring plan inconsistent with LCA, PD inconsistent with other evidence, unexplained missing documents, leftover templates, and confidential data in public files. — LP README

### Inferences
Each item below is the likely finding area for this facility type, inferred from the rules cited above:
1. **Biogenic fraction (F_eligible source).** Using fuel-input estimates instead of 14C on the captured stream for a mixed-source kiln conflicts with 4.4.5(c), as does having no 14C sampling plan or no representativeness rationale. Expect a CL or CAR; Puro's Table 3 lists source eligibility as a check on every report.
2. **Biomass eligibility (F_eligible biomass).** Likely problems:
   - per-delivery records missing or incomplete (ID, date, amount, waste type, area, deliverer);
   - gaps in weighbridge records (Feb to Jun 2025 are not in the LP);
   - an unclear category or eligibility for tyres;
   - hazardous-wood authorisation missing (C-S1).
3. **Methodology version mismatch.** The LP ADI is v1 while the current GSC is v5. LCA amortisation and mass-balance attribution must follow the version under which the audit runs. Puro checks "Methodology version" on every report.
4. **Legal framework.** The jurisdiction is not pre-approved. Without Puro's written pre-audit approval of the Table 1 evidence, the audit should not start.
5. **Storage permit (7.5.1).** No-objection certificates may not equal an explicit "approval for permanent geological storage". The auditor will test this against 3.2.8 and 7.5.1.
6. **Contracts (3.3.4 and 3.3.5).** Likely problems:
   - no explicit division of liabilities for monitoring, leakage response and closure costs;
   - no right to audit the operators;
   - no sole-claim or no-claim wording binding the cement plant and the storage operator;
   - the signed ownership statement missing.
7. **Monitoring plan completeness (7.2.5(d)).** Each of the following needs parameters, methods, accuracy, location, frequency and thresholds:
   - truck delivery reconciliation (7.4.4(b));
   - bubble point (7.3.5);
   - water flow (7.3.1);
   - calibration at most 5% (7.2.9);
   - solvent consumption (7.4.3).
8. **Data systems (4.2.5, 7.2.2).** A scope-of-work document rather than evidence of an operating, time-stamped system.
9. **Uncertainty.** No Excel initial quantification; per-term uncertainty not addressed.
10. **Consistency.** Additionality financials, LCA inputs (energy, solvent, transport distances, amortisation), the monitoring plan and the project description must agree; this is the README checklist item 1.
11. **Water and chemical plans (3.8.5, 3.8.6).** Water-stress context (ESS 3D) and the amine-solvent exposure thresholds and emergency plan must be explicit. The ADI must say where they sit if they are not standalone documents.
12. **Stakeholder engagement.** Consultation must happen after registration approval, run at least 14 days, include a sample invitation, cover the required groups, and provide a grievance channel. Otherwise a documented justification is needed, either a retrofit exemption or prior consultation (SEP 2.1.2 to 2.1.4).

### Gaps
- No public list of actual VVB findings on Puro GSC or BECCS Facility Audits was found. Public registry audit reports were either scanned images or not located. The items above are inferred from Puro's rules, not observed audit outcomes.
- No source was found that compares how different VVBs handle mineralisation or dissolved-CO2 storage under Puro GSC.
