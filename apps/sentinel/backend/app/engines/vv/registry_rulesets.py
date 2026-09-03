"""
Registry-specific rulesets for V&V verification.
Based on real submission analysis — Puro.Earth CCS methodology (44.01 UAE project).
"""

# ── Puro.Earth: Carbon Capture & Storage (CCS / CO2 Mineralisation) ──────────
# Based on actual 44.01 UAE Puro.Earth submission document structure
PURO_EARTH_CCS = {
    "registry": "Puro.Earth",
    "methodology": "Carbon Capture & Storage (CCS)",
    "code": "PURO-CCS-GSC",
    "description": "Geological CO2 removal via capture, transport, and permanent mineralisation",
    "checkpoints": [
        # CATEGORY 1: Administrative & Legal
        {
            "id": "PURO-CCS-A-01", "category": "Administrative",
            "name": "CO2 Offtake Agreement",
            "requirement": "Executed contractual agreement between CO2 Removal Supplier and operators covering volumes, pricing, and delivery terms.",
            "evidence_types": ["co2_offtake_agreement", "contractual_terms"],
            "document_type": "co2_offtake_agreement",
            "critical": True
        },
        {
            "id": "PURO-CCS-A-02", "category": "Administrative",
            "name": "Company Registration",
            "requirement": "Valid trade registry extract or certificate of incorporation for the CO2 Removal Supplier entity.",
            "evidence_types": ["company_registration", "certificate_of_incorporation"],
            "document_type": "company_registration",
            "critical": True
        },
        {
            "id": "PURO-CCS-A-03", "category": "Administrative",
            "name": "Regulatory Approvals",
            "requirement": "Valid No-Objection Certificates (NOC) from relevant national authorities (FNRC, FEA, or equivalent) for CO2 injection operations.",
            "evidence_types": ["noc_regulatory", "regulatory_approval"],
            "document_type": "noc_regulatory",
            "critical": True
        },
        # CATEGORY 2: Additionality & Baseline
        {
            "id": "PURO-CCS-B-01", "category": "Additionality",
            "name": "Additionality Assessment",
            "requirement": "Comprehensive additionality assessment demonstrating the project would not occur without carbon finance (financial, regulatory, and barrier analysis).",
            "evidence_types": ["additionality_assessment"],
            "document_type": "additionality_assessment",
            "critical": True
        },
        {
            "id": "PURO-CCS-B-02", "category": "Additionality",
            "name": "Baseline & Cost Analysis",
            "requirement": "Pilot project cost analysis demonstrating financial non-viability without carbon revenue. Baseline scenario documented.",
            "evidence_types": ["cost_analysis", "baseline_documentation"],
            "document_type": "cost_analysis",
            "critical": False
        },
        # CATEGORY 3: Environmental & Social Safeguards
        {
            "id": "PURO-CCS-C-01", "category": "Environmental & Social Safeguards",
            "name": "Stakeholder Engagement",
            "requirement": "Documented stakeholder engagement process including affected communities, public consultation, and feedback resolution.",
            "evidence_types": ["stakeholder_engagement", "stakeholder_report"],
            "document_type": "stakeholder_engagement",
            "critical": True
        },
        {
            "id": "PURO-CCS-C-02", "category": "Environmental & Social Safeguards",
            "name": "Environmental & Social Safeguards Framework",
            "requirement": "Comprehensive ESS framework aligned with IFC Performance Standards. HR policy, on-site parameters, and HSE management system documented.",
            "evidence_types": ["ess_framework", "hr_policy", "hse_management"],
            "document_type": "ess_framework",
            "critical": True
        },
        {
            "id": "PURO-CCS-C-03", "category": "Environmental & Social Safeguards",
            "name": "Risk Assessment",
            "requirement": "Uncertainty and risk register for the CO2 removal activity including geological, operational, and financial risks with mitigation measures.",
            "evidence_types": ["risk_register", "risk_assessment"],
            "document_type": "risk_register",
            "critical": True
        },
        {
            "id": "PURO-CCS-C-04", "category": "Environmental & Social Safeguards",
            "name": "Chemical Management Plan",
            "requirement": "Chemical management plan including MSDS for all chemicals used (absorbents, caustic soda, etc.) and emergency preparedness procedures.",
            "evidence_types": ["chemical_management", "msds", "emergency_preparedness"],
            "document_type": "chemical_management",
            "critical": False
        },
        {
            "id": "PURO-CCS-C-05", "category": "Environmental & Social Safeguards",
            "name": "Impact Assessments",
            "requirement": "Environmental Impact Assessment (EIA) and Social Impact Assessment (SIA) completed for the project location.",
            "evidence_types": ["eia_sia", "environmental_impact", "social_impact"],
            "document_type": "eia_sia",
            "critical": True
        },
        # CATEGORY 4: Storage Site Qualification
        {
            "id": "PURO-CCS-D-01", "category": "Storage Site",
            "name": "Storage Site Overview",
            "requirement": "Storage site characterisation including satellite imagery, geological survey, and site suitability assessment for permanent CO2 mineralisation.",
            "evidence_types": ["storage_site_overview", "logistic_chain", "site_characterisation"],
            "document_type": "storage_site_overview",
            "critical": True
        },
        {
            "id": "PURO-CCS-D-02", "category": "Storage Site",
            "name": "Regulatory NOCs",
            "requirement": "No-Objection Certificates from FNRC (Federal Nature Reserve Corporation) and FEA (Federal Environment Agency) or equivalent national bodies.",
            "evidence_types": ["noc_fnrc_fea", "fnrc_noc", "fea_noc"],
            "document_type": "noc_fnrc_fea",
            "critical": True
        },
        {
            "id": "PURO-CCS-D-03", "category": "Storage Site",
            "name": "Reservoir Modelling",
            "requirement": "Reservoir modelling report demonstrating injection capacity, injectivity, and long-term CO2 trapping mechanisms.",
            "evidence_types": ["reservoir_modelling", "reservoir_report"],
            "document_type": "reservoir_modelling",
            "critical": True
        },
        {
            "id": "PURO-CCS-D-04", "category": "Storage Site",
            "name": "Legal Framework",
            "requirement": "Legal framework documenting storage rights, liability assignment, and regulatory compliance for long-term CO2 storage.",
            "evidence_types": ["legal_framework", "storage_rights"],
            "document_type": "legal_framework",
            "critical": True
        },
        # CATEGORY 5: Monitoring Plan
        {
            "id": "PURO-CCS-E-01", "category": "Monitoring Plan",
            "name": "Capture & Transport Monitoring",
            "requirement": "Monitoring plan for CO2 capture process and transportation pipeline including flow meters, pressure sensors, and leak detection.",
            "evidence_types": ["capture_transport_monitoring", "monitoring_plan"],
            "document_type": "capture_transport_monitoring",
            "critical": True
        },
        {
            "id": "PURO-CCS-E-02", "category": "Monitoring Plan",
            "name": "GSC Monitoring Plan",
            "requirement": "GSC (Geological Storage of Carbon) methodology-specific monitoring plan covering injection rates, pressure monitoring, and mineralisation verification.",
            "evidence_types": ["gsc_monitoring_plan", "gsc_plan"],
            "document_type": "gsc_monitoring_plan",
            "critical": True
        },
        {
            "id": "PURO-CCS-E-03", "category": "Monitoring Plan",
            "name": "Data Systems Overview",
            "requirement": "Overview of digital systems for data collection, storage, and reporting. Digitalization scope of work documented.",
            "evidence_types": ["data_systems", "digitalization_scope"],
            "document_type": "data_systems",
            "critical": False
        },
        {
            "id": "PURO-CCS-E-04", "category": "Monitoring Plan",
            "name": "Uncertainty Quantification",
            "requirement": "Quantification uncertainty assessment for CO2 measurement, reporting, and verification per GSC protocol.",
            "evidence_types": ["uncertainty_quantification", "uncertainty_assessment"],
            "document_type": "uncertainty_quantification",
            "critical": True
        },
        # CATEGORY 6: Leakage Determination
        {
            "id": "PURO-CCS-F-01", "category": "Leakage",
            "name": "GHG Emission Displacement",
            "requirement": "GHG emission displacement form quantifying all leakage sources: energy use, transportation, and process emissions. Net removal calculated.",
            "evidence_types": ["leakage_determination", "ghg_displacement", "emission_displacement"],
            "document_type": "leakage_determination",
            "critical": True
        },
        {
            "id": "PURO-CCS-F-02", "category": "Leakage",
            "name": "Energy Procurement & Scope 2",
            "requirement": "Energy procurement guidance demonstrating renewable or low-carbon energy sourcing. Scope 2 emissions calculated using market-based method.",
            "evidence_types": ["energy_procurement", "scope2_emissions"],
            "document_type": "energy_procurement",
            "critical": False
        },
        # CATEGORY 7: Life Cycle Assessment
        {
            "id": "PURO-CCS-G-01", "category": "Life Cycle Assessment",
            "name": "LCA Spreadsheet",
            "requirement": "Life cycle assessment calculation model (XLSM/XLSX) covering all system boundaries, emission factors, and net removal calculation.",
            "evidence_types": ["lca_spreadsheet", "lca_model"],
            "document_type": "lca_spreadsheet",
            "critical": True
        },
        {
            "id": "PURO-CCS-G-02", "category": "Life Cycle Assessment",
            "name": "LCA Report",
            "requirement": "Third-party verified LCA report demonstrating net lifecycle CO2 removal, system boundaries, and compliance with ISO 14064.",
            "evidence_types": ["lca_report"],
            "document_type": "lca_report",
            "critical": True
        },
        # CATEGORY 8: Project Description
        {
            "id": "PURO-CCS-H-01", "category": "Project Description",
            "name": "Project Description",
            "requirement": "Complete project description covering technology, scale, location, team, implementation timeline, and co-benefits.",
            "evidence_types": ["project_description"],
            "document_type": "project_description",
            "critical": True
        },
    ]
}

