import { constant, duration, equation, fixed, reuse, series } from "../build";
import type { CalcNode, CalcSpec, EquationNode } from "../types";

/**
 * Captured CO₂ trucked to a site and stored underground (Fujairah: capture →
 * liquefaction → road tanker → surface conditioning → peridotite reservoir).
 *
 * Stream metric names follow the operator's block diagram, the same names the
 * 3D site model uses (lib/site-layouts). Fixed keys follow the GHG accounting
 * columns in attributes.json.
 *
 * Clause references are left generic until the edition in force is confirmed,
 * as in the requirement modules (registries/puro/methodologies.ts).
 */

export interface GeologicOptions {
  id: string;
  registry: string;
  methodology: string;
  edition: string;
  creditUnit: string;
  rootLabel: string;
  refPrefix: string;
  sources: string[];
  /** Only the biogenic / atmospheric share of the CO₂ is creditable. */
  eligibleShare: boolean;
  /** How the CO₂ is captured, for labels. */
  captureLabel: string;
  /** Registry applies a conservative discount for measurement uncertainty. */
  uncertaintyDiscount: boolean;
}

function storedTerm(o: GeologicOptions) {
  const ref = (clause: string) => `${o.refPrefix} — ${clause}`;
  const delivered = series("M_del", "M_del", "Liquid CO₂ delivered", "t", "LCO2_DELIVERED_t", "sum", {
    note: "Net liquid CO₂ from weighing-bridge tickets for every tanker trip.",
    reference: ref("CO₂ quantification"),
    remedy: "Load weighing-bridge tickets (gross, tare, net) for each tanker trip in the window.",
  });
  const stored = equation(
    "M_st",
    "M_st",
    "CO₂ stored",
    "t",
    "difference",
    [
      delivered,
      series("L_tr", "L_tr", "Transit losses", "t", "CO2_TRANSIT_LOSS_kg", "sum", {
        scale: 0.001,
        note: "Boil-off and leakage between the capture site and the storage site.",
        reference: ref("losses and leakage"),
        remedy: "Add the transport provider's transit-loss estimate per trip.",
      }),
      series("L_vent", "L_vent", "Venting at site conditioning", "t", "CO2_VENTED_SITE_kg", "sum", {
        scale: 0.001,
        note: "CO₂ vented while vaporising and metering into the water stream.",
        reference: ref("losses and leakage"),
        remedy: "Add the estimated site venting per day from the metering skid.",
      }),
    ],
    { note: "Deliveries less losses before injection.", reference: ref("CO₂ quantification") },
  );
  if (!o.eligibleShare) return { stored, root: stored, delivered };
  const eligible = equation(
    "S",
    "S",
    "Eligible CO₂ stored",
    "t",
    "product",
    [
      stored,
      fixed("f_bio", "f_bio", "Biogenic share (C-14)", "fraction", "BIOGENIC_FRACTION_pct", "intensity", {
        scale: 0.01,
        note: "Share of the CO₂ product that is biogenic, from C-14 lab analysis.",
        reference: ref("eligible CO₂ sources"),
        remedy: "Upload the C-14 lab result whose sampling covers this window.",
      }),
    ],
    { note: "Only biogenic or atmospheric CO₂ is creditable.", reference: ref("eligible CO₂ sources") },
  );
  return { stored, root: eligible, delivered };
}

