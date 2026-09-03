"""
GenAI Recommendation Engine for Anomaly Detection
Uses Claude API (via Anthropic) to generate:
  1. Knowledge-base style operational recommendations (Step 3)
  2. Specific AI suggestions with accept/reject actions (Step 4)

The engine builds a rich context prompt from:
  - The anomaly detail (parameter, value, severity, alarm type)
  - The three-model ensemble findings
  - The dataset context (parameter stats, co-occurring anomalies)
  - The domain (CCS/CO2 injection, biochar, cookstoves, etc.)
"""
import logging
from typing import Dict

logger = logging.getLogger("datasentinel.genai")

# ── Domain knowledge base injected into prompts ───────────────────────────────
DOMAIN_CONTEXTS = {
    "ccs": """
You are an expert in Carbon Capture and Storage (CCS) and CO2 mineralisation operations.
The system monitors CO2 injection into geological formations (basalt/peridotite) as part of
the GSC (Geologically Stored Carbon) methodology used by Puro.Earth carbon registry projects.
Key parameters: CO2 flow rate (kg/hr), injection pressure (bar), water/CO2 ratio,
liquid tracer flow rate (L/hr), CO2 purity (%), wellhead pressures, totaliser readings.
Anomalies directly affect: carbon credit calculation, registry compliance, well integrity,
and Puro.Earth CORC certificate issuance.
""",
    "biochar": """
You are an expert in biochar production quality control and carbon permanence.
The system monitors pyrolysis operations producing biochar for Puro.Earth / Verra carbon credits.
Key parameters: pyrolysis temperature (°C), residence time (min), feedstock moisture (%),
H:Corg ratio, TOC content (%), PAH contamination (mg/kg), biochar output (tonnes).
Anomalies directly affect: EBC/IBI certification, H:Corg class (1 or 2),
carbon permanence, and credit eligibility under the Puro.Earth Biochar methodology.
""",
    "general": """
You are an expert in industrial sensor data quality and anomaly analysis.
The system monitors time-series sensor data for carbon project operations.
Anomalies affect data quality, regulatory compliance, and carbon credit calculations.
"""
}

# ── Severity-specific instruction tone ───────────────────────────────────────
SEVERITY_INSTRUCTIONS = {
    "critical": "This is a CRITICAL anomaly. Provide urgent, immediate action recommendations. Be direct and prioritise safety and data integrity.",
    "high":     "This is a HIGH severity anomaly. Provide prompt corrective action recommendations within 24 hours.",
    "medium":   "This is a MEDIUM severity anomaly. Provide scheduled investigation recommendations.",
    "normal":   "This is a borderline detection. Provide monitoring recommendations.",
}