# ── Puro.Earth: Biochar Carbon Removal ───────────────────────────────────────
PURO_EARTH_BIOCHAR = {
    "registry": "Puro.Earth",
    "methodology": "Biochar Carbon Removal",
    "code": "PURO-BIOCHAR-V2",
    "description": "Pyrolysis-based biochar production from waste biomass",
    "checkpoints": [
        {"id":"PURO-B-E-01","category":"Eligibility","name":"Feedstock Eligibility","requirement":"Feedstock must be waste biomass (agricultural residues, forestry waste). No purpose-grown biomass unless additionality proven.","evidence_types":["feedstock_declaration","supplier_documentation"],"document_type":"feedstock_declaration","critical":True},
        {"id":"PURO-B-E-02","category":"Eligibility","name":"Technology Eligibility","requirement":"Pyrolysis or gasification at ≥350°C. Biochar must meet EBC or IBI certification.","evidence_types":["process_documentation","certification"],"document_type":"process_documentation","critical":True},
        {"id":"PURO-B-M-01","category":"Monitoring","name":"Production Volume","requirement":"Total biochar production (tonnes) documented per batch with timestamps, temperatures, and residence times.","evidence_types":["production_logs","monitoring_data"],"document_type":"production_logs","critical":True},
        {"id":"PURO-B-M-02","category":"Monitoring","name":"Temperature Logs","requirement":"Continuous temperature monitoring during pyrolysis. Peak temperature ≥700°C for H:Corg <0.4 (Class 2).","evidence_types":["temperature_time_series"],"document_type":"temperature_time_series","critical":True},
        {"id":"PURO-B-Q-01","category":"Quality","name":"H:Corg Ratio","requirement":"H:Corg ≤0.7 (Class 1) or ≤0.4 (Class 2). Verified by accredited third-party lab.","evidence_types":["lab_report"],"document_type":"lab_report","critical":True},
        {"id":"PURO-B-Q-02","category":"Quality","name":"Carbon Content (TOC)","requirement":"Total organic carbon ≥10%, verified by accredited lab.","evidence_types":["lab_report"],"document_type":"lab_report","critical":True},
        {"id":"PURO-B-Q-03","category":"Quality","name":"Contaminant Testing","requirement":"PAH ≤6 mg/kg (EBC Premium). Heavy metals within EBC limits.","evidence_types":["lab_report"],"document_type":"lab_report","critical":True},
        {"id":"PURO-B-C-01","category":"Credit Calculation","name":"Net Carbon Removal","requirement":"Net removal = Biochar C × stability factor − process emissions − transport emissions.","evidence_types":["calculation_worksheet"],"document_type":"calculation_worksheet","critical":True},
        {"id":"PURO-B-D-01","category":"Documentation","name":"Chain of Custody","requirement":"Documented chain of custody from feedstock origin to biochar application site.","evidence_types":["chain_of_custody"],"document_type":"chain_of_custody","critical":True},
        {"id":"PURO-B-D-02","category":"Documentation","name":"Application Records","requirement":"Evidence biochar permanently applied to soil or used in construction.","evidence_types":["application_records"],"document_type":"application_records","critical":True},
    ]
}

