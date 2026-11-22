# Isometric validation documents: PDD and evidence for biogenic CO2 captured at a cement site, liquefied, trucked, and stored by in-situ mineralisation

Research date: 14 November 2026. Scope: documents, descriptions and evidence for validation (not onboarding process, fees or timelines).

**Documents relied on (versions as served on registry.isometric.com / docs.isometric.com in Nov 2026).** The registry pages show a version number in the title but no publication date; the only date shown is the footer "© 2026 Isometric HQ Ltd", and the changelog pages list versions without dates. Treat "current as of Nov 2026" as "the version served by the unversioned URL on 14 Nov 2026".

| Document | Version | URL |
|---|---|---|
| Isometric Standard | v2.2 (cites itself as "Isometric Standard (2026), version 2.2"; first published 4 Oct 2023) | https://registry.isometric.com/standard |
| Biogenic Carbon Capture and Storage (Bio-CCS) Protocol | v1.5 (unversioned URL serves v1.5) | https://registry.isometric.com/protocol/biogenic-capture-and-storage ; changelog https://registry.isometric.com/protocol/biogenic-capture-and-storage/1.5/changelog |
| CO2 Storage via In-situ Mineralization in Mafic and Ultramafic Formations Module | v1.2 (unversioned URL serves v1.2) | https://registry.isometric.com/module/in-situ-mineralization/1.2 |
| Biomass Feedstock Accounting Module | v1.4 | https://registry.isometric.com/module/biomass-feedstock-accounting |
| GHG Accounting Module | v1.1 | https://registry.isometric.com/module/ghg-accounting |
| Energy Use Accounting Module | v1.3 | https://registry.isometric.com/module/energy-use-accounting |
| Shared CO2 Transport Infrastructure Module | v1.0 (referenced by Bio-CCS v1.5; not read directly) | https://registry.isometric.com/protocol/biogenic-capture-and-storage |
| Certify user guides: Project Design, Validation, Data visibility; Support: PDD quality best practice | live docs, undated | https://docs.isometric.com/user-guides/certify/project-design.md ; https://docs.isometric.com/user-guides/certify/validation.md ; https://docs.isometric.com/user-guides/certify/data-visibility.md ; https://docs.isometric.com/support/validation-and-verification/pdd-quality-best-practice.md |

Local file `docs/isometric-insitu-mineralization-submit-path.md` (dated "as of September 2026") was checked against these sources; corrections are flagged inline as **[local-doc check]**.

---

## 1. What is the structure of the Isometric PDD? Is there a published template or guidance?

### Takeaway
There is no downloadable Word/PDF PDD template. The PDD is a structured, requirement-by-requirement checklist inside Isometric Certify, generated from the Standard + the chosen protocol + the chosen modules, grouped into five sections; each requirement (identified by an `R-`/`G-` shortcode) is answered in a rich-text form and backed by categorised evidence files. The Standard §3.2 is the master list of PDD content; the protocol and modules add their own items.

