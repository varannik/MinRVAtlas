# Cortex library: CO₂ storage by in-situ mineralization

Public documents for Cortex to read for in-situ mineralization projects: CO₂ dissolved in water and injected into mafic or ultramafic rock, credited under Puro Geologically Stored Carbon (or Isometric). With them, Cortex can answer and check every journey step from registry onboarding to credit issuance. Collected 21 November 2026.

The PDF and DOCX files are not in git (see `.gitignore`), because they are third-party documents. Puro's say "no part may be reproduced", and Isometric's are CC BY-NC-ND. This README is tracked: the **Source** links get them again.

**One edition per document.** Only current editions are here. Cortex warns about two editions of the same rules, and a project is locked to one edition (Fujairah: Puro GSC Edition 2024 v5 under General Rules 4.4). Don't add superseded editions next to these.

## Where each folder goes

| Folder | Upload to | Who | Searched by |
|---|---|---|---|
| `protocols/puro/` | `shared/puro/any/any/` in the intake bucket | Operator (AWS CLI) | Every Puro project in every organisation |
| `knowledge/templates/` | `shared/puro/any/any/` | Operator | Every Puro project |
| `protocols/isometric/` | `shared/isometric/any/any/` | Operator | Every Isometric project |
| `knowledge/science/`, `knowledge/law/`, `knowledge/measurement/` | `shared/any/any/any/` | Operator | Every project |

Deploy the registry filter (`retrieval_filter` in `infra/lib/cortex/lambda/access.py`, which now compares the registry too) before uploading to `shared/isometric/` or `shared/any/`. Without it, a Puro project would also search Isometric's documents.

Already in Cortex, so skip:
- `Puro_Geologically_Stored_Carbon_2024_v5.pdf`: byte-identical to the registry copy at `shared/puro/puro-geologically-stored-carbon/2024-v5/`.
- `Puro_General_Rules_v4.4.pdf`: Fujairah has it on its Protocols pin. Upload it to `shared/puro/any/any/`, then remove the project copy on the Cortex page, so every Puro project gets one copy.

Upload (sandbox), from the repo root:

```sh
B=minrv-ew2-sandbox-cortex-intake-625239230739
L=docs/cortex-library/mineralization
aws s3 cp $L/protocols/puro/   s3://$B/shared/puro/any/any/ --recursive --checksum-algorithm SHA256 \
  --exclude "Puro_Geologically_Stored_Carbon_2024_v5.pdf"
aws s3 cp $L/knowledge/templates/ s3://$B/shared/puro/any/any/ --recursive --checksum-algorithm SHA256
aws s3 cp $L/protocols/isometric/ s3://$B/shared/isometric/any/any/ --recursive --checksum-algorithm SHA256
for d in science law measurement; do
  aws s3 cp $L/knowledge/$d/ s3://$B/shared/any/any/any/ --recursive --checksum-algorithm SHA256
done
```

Each file is scanned, admitted, parsed by Bedrock Data Automation (billed per page), labelled and indexed. The library has about 2,100 PDF pages plus six Word templates. Organisation-only copies (not shared with other organisations) go through the Cortex page instead: Knowledge pin, "Every project".

## Puro registry rules: `protocols/puro/`

| File | What it is | Journey steps |
|---|---|---|
| `Puro_Geologically_Stored_Carbon_2024_v5.pdf` | GSC methodology, Edition 2024 v5 (23 Apr 2026): eligibility, CORC equation, monitoring, bubble point, legal framework (Table 1), reversal | Methodology, all of Project documents, Monitor, Report |
| `Puro_General_Rules_v4.4.pdf` | Puro Standard General Rules 4.4 (07 May 2026): additionality, safeguards, buffer, crediting | Onboarding, Project documents, Project validated, Credits issued |
| `Puro_Certification_Procedures_v1.2.pdf` | How certification runs, end to end (30 Sep 2026): registration, audits, issuance, other schemes (9.8.21) | Registry onboarding, Validation, Verification, Credits issued |
| `Puro_Common_Criteria_v1.0.pdf` | Criteria common to all Puro methodologies (28 May 2026) | Project documents, Validation |
| `Puro_Definitions_and_Abbreviations_v1.0.pdf` | Puro's defined terms (28 May 2026) | All |
| `Puro_Program_Annex_v1.0.pdf` | Puro Program annex to the Certification Procedures | Registry onboarding, Credits issued |
| `Puro_Validation_and_Verification_Requirements_v1.3.pdf` | What the auditor (VVB) must do and deliver | Validation (VVB, site visit, findings, report), Verification |
| `Puro_Biomass_Sourcing_Criteria_v1.3.pdf` | Eligible biomass and its evidence (3 Sep 2026) | Site descriptions, Feedstock records, Capture source |
| `Puro_Additionality_Assessment_Requirements_v2.1.pdf` | Additionality tests (18 Jun 2026) | Baseline and additionality |
| `Puro_Stakeholder_Engagement_Requirements_v1.1.pdf` | Consultation requirements | Stakeholder consultation, Public comment |
| `Puro_SDG_Assessment_Requirements_v1.0.pdf` | SDG contribution requirements | SDG report |
| `Puro_Article_6_Procedures_v2.pdf` | Corresponding adjustments and host-country authorisation | Host country |
| `Puro_KYC_AML_Policies_v1.2.pdf` | Know-your-business and anti-money-laundering checks | KYB / KYC |
| `Puro_LCA_Guidelines_for_Suppliers_2023.pdf` | How Puro expects the life-cycle assessment | LCA, LCA update |
| `Puro_Grievance_Policy_v1.2.pdf` | How grievances are raised and handled | Safeguards, Stakeholder consultation |
| `Puro_Clarifications_2026-11-06.pdf` | Puro's rulings on how to apply its rules and methodologies | All |