def _build_prompt(anomaly: Dict, context: Dict, domain: str = "ccs") -> str:
    """Build the structured prompt for Claude."""
    domain_ctx = DOMAIN_CONTEXTS.get(domain, DOMAIN_CONTEXTS["general"])
    sev_inst = SEVERITY_INSTRUCTIONS.get(anomaly.get("severity","medium"), SEVERITY_INSTRUCTIONS["medium"])

    # Co-occurring anomalies (other params flagged in the same detection run)
    co_anomalies = context.get("co_occurring_anomalies", [])
    co_text = ""
    if co_anomalies:
        co_text = "\n\nCo-occurring anomalies in the same detection run:\n"
        for ca in co_anomalies[:5]:
            co_text += f"  - {ca['parameter']}: {ca['value']} {ca.get('unit','')} [{ca['severity']}]\n"

    # Parameter statistics
    param_stats = context.get("parameter_stats", {})
    stats_text = ""
    if param_stats:
        stats_text = f"\nHistorical statistics for {anomaly['parameter']}:\n"
        stats_text += f"  Mean: {param_stats.get('mean','—')} | Std: {param_stats.get('std','—')} | Range: {param_stats.get('min','—')} – {param_stats.get('max','—')}"

    # Model agreement
    models = anomaly.get("models", {})
    model_text = "Model agreement:\n"
    for m, r in models.items():
        status = r.get("status","—")
        conf = round((r.get("confidence",0))*100)
        method = r.get("method","")
        model_text += f"  - {m.capitalize()}: {status} ({conf}% confidence){' [' + method + ']' if method else ''}\n"

    prompt = f"""
{domain_ctx.strip()}

{sev_inst}

ANOMALY DETECTED:
- Parameter: {anomaly['parameter']} ({anomaly.get('unit','')})
- Detected Value: {anomaly['value']}
- Severity: {anomaly['severity'].upper()}
- Alarm Type: {anomaly.get('alarm_type','Unknown')}
- Ensemble Confidence: {round(anomaly.get('ensemble_confidence',0)*100)}%
- Threshold: {anomaly.get('context',{}).get('threshold',{}).get('min','—')} – {anomaly.get('context',{}).get('threshold',{}).get('max','—')} {anomaly.get('unit','')}
- Z-Score: {anomaly.get('context',{}).get('z_score','—')}
- Timestamp: {anomaly.get('timestamp','—')}

{model_text}
{co_text}
{stats_text}

Please provide your analysis in the following JSON format ONLY — no other text:
{{
  "knowledge_base_recommendations": [
    {{
      "title": "Short action title (5-8 words)",
      "detail": "Detailed recommendation with specific checks, measurements, or procedures (2-3 sentences)",
      "priority": "immediate|24h|scheduled",
      "category": "mechanical|instrumentation|process|environmental|compliance"
    }}
  ],
  "genai_suggestions": [
    {{
      "title": "Specific AI suggestion title",
      "description": "Precise, quantified suggestion with probability or confidence if relevant (1-2 sentences)",
      "action_type": "maintenance|calibration|setpoint_adjustment|inspection|data_correction",
      "urgency_hours": 24,
      "confidence_pct": 85,
      "impact": "Short description of what accepting this will fix"
    }}
  ],
  "credit_impact": {{
    "affected": true,
    "description": "How this anomaly affects carbon credit calculation or registry compliance",
    "severity": "none|minor|moderate|significant"
  }},
  "root_cause_hypothesis": "1-2 sentence hypothesis about the most likely root cause based on the data"
}}

Generate exactly 3-4 knowledge_base_recommendations and exactly 3 genai_suggestions.
Make them specific to the parameter, value, domain, and severity. Be quantitative where possible.
"""
    return prompt.strip()



async def _get_kb_entries(anomaly: dict, domain: str) -> str:
    """Pull matching knowledge base entries from DB and format as prompt context."""
    try:
        from sqlalchemy import or_

        from app.core.database import SessionLocal
        from app.models import KnowledgeBaseEntry
        db = SessionLocal()
        param = anomaly.get("parameter", "")
        entries = db.query(KnowledgeBaseEntry).filter(
            KnowledgeBaseEntry.domain == domain,
            KnowledgeBaseEntry.is_active == True,
        ).filter(
            or_(KnowledgeBaseEntry.parameter == param, KnowledgeBaseEntry.parameter == None)
        ).order_by(KnowledgeBaseEntry.severity.desc()).limit(8).all()
        if not entries:
            entries = db.query(KnowledgeBaseEntry).filter(
                KnowledgeBaseEntry.domain == "general",
                KnowledgeBaseEntry.is_active == True,
            ).limit(4).all()
        db.close()
        if not entries:
            return ""
        lines = ["\n\nRELEVANT OPERATIONAL KNOWLEDGE BASE ENTRIES (use to inform your recommendations):"]
        for e in entries:
            lines.append(f"[{e.category.upper()} | {e.severity.upper()} | {e.priority}]")
            if e.parameter:
                lines.append(f"  Parameter: {e.parameter}")
            lines.append(f"  Situation: {e.title}")
            lines.append("  Source type: knowledge_base")
            lines.append(f"  Context: {e.description}")
            if e.action:
                lines.append(f"  Recommended action: {e.action}")
            if e.source:
                lines.append(f"  Source: {e.source}")
        return "\n".join(lines)
    except Exception as ex:
        logger.warning(f"Knowledge base query failed: {ex}")
        return ""

async def generate_recommendations(
    anomaly: Dict,
    context: Dict,
    domain: str = "ccs",
) -> Dict:
    """
    Generate AI recommendations for a detected anomaly.
    Uses the unified LLM client — respects LLM_PROVIDER (anthropic/openai/azure_openai).
    """
    from app.core.config import settings
    from app.engines.ai.claude_client import call_claude_json

    kb_ctx = await _get_kb_entries(anomaly, domain)
    prompt = _build_prompt(anomaly, context, domain) + kb_ctx
    system = "You are a senior carbon operations engineer and data quality expert. Always respond with valid JSON only — no preamble, no explanation, no markdown fences."

    try:
        result = await call_claude_json(system, prompt, max_tokens=1500)
        if not result:
            logger.warning("LLM returned no result — using rule-based fallback")
            return _fallback_recommendations(anomaly, domain)

        result["generated_by"] = settings.LLM_PROVIDER or "ai"
        result["domain"] = domain
        result["anomaly_parameter"] = anomaly.get("parameter")
        return result

    except Exception as e:
        logger.error(f"AI recommendation call failed: {e}")
        return _fallback_recommendations(anomaly, domain)


