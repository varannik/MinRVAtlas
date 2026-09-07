import {
  isMonitoredInput,
  type AccountingComponent,
  type AccountingInput,
  type GroupRole,
} from "./accounting";

export type FormulaOp = "×" | "÷";

export type BlueprintFormula = {
  key: string;
  expression: string;
  terms: { key: string; op: FormulaOp }[];
};

const FORMULAS: Record<string, string> = {
  aggregated_sample_transport: "aggregated_sample_transport",
  area_based_emissions: "area × emission_factor",
  constant_activity_emissions: "constant_activity_emissions",
  count_based_emissions: "count × emissions_per_count",
  currency_based_ci_emissions: "amount_spent × carbon_intensity",
  distance_based_ci_emissions: "distance × carbon_intensity",
  electricity_ratio_based_emissions: "mass_feedstock × energy × carbon_intensity",
  embodied_emissions: "embodied_emissions",
  energy_based_ci_emissions: "energy × carbon_intensity",
  fuel_consumption_based_transport: "distance × fuel_carbon_intensity ÷ fuel_economy",
  fuel_usage_by_mass: "mass_of_fuel × fuel_combustion_carbon_intensity",
  fuel_usage_by_volume: "volume_of_fuel × fuel_combustion_carbon_intensity",
  ghg_direct_emissions: "mass_flow × concentration × global_warming_potential",
  grid_electricity_use: "electricity_use × grid_carbon_intensity",
  grid_electricity_use_with_recs: "grid_electricity_use × grid_carbon_intensity",
  mass_based_ci_emissions: "mass × carbon_intensity",
  mass_distance_based_ci_emissions: "mass_distance × carbon_intensity",
  mass_ratio_based_emissions: "mass_ratio × emissions_factor × feedstock_mass",
  metered_energy_based_ci_emissions: "energy_use × carbon_intensity",
  time_based_emissions: "time × emission_factor",
  time_based_grid_electricity_use: "time × average_power × grid_carbon_intensity",
  transport: "mass × distance × carbon_intensity",
  specific_volume_based_emissions:
    "volume_material_per_mass × emissions_factor × feedstock_mass",
  volume_based_ci_emissions: "volume × carbon_intensity",
  off_platform_sequestration: "off_platform_sequestration",
  calculated_sequestration: "calculated_sequestration",
  dac_sequestration_constant_co2_mass: "dac_sequestration_constant_co2_mass",
  constant_reduction: "constant_reduction",
  constant_loss: "constant_loss",
  constant_uncertainty_discount: "constant_uncertainty_discount",
};

const KEY_ALIASES: Record<string, string[]> = {
  mass: ["mass", "mass_feedstock", "mass_of_fuel", "mass_of_load", "feedstock_mass"],
  mass_feedstock: ["mass_feedstock", "feedstock_mass", "mass"],
  feedstock_mass: ["feedstock_mass", "mass_feedstock", "mass"],
  mass_of_fuel: ["mass_of_fuel", "mass"],
  energy: ["energy", "electricity_use", "grid_electricity_use", "energy_used", "energy_use"],
  energy_use: ["energy_use", "energy", "electricity_use"],
  electricity_use: ["electricity_use", "grid_electricity_use", "energy", "total_grid_electricity_use"],
  grid_electricity_use: ["grid_electricity_use", "electricity_use", "energy"],
  carbon_intensity: [
    "carbon_intensity",
    "emission_factor",
    "emissions_factor",
    "grid_carbon_intensity",
    "fuel_combustion_carbon_intensity",
    "fuel_carbon_intensity",
  ],
  emission_factor: ["emission_factor", "emissions_factor", "carbon_intensity"],
  emissions_factor: ["emissions_factor", "emission_factor", "carbon_intensity"],
  grid_carbon_intensity: ["grid_carbon_intensity", "carbon_intensity", "emission_factor"],
  fuel_combustion_carbon_intensity: [
    "fuel_combustion_carbon_intensity",
    "fuel_carbon_intensity",
    "emission_factor",
    "carbon_intensity",
  ],
  fuel_carbon_intensity: [
    "fuel_carbon_intensity",
    "fuel_combustion_carbon_intensity",
    "carbon_intensity",
  ],
  volume_of_fuel: ["volume_of_fuel", "volume"],
  volume: ["volume", "volume_of_fuel"],
  distance: ["distance"],
  amount_spent: ["amount_spent", "spend"],
  spend: ["spend", "amount_spent"],
};