## Puro templates: `knowledge/templates/`

| File | Journey steps |
|---|---|
| `Puro_Project_Description_Template_v2.1.docx` | Project Description (Cortex drafts on this template), Project Concept Note |
| `Puro_Baseline_and_Additionality_Questionnaire_v2.0.docx` | Baseline and additionality |
| `Puro_Environmental_and_Social_Safeguards_Questionnaire_v2.2.docx` | Safeguards |
| `Puro_Stakeholder_Engagement_Report_Template_v2.1.docx` | Stakeholder consultation |
| `Puro_SDG_Reporting_Template_v1.2.docx`, `Puro_SDG_Proposal_Template_v1.docx` | SDG report |

## Isometric: `protocols/isometric/`

Printed from registry.isometric.com on 21 Nov 2026 (CC BY-NC-ND 4.0). Modules without a version in the name are the version current on that date.

| File | Journey steps |
|---|---|
| `Isometric_Standard_v2.2.pdf` | All Isometric steps |
| `Isometric_In-situ_Mineralization_Module_v1.2.pdf` | Storage baseline and risk, Monitoring plan, Permits, Storage monitoring, Reversals |
| `Isometric_BioCCS_Protocol_v1.5.pdf` | Capture source, Fossil share, Biogenic fraction |
| `Isometric_GHG_Accounting_Module.pdf` | LCA, GHG entries, Uncertainty |
| `Isometric_Energy_Use_Accounting_Module.pdf` | Energy and fuel |
| `Isometric_Biomass_Feedstock_Accounting_Module.pdf` | Feedstock accounting, Feedstock records |

## Science: `knowledge/science/`

| File | Why Cortex needs it | Journey steps |
|---|---|---|
| `Matter_et_al_2025_CO2_mineralisation_in_peridotite_Oman_pilot_CommsEarthEnv.pdf` | First pilot-scale peridotite injection (Samail ophiolite, Oman): about 88% mineralised within 45 days | Storage baseline and risk, Storage monitoring, Reversals |
| `Kelemen_Matter_2008_In_situ_carbonation_of_peridotite_PNAS.pdf` | Founding case for peridotite carbonation in the Oman–UAE ophiolite | Site descriptions, Storage baseline and risk |
| `Kelemen_et_al_2019_CO2_storage_in_minerals_and_geological_formations_Frontiers.pdf` | Review of mineral and geological storage: rates, capacity, costs (CC BY) | Preliminary Assessment, Storage |
| `Clark_et_al_2020_CarbFix2_mineralization_basalt_GCA.pdf` | 3.5 years of continuous dissolved-gas injection at CarbFix2: mineralised fractions, injectivity | Storage monitoring, Reversals |
| `Spycher_et_al_2003_CO2_H2O_mutual_solubilities_LBNL.pdf` | CO₂ solubility in water from 12 to 100 °C and up to 600 bar: the basis for bubble-point pressure | Bubble-point margin, Monitoring plan |
| `IPCC_SRCCS_2005_Ch5_Underground_geological_storage.pdf` | Storage mechanisms, site selection, monitoring, leakage risk | Storage baseline and risk, Monitoring plan |
| `IPCC_SRCCS_2005_Ch7_Mineral_carbonation.pdf` | Mineral carbonation chemistry and permanence | Storage, Reversals |
| `Carbfix_Methodology_Transport_and_Geological_Storage_2022.pdf` | Carbfix's DNV-validated MRV for dissolved-CO₂ mineral storage (reference practice, not Puro rules) | Monitoring plan, Storage monitoring, Chain reconciliation |

## Law: `knowledge/law/`

Puro GSC 3.2.11 Table 1 asks a host country outside the pre-approved list to meet eight legal requirements, and gives the EU CCS Directive and US 40 CFR 144/146 as examples.