function emissionsTerm(o: GeologicOptions, delivered: CalcNode): EquationNode {
  const ref = (clause: string) => `${o.refPrefix} — ${clause}`;
  const grid = fixed("EF_grid", "EF_grid", "Grid emission factor", "t/kWh", "GRID_EMISSION_FACTOR_kg_per_kWh", "intensity", {
    scale: 0.001,
    note: "Location-based grid factor for the period.",
    reference: ref("life-cycle emissions"),
    remedy: "Set GRID_EMISSION_FACTOR_kg_per_kWh in the period attributes.",
  });
  return equation(
    "E",
    "E",
    "Life-cycle emissions",
    "t",
    "sum",
    [
      equation(
        "E_cap",
        "E_cap",
        `${o.captureLabel} & liquefaction`,
        "t",
        "product",
        [
          series("P_cap", "P̄_cap", "Mean capture power", "kW", "CAPTURE_POWER_kW", "mean", {
            note: "Metered electrical load of the capture and liquefaction units.",
            reference: ref("life-cycle emissions"),
            remedy: "Connect the capture site's power meter to the stream.",
          }),
          duration("dt_cap"),
          reuse(grid, "cap"),
        ],
        { note: "Electricity for capture and liquefaction × grid factor.", reference: ref("life-cycle emissions") },
      ),
      equation(
        "E_trn",
        "E_trn",
        "Road transport",
        "t",
        "product",
        [
          series("n_trip", "n", "Tanker trips", "trips", "LCO2_TANKER_TRIPS", "sum", {
            note: "Trips logged by the transport provider.",
            reference: ref("life-cycle emissions"),
            remedy: "Load the tanker trip log for the window.",
          }),
          series("v_fuel", "v_fuel", "Diesel per trip", "L/trip", "FUEL_PER_TRIP_L", "mean", {
            note: "Mean fuel burned per round trip.",
            reference: ref("life-cycle emissions"),
            remedy: "Add fuel per trip from the transport provider.",
          }),
          fixed("EF_dsl", "EF_dsl", "Diesel emission factor", "t/L", "DIESEL_EF_kg_per_L", "intensity", {
            scale: 0.001,
            reference: ref("life-cycle emissions"),
            remedy: "Set DIESEL_EF_kg_per_L in the period attributes.",
          }),
        ],
        { note: "Trips × fuel per trip × diesel factor.", reference: ref("life-cycle emissions") },
      ),
      equation(
        "E_inj",
        "E_inj",
        "Conditioning & injection",
        "t",
        "product",
        [
          reuse(delivered, "inj"),
          series("e_inj", "e_inj", "Injection energy per tonne", "kWh/t", "ENERGY_PER_TONNE_kWht", "mean", {
            note: "Pumping and vaporising energy per tonne of CO₂ injected.",
            reference: ref("life-cycle emissions"),
            remedy: "Check ENERGY_PER_TONNE_kWht is reaching the stream.",
          }),
          reuse(grid, "inj"),
        ],
        { note: "CO₂ handled × energy per tonne × grid factor.", reference: ref("life-cycle emissions") },
      ),
      fixed("E_emb", "E_emb", "Embodied & end-of-life (amortised)", "t", "EMBODIED_EMISSIONS_t", "prorata", {
        note: "Plant construction and decommissioning, spread over the crediting period.",
        reference: ref("life-cycle emissions"),
        remedy: "Add EMBODIED_EMISSIONS_t from the LCA with its validity window.",
      }),
    ],
    { note: "Every emission from capture to injection.", reference: ref("life-cycle emissions") },
  );
}

export function geologicStorageSpec(o: GeologicOptions): CalcSpec {
  const ref = (clause: string) => `${o.refPrefix} — ${clause}`;
  const { root: storedRoot, delivered } = storedTerm(o);
  const net = equation(
    "N",
    o.uncertaintyDiscount ? "N" : "R",
    o.uncertaintyDiscount ? "Net CO₂e removed (before discount)" : o.rootLabel,
    "tCO₂e",
    "difference",
    [
      storedRoot,
      emissionsTerm(o, delivered),
      series("R_rev", "R_rev", "Reservoir reversals", "t", "CO2_REVERSAL_t", "sum", {
        note: "CO₂ shown by storage monitoring to have left the reservoir.",
        reference: ref("storage monitoring"),
        remedy: "Report reservoir monitoring for the window (zero is a valid reading).",
      }),
    ],
    { note: "Stored − emitted − reversed.", reference: ref("net removal") },
  );

  const root: EquationNode = o.uncertaintyDiscount
    ? equation(
        "R",
        "R",
        o.rootLabel,
        "tCO₂e",
        "product",
        [
          net,
          equation(
            "k",
            "k",
            "Certainty factor",
            "fraction",
            "difference",
            [
              constant("one", "1", "Whole", "fraction", 1, "Identity"),
              fixed("u", "u", "Uncertainty discount", "fraction", "UNCERTAINTY_DISCOUNT", "intensity", {
                note: "Conservative discount from the uncertainty assessment.",
                reference: ref("uncertainty"),
                remedy: "Set UNCERTAINTY_DISCOUNT from the period's uncertainty quantification.",
              }),
            ],
            { note: "1 − uncertainty discount.", reference: ref("uncertainty") },
          ),
        ],
        { note: "Net removal after the uncertainty discount.", reference: ref("crediting") },
      )
    : { ...net, id: "R" };

  return {
    id: o.id,
    registry: o.registry,
    methodology: o.methodology,
    edition: o.edition,
    creditUnit: o.creditUnit,
    root,
    proxyId: "M_del",
    sources: o.sources,
  };
}