function normalizeBlueprintKey(blueprintKey: string): string {
  return blueprintKey.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function parseExpression(expression: string): { key: string; op: FormulaOp }[] {
  const cleaned = expression.replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  const tokens = cleaned.split(/(\s*[×÷*/]\s*)/).map((part) => part.trim()).filter(Boolean);
  const terms: { key: string; op: FormulaOp }[] = [];
  let nextOp: FormulaOp = "×";
  for (const token of tokens) {
    if (token === "×" || token === "*") {
      nextOp = "×";
      continue;
    }
    if (token === "÷" || token === "/") {
      nextOp = "÷";
      continue;
    }
    terms.push({ key: token, op: nextOp });
    nextOp = "×";
  }
  return terms;
}

export function formulaFor(blueprintKey?: string): BlueprintFormula | null {
  if (!blueprintKey) return null;
  const key = normalizeBlueprintKey(blueprintKey);
  const expression = FORMULAS[key] ?? FORMULAS[key.split(/[./:]/).pop() ?? key];
  if (!expression) return null;
  return { key, expression, terms: parseExpression(expression) };
}

export function formulaLabel(component: AccountingComponent): string {
  const known = formulaFor(component.blueprintKey);
  if (known) return known.expression;
  if (component.inputs.length === 0) return component.blueprint ?? "no inputs";
  if (component.inputs.length === 1) return component.inputs[0].key;
  return component.inputs.map((input) => input.key).join(" × ");
}

export type FormulaStep = {
  input: AccountingInput;
  op: FormulaOp | "=";
};

export function formulaSteps(component: AccountingComponent): FormulaStep[] {
  const known = formulaFor(component.blueprintKey);
  if (!known) {
    return component.inputs.map((input, index) => ({
      input,
      op: index === 0 ? "=" : "×",
    }));
  }
  const steps: FormulaStep[] = [];
  for (const [index, term] of known.terms.entries()) {
    const input = findInput(component, term.key);
    if (!input) continue;
    steps.push({ input, op: index === 0 ? "=" : term.op });
  }
  if (steps.length === 0) {
    return component.inputs.map((input, index) => ({
      input,
      op: index === 0 ? "=" : "×",
    }));
  }
  return steps;
}

/** How this component contributes to its parent bucket. */
export function componentEdgeSign(
  component: AccountingComponent,
  role: GroupRole,
): "+" | "−" {
  const key = (component.blueprintKey ?? "").toLowerCase();
  if (key.includes("loss") || key.includes("uncertainty_discount")) return "−";
  if (key.includes("reduction")) return "−";
  if (role === "sequestrations") return "+";
  return "+";
}

/** Net = Stored − Counterfactual − Emissions. */
export function roleEdgeSign(role: GroupRole): "+" | "−" {
  return role === "sequestrations" ? "+" : "−";
}

export type MeasuredValue = {
  magnitude: number;
  unit: string;
};

function normalizeUnit(unit: string): string {
  return unit.replace(/\s+/g, "").replace(/²/g, "2").replace(/³/g, "3").toLowerCase();
}

function toTermNumber(magnitude: number, unit: string): number {
  const u = normalizeUnit(unit);
  if (u === "%") return magnitude / 100;
  if (u === "t" || u === "tonne" || u === "tonnes") return magnitude;
  return magnitude;
}

function identityToKg(magnitude: number, unit: string): number {
  const u = normalizeUnit(unit);
  if (u === "t" || u === "tonne" || u === "tonnes" || u === "tco2e" || u === "tco₂e") {
    return magnitude * 1000;
  }
  if (u === "g" || u === "gco2e" || u === "gco₂e") return magnitude / 1000;
  return magnitude;
}

function findInput(
  component: AccountingComponent,
  term: string,
): AccountingInput | undefined {
  const direct = component.inputs.find((input) => input.key === term);
  if (direct) return direct;
  const aliases = KEY_ALIASES[term] ?? [term];
  return component.inputs.find((input) =>
    aliases.some(
      (alias) =>
        input.key === alias ||
        input.key.includes(alias) ||
        alias.includes(input.key),
    ),
  );
}

export function evaluateComponent(
  component: AccountingComponent,
  read: (input: AccountingInput) => MeasuredValue | null,
): { kg: number | null; missing: string[] } {
  const steps = formulaSteps(component);
  const missing: string[] = [];
  const numbers: number[] = [];
  const ops: (FormulaOp | "=")[] = [];

  for (const step of steps) {
    const value = read(step.input);
    if (!value || !Number.isFinite(value.magnitude)) {
      missing.push(step.input.name);
      continue;
    }
    ops.push(step.op);
    numbers.push(toTermNumber(value.magnitude, value.unit));
  }

  if (missing.length > 0 || numbers.length === 0) return { kg: null, missing };
  if (steps.length === 0) return { kg: null, missing: ["input"] };

  const identity = steps.length === 1;
  if (identity) {
    const value = read(steps[0].input);
    if (!value) return { kg: null, missing: [steps[0].input.name] };
    return { kg: identityToKg(value.magnitude, value.unit), missing: [] };
  }

  let acc = numbers[0];
  for (let i = 1; i < numbers.length; i += 1) {
    if (ops[i] === "÷") acc = numbers[i] === 0 ? Number.NaN : acc / numbers[i];
    else acc *= numbers[i];
  }
  if (!Number.isFinite(acc)) return { kg: null, missing: ["undefined"] };
  return { kg: acc, missing: [] };
}