| File | Journey steps |
|---|---|
| `EU_CCS_Directive_2009-31-EC_consolidated_2018.pdf` | Storage jurisdiction (Table 1 comparison), Permits |
| `US_40_CFR_146_Underground_Injection_Control_incl_Class_VI.pdf` | Storage jurisdiction, Permits, Storage monitoring (Subpart H, Class VI) |
| `EU_CRCF_Regulation_2024-3012.pdf` | LCA (GSC v5's 15 or 20-year amortisation follows CRCF), Host country |

## Measurement: `knowledge/measurement/`

| File | Journey steps |
|---|---|
| `IPCC_2006_Guidelines_Vol2_Ch5_CO2_transport_injection_geological_storage.pdf` | CO₂ balance, Uncertainty, Reversals |
| `NETL_Best_Practices_MVA_Geologic_Storage_2017.pdf` | Monitoring plan, Storage monitoring |
| `EPA_Class_VI_Well_Testing_and_Monitoring_Guidance_2013.pdf` | Monitoring plan, Storage monitoring, Permits |
| `OIML_R137_Gas_meters_2012.pdf` | Calibration, CO₂ injected (gas-phase meters) |
| `OIML_R117-1_Dynamic_measuring_systems_for_liquids_2007.pdf` | Calibration, Chain reconciliation (liquid CO₂ truck loading and unloading) |
| `EU_ETS_MRR_Guidance_3_Biomass_2022.pdf` | Biogenic fraction (¹⁴C per EN ISO 13833), Fossil share (biomass co-firing) |
| `CSI_Cement_CO2_and_Energy_Protocol_v3.0.pdf` | Capture source, Fossil share, Energy and fuel (cement kiln CO₂ with biomass fuels) |

## Not here: fetch by hand

| Document | Why missing | Get it |
|---|---|---|
| UAE Federal Decree-Law No. 11 of 2024, Reduction of Climate Change Effects | Portal blocks scripted downloads | [uaelegislation.gov.ae/en/legislations/2558](https://uaelegislation.gov.ae/en/legislations/2558/download) in a browser, save as `knowledge/law/UAE_Federal_Decree-Law_11_2024_Reduction_of_Climate_Change_Effects.pdf` |
| UAE Cabinet Resolution No. 67 of 2024, National Register for Carbon Credits | Same | [uaelegislation.gov.ae/en/legislations/2521](https://uaelegislation.gov.ae/en/legislations/2521/download), save as `knowledge/law/UAE_Cabinet_Resolution_67_2024_National_Register_for_Carbon_Credits.pdf` |
| Nisbet & Buscarnera 2024, Carbon mineralization in fractured mafic and ultramafic rocks (Rev. Geophys., CC BY) | Repository blocks scripted downloads | [PMC11586057](https://pmc.ncbi.nlm.nih.gov/articles/PMC11586057/) |
| Matter et al. 2016, Rapid carbon mineralization… (Science) | Paywalled; author copy blocks scripts | [UCL Discovery 1504571](https://discovery.ucl.ac.uk/1504571/) |
| Snæbjörnsdóttir et al. 2020, CO₂ storage through mineral carbonation (Nat. Rev. Earth Environ.) | Paywalled; author copy blocks scripts | [UCL Discovery 10096305](https://discovery-pp.ucl.ac.uk/id/eprint/10096305) |
| Sigfusson et al. 2015, Dissolved CO₂ injection system (IJGGC) | No free copy | doi:10.1016/j.ijggc.2015.02.022 |
| Kelemen et al. 2020, Engineered carbon mineralization in ultramafic rocks (Chem. Geol.) | Paywalled | doi:10.1016/j.chemgeo.2020.119628 |
| ISO 13833 / ASTM D6866 (biogenic carbon by ¹⁴C), ISO 27914 (geological storage), ISO 14064-2/-3, ISO 14040/14044 (LCA), ISO/IEC 17025 (labs) | Paid standards | ISO / ASTM, if the organisation holds a licence |
| EU ETS MRR Guidance 3, 2025 update ("Biomass and other zero-rating") | Newer than the 2022 edition here; no stable link found | climate.ec.europa.eu, then replace the 2022 file |

## What only the project can give Cortex

These are the project's own evidence, uploaded on the Cortex page to the project's pins (Evidence, Calibration, Reviewer), not to the library.

| Journey step | Documents |
|---|---|
| KYB / KYC | Company registration, ownership, directors, IDs |
| Storage jurisdiction | Puro's written approval of the host country's framework |
| Site descriptions | Capture site, logistic chain and storage site descriptions; biomass sourcing form |
| Operators and contracts | Trade registry extracts for every operator; contracts (incl. CO₂ ownership transfer, GSC 3.3.2) |
| Permits | Every installation's permits and the storage approval |
| Monitoring plan | Monitoring plan and storage monitoring plan |
| Baseline and additionality, LCA, Safeguards, Stakeholder consultation, SDG report | The completed templates and their evidence |
| Chain reconciliation | Capture outlet totals, truck loading and unloading tickets, wellhead totals |
| Biogenic fraction | Radiocarbon lab results for the captured stream |
| Feedstock records, Energy and fuel | Biomass deliveries; electricity, fuel and transport records |
| Storage monitoring | The period's storage monitoring results |
| Calibration | Certificates for every meter and lab used in the period |
| Uncertainty | The updated uncertainty assessment |
| Validation report, Verification statement | The auditor's reports once the registry accepts them |