### Cited Findings
- The PDD and its supporting evidence are drafted, submitted and reviewed in Certify. — [Certify: Project Design](https://docs.isometric.com/user-guides/certify/project-design.md)
- Requirements are generated from three sources: the Isometric Standard, the protocol the project is credited under, and any applicable modules. Each shows a shortcode (e.g. `R-NK7R-0`) and a link to the governing document. Newer requirements may depend on the pathway; the Registry Operations Manager (ROM) advises on drafting during onboarding. — [Certify: Project Design](https://docs.isometric.com/user-guides/certify/project-design.md)
- The five requirement sections: "Project setup", "Protocol & monitoring", "Environmental & social", "Stakeholder input", "Pathway specific". — [Certify: Project Design](https://docs.isometric.com/user-guides/certify/project-design.md)
- Responses support headings, lists, tables, hyperlinks, inline images, equations and references; each requirement can be given a drafting stage (e.g. "Peer Review", "Complete"); a progress bar tracks unanswered items. — [Certify: Project Design](https://docs.isometric.com/user-guides/certify/project-design.md)
- Evidence upload: each file needs a category, the reason it is attached, and the relevant pages. The 11 categories are: Plan / Assessment (monitoring, MRV, implementation plans; baseline, additionality, risk, leakage analyses; EIAs, SIAs, LCAs, HSE plans); Technical Drawing / Diagram (P&IDs, process flows, plant layouts, mass-balance and chain-of-custody diagrams); Specification (equipment specs, data sheets, SDS); Lab Result; Operational Record (delivery records, weigh tickets, logs, batch records, calibration records); Model / Calculation (carbon, LCA, financial, uncertainty models, emission factors); Permit / Certificate (environmental and construction permits, ISO certifications, lab accreditation, incorporation certificates); Contract / Affidavit (offtake, supplier, land agreements; ownership and rights affidavits); Stakeholder Record (meeting reports, consultation records, minutes, grievance mechanisms); Reference / Evidence (papers, photos, geospatial files, invoices); Other. — [Certify: Project Design](https://docs.isometric.com/user-guides/certify/project-design.md)
- Remi (Isometric's AI review agent) can be run per requirement; its issues must be resolved or disputed before the pre-screen submission; "Request validation" becomes enabled when all tasks are complete; reviewers (Isometric at pre-screen, the VVB at validation) accept responses or log issues, which the supplier marks "addressed" or "disputed" with rationale. — [Certify: Project Design](https://docs.isometric.com/user-guides/certify/project-design.md)
- Isometric's PDD-quality FAQ: every sub-requirement under a requirement must be explicitly addressed; VVBs "typically raise an issue against any sub-requirement that is missing or unanswered"; "Evidence attachments are encouraged, but should not replace a written explanation" — explain what each attachment shows, quote the relevant text and give page numbers. — [Support: PDD quality best practice](https://docs.isometric.com/support/validation-and-verification/pdd-quality-best-practice.md)
- The pre-screen package is the PDD **and the LCA**, both submitted in Certify. — [Certify: Validation](https://docs.isometric.com/user-guides/certify/validation.md)

#### Master PDD content list — Isometric Standard v2.2 §3.2 (all project types + Removals)
Source for every row: [Isometric Standard v2.2 §3.2](https://registry.isometric.com/standard)
- Project title, purpose(s) and objective(s).
- Project type, technologies, products, services, infrastructure and how the activity achieves its outcome (`R-7X0X-1`); facilities, equipment and other information needed to understand the mechanism (`G-VCST-0`).
- At least one address and/or geo-coordinates; for multiple locations, the role of each (`R-A5B6-0`).
- Anticipated quantity of net removals (tCO2e) (`R-XT6V-1`).
- Risks that could substantially affect outputs and management measures (`R-5MFP-0`).
- Roles, responsibilities and contact details of each organisation: name, role, company number, address, contact person, email, phone (`R-F6R7-0`).
- Summary environmental impact assessment.
- Chronological plan / actual dates, with justification, for Project Start Date, baseline period and Crediting Period.
- Description of the data collection and storage approach (`R-GYA1-0`).
- Removals-specific: pre-project conditions supporting the counterfactual; monitoring plan (monitored elements, monitoring and reporting frequency, project steps, equipment, methods, accuracy and calibration, responsibilities, QA/QC); project Risk of Reversal (at least the protocol value; increases justified); compatibility with the net-zero transition with reference to host country target / NDC / long-term strategy, or a statement where none exists (`R-S9BB-0`); system boundary and all GHGs across SSRs with justification of exclusions; anticipated uncertainty approach; stakeholder consultations, ongoing communication mechanisms and outcomes.
- Project Durability Threshold must be chosen in the PDD (`R-7C8E-1`) and durability above it demonstrated (`R-1T2Y-1`); default threshold 1,000 years where a protocol does not specify (§2.5.7).
- Regulatory compliance in every applicable jurisdiction must be identified in the PDD (`R-KQCS-0`, §3.9).
- Scheme-hopping disclosure: participation in other schemes in the last five years, audit reports and withdrawals (`R-Q3JN-0`, §5.7.3).

### Inferences
- In practice the "PDD" a VVB reads is the set of Certify requirement responses plus the attached evidence, and the redacted export published on the registry. A supplier who drafts offline should mirror the five Certify sections and keep a shortcode-to-evidence index.
- Because the requirement list is generated per protocol/module combination, the exact list for a Bio-CCS + in-situ mineralisation project can only be confirmed in Certify once the project is created with those selections.

### Gaps
- No published static PDD template (DOCX/PDF) from Isometric was found; the Certify checklist appears to be the only "template".
- I could not retrieve a published registry PDD for a Bio-CCS project or an in-situ mineralisation project to use as a worked example (registry project listings did not render to the fetch tool; searches returned only protocol pages).

---

## 2. What general requirements does the Isometric Standard place on project documentation?

### Takeaway
Isometric Standard v2.2 requires the PDD to evidence: a defined temporal/geographic boundary and cradle-to-grave system boundary; a no-project baseline reflecting current law; additionality on four pillars (financial, common practice, regulatory, environmental); durability ≥1,000 years and a risk-of-reversal rating feeding a buffer pool (geological storage = Very Low = 1%); quantified leakage; a conservative uncertainty approach with sensitivity analysis; no net environmental or social harm with a closure plan; a documented stakeholder consultation and grievance mechanism; legal ownership by one sole Project Proponent; disclosure of other schemes (no double issuance); and host-country net-zero compatibility and regulatory compliance.

### Cited Findings
**Boundary and baseline**
- Projects need a defined temporal and geographic boundary (`R-VHWJ-0`); the system boundary must at minimum cover construction/manufacturing, operation and closure/disposal (§2.5.2.1). — [Isometric Standard v2.2](https://registry.isometric.com/standard)
- Projects are assessed against a no-project scenario (`R-PGFH-1`); baselines must reflect existing government policies or legal requirements (`G-53YK-1`) and are reassessed at each Crediting Period renewal (§2.5.3.1). — [Isometric Standard v2.2](https://registry.isometric.com/standard)

**Additionality (§3.5)**
- Four pillars: financial, common practice, environmental, regulatory. — [Isometric Standard v2.2](https://registry.isometric.com/standard)
- Financial: acceptable without further analysis if removals are the main purpose and the only revenue source; otherwise an IRR analysis over at least 10 years with ±20% scenario testing (`G-NTMA-1`, `G-9FFZ-0`, §3.5.1.2.1). — [Isometric Standard v2.2](https://registry.isometric.com/standard)
- Common practice: technologies below TRL 8/9 may be deemed additional; otherwise a market-penetration test (<20%) or discrete-facility test (N_all ≤ 3 or F ≤ 20%) (§3.5.1.1). — [Isometric Standard v2.2](https://registry.isometric.com/standard)
- Regulatory: demonstrate there is no legal requirement for the activity, or that the project exceeds it (`R-983D-0`, §3.5.1.3). — [Isometric Standard v2.2](https://registry.isometric.com/standard)
- Environmental: net climate impact must be negative after counterfactual and leakage (`R-CDNF-1`). — [Isometric Standard v2.2](https://registry.isometric.com/standard)
- Bio-CCS adds: additionality reviewed at least each Crediting Period or sooner if regulation, legal obligations or project financials change significantly; a non-additional finding stops future issuance but does not affect past credits (§6.4). — [Bio-CCS Protocol v1.5](https://registry.isometric.com/protocol/biogenic-capture-and-storage)

**Permanence, durability and reversal**
- Default Durability Threshold 1,000 years (§2.5.7); a Project Durability Threshold is chosen in the PDD (`R-7C8E-1`) and must be demonstrated (`R-1T2Y-1`). — [Isometric Standard v2.2](https://registry.isometric.com/standard)
- Protocols categorise Risk of Reversal to set the buffer (`R-V143-1`); Appendix C questionnaire is the default (`G-EP06-1`). Buffer contributions: no observable risk 0%, very low 1%, low 5%, medium 7%, high 10–20% (§5.6). Exemptions include projects under an equivalent regulatory scheme (the EU CCS Directive is listed). Potential reversals must be reported within one business day where possible and no later than three (`G-F1WD-1`). — [Isometric Standard v2.2](https://registry.isometric.com/standard)

**Leakage and uncertainty**
- Projects must assess leakage including upstream and downstream effects; identified leakage is quantified and deducted (§3.6). — [Isometric Standard v2.2](https://registry.isometric.com/standard)
- All parameters must be listed with a sensitivity analysis (`R-2AVD-1`); conservative estimate by one of: conservative inputs (≤16th/≥84th percentile), variance propagation (≥1 SD below mean) or Monte Carlo (≤16th percentile) (§3.7.1). — [Isometric Standard v2.2](https://registry.isometric.com/standard)

**Environmental and social impacts (§3.10)**
- Consider material E&S impacts inside and outside the boundary; at minimum "do no net harm"; remediate unintended harm (`R-X9EC-0`). Define closure conditions and a closure plan including post-closure actions (`R-6VFZ-0`). For each impact area show risk assessment and mitigation (`G-TGC2-0`); justify in the PDD any risk deemed not applicable (`G-E57Q-0`). Third-party EIA/SIA suggested for all projects and required if impacts are significant or the host jurisdiction requires it (`G-1T3C-0`). — [Isometric Standard v2.2](https://registry.isometric.com/standard)
- Environmental: no net environmental harm (`R-4K5P-0`); address air emissions, water discharges, noise, vibration, waste, hazardous materials (`G-NEZ1-0`); biodiversity (`G-93TP-0`). Social: no net social harm (`R-R81B-0`); labour rights (`G-WRPB-0`); avoid displacement (`G-GDJ0-0`); IPLCs and cultural heritage incl. ILO 169, UNDRIP and FPIC where negative impacts (`G-42DN-0`); human rights and gender-based violence (`G-QQ9A-0`). SDGs: show consistency with relevant SDGs, qualitative assessment of co-benefits beyond SDG 13, disclose tools used (`R-BWX0-0`). — [Isometric Standard v2.2](https://registry.isometric.com/standard)

**Stakeholder input (§3.8)**
- Consult IPLCs, stakeholders with land-tenure rights, local policymakers; others may include regional/national officials, local NGOs and affected groups. Evidence of meetings must be submitted (`R-ZHRN-1`). — [Isometric Standard v2.2](https://registry.isometric.com/standard)
- Consultation must be iterative (first meeting before project development), accessible (≥14 days' notice, local language, non-technical), transparent (purpose shared in advance, conflicts declared), systematically documented and publicly accessible or available on request (`G-JNW9-0`). — [Isometric Standard v2.2](https://registry.isometric.com/standard)
- Grievance mechanism required (`R-E579-0`); proponent contact details available to all stakeholders (`G-W7XW-0`); acknowledge within 14 days (`G-FWSH-0`); resolve or escalate within 60 days (`G-3HN6-0`); report new grievances to Isometric within 14 days. — [Isometric Standard v2.2](https://registry.isometric.com/standard)

**Ownership and double counting**
- Demonstrate legal ownership and represent it to Isometric (`R-M858-1`); a single Project Proponent is sole owner (`G-0KA1-1`); contracts must relinquish ownership to the proponent and bar other participants from claiming certificates (§3.1). — [Isometric Standard v2.2](https://registry.isometric.com/standard)
- Bio-CCS: where multiple parties are involved (e.g. capture host, transporter, storage operator), one Project Proponent must be contractually named as sole certificate owner (`G-TTWW-0`, §6.3). — [Bio-CCS Protocol v1.5](https://registry.isometric.com/protocol/biogenic-capture-and-storage)
- No double issuance (activity may not be listed on another programme; overlapping GHG boundaries restricted), no double use (public record and unique retirement statements), no double claiming; disclose participation in other schemes in the last five years with audit reports and withdrawals (`R-Q3JN-0`). CORSIA (§5.8): agree compensation for double claims, report corresponding adjustments. — [Isometric Standard v2.2](https://registry.isometric.com/standard)

**Host-country considerations**
- PDD must assess compatibility with the net-zero transition referencing the host country's target, NDC or long-term strategy, or state that none exists (`R-S9BB-0`). — [Isometric Standard v2.2](https://registry.isometric.com/standard)
- PDD must identify how the project complies with regulations in every applicable jurisdiction (`R-KQCS-0`, §3.9). — [Isometric Standard v2.2](https://registry.isometric.com/standard)
- Crediting Period: general maximum 10 years; BiCRS and DAC protocols allow 15 years; renewals unlimited subject to re-validation; Project Start Date no earlier than 5 years before initial registry submission; re-validation if no verification for 12+ months (§3.4). — [Isometric Standard v2.2](https://registry.isometric.com/standard). Isometric extended crediting periods for DAC and BECCS in Feb 2026 — [Carbon Pulse headline, paywalled](https://carbon-pulse.com/486615/); Bio-CCS v1.4 "Incorporates changes from the Isometric Standard update on buffer pools and crediting periods" — [Bio-CCS changelog](https://registry.isometric.com/protocol/biogenic-capture-and-storage/1.5/changelog)

**Validation-level parameters**
- Materiality threshold 5% of net removal for the totality of omissions, errors and misstatements (§4.3). — [Isometric Standard v2.2](https://registry.isometric.com/standard)
- VVBs accredited by an IAF member against ISO 14065 (or other relevant ISO, or governmental body); site visit required during the first validation or verification unless the protocol says otherwise; verification under ISO 14064-3 at reasonable assurance (§4.1–4.2). — [Isometric Standard v2.2](https://registry.isometric.com/standard)

### Inferences
- For a cement host plant, regulatory additionality will need to show that no regulation (e.g. a national CCS mandate or ETS cap) requires the capture; financial additionality will likely need the IRR route because the host facility has other revenue, unless the capture unit is structured as a stand-alone entity whose only revenue is CDR credits.
- Host-country Article 6 / corresponding adjustment requirements beyond CORSIA were not found in Standard v2.2; the PDD will still need the NDC/net-zero compatibility statement (`R-S9BB-0`).

### Gaps
- I did not find Standard v2.2 text on Article 6 letters of authorisation or corresponding adjustments outside the CORSIA section (§5.8); the Standard page text was read in two parts and neither part contained it.
- Appendix C (Risk of Reversal questionnaire) questions were not captured.
- No general record-retention period in the Standard was captured (CRCF section says ≥10 years after the monitoring period; module-specific periods are in Section 4).

---

## 3. Which protocol and modules apply, and what documentation and evidence does each require?

### Takeaway
For biogenic CO2 captured at a point source and stored in mafic/ultramafic rock, the applicable stack is the **Biogenic Carbon Capture and Storage Protocol v1.5** plus the **In-situ Mineralization Module v1.2** (storage), **Biomass Feedstock Accounting Module v1.4** (feedstock eligibility, counterfactual, market leakage, biogenic fraction of wastes), **GHG Accounting Module v1.1** (embodied and transport emissions, amortisation, materiality, data quality) and **Energy Use Accounting Module v1.3** (electricity and heat); the **Shared CO2 Transport Infrastructure Module v1.0** applies only if transport or storage infrastructure is shared. Cement kilns are not named in Bio-CCS eligibility, and kiln calcination CO2 is treated as fossil, so the biogenic fraction (radiocarbon of flue gas, Method A) is central evidence.

### Cited Findings
**Protocol choice — [local-doc check]**
- Bio-CCS v1.5 applies to projects that "capture biogenic CO2 at a point-source" with storage durability >1,000 years; examples are biomass power, CHP, bio-hydrogen, biogas and Energy-from-Waste facilities; the list is non-exhaustive and cement kilns are not named (`G-ZW9X-0`, §4.0). — [Bio-CCS Protocol v1.5](https://registry.isometric.com/protocol/biogenic-capture-and-storage/1.5)
- Bio-CCS v1.5 §9 lists the accepted storage modules: saline-aquifer-storage v1.2, depleted-hydrocarbon-reservoirs v1.1, **in-situ-mineralization v1.2**, ex-situ-mineralization-in-closed-engineered-systems v1.1 (with built-materials-storage v1.1), enhanced-weathering-closed-engineered-systems v1.0 (with dic-storage-in-oceans v1.0). — [Bio-CCS Protocol v1.5](https://registry.isometric.com/protocol/biogenic-capture-and-storage)
- The local note says the capture protocol is "usually Direct Air Capture Protocol v1.3". That does not fit a biogenic point-source project; Bio-CCS v1.5 is the protocol that names in-situ mineralisation v1.2 as a storage option for point-source biogenic CO2. — [Bio-CCS Protocol v1.5](https://registry.isometric.com/protocol/biogenic-capture-and-storage) vs local file.

**Bio-CCS Protocol v1.5 — PDD and evidence items** (all from [Bio-CCS Protocol v1.5](https://registry.isometric.com/protocol/biogenic-capture-and-storage) unless noted)
- PDD must contain (`G-JSJB-0`, §6.1): a high-level process diagram of key inputs, outputs and flow through each project stage; documentation of additionality of the CCS; non-additionality of co-product facilities outside the boundary; GHG emissions of solvent/sorbent use and safe disposal; purity and concentration of CO2 to be injected/stored.
- Mixed feedstocks: waste feedstocks with inseparable biogenic and fossil carbon are eligible only if the biogenic fraction is eligible under Biomass Feedstock Accounting v1.4, market leakage is accounted for (its §2.5) and SC4 is met (`R-3KZD-1`); must demonstrate a waste hierarchy ensuring only unrecyclable waste is incinerated (`R-Q8V2-0`).
- Co-firing: use a fossil-fuel emission factor covering full upstream and combustion emissions (`R-AXPQ-0`), or upstream-only if the fossil CO2 is captured, quantified under §8.3.1 and stored in the same reservoir; if >5% of feedstock mass is fossil, justify it at validation; Isometric may withhold credit for unjustified periods (`R-YJJC-0`).
- Biogenic fraction F_B: projects capturing non-biogenic CO2 must determine the creditable biogenic fraction (`R-SH5B-0`). Co-fired projects may use Method A or B (`G-1D0Z-0`); inseparable-waste projects must use Method A (Method B case-by-case) (`G-DR5A-0`). Method A: continuous representative flue-gas sampling proportional to stack mass flow, integrated over ≤3 months, sampling location per ISO 10396/EN 15259 or ASTM D7459, sampling per EN 14181 or ASTM D7459, radiocarbon analysis per ISO 13833:2013 or ASTM D6866-21. Method B: conservative carbon mass balance (Eq. 3) using measured dry biomass and fossil fuel masses and carbon contents.
- At validation the PDD must give an estimated average F_B (may be a monthly profile) from local historical data, supplier factors, feedstock sampling/selective dissolution or literature (`R-0T9J-0`).
- Geologic CO2 released from minerals counts as fossil unless shown to be biogenic and mineralised by the project (Appendix 1). Only the biogenic share of stored CO2 is credited (Eq. 2); post-capture fossil emissions calculated by Eq. 9 (Method A) or Eq. 10 (Method B).
- System boundary (§7.1): cradle-to-grave; Table 1 SSRs cover establishment (equipment manufacture, transport, construction, surveys), operations (feedstock sourcing and transport, Bio-CCS facility, capture, CO2 transport, CO2 storage, direct emissions, MRV sampling, staff travel), end-of-life (decommissioning, long-term monitoring); exclusions need justification in the PDD; all GHGs at GWP100 (AR6).
- Baseline (§7.2): new-build (no facility without the project) vs retrofit (no CCS components) (`G-6EE0-0`); counterfactual covers CO2 that would have stayed stored in biomass plus storage that would have occurred anyway, per Biomass Feedstock Accounting v1.4; storage counterfactual zero unless the storage module requires otherwise (`G-T39N-0`).
- Mass-balance allocation for mixed biogenic/fossil processes is gated by eligibility criteria: EC2 inseparable waste feedstock; EC3 fossil emissions within a cap-and-trade scheme listed in Appendix 3 (only EU ETS incl. EEA states and UK ETS are approved); EC4 evidence that CCS of the fossil emissions would not happen without CDR revenue (Table 3, Appendix 3).
- Leakage (§8.5.4): identify leakage sources; at minimum market leakage per Biomass Feedstock Accounting v1.4 and storage modules, plus energy leakage from efficiency losses (`G-G07K-0`).
- Uncertainty (§6.5.1): list all input variables with uncertainties (min and max at minimum), summarise data handling and error propagation, provide a reproducible sensitivity analysis; parameters changing removals by <1% may be omitted.
- Safeguards (§5): leak detection with audible alarms for CO2 interim storage, transport and pipelines (`R-8K1S-1`); CO2 leak response plan shared with local communities and first responders (`R-W7XE-1`); solvent/sorbent emissions below regulatory limits with recognised test methods, records ≥5 years, retest after material change (`R-18QC-0`, `G-V0AG-0`, `G-EN65-0`); annual water consumption and mitigation using WRI Aqueduct or equivalent, with no net increase or justification where water stress is High/Extremely High (`R-AVC2-2`); combustion residues compliant with WID/IED or equivalent (`R-5W9P-0`), fly ash/scrubber residues disposal method (`G-463Q-0`), flue gas limits (`G-QTZC-0`), POP destruction 2 s at 850 °C or 1,100 °C if halogen ≥1% (`G-BFV1-0`, `G-Z4PP-0`).
- Risk of reversal (Appendix 4): geologic storage typically Very Low Risk, 1% buffer; risk factors feed the monitoring plan and go in the PDD.
- Records: data and analyses kept for verification ≥5 years after the monitoring period (§8.5.7.2).
- Data sharing (§6.6): PDD, GHG Statement, measurements, emission factors and literature public via Isometric's platform; only licensed emission factors and certain confidential information may be restricted.
- Site visits (§6.2.2): required during the first validation or verification at both capture and storage sites, and at least once per validation.

**In-situ Mineralization Module v1.2 — storage documentation** (all from [In-situ Mineralization Module v1.2](https://registry.isometric.com/module/in-situ-mineralization/1.2) unless noted)
- Scope: onshore mafic/ultramafic formations; dissolved or supercritical injection; "Crediting will occur on injection into the reservoir and isolation from the atmosphere."
- Location: at least one address and/or geo-coordinates, operations at each location (`R-7ZBJ-0`).
- Well permit: current permit from the responsible authority naming CO2 as an acceptable injectant; storage not permitted where EHR could affect the reservoir (`R-JYE5-0`). Disclose permit requirements in the PDD and follow them (`G-GX49-0`); report regulations applied and deviations from national/international standards (`G-9KCZ-0`). Keep copies of permit submissions and provide to Isometric/VVB within 30 days of request; report permit/regulatory changes (§2.2).
- Approved permitting regimes (Appendix 2): US EPA UIC Class VI; EU Directive 2009/31/EC; Norway subsea storage licence; UK NSTA Regulation 2010 (SI 2010/2221); Alberta AER Directive 064. Outside these, a licensed geoscientist (PG/P.Geo, CGeol, EurGeol or equivalent) must sign off seven items — site characterisation, AOR and reservoir modelling with uncertainty, risk register, monitoring/testing/reporting plan, well-integrity plan, rigour equivalence to listed permits, SRMS maturity opinion — and the signed report goes in the PDD (`G-X88M-0`).
- Site characterisation (§2.3, `R-6K9T-0`): AOR defined under the permit; mineralisation zone with sufficient volume, porosity, permeability, injectivity; divalent cation content (examples ~25 wt% Carbfix, ~16 wt% Columbia River Basalts, >50 wt% peridotites); sufficient reactive surface area or plan to increase it; confinement (supercritical: confining system free of transmissive faults; dissolved: confining layer or fully characterised system); site-specific regional seismicity study before injection; bubble-point calculation with PHREEQC v3 and an equation of state (e.g. Peng-Robinson); characterisation reviewed every 5 years.
- Pre-injection baseline (Appendix 1, Table A1) — Required: porosity and permeability; subsurface structures and features; reservoir volume; injectivity; fluid saturation; divalent cation concentrations (Mg, Ca, Fe); reactive surface area; reservoir pressure; bubble point pressure (reservoir pressure must exceed it by >5 bar); emergency response plan; formation fluid temperature, pH, conductivity/salinity, tracers; maximum allowable surface injection pressure; overlying formation pressure; reservoir modelling. Conditional (if permit requires): formation fluid dissolved gas; surface elevation/displacement; surface CO2 flux; ecosystem imaging; USDW temperature, salinity, dissolved gas, pH, density, TDS, major ions, tracers. Conditional (if springs present): natural spring pH, temperature, conductivity, dissolved gas, tracers.
- Well construction (§2.5): build per permit and best practice, keep construction records (`R-T85F-0`); evaluate all wells in the AOR and plug any posing a durability risk (`G-BVQ8-0`); surface casing below lowermost USDW cemented to surface, CO2-compatible API/ASTM materials (`G-R6VK-0`); casing/cement prevents fluid movement out of the mineralisation zone (`G-4HZY-0`).
- Site visits (§2.4): first validation or verification must include capture and storage sites; at least one per validation (ISO 14064-3 6.1.4.2).
- Quantification (§5): CO2e stored = Σ(C_mean,inj × m_inj); CO2 concentration "Measured immediately upstream from the point of injection" (`R-8VM3-0`); analyser accuracy ≤2% of full scale, ≥1-minute logging, calibrated at least annually against traceable standards; flow meters ≤2% of full scale, calibrated at least annually, traceable; missing data ≤30 min may be filled, longer gaps not creditable beyond 30 min, total gaps <5%; injectant records kept ≥5 years after the monitoring period; counterfactual zero; emissions per the protocol. For multi-project injection, total mass may be measured at transfer from the capture facility into the combined stream (§5.2).
- Reversal (§4): "This results in a 1% buffer pool for Projects using this Storage Module"; reassessed at Crediting Period renewal; negligence may end crediting; sole injector bears 100% of a reversal, multiple injectors pro-rata by injected mass. **[local-doc check]** The local note says 2%; the v1.2 page says 1%, consistent with Standard v2.2 "Very low: 1%". The v1.2 changelog diff view also shows text "a 2% buffer pool will be set aside as a precaution", which appears to be the earlier wording — [v1.2 changelog](https://registry.isometric.com/module/in-situ-mineralization/1.2/changelog).
- Closure (§8–9): prove beyond reasonable doubt CO2 causes no harm to USDWs and stays in the AOR over >100,000 years (`R-G5BD-0`); site report and decommissioning plan kept ≥10 years (`G-ZGJX-0`); closure and post-closure records ≥10 years after closure.
- E&S: comply with local environmental, ecological and social requirements and the Standard's E&S section (§2.1).

**Biomass Feedstock Accounting Module v1.4 — feedstock evidence** (all from [Biomass Feedstock Accounting v1.4](https://registry.isometric.com/module/biomass-feedstock-accounting))
- Exclusions: palm oil and derivatives, peatland drainage biomass, woody feedstock suited to and in demand for wood products, feedstocks used for food or feed.
- FC1.1 supplier details (validation and verification): name, company registration number, address, contact, role, declaration of payments and benefits. FC1.2 sourcing region (mapped boundary, radius or legal/operating area). FC1.3 chain of custody: identity preservation, segregation or mass balance (book-and-claim not permitted). FC1.4 annual demand in bone-dry t/yr. FC1.5 characterisation: species, pre-processing, contaminants, potential fossil carbon content.
- Storage of feedstock: show no increased methanogenesis (e.g. ≤4 weeks, ≤30% moisture, pelleted) or quantify CH4 (FS1.1/FS2.1).
- >10 source lots: sampling plan approved by Isometric before evidence collection; VVB randomly samples suppliers (§1.3.2).
- Cascading use: CU1.1 (woody, not suited to/in demand for wood products) and CU2.1 (non-woody, not used for food/feed), with evidence such as end-use data, affidavits, waste codes, payment-at-cost agreements.
- Sustainability criteria by feedstock type: SC1 forestry residues (certification, regional carbon stock trend, no primary forest since Jan 2008); SC2 crop residues (land status since Jan 2008, soil effects); SC3 manure; SC4 controlled waste (SC4.1 waste designation — EWC codes, facility registration, waste transfer notes; SC4.2 evidence of sorting from higher-value fractions; SC4.3 biogenic fraction accurately determined — ISO 21644:2021 or ASTM D6866 radiocarbon, component mass balance, accredited compositional analysis, or EU ETS MRR data (`R-2AMF-0`, `G-PADH-0`)); SC5 industrial/commercial residues (listed types, biogenic fraction `R-9MBS-0`); SC6 biofuel CO2 streams; SC7 conservation residues.
- Counterfactual (§2.4): CF1.1 counterfactual fate with 3- or 5-year look-back evidence (`R-GBK2-1`); counterfactual storage CS1–CS4 (e.g. CS2 full release within 15 years if it would otherwise be incinerated/burned without capture).
- Market leakage (§2.5): ML1 quantify, or a zero-leakage pathway ML2–ML7 (e.g. ML2 negligible revenue to supplier; ML3 feedstock surplus — RDF is an example; ML6/ML7 eligible retrofit with unchanged consumption); payment threshold ≤10% of supplier revenue or equal to disposal cost; not available to related parties.

**GHG Accounting Module v1.1 — transport and embodied emissions** (from [GHG Accounting v1.1](https://registry.isometric.com/module/ghg-accounting))
- Transport (§4.2): highest-ranked available method; Energy Usage Method (fuel/electricity × life-cycle EF) preferred; Distance-Based (distance × mass × vehicle EF) only if fuel data unavailable; include combustion and upstream fuel emissions; "Actual fuel quantities from invoices" cited as high-quality activity data.
- Embodied (§4.1, §7): cradle-to-grave for equipment, infrastructure, vehicles, materials; A1–A3 minimum; proportional allocation for shared assets; amortisation cap 20 years or project lifetime (`G-89NW-0`); lifetime justified in the PDD (`G-388V-0`); residual emission debt reported each verification (`G-FKD6-0`).
- Data quality: primary over secondary data; EFs at GWP100 AR6 (`G-WFA0-0`), from reputable sources and cited (`G-QDWZ-0`), reviewed annually (`G-G45N-0`); justify medium/low-quality data (`G-9B6T-0`); conservative choice documented in the PDD (`G-T6ZQ-0`).
- Materiality: excluded SSRs each <1% and in total <1% of net removals (`G-B2RM-0`).
- Co-products: declare all co-products/by-products and allocation procedure (`R-3MBJ-0`).

**Energy Use Accounting Module v1.3 — electricity and heat at the host plant** (from [Energy Use Accounting v1.3](https://registry.isometric.com/module/energy-use-accounting))
- Grid EF: location-specific, residual-mix, consumption-based, life-cycle, latest year (national average if no residual mix). PPAs/EACs require contract evidence, exclusive EAC retirement, deliverability, temporal matching for intensive facilities (>200 GWh/yr) and new-build additionality (≤36 months).
- Waste heat must be "unavoidable and unutilized" with a supplier affidavit, and the heat-generating process must be financially viable without CDR revenue (EC7, EC8) — relevant if capture uses kiln waste heat.
- Shared meters at the host facility allocated by sub-metering, equipment ratings/hours or other justified method; metering utility-grade with at least hourly reporting; electricity and fuel records incl. meter specs and calibration logs kept ≥5 years.

### Inferences
- Cement kiln eligibility under Bio-CCS v1.5 is not explicit. The flue gas mixes biogenic fuel CO2 with fossil fuel CO2 and calcination CO2 from limestone (treated as fossil under Appendix 1), so the supplier should (a) confirm eligibility with Isometric early (possibly via an Explanatory Note), (b) plan Method A radiocarbon F_B on the captured stream, and (c) expect the >5% fossil-feedstock justification (`R-YJJC-0`) to be triggered.
- Because only the biogenic share is credited, and mass-balance allocation EC3 is limited to EU/UK ETS, a host plant outside the EU/UK would rely on EC4 or on F_B-weighted crediting.
- Liquefied CO2 by truck: road transport emissions go through GHG Accounting §4.2 (fuel invoices preferred); mass loss between capture metering and injection metering (boil-off, venting) reduces stored CO2, and fossil losses count as post-capture emissions; batch weighing/gauging "with records at loading and receipt" (Bio-CCS §8.3.2.2) fits truck transfers.
- If the dissolved-CO2 injection design is used, water consumption will be material for `R-AVC2-2`, especially in an arid, high water-stress host region.

### Gaps
- I did not read the Shared CO2 Transport Infrastructure Module v1.0 directly; it appears to apply only to shared pipelines/infrastructure (per Bio-CCS v1.5 references).
- Bio-CCS v1.5 contains no cement- or kiln-specific text; I found no Isometric guidance on cement co-processing.
- Whether EC2–EC4 must all be met or are alternatives for mass-balance allocation was not clear from the fetched text.

---

## 4. What monitoring plan and data requirements must be described up front?

### Takeaway
The validation PDD must contain a full monitoring plan (Standard §3.2): monitored parameters, frequencies, equipment, methods, accuracy and calibration, responsibilities and QA/QC, covering capture metering and F_B sampling (Bio-CCS), energy and transport data (Energy Use and GHG Accounting modules), and storage operational and post-injection monitoring (In-situ Module Tables A2–A3). Instruments for mass and concentration need ≤2% accuracy, annual traceable calibration and 1-minute logging, and data gaps are capped at 5%.

### Cited Findings
- Monitoring plan in the PDD must cover monitored elements, frequency of monitoring and reporting, project steps, equipment, methods, accuracy and calibration, responsibilities and QA/QC; plus a description of the data collection and storage approach (`R-GYA1-0`). — [Isometric Standard v2.2 §3.2](https://registry.isometric.com/standard)
- Capture CO2 concentration (§8.3.2.1): measured after capture, before mixing or leaving the facility; inline NDIR/TDL analyser ≤2% full-scale accuracy, ≥1-minute recording, calibration per manufacturer and at least annually with traceable gases and certificate of analysis, raw data on request; or batch sampling per consignment. — [Bio-CCS Protocol v1.5](https://registry.isometric.com/protocol/biogenic-capture-and-storage)
- Captured mass (§8.3.2.2): continuous calibrated mass/volumetric flow meter plus density (Coriolis or thermal mass preferred), or batch weighing/gauging (weighbridge, calibrated scale, tank gauging) "with records at loading and receipt"; ≤2% of value accuracy, annual traceable calibration, installation per manufacturer (straight runs), raw data on request; density measured or derived from P/T with an equation of state. — [Bio-CCS Protocol v1.5](https://registry.isometric.com/protocol/biogenic-capture-and-storage)
- Energy metering (`G-AZ2J-0`): total CDR process electricity, gross bioenergy generation, exports, thermal energy at ±2% with calibrated meters, heat-transfer fluid specifications. Direct emissions: CEMS per EN 14181 for combustion (`G-8PR9-0`); other methods with NIST-traceable calibration and quarterly lab analysis (`G-WBKY-0`). — [Bio-CCS Protocol v1.5](https://registry.isometric.com/protocol/biogenic-capture-and-storage)
- Missing data (§8.5.5): ≤30-min gaps filled from 30 min before/after; longer gaps filled only for 30 min; loss of biogenic capture data means no removal claimed for that period; emissions gaps use the 24-h maximum; gaps <5% of data; notify Isometric and VVB; document in the GHG Statement. — [Bio-CCS Protocol v1.5](https://registry.isometric.com/protocol/biogenic-capture-and-storage)
- Storage monitoring plan updated every 5 years or per permit, each measurement tagged with its risk category (`R-1HWS-0`). Operational (Table A2): continuous — injection pressure, injection rate/volume, injectate CO2 concentration, annulus pressure, reservoir pressure, overlying formation pressure, induced seismicity; daily — injectate temperature and pH; weekly — formation fluid pH and conductivity; monthly — injectate density, dissolved gas, major ions, bubble point, wellhead gas composition (conditional); quarterly — corrosion monitoring; annually — external mechanical integrity, natural springs (conditional); every 2 years — pressure fall-off test; every 5 years — indirect plume monitoring (conditional); every 6 months — USDW water table (conditional); per permit — impurities, viscosity, tracers, surface CO2 flux, ecosystem imaging, surface elevation, USDW parameters. — [In-situ Mineralization Module v1.2](https://registry.isometric.com/module/in-situ-mineralization/1.2)
- Additional storage rules: reservoir pressure >5 bar above bubble point, bubble point at least monthly; species-specific gas detectors (CO2, CH4, C3H8) with alarms and injection shut-off; seismic events ≥M2.7 reported; monthly reactive-tracer (DIC) sampling unless permit requires more; reservoir models updated as data changes (`R-N6RE-0`); leak response: halt, assess, quantify, follow emergency response plan. Post-injection (`R-EF50-0`): corrosion and external MIT annually for first 3 years; trapping modelled over 50 years; minimum 50 years post-injection monitoring unless mineralisation proven. — [In-situ Mineralization Module v1.2](https://registry.isometric.com/module/in-situ-mineralization/1.2)
- Labs doing project analyses need ISO/IEC 17025 accreditation (or demonstrated equivalence agreed with the ROM); lab documentation and justification go into the PDD. — [Support: Laboratory accreditation](https://docs.isometric.com/support/validation-and-verification/laboratory-accreditation.md)
- **[local-doc check]** The local note lists pressure fall-off "yearly" and internal integrity "every 6 months"; Module v1.2 Table A2 gives fall-off every 2 years and corrosion monitoring quarterly. The local note's "keep raw logs at least 10 years after injection" differs from the module's ≥5 years after the monitoring period for injectant records and ≥10 years after closure for closure/post-closure records. — [In-situ Mineralization Module v1.2](https://registry.isometric.com/module/in-situ-mineralization/1.2)

### Inferences
- For a trucked chain there are at least three metering points the plan should describe: capture outlet (mass + concentration + F_B sampling), truck loading/unloading (weighbridge or tank gauging records), and injection wellhead (mass + concentration "immediately upstream from the point of injection"); the reconciliation between them is the evidence for transport losses.

### Gaps
- The support FAQ cites "Section 7.4.2 of the Isometric Standard" for lab accreditation, but Standard v2.2's table of contents has no §7.4.2 (Section 7 is Definitions), so the citation may be stale.
- Corrosion-monitoring frequency text in v1.2 appears garbled in places ("annually ... unless otherwise specified in the permit quarterly"); confirm with Isometric.

---

## 5. What administrative and legal documents are expected?

### Takeaway
Expected admin/legal evidence: company details (registration number, address, contacts) for every organisation; proof of sole ownership of removals and contracts in which the capture host, transporter and storage operator relinquish claims; the well/injection permit naming CO2 as injectant plus other environmental and construction permits; supplier details and declarations for each feedstock supplier; energy contracts (PPAs/EACs) where claimed; stakeholder consultation records; disclosure of other carbon schemes.

### Cited Findings
- Organisation details: name, role, company number, address, contact person, email, phone for each organisation (`R-F6R7-0`). — [Isometric Standard v2.2](https://registry.isometric.com/standard)
- Ownership: legal ownership demonstrated (`R-M858-1`); sole Project Proponent (`G-0KA1-1`); contracts relinquishing ownership and barring other participants from claiming certificates (§3.1). — [Isometric Standard v2.2](https://registry.isometric.com/standard); contractual naming of the sole certificate owner across multiple parties (`G-TTWW-0`) — [Bio-CCS Protocol v1.5](https://registry.isometric.com/protocol/biogenic-capture-and-storage)
- Well permit naming CO2 as injectant (`R-JYE5-0`); permit requirements disclosed (`G-GX49-0`); licensed-geoscientist sign-off where outside approved regimes (`G-X88M-0`); construction records (`R-T85F-0`). — [In-situ Mineralization Module v1.2](https://registry.isometric.com/module/in-situ-mineralization/1.2)
- Regulatory compliance in all applicable jurisdictions (`R-KQCS-0`); third-party EIA/SIA where impacts are significant or required by the jurisdiction (`G-1T3C-0`); scheme-hopping disclosure (`R-Q3JN-0`). — [Isometric Standard v2.2](https://registry.isometric.com/standard)
- Feedstock supplier details incl. company registration number and declaration of payments and benefits (FC1.1); waste designation evidence such as EWC codes, facility registration and waste transfer notes (SC4.1). — [Biomass Feedstock Accounting v1.4](https://registry.isometric.com/module/biomass-feedstock-accounting)
- PPAs/offtake agreements and EAC retirement certificates where low-carbon electricity is claimed; waste-heat supplier affidavit. — [Energy Use Accounting v1.3](https://registry.isometric.com/module/energy-use-accounting)
- Certify's evidence categories explicitly anticipate: environmental and construction permits, ISO certifications, lab accreditation, incorporation certificates (Permit / Certificate); offtake, supplier and land agreements, ownership and rights affidavits (Contract / Affidavit); consultation records and grievance mechanism (Stakeholder Record). — [Certify: Project Design](https://docs.isometric.com/user-guides/certify/project-design.md)

### Inferences
- A trucked chain with a separate storage operator needs a contract chain (capture host ↔ proponent ↔ haulier ↔ storage/injection operator) that assigns CDR attributes to one proponent and gives the proponent and VVB access to injection and monitoring data and permit submissions within 30 days of request.
- Credit offtake agreements are listed as an example category but I found no Isometric requirement to hold one for validation.

### Gaps
- No Isometric text found that specifically requires proof of subsurface/pore-space rights or land title for the injection site, beyond the permit and generic "land agreements" category.

---

## 6. What is published on the Isometric Registry, and what can be redacted?

### Takeaway
At the start of the 10-day public comment period the registry lists the project name, location, description, process diagram, protocol and a redacted PDD; the VVB validation report is published after acceptance; at issuance GHG-entry calculations, datapoints and public source files are published. Commercially sensitive or personal information can be redacted by agreement with the ROM, but baselines and assumptions critical to quantification cannot be withheld, and exact coordinates are never published.

### Cited Findings
- Once a project enters public comment, project name, location, description, process diagram, protocol and the published PDD are listed. At issuance, GHG-entry calculation views and datapoints are published; public source files can be downloaded; non-public files appear by filename only. Exact latitude/longitude are never shared publicly. — [Certify: Data visibility](https://docs.isometric.com/user-guides/certify/data-visibility.md)
- The published PDD may be redacted for commercial confidentiality, agreed between Isometric and the supplier and published at the start of public comment. — [Certify: Data visibility](https://docs.isometric.com/user-guides/certify/data-visibility.md); [Certify: Project Design](https://docs.isometric.com/user-guides/certify/project-design.md)
- PDD public comment lasts 10 days; Isometric reviews feedback before passing it to the supplier and VVB; the VVB validation report is published on the registry page. — [Certify: Validation](https://docs.isometric.com/user-guides/certify/validation.md). The Standard extends this to 30 days if material comments arrive or a stakeholder requests more time (§3.3). — [Isometric Standard v2.2](https://registry.isometric.com/standard)
- Proponents may label sensitive information (locations, names, proprietary processes, non-public plans) as confidential, but Isometric cannot withhold baselines or assumptions critical to quantification (§3.2); restricted data (e.g. licensed-database emission factors) is visible only to authorised buyers, Isometric and VVBs, and other numerical quantification data cannot be restricted (§3.12). — [Isometric Standard v2.2](https://registry.isometric.com/standard)
- Assigned VVB sees all draft PDD content after PDD pre-screen and the full draft LCA after LCA pre-screen. — [Certify: Data visibility](https://docs.isometric.com/user-guides/certify/data-visibility.md)

### Inferences
- Feedstock supplier identities, contract prices and kiln operating data can likely be redacted, but F_B values, emission factors (unless licensed) and the mass balance cannot.

### Gaps
- The docs do not say whether the LCA itself is published as a document (only GHG-entry calculations at issuance).

---

## 7. Common validation findings or reasons for delay

### Takeaway
Isometric's own guidance names few specific findings; the documented ones are unanswered sub-requirements, attachments without written explanation, unresolved pre-screen/Remi issues, and missing evidence of the kind each shortcode asks for. For this project type the likely friction points are cement-kiln eligibility, biogenic-fraction method, fossil share >5%, permitting outside the approved regimes, and the transport mass balance.

### Cited Findings
- VVBs "typically raise an issue against any sub-requirement that is missing or unanswered"; attachments "should not replace a written explanation". — [Support: PDD quality best practice](https://docs.isometric.com/support/validation-and-verification/pdd-quality-best-practice.md)
- Pre-screen runs only once the PDD is complete; Remi issues must be resolved or disputed before pre-screen; submissions are approved iteratively; verification completes only when "no amendments remain"; final V&V report typically within 6–8 weeks after the site visit. — [Support: Onboarding and timelines](https://docs.isometric.com/support/working-with-isometric/onboarding-and-timelines.md); [Certify: Project Design](https://docs.isometric.com/user-guides/certify/project-design.md)
- Where a project does not fit a requirement, an Explanatory Note (planned protocol update, later compliance via a Forward Action Request, or agreed alternative approach as last resort) is approved and published as part of the project record. — [Support: Audit exemptions and explanatory notes](https://docs.isometric.com/support/validation-and-verification/audit-exemptions-and-explanatory-notes.md)
- ICROA's 2023 review of Isometric noted it was "not adequately outlined how stakeholder consultation should be conducted" — that review predates Standard v2.2. — [ICROA Isometric Application Report (2023)](https://icroa.org/wp-content/uploads/2024/10/Isometric-Application-Report_-ICROA.pdf)

### Inferences
- Likely findings for this project, inferred from the requirements above: (1) eligibility of a cement kiln and the treatment of calcination CO2; (2) no validated F_B estimate or Method A sampling plan (`R-0T9J-0`, `G-DR5A-0`); (3) missing justification for >5% fossil fuel (`R-YJJC-0`); (4) host-country permit outside Appendix 2 regimes without the signed licensed-geoscientist report (`G-X88M-0`); (5) gaps in the capture→truck→injection mass reconciliation; (6) water-stress justification for dissolved injection (`R-AVC2-2`); (7) stakeholder consultation records not meeting `G-JNW9-0` (14 days' notice, local language, minutes).

### Gaps
- No public list of common VVB findings for Bio-CCS or in-situ mineralisation projects was found; no published PDD of either type could be retrieved as a worked example.