# ── Isometric: Biochar Permanence Protocol ────────────────────────────────────
ISOMETRIC_BIOCHAR = {
    "registry": "Isometric",
    "methodology": "Biochar Permanence Protocol",
    "code": "ISO-BIOCHAR-V1",
    "description": "Science-based biochar carbon removal verification",
    "checkpoints": [
        {"id":"ISO-M-01","category":"Measurement","name":"Quantification Methodology","requirement":"Carbon removal using Isometric's approved quantification methodology v1.2+.","evidence_types":["calculation_worksheet"],"document_type":"calculation_worksheet","critical":True},
        {"id":"ISO-M-02","category":"Measurement","name":"Uncertainty Analysis","requirement":"Uncertainty ≤5% combined at 95% confidence.","evidence_types":["uncertainty_analysis"],"document_type":"uncertainty_analysis","critical":True},
        {"id":"ISO-P-01","category":"Permanence","name":"Permanence Assessment","requirement":"Mean residence time (MRT) >100 years via H:Corg proxy or direct measurement.","evidence_types":["lab_report","permanence_calculation"],"document_type":"lab_report","critical":True},
        {"id":"ISO-L-01","category":"Leakage","name":"Leakage Assessment","requirement":"Activity leakage from feedstock diversion assessed and quantified.","evidence_types":["leakage_assessment"],"document_type":"leakage_assessment","critical":False},
        {"id":"ISO-D-01","category":"Documentation","name":"MRV Protocol","requirement":"MRV protocol submitted and approved by Isometric.","evidence_types":["mrv_protocol"],"document_type":"mrv_protocol","critical":True},
    ]
}