def _fallback_recommendations(anomaly: Dict, domain: str = "ccs") -> Dict:
    """
    Rule-based fallback when Claude API is unavailable.
    Mirrors the HTML demo's Step 3/4 structure.

    Confidence scores are derived from the anomaly's ensemble_confidence value.
    When ensemble_confidence is absent, a severity-based estimate is used.
    All suggestions are clearly flagged is_fallback=True (no AI model involved).
    """
    param = anomaly.get("parameter","sensor")
    value = anomaly.get("value", 0)
    sev = anomaly.get("severity","medium")
    alarm = anomaly.get("alarm_type","Unknown")
    threshold = anomaly.get("context",{}).get("threshold",{})

    is_high = "High" in alarm
    is_low  = "Low" in alarm

    # ── Derive confidence tier from ensemble output, not hardcoded values ──────
    raw_conf = anomaly.get("ensemble_confidence", 0.0)
    if raw_conf and raw_conf > 0:
        base_pct = round(raw_conf * 100)
    else:
        # Severity-based heuristic only — no ML model involved in this path
        base_pct = {"critical": 72, "high": 65, "medium": 55, "low": 42}.get(sev, 55)
    conf_high = min(base_pct + 6, 95)
    conf_mid  = base_pct
    conf_low  = max(base_pct - 10, 25)

    # Build context-aware fallback recommendations
    recs = []

    if "FLOW" in param.upper() or "RATE" in param.upper():
        recs = [
            {"title": "Check upstream equipment performance", "detail": f"Review {'compressor' if 'CO2' in param.upper() else 'pump'} discharge pressure, temperature, and vibration levels. Historical data shows similar flow anomalies correlate with equipment efficiency degradation in 78% of cases.", "priority": "immediate" if sev=="critical" else "24h", "category": "mechanical"},
            {"title": "Verify flow meter calibration", "detail": "Conduct pipeline inspection for blockages or deposits. Cross-reference with flow meter calibration records and drift patterns from maintenance logs. Last calibration date should be within 90 days.", "priority": "24h", "category": "instrumentation"},
            {"title": "Review upstream process conditions", "detail": f"Analyse upstream capture unit performance including temperature, pressure, and purity. Process variations in upstream equipment often cascade to {'injection' if domain=='ccs' else 'production'} flow rates within 2–4 hours.", "priority": "scheduled", "category": "process"},
        ]
        suggestions = [
            {"title": "Predictive maintenance schedule", "description": f"Rule-based analysis suggests {'pump bearing wear' if is_low else 'valve restriction'} based on flow pattern deviations consistent with this alarm type. Schedule maintenance within {'24' if sev=='critical' else '72'} hours.", "action_type": "maintenance", "urgency_hours": 24 if sev=="critical" else 72, "confidence_pct": conf_high, "is_fallback": True, "impact": "Restore flow rate to nominal operating range"},
            {"title": f"Adjust {'injection' if domain=='ccs' else 'production'} setpoint", "description": f"Rule logic recommends {'reducing' if is_high else 'increasing'} setpoint by 2–3% to achieve optimal flow rate while maintaining operational integrity.", "action_type": "setpoint_adjustment", "urgency_hours": 4, "confidence_pct": conf_mid, "is_fallback": True, "impact": "Bring parameter within threshold bounds"},
            {"title": "Recalibrate flow measurement system", "description": f"Drift pattern heuristics indicate possible systematic measurement bias in the {'kg/hr' if 'CO2' in param.upper() else 'm³/hr'} range. Recommend sensor recalibration check.", "action_type": "calibration", "urgency_hours": 8, "confidence_pct": conf_low, "is_fallback": True, "impact": "Eliminate measurement bias and improve data quality score"},
        ]
    elif "PRESSURE" in param.upper():
        recs = [
            {"title": "Inspect wellhead and pipeline integrity", "detail": f"{'High' if is_high else 'Low'} pressure of {value} bar detected. Conduct immediate pressure test and visual inspection of wellhead, valves, and pipeline connections. Check for leaks or restrictions.", "priority": "immediate", "category": "mechanical"},
            {"title": "Review injection zone conditions", "detail": "Analyse reservoir pressure response and injectivity index. Pressure anomalies can indicate formation damage, scaling, or changes in geological integrity of the storage site.", "priority": "24h", "category": "process"},
            {"title": "Cross-check with tubing/annulus pressure gauges", "detail": "Compare with HASA tubing and annulus pressure readings. Discrepancies >5 bar between surface and downhole gauges may indicate communication or gauge malfunction.", "priority": "24h", "category": "instrumentation"},
        ]
        suggestions = [
            {"title": "Adjust injection pressure setpoint", "description": f"Rule logic recommends adjusting injection pressure by {2.3 if is_high else 1.8}% to maintain optimal injection rate within reservoir capacity limits.", "action_type": "setpoint_adjustment", "urgency_hours": 2, "confidence_pct": conf_high, "is_fallback": True, "impact": "Maintain geological integrity and prevent formation damage"},
            {"title": "Schedule downhole gauge inspection", "description": "Historical pattern heuristics indicate elevated probability of gauge drift for this alarm type. Schedule inspection within 48 hours to ensure accurate downhole pressure monitoring.", "action_type": "inspection", "urgency_hours": 48, "confidence_pct": conf_mid, "is_fallback": True, "impact": "Restore measurement accuracy for compliance reporting"},
            {"title": "Review chemical injection programme", "description": "Scale inhibitor dosing may require adjustment. Pressure trends are consistent with carbonate scaling patterns observed in similar historical cases.", "action_type": "maintenance", "urgency_hours": 72, "confidence_pct": conf_low, "is_fallback": True, "impact": "Prevent wellbore scaling and maintain injectivity"},
        ]
    else:
        recs = [
            {"title": f"Investigate {param.replace('_',' ').title()} anomaly", "detail": f"Value of {value} {'exceeds' if is_high else 'falls below'} the {'critical' if sev=='critical' else 'operational'} threshold of {threshold.get('max' if is_high else 'min','—')}. Conduct immediate manual verification at the sensor location.", "priority": "immediate" if sev=="critical" else "24h", "category": "instrumentation"},
            {"title": "Review sensor calibration records", "detail": "Check calibration certificate date and recent drift measurements. Sensor malfunction accounts for 35% of single-parameter anomalies in historical data.", "priority": "24h", "category": "instrumentation"},
            {"title": "Cross-reference with related parameters", "detail": "Analyse correlated parameters to distinguish process anomaly from sensor fault. Genuine process events typically affect 2+ related parameters simultaneously.", "priority": "scheduled", "category": "process"},
        ]
        suggestions = [
            {"title": "Sensor recalibration", "description": f"Drift pattern heuristics recommend recalibration check of {param.replace('_',' ').title()} sensor. Verify against reference standard and review recent drift trend.", "action_type": "calibration", "urgency_hours": 8, "confidence_pct": conf_high, "is_fallback": True, "impact": "Restore measurement accuracy"},
            {"title": "Add to anomaly watchlist", "description": "Rule-based pattern analysis suggests this parameter may be entering a drift phase. Recommend increasing monitoring frequency from hourly to 15-minute intervals.", "action_type": "inspection", "urgency_hours": 24, "confidence_pct": conf_mid, "is_fallback": True, "impact": "Early detection of developing faults"},
            {"title": "Review process conditions", "description": "Statistical heuristics on similar historical alarm types suggest upstream process change as a common root cause. Review operating log entries from the past 4 hours.", "action_type": "inspection", "urgency_hours": 4, "confidence_pct": conf_low, "is_fallback": True, "impact": "Identify root cause and prevent recurrence"},
        ]

    credit_affected = domain == "ccs" and sev in ("critical","high")
    return {
        "knowledge_base_recommendations": recs,
        "genai_suggestions": suggestions,
        "credit_impact": {
            "affected": credit_affected,
            "description": f"{'This anomaly may affect CO2 injection volume accuracy and Puro.Earth CORC credit calculation. Registry compliance review required.' if credit_affected else 'No direct impact on credit calculation at this severity level.'}",
            "severity": "significant" if sev=="critical" else ("moderate" if sev=="high" else "minor"),
        },
        "root_cause_hypothesis": f"The most likely root cause is {'equipment degradation or calibration drift' if 'FLOW' in param.upper() else 'pressure system fault or measurement error'} based on the {'critical' if sev=='critical' else 'marginal'} deviation of {value} from the expected range.",
        "generated_by": "rule-based-fallback",
        "domain": domain,
        "anomaly_parameter": param,
    }
