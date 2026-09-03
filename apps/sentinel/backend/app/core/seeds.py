"""
F038: Seed data extracted from startup.py to keep startup.py under 400 lines.

Contains:
  - DEFAULT_KB_ENTRIES  — knowledge base defaults seeded on first run
  - create_default_admin() — idempotent admin account creation
"""
import logging
import os
import time

logger = logging.getLogger("datasentinel.seeds")


DEFAULT_KB_ENTRIES = [
    dict(domain="ccs", parameter="CO2_FLOW_RATE", category="mechanical",
         title="Check CO2 compressor performance",
         description="Abnormal CO2 flow rate often indicates compressor efficiency degradation. Review discharge pressure, temperature, and vibration.",
         action="Inspect compressor bearings, seals, and discharge valves.",
         severity="high", priority="immediate", source="GSC Operating Manual",
         tags=["compressor", "flow"]),
    dict(domain="ccs", parameter="CO2_FLOW_RATE", category="instrumentation",
         title="Verify flow meter calibration",
         description="Flow meter drift can cause false anomalies. Check calibration certificate and recent drift trend.",
         action="Compare with redundant measurement. Schedule recalibration if drift >0.5%.",
         severity="medium", priority="24h", source="Instrumentation SOP",
         tags=["calibration", "flow_meter"]),
    dict(domain="ccs", parameter="INJECTION_PRESSURE", category="mechanical",
         title="Inspect wellhead and pipeline integrity",
         description="Pressure deviations indicate wellbore or surface equipment issues. Risk of formation damage if uncorrected.",
         action="Conduct pressure test and visual inspection of wellhead, valves, and connections.",
         severity="critical", priority="immediate", source="Well Integrity Manual",
         tags=["wellhead", "pressure", "integrity"]),
    dict(domain="ccs", parameter="INJECTION_PRESSURE", category="process",
         title="Review reservoir injectivity index",
         description="Sustained pressure anomalies may indicate formation damage, scaling, or changes in geological integrity.",
         action="Analyse pressure transient data. Compare with baseline injectivity curve from pilot phase.",
         severity="high", priority="24h", source="Reservoir Engineering SOP",
         tags=["reservoir", "injectivity"]),
    dict(domain="ccs", parameter="WATER_CO2_RATIO", category="process",
         title="Check injection fluid composition",
         description="Water/CO2 ratio outside bounds affects mineralisation efficiency and CO2 credit calculation accuracy.",
         action="Review mixing skid calibration. Verify water injection pump rates against setpoints.",
         severity="high", priority="24h", source="GSC Process Manual",
         tags=["ratio", "mixing", "credits"]),
    dict(domain="ccs", parameter="CO2_PURITY_PERCENTAGE", category="process",
         title="Review CO2 source quality",
         description="CO2 purity below 90% risks credit invalidation under Puro.Earth GSC methodology.",
         action="Check supply quality certificate. Review gas chromatograph readings. Notify CO2 supplier.",
         severity="critical", priority="immediate", source="Puro.Earth GSC Methodology",
         tags=["purity", "compliance"]),
    dict(domain="ccs", parameter=None, category="environmental",
         title="Verify ESS monitoring continuity",
         description="Data gaps in environmental monitoring must be reported to registry under the ESS framework.",
         action="Check sensor connectivity and data logger status. Fill gaps with interpolation.",
         severity="medium", priority="24h", source="ESS Framework v2.1",
         tags=["ESS", "environmental"]),
    dict(domain="biochar", parameter="TEMPERATURE", category="process",
         title="Check pyrolysis temperature profile",
         description="Temperature below 700C risks producing Class 2 instead of Class 1 biochar, reducing carbon permanence rating.",
         action="Review burner controls, feedstock moisture, and residence time. Adjust temperature setpoint.",
         severity="critical", priority="immediate", source="EBC Certification Standard",
         tags=["pyrolysis", "temperature"]),
    dict(domain="biochar", parameter=None, category="instrumentation",
         title="Verify thermocouple calibration",
         description="Thermocouple drift is the leading cause of false temperature readings in pyrolysis units.",
         action="Compare primary and redundant thermocouples. Perform ice-point check. Replace if drift >2C.",
         severity="medium", priority="24h", source="Instrumentation SOP",
         tags=["thermocouple", "calibration"]),
    dict(domain="general", parameter=None, category="instrumentation",
         title="Conduct sensor cross-validation",
         description="When a single parameter shows anomaly without correlated parameters affected, sensor fault is most likely.",
         action="Compare with adjacent sensors. Check signal cable integrity. Review last maintenance record.",
         severity="medium", priority="24h", source="General Best Practice",
         tags=["sensor", "validation"]),
    dict(domain="general", parameter=None, category="process",
         title="Review recent operational changes",
         description="Anomalies following setpoint changes or maintenance events are often process-related rather than equipment failure.",
         action="Cross-reference operational log from past 4 hours. Interview shift supervisor.",
         severity="low", priority="scheduled", source="Operations Best Practice",
         tags=["operational", "change"]),
]


