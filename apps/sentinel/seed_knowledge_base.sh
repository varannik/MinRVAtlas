#!/bin/bash
echo "📚 Seeding DataSentinel Knowledge Base..."
echo ""

docker exec ds_postgres psql -U datasentinel -d datasentinel << 'SQL'

-- Create table if it doesn't exist yet
CREATE TABLE IF NOT EXISTS knowledge_base (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain VARCHAR(50) NOT NULL,
    parameter VARCHAR(200),
    category VARCHAR(100) NOT NULL,
    title VARCHAR(300) NOT NULL,
    description TEXT NOT NULL,
    action TEXT,
    severity VARCHAR(20) DEFAULT 'medium',
    priority VARCHAR(20) DEFAULT '24h',
    tags JSONB DEFAULT '[]',
    source VARCHAR(200),
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default entries (skip if already exist by title)
INSERT INTO knowledge_base (domain, parameter, category, title, description, action, severity, priority, tags, source) VALUES

-- ── CCS / CO2 Injection ──────────────────────────────────────────────────────
('ccs', 'CO2_FLOW_RATE', 'mechanical',
 'Check CO2 compressor performance',
 'Abnormal CO2 flow rate often indicates compressor efficiency degradation. Historical data shows similar flow anomalies correlate with equipment issues in 78% of cases. Review discharge pressure, temperature, and vibration levels.',
 'Inspect compressor bearings, seals, and discharge valves. Cross-reference with redundant flow measurement. Check compressor suction and discharge pressures.',
 'high', 'immediate', '["compressor","flow","maintenance"]', 'ACE2 Operating Manual v3.1'),

('ccs', 'CO2_FLOW_RATE', 'instrumentation',
 'Verify flow meter calibration and drift',
 'Flow meter drift is the leading cause of false CO2 flow anomalies. Check calibration certificate date — should be within 90 days. Systematic drift >0.5% invalidates the measurement.',
 'Compare with redundant flow measurement. Perform in-situ calibration check. Schedule recalibration if drift >0.5%.',
 'medium', '24h', '["calibration","flow_meter","instrumentation"]', 'Instrumentation SOP v2.0'),

('ccs', 'CO2_FLOW_RATE', 'process',
 'Review upstream capture unit performance',
 'Process variations in the upstream CO2 capture unit (temperature, pressure, purity) often cascade to injection flow rate anomalies within 2-4 hours.',
 'Analyse upstream capture unit logs. Review absorption column efficiency, reboiler duty, and CO2 purity readings from the past 4 hours.',
 'medium', 'scheduled', '["upstream","capture","process"]', 'ACE2 Process Manual'),

('ccs', 'INJECTION_PRESSURE', 'mechanical',
 'Inspect wellhead and pipeline integrity',
 'Pressure deviations indicate wellbore or surface equipment issues. Risk of formation damage if high pressure is uncorrected. Low pressure may indicate tubing leak.',
 'Conduct pressure test and visual inspection of wellhead, valves, and pipeline connections. Check for leaks. Review downhole gauge readings.',
 'critical', 'immediate', '["wellhead","pressure","integrity","safety"]', 'Well Integrity Manual v1.3'),

('ccs', 'INJECTION_PRESSURE', 'process',
 'Review reservoir injectivity index',
 'Sustained pressure anomalies may indicate formation damage, carbonate scaling, or changes in geological integrity of the storage site. The injectivity index (II) should be stable within ±10%.',
 'Analyse pressure transient data. Compare with baseline injectivity curve from pilot phase. Consider acid stimulation if II dropped >20%.',
 'high', '24h', '["reservoir","injectivity","geology","scaling"]', 'Reservoir Engineering SOP'),

('ccs', 'WATER_CO2_RATIO', 'process',
 'Check injection fluid composition at mixing skid',
 'Water/CO2 ratio outside bounds affects mineralisation efficiency and CO2 credit calculation accuracy under ACE2 methodology. Ratio must be within ±5% of design specification.',
 'Review mixing skid calibration and setpoints. Verify water injection pump rates against design. Check for blockages in water injection line.',
 'high', '24h', '["ratio","mixing","credits","mineralisation"]', 'ACE2 Process Manual'),

('ccs', 'CO2_PURITY_PERCENTAGE', 'process',
 'Review CO2 source quality and purity certificate',
 'CO2 purity below 90% risks credit invalidation under Puro.Earth ACE2 methodology. Impurities (H2S, CH4, N2) affect mineralisation rate and may damage well equipment.',
 'Check supply pipeline quality certificate. Review gas chromatograph readings at receipt point. Notify CO2 supplier immediately. Consider suspending injection until purity restored.',
 'critical', 'immediate', '["purity","registry","compliance","credits"]', 'Puro.Earth ACE2 Methodology v2.1'),

('ccs', 'LIQUID_TRACER_FLOW_RATE', 'instrumentation',
 'Verify liquid tracer pump and dosing system',
 'Tracer is required for monitoring CO2 mineralisation progress. Loss of tracer flow invalidates monitoring data and may trigger registry notification requirement.',
 'Check tracer pump pressure and flow rate. Verify tracer tank level. Check injection nozzle for blockage. Review last maintenance record.',
 'high', 'immediate', '["tracer","monitoring","pump"]', 'ACE2 Monitoring Program'),

('ccs', NULL, 'environmental',
 'Verify ESS monitoring continuity and data completeness',
 'Data gaps in environmental and social safeguard (ESS) monitoring must be reported to the Puro.Earth registry within 48 hours. ESS framework requires continuous measurement with <2% data gap.',
 'Check sensor connectivity and data logger status. Fill gaps with interpolation per uncertainty assessment protocol. Document gap cause and corrective action.',
 'medium', '24h', '["ESS","environmental","compliance","registry"]', 'ESS Framework v2.1'),

('ccs', NULL, 'compliance',
 'Review Puro.Earth ACE2 monitoring plan compliance',
 'Any deviation from the approved ACE2 monitoring plan must be documented. Systematic deviations may require methodology deviation report submission to Puro.Earth.',
 'Compare current operations against approved monitoring plan. Document any deviations. Contact Puro.Earth methodology team if systematic deviation identified.',
 'high', 'scheduled', '["ACE2","methodology","registry","deviation"]', 'Puro.Earth ACE2 Methodology v2.1'),

-- ── Biochar Production ───────────────────────────────────────────────────────
('biochar', 'TEMPERATURE', 'process',
 'Check pyrolysis temperature profile and feedstock',
 'Temperature below 700°C risks producing Class 2 instead of Class 1 biochar under EBC/IBI standards, significantly reducing carbon permanence rating and credit value. Check feedstock moisture content — wet feedstock lowers temperature.',
 'Review burner controls and fuel supply. Check feedstock moisture (should be <15%). Adjust temperature setpoint and residence time. Take a sample for H:Corg analysis.',
 'critical', 'immediate', '["pyrolysis","temperature","class","EBC","IBI"]', 'EBC Certification Standard 2023'),

('biochar', 'TEMPERATURE', 'instrumentation',
 'Verify thermocouple calibration and placement',
 'Thermocouple drift is the leading cause of false temperature readings in pyrolysis units. A drift of 20°C can shift Class 1 biochar to Class 2, losing 60% of credit value.',
 'Compare primary and redundant thermocouples. Perform ice-point check (0°C ± 0.5°C). Replace if drift >2°C. Check thermocouple placement — must be at hottest zone.',
 'medium', '24h', '["thermocouple","calibration","temperature"]', 'Instrumentation SOP'),

('biochar', NULL, 'process',
 'Check residence time and kiln rotation speed',
 'Insufficient residence time at target temperature produces undercharred biochar with low carbon content. Residence time must meet methodology minimum (typically 20-30 min at T>700°C).',
 'Review kiln rotation speed and feed rate logs. Calculate actual residence time. Reduce feed rate if residence time below specification.',
 'high', '24h', '["residence_time","kiln","process"]', 'IBI Biochar Standard v2.1'),

('biochar', NULL, 'compliance',
 'Verify H:Corg ratio from lab analysis',
 'H:Corg ratio determines EBC class: Class 1 requires H:Corg <0.4, Class 2 requires H:Corg <0.6. This directly determines credit eligibility and permanence rating. Lab analysis required every 50 tonnes.',
 'Send sample to accredited lab for proximate, ultimate analysis, and H:Corg determination. Do not issue credits until lab results received and H:Corg confirmed.',
 'critical', 'scheduled', '["H:Corg","lab","EBC","class","permanence"]', 'EBC Certification Standard 2023'),

-- ── Cookstoves ───────────────────────────────────────────────────────────────
('cookstoves', NULL, 'process',
 'Verify stove adoption and usage monitoring',
 'Gold Standard ICS methodology requires evidence of sustained usage. Anomalies in fuel consumption monitoring may indicate stove abandonment or improper usage.',
 'Conduct field visit to verify stove condition and usage. Update household register. Photograph stove and fuel storage.',
 'medium', 'scheduled', '["adoption","usage","monitoring","field"]', 'Gold Standard ICS Methodology v3'),

-- ── General Sensors ─────────────────────────────────────────────────────────
('general', NULL, 'instrumentation',
 'Conduct sensor cross-validation against adjacent sensors',
 'When a single parameter shows anomaly without correlated parameters being affected, sensor fault is more likely than genuine process event. Genuine process events typically affect 2+ related parameters simultaneously.',
 'Compare with adjacent sensors of same type. Check signal cable integrity and connection. Review last maintenance record and calibration date.',
 'medium', '24h', '["sensor","validation","fault","cross-check"]', 'General Instrumentation Best Practice'),

('general', NULL, 'process',
 'Review recent operational changes and shift log',
 'Anomalies following setpoint changes, maintenance events, or shift handover are often process-related. Check the operational log for changes in the past 4-6 hours.',
 'Cross-reference operational log. Interview shift supervisor. Compare current operating parameters with pre-anomaly baseline.',
 'low', 'scheduled', '["operational","change","log","shift"]', 'Operations Management Best Practice'),

('general', NULL, 'instrumentation',
 'Check power supply and signal conditioning',
 'Power supply fluctuations and signal conditioning failures cause sensor readings to drift or spike without any real process change. Check UPS status and signal conditioner outputs.',
 'Check UPS battery status and output voltage. Verify signal conditioner output range. Check grounding and shielding on sensor cables.',
 'medium', '24h', '["power","signal","UPS","grounding"]', 'Electrical Best Practice'),

('general', NULL, 'mechanical',
 'Inspect process connection and isolation valves',
 'Blocked or partially closed isolation valves and process connection issues (blockages, fouling) cause measurement errors that appear as anomalies in pressure and flow sensors.',
 'Inspect isolation valves — ensure fully open. Check for blockages in impulse lines. Flush process connections if pressure transmitter.',
 'medium', '24h', '["connection","valve","blockage","fouling"]', 'Mechanical Maintenance SOP')

ON CONFLICT DO NOTHING;

SELECT COUNT(*) as "Total entries seeded" FROM knowledge_base;
SELECT domain, COUNT(*) as entries FROM knowledge_base GROUP BY domain ORDER BY domain;

SQL

echo ""
echo "✅ Knowledge base seeded. Refresh the Knowledge Base page to see the entries."