# ── Gold Standard: Improved Cookstoves ────────────────────────────────────────
GOLD_STANDARD_COOKSTOVES = {
    "registry": "Gold Standard",
    "methodology": "Improved Cookstoves",
    "code": "GS-ICS-V3",
    "description": "Clean cooking intervention reducing biomass combustion emissions",
    "checkpoints": [
        {"id":"GS-B-01","category":"Baseline","name":"Baseline Scenario","requirement":"Business-as-usual fuel type, consumption, and stove efficiency documented.","evidence_types":["baseline_study","survey_data"],"document_type":"baseline_study","critical":True},
        {"id":"GS-A-01","category":"Additionality","name":"Additionality Assessment","requirement":"Financial, technological, and social barriers to adoption without carbon finance.","evidence_types":["additionality_assessment"],"document_type":"additionality_assessment","critical":True},
        {"id":"GS-S-01","category":"Safeguards","name":"Stakeholder Consultation","requirement":"FPIC process and local stakeholder engagement documented.","evidence_types":["stakeholder_report","fpic_documentation"],"document_type":"stakeholder_report","critical":True},
        {"id":"GS-M-01","category":"Monitoring","name":"Monitoring Report","requirement":"Annual monitoring with household surveys, stove counts, and fuel consumption measurements.","evidence_types":["monitoring_report","survey_data"],"document_type":"monitoring_report","critical":True},
        {"id":"GS-C-01","category":"Co-Benefits","name":"SDG Co-Benefits","requirement":"SDG 3, 7, 13 contribution documented with measurable indicators.","evidence_types":["co_benefits_report"],"document_type":"co_benefits_report","critical":False},
    ]
}

