"""What each stream metric and dated value is, in the words a site uses.

The built-in tag map. Metric ids are the stream metric names the calculation
tree reads (apps/web/src/lib/mrv/calc/specs). Each entry says how a day folds,
what the readings can physically be, and which credit term it feeds, so a
finding can say what it does to the credit. A project's approved tag map
(PLC tags → these metrics, its own limits) replaces entries once approvals exist.
"""

from dataclasses import dataclass

TAG_MAP_VERSION = "built-in-1"

# How readings arrive:
#   rate     a continuous meter (power, energy per tonne); a day is the mean
#   event    one reading per delivery, trip or batch; a day is the sum
#   total    one daily total (venting, reversals); a day is the sum
#   counter  a cumulative totaliser that only rises until it is reset
KINDS = ("rate", "event", "total", "counter")


@dataclass(frozen=True)
class Metric:
    id: str
    # The quantity, as a sentence names it: "liquid CO₂ delivered".
    name: str
    # What reports it: "weighbridge record", "capture power meter".
    meter: str
    unit: str
    kind: str
    # The credit term it feeds, as the calculation tree names it.
    feeds: str = ""
    # Readings below or above these are physically impossible.
    low: float | None = None
    high: float | None = None
    # A zero reading is normal (no venting, no reversal today).
    zero_ok: bool = False
    # Expected spacing of a continuous meter's readings, in minutes.
    cadence_minutes: float | None = None
    # Factor from the unit to tonnes of CO₂ (or CO₂e), when it is one.
    to_tonnes: float | None = None
    # The journey task whose records back it (journey.yaml), where a fix is filed.
    task: str = ""

    @property
    def daily(self):
        """How one day folds: a mean for meters, a sum for counted amounts, the last value for totalisers."""
        return {"rate": "mean", "counter": "last"}.get(self.kind, "sum")

    @property
    def continuous(self):
        return self.kind in ("rate", "counter")