def create_default_admin():
    """
    Idempotently create the system admin account on first startup.
    Retries up to 5 times in case the DB isn't ready yet.

    Extracted from startup.py (F038) to keep startup.py focused on migrations only.
    """
    from sqlalchemy import func

    from app.core.database import SessionLocal
    from app.core.security import hash_password
    from app.models import KnowledgeBaseEntry, User

    for attempt in range(5):
        db = None
        try:
            db = SessionLocal()

            existing = db.query(User).filter(User.email == "admin@datasentinel.io").first()
            default_pw = os.environ.get("ADMIN_DEFAULT_PASSWORD", "changeme-on-first-login")
            _weak_defaults = {"changeme-on-first-login", "admin", "password", "admin123"}

            if not existing:
                # F027: warn loudly if default password is unchanged in production
                if default_pw in _weak_defaults and os.environ.get("ENVIRONMENT") == "production":
                    logger.critical(
                        "ADMIN_DEFAULT_PASSWORD is set to a weak default in production! "
                        "Set a strong password via ECS Secrets Manager before first login."
                    )
                admin = User(
                    email="admin@datasentinel.io",
                    full_name="System Admin",
                    hashed_password=hash_password(default_pw),
                    role="admin",
                    is_active=True,
                )
                db.add(admin)
                db.commit()
                logger.info("Admin user created: admin@datasentinel.io")

            elif os.environ.get("ADMIN_FORCE_PASSWORD_RESET", "").lower() == "true":
                # Safety escape hatch: set ADMIN_FORCE_PASSWORD_RESET=true in ECS
                # together with ADMIN_DEFAULT_PASSWORD=<new_password> to reset the
                # admin password on next container start.
                # IMPORTANT: remove ADMIN_FORCE_PASSWORD_RESET after logging in.
                existing.hashed_password = hash_password(default_pw)
                existing.is_active = True
                db.commit()
                logger.warning(
                    "ADMIN_FORCE_PASSWORD_RESET=true — admin password has been reset. "
                    "Remove this env var from ECS after logging in."
                )

            # Remove duplicate projects
            from app.models import Project
            dupes = (
                db.query(Project.name)
                .group_by(Project.name)
                .having(func.count(Project.id) > 1)
                .all()
            )
            for (name,) in dupes:
                same = db.query(Project).filter(Project.name == name).order_by(Project.created_at.asc()).all()
                for p in same[1:]:
                    db.delete(p)
                logger.info(f"Deduped '{name}': removed {len(same)-1} duplicate(s)")
            if dupes:
                db.commit()

            # Promote super-admins
            raw_sa = os.environ.get("SUPER_ADMIN_EMAILS", "")
            for email in [e.strip() for e in raw_sa.split(",") if e.strip()]:
                u = db.query(User).filter(User.email == email).first()
                if u and u.role != "super_admin":
                    u.role = "super_admin"
                    db.commit()
                    logger.info(f"Promoted {email} to super_admin")

            # Seed knowledge base defaults
            if db.query(KnowledgeBaseEntry).count() == 0:
                for entry in DEFAULT_KB_ENTRIES:
                    db.add(KnowledgeBaseEntry(**entry))
                db.commit()
                logger.info(f"Knowledge base seeded with {len(DEFAULT_KB_ENTRIES)} default entries")

            db.close()
            return

        except Exception as e:
            logger.warning(f"Startup attempt {attempt+1} failed: {e}")
            if db:
                try:
                    db.close()
                except Exception:
                    pass
            time.sleep(2)

    logger.error("Could not initialise default admin after 5 attempts")