# ── Verra VCS: VM0044 Biochar ─────────────────────────────────────────────────
VERRA_BIOCHAR = {
    "registry": "Verra (VCS)",
    "methodology": "Biochar Methodology VM0044",
    "code": "VM0044-V1",
    "description": "Verra Verified Carbon Standard biochar methodology",
    "checkpoints": [
        {"id":"VM-E-01","category":"Eligibility","name":"Methodology Applicability","requirement":"Project meets VM0044 applicability conditions. Biochar must remain in field or built environment.","evidence_types":["methodology_compliance"],"document_type":"methodology_compliance","critical":True},
        {"id":"VM-B-01","category":"Baseline","name":"Baseline Carbon Stock","requirement":"Baseline carbon stock of feedstock calculated using VM0044 equations.","evidence_types":["baseline_calculation"],"document_type":"baseline_calculation","critical":True},
        {"id":"VM-M-01","category":"Monitoring","name":"Monitoring Plan","requirement":"VM0044-compliant monitoring plan for production quantities, quality, and application.","evidence_types":["monitoring_plan"],"document_type":"monitoring_plan","critical":True},
        {"id":"VM-Q-01","category":"Quality","name":"Biochar Quality","requirement":"H:Corg <0.7, TOC ≥10%, contaminants within VCS limits.","evidence_types":["lab_report"],"document_type":"lab_report","critical":True},
    ]
}

# ── Registry lookup ───────────────────────────────────────────────────────────
ALL_REGISTRIES = {
    "puro_earth_ccs":         PURO_EARTH_CCS,
    "puro_earth_biochar":     PURO_EARTH_BIOCHAR,
    "puro_earth":             PURO_EARTH_CCS,       # default Puro = CCS (based on real submission)
    "isometric_biochar":      ISOMETRIC_BIOCHAR,
    "isometric":              ISOMETRIC_BIOCHAR,
    "gold_standard_cookstoves": GOLD_STANDARD_COOKSTOVES,
    "gold_standard":          GOLD_STANDARD_COOKSTOVES,
    "verra_biochar":          VERRA_BIOCHAR,
    "verra":                  VERRA_BIOCHAR,
}

def get_ruleset(registry_slug: str, methodology_code: str = "") -> dict:
    """Return the appropriate ruleset for a registry+methodology combination."""
    # Build lookup key
    key = registry_slug.lower().replace("-","_").replace(" ","_")
    if methodology_code:
        m = methodology_code.lower().replace("-","_")
        combined = f"{key}_{m}"
        if combined in ALL_REGISTRIES:
            return ALL_REGISTRIES[combined]
        # Try partial methodology match
        for k in ALL_REGISTRIES:
            if key in k and any(w in k for w in m.split("_")[:2]):
                return ALL_REGISTRIES[k]
    return ALL_REGISTRIES.get(key, PURO_EARTH_CCS)

def list_registries_and_methodologies():
    """Return unique registry/methodology combinations for the UI."""
    seen = set()
    result = []
    for ruleset in ALL_REGISTRIES.values():
        key = (ruleset["registry"], ruleset["methodology"])
        if key not in seen:
            seen.add(key)
            result.append({
                "registry": ruleset["registry"],
                "methodology": ruleset["methodology"],
                "code": ruleset["code"],
                "description": ruleset.get("description",""),
                "checkpoint_count": len(ruleset["checkpoints"]),
            })
    return result