METRICS = {
    m.id: m
    for m in (
        Metric(
            "LCO2_DELIVERED_t",
            "liquid CO₂ delivered",
            "weighbridge record",
            "t",
            "event",
            feeds="M_del, the CO₂ delivered for storage, where CO₂ stored starts",
            low=0,
            # One delivery: a road tanker carries 20–30 t, a rail tank car up to about 80 t.
            high=100,
            to_tonnes=1,
            task="monitor.chain",
        ),
        Metric(
            "CO2_TRANSIT_LOSS_kg",
            "transit loss",
            "transport provider's loss record",
            "kg",
            "event",
            feeds="L_tr, transit losses subtracted from CO₂ stored",
            low=0,
            high=5000,
            zero_ok=True,
            to_tonnes=0.001,
            task="monitor.chain",
        ),
        Metric(
            "CO2_VENTED_SITE_kg",
            "CO₂ vented at the storage site",
            "venting record",
            "kg",
            "total",
            feeds="L_vent, venting subtracted from CO₂ stored",
            low=0,
            high=20000,
            zero_ok=True,
            to_tonnes=0.001,
            task="monitor.chain",
        ),
        Metric(
            "CAPTURE_POWER_kW",
            "capture and liquefaction power",
            "capture power meter",
            "kW",
            "rate",
            feeds="E_cap, the electricity emissions of capture and liquefaction",
            low=0,
            high=20000,
            cadence_minutes=2,
            task="monitor.energy",
        ),
        Metric(
            "LCO2_TANKER_TRIPS",
            "tanker trips",
            "trip log",
            "trips",
            "total",
            feeds="E_trn, road transport emissions",
            low=0,
            high=50,
            zero_ok=True,
            task="monitor.energy",
        ),
        Metric(
            "FUEL_PER_TRIP_L",
            "diesel per tanker trip",
            "fuel log",
            "L",
            "event",
            feeds="E_trn, road transport emissions",
            low=0,
            high=1000,
            task="monitor.energy",
        ),
        Metric(
            "ENERGY_PER_TONNE_kWht",
            "injection energy per tonne",
            "injection energy meter",
            "kWh/t",
            "rate",
            feeds="E_inj, the emissions of conditioning and injection",
            low=0,
            high=2000,
            cadence_minutes=2,
            task="monitor.energy",
        ),
        Metric(
            "CO2_REVERSAL_t",
            "reservoir reversals",
            "reservoir monitoring report",
            "t",
            "total",
            feeds="R_rev, reversals subtracted from the credit",
            low=0,
            zero_ok=True,
            to_tonnes=1,
            task="monitor.storage",
        ),
        # The CO₂ chain metered day by day (Fujairah's tag dictionary): capture, liquefaction,
        # injection, and the electricity of each stage. Daily totals from the site's totalisers.
        Metric(
            "CO2_CAPTURED_t",
            "CO₂ captured",
            "capture flow meter (FT-0209)",
            "t",
            "total",
            feeds="the captured CO₂ the chain reconciliation starts from",
            low=0,
            high=500,
            to_tonnes=1,
            task="monitor.chain",
        ),
        Metric(
            "CO2_LIQUEFIED_t",
            "CO₂ liquefied",
            "liquefaction totalisers (ST-01 less CL-01)",
            "t",
            "total",
            feeds="the liquefied CO₂ between capture and delivery in the chain reconciliation",
            low=0,
            high=500,
            zero_ok=True,
            to_tonnes=1,
            task="monitor.chain",
        ),
        Metric(
            "CO2_INJECTED_t",
            "CO₂ injected",
            "injection flow meters (FT-04 and FT-05)",
            "t",
            "total",
            feeds="C_injected, the CO₂ stored that Puro's equation starts from",
            low=0,
            high=500,
            zero_ok=True,
            to_tonnes=1,
            task="monitor.injected",
        ),
        Metric(
            "WATER_INJECTED_t",
            "water injected",
            "water flow meter (FT-03)",
            "t",
            "total",
            feeds="the water the CO₂ is dissolved in before injection",
            low=0,
            high=20000,
            zero_ok=True,
            task="monitor.storage",
        ),
        Metric(
            "TRACER_INJECTED_t",
            "tracer injected",
            "tracer flow meter (FT-07)",
            "t",
            "total",
            feeds="the tracer that shows where the injected CO₂ goes",
            low=0,
            high=50,
            zero_ok=True,
            task="monitor.storage",
        ),
        Metric(
            "ENERGY_CAPTURE_kWh",
            "capture plant electricity",
            "capture unit energy meter (CCU)",
            "kWh",
            "total",
            feeds="E_cap, the electricity emissions of capture",
            low=0,
            high=200000,
            zero_ok=True,
            task="monitor.energy",
        ),
        Metric(
            "ENERGY_LIQUEFACTION_kWh",
            "liquefaction electricity",
            "liquefaction unit energy meter",
            "kWh",
            "total",
            feeds="E_cap, the electricity emissions of liquefaction",
            low=0,
            high=200000,
            zero_ok=True,
            task="monitor.energy",
        ),
        Metric(
            "ENERGY_INJECTION_kWh",
            "injection site electricity",
            "injection site energy meter",
            "kWh",
            "total",
            feeds="E_inj, the emissions of conditioning and injection",
            low=0,
            high=200000,
            zero_ok=True,
            task="monitor.energy",
        ),
        Metric(
            "GROSS_REMOVAL_t",
            "gross removal",
            "gross removal record",
            "t",
            "total",
            feeds="the gross removal the credit starts from",
            low=0,
            to_tonnes=1,
        ),
        Metric(
            "PROJECT_EMISSIONS_t",
            "project emissions",
            "emissions record",
            "t",
            "total",
            feeds="project emissions subtracted from the credit",
            low=0,
            zero_ok=True,
            to_tonnes=1,
            task="monitor.energy",
        ),
        Metric(
            "BIOCHAR_DRY_MASS_t",
            "biochar output (dry mass)",
            "biochar scale",
            "t",
            "event",
            feeds="the biochar mass the stored carbon is worked out from",
            low=0,
            zero_ok=True,
        ),
        Metric(
            "PRODUCTION_EMISSIONS_t",
            "production emissions",
            "production emissions record",
            "t",
            "event",
            feeds="production emissions subtracted from the credit",
            low=0,
            zero_ok=True,
            to_tonnes=1,
            task="monitor.energy",
        ),
    )
}

# Dated values (lab results, factors, LCA totals) and what they are.
FIXED = {
    "BIOGENIC_FRACTION_pct": "C-14 biogenic share (lab result)",
    "GRID_EMISSION_FACTOR_kg_per_kWh": "grid emission factor",
    "DIESEL_EF_kg_per_L": "diesel emission factor",
    "EMBODIED_EMISSIONS_t": "embodied emissions from the LCA",
    "UNCERTAINTY_DISCOUNT": "uncertainty discount",
    "LEAKAGE_FRACTION": "leakage fraction",
    "ORGANIC_CARBON_FRACTION": "organic carbon content (lab result)",
    "PERSISTENCE_FRACTION": "persistence factor",
    "BIOMASS_EMISSIONS_t": "biomass sourcing emissions",
    "USE_EMISSIONS_t": "end use and transport emissions",
}


# The journey task each dated value is filed on.
FIXED_TASKS = {
    "BIOGENIC_FRACTION_pct": "monitor.biogenic",
    "GRID_EMISSION_FACTOR_kg_per_kWh": "monitor.energy",
    "DIESEL_EF_kg_per_L": "monitor.energy",
}


def task_for(metric_id=None, fixed_key=None):
    """The journey task a finding about this metric or dated value bears on; "" when none does."""
    if metric_id:
        known = METRICS.get(metric_id)
        return known.task if known else ""
    return FIXED_TASKS.get(fixed_key or "", "")


def metric(metric_id):
    """The catalogue entry, or a plain one for a metric the catalogue does not know yet."""
    known = METRICS.get(metric_id)
    if known:
        return known
    unit = metric_id.rsplit("_", 1)[-1] if "_" in metric_id else ""
    return Metric(metric_id, metric_id, f"{metric_id} meter", unit, "rate")


def fixed_name(key):
    return FIXED.get(key, key)
