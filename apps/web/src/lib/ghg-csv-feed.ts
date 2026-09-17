import {
  defaultUnit,
  type AccountingComponent,
  type AccountingInput,
  type AccountingTemplate,
} from "./accounting";
import { GHG_COLUMN_METRICS } from "./ghg-csv-columns";
import { remapCsv, splitCsvLine } from "./sentinel/column-map";

/** Dense-phase CO₂ at reservoir conditions (kg/m³). */
const CO2_DENSITY_KG_M3 = 1.977;

export type CsvMetric = {
  key: string;
  magnitude: number;
  unit: string;
  label: string;
};

export type GhgFeedMatch = {
  componentId: string;
  inputKey: string;
  inputName: string;
  magnitude: number;
  unit: string;
  source: string;
};

export type GhgFeedResult = {
  metrics: CsvMetric[];
  matches: GhgFeedMatch[];
  fed: number;
  skipped: string[];
};

function parseCsvTable(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]).map((cell) => cell.trim());
  const rows = lines.slice(1).map((line) => splitCsvLine(line));
  return { headers, rows };
}

function normalizeHeader(header: string): string {
  return header.replace(/^\uFEFF/, "").trim().toUpperCase();
}

function columnIndex(headers: string[], ...names: string[]): number {
  const wanted = new Set(names.map((name) => normalizeHeader(name)));
  return headers.findIndex((header) => wanted.has(normalizeHeader(header)));
}

function numericColumn(rows: string[][], index: number): number[] {
  if (index < 0) return [];
  return rows
    .map((row) => Number(String(row[index] ?? "").trim()))
    .filter((value) => Number.isFinite(value));
}

function scalarColumn(rows: string[][], index: number): number | null {
  if (index < 0) return null;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const value = Number(String(rows[i]?.[index] ?? "").trim());
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function rowDay(row: string[], headers: string[]): string | null {
  const index = columnIndex(headers, "timestamp_utc");
  if (index < 0) return null;
  const raw = row[index]?.trim();
  if (!raw || raw.length < 10) return null;
  return raw.slice(0, 10);
}

function filterRowsByPeriod(
  rows: string[][],
  headers: string[],
  periodStart?: string,
  periodEnd?: string,
): string[][] {
  if (!periodStart || !periodEnd) return rows;
  if (columnIndex(headers, "timestamp_utc") < 0) return rows;
  return rows.filter((row) => {
    const day = rowDay(row, headers);
    return day != null && day >= periodStart && day <= periodEnd;
  });
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function integrateRateM3(
  rows: string[][],
  headers: string[],
  rateIndex: number,
): number | null {
  const tsIndex = columnIndex(headers, "timestamp_utc");
  if (tsIndex < 0) {
    const rates = numericColumn(rows, rateIndex);
    return rates.length ? rates.reduce((sum, rate) => sum + rate, 0) / 60 : null;
  }

  let total = 0;
  let pairs = 0;
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1];
    const curr = rows[i];
    const rate = Number(String(curr[rateIndex] ?? "").trim());
    const prevTs = Date.parse(String(prev[tsIndex]).replace(" ", "T") + "Z");
    const currTs = Date.parse(String(curr[tsIndex]).replace(" ", "T") + "Z");
    if (!Number.isFinite(rate) || !Number.isFinite(prevTs) || !Number.isFinite(currTs)) {
      continue;
    }
    const hours = Math.max(0, (currTs - prevTs) / 3_600_000);
    if (hours > 0) {
      total += rate * hours;
      pairs += 1;
    }
  }
  return pairs > 0 ? total : null;
}

function pushMetric(metrics: CsvMetric[], metric: CsvMetric) {
  if (!metrics.some((row) => row.key === metric.key)) metrics.push(metric);
}

function pushMassMetrics(metrics: CsvMetric[], volumeM3: number) {
  const massKg = volumeM3 * CO2_DENSITY_KG_M3;
  pushMetric(metrics, {
    key: "co2_volume_m3",
    magnitude: volumeM3,
    unit: "m3",
    label: "Injected CO₂ volume",
  });
  pushMetric(metrics, {
    key: "co2_mass_kg",
    magnitude: massKg,
    unit: "kg",
    label: "Injected CO₂ mass",
  });
  pushMetric(metrics, {
    key: "co2_mass_t",
    magnitude: massKg / 1000,
    unit: "t",
    label: "Injected CO₂ mass",
  });
}

function extractAccountingMetrics(headers: string[], rows: string[][]): CsvMetric[] {
  const metrics: CsvMetric[] = [];
  for (const header of headers) {
    const spec = GHG_COLUMN_METRICS[header] ?? GHG_COLUMN_METRICS[normalizeHeader(header)];
    if (!spec) continue;
    const value = scalarColumn(rows, columnIndex(headers, header));
    if (value == null || value <= 0) continue;
    pushMetric(metrics, {
      key: spec.key,
      magnitude: value,
      unit: spec.unit,
      label: spec.label,
    });
    if (spec.key === "feedstock_mass_t") {
      pushMetric(metrics, {
        key: "feedstock_mass_kg",
        magnitude: value * 1000,
        unit: "kg",
        label: "Feedstock mass",
      });
    }
  }
  return metrics;
}

export function extractMetricsFromCsv(
  csvText: string,
  filename: string,
  periodStart?: string,
  periodEnd?: string,
): CsvMetric[] {
  const remapped = remapCsv(filename, csvText);
  const { headers, rows } = parseCsvTable(remapped?.csv ?? csvText);
  if (!headers.length) return [];

  const filtered = filterRowsByPeriod(rows, headers, periodStart, periodEnd);
  const metrics = extractAccountingMetrics(headers, filtered);

  const totalizerIndex = columnIndex(
    headers,
    "CO2_TOTAL_SENSOR_m3",
    "CO2_TOTAL_CALC_m3",
    "CO2_TOTALIZER",
  );
  if (totalizerIndex >= 0) {
    const values = numericColumn(filtered, totalizerIndex);
    if (values.length >= 2) {
      const delta = values[values.length - 1] - values[0];
      if (delta > 0) pushMassMetrics(metrics, delta);
    } else if (values.length === 1 && values[0] > 0) {
      pushMassMetrics(metrics, values[0]);
    }
  }

  const rateIndex = columnIndex(headers, "INJ_RATE_FT01_m3h", "INJECTION_RATE");
  if (rateIndex >= 0 && !metrics.some((metric) => metric.key === "co2_volume_m3")) {
    const integrated = integrateRateM3(filtered, headers, rateIndex);
    if (integrated != null && integrated > 0) pushMassMetrics(metrics, integrated);
  }

  const energyPerTonneIndex = columnIndex(
    headers,
    "ENERGY_PER_TONNE_kWht",
    "ENERGY_PER_TONNE",
  );
  const massTonnes = metrics.find((metric) => metric.key === "co2_mass_t");
  if (energyPerTonneIndex >= 0) {
    const perTonne = average(numericColumn(filtered, energyPerTonneIndex));
    if (perTonne != null) {
      pushMetric(metrics, {
        key: "energy_per_tonne_kwh",
        magnitude: perTonne,
        unit: "kWh",
        label: "Energy per tonne CO₂",
      });
      if (massTonnes) {
        const totalKwh = perTonne * massTonnes.magnitude;
        pushMetric(metrics, {
          key: "total_energy_kwh",
          magnitude: totalKwh,
          unit: "kWh",
          label: "Total grid electricity",
        });
      }
    }
  }

  const waterIndex = columnIndex(headers, "WATER_FLOW_m3h", "WATER_FLOW_RATE");
  const waterAvg = average(numericColumn(filtered, waterIndex));
  if (waterAvg != null) {
    pushMetric(metrics, {
      key: "water_flow_m3h",
      magnitude: waterAvg,
      unit: "m3/h",
      label: "Water flow rate",
    });
  }

  return metrics;
}

function normalizeUnit(unit: string): string {
  return unit
    .replace(/\s+/g, "")
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/·/g, "")
    .toLowerCase();
}

function convertMagnitude(
  magnitude: number,
  fromUnit: string,
  toUnit: string,
): number | null {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (from === to) return magnitude;
  if ((from === "kg" || from === "g") && (to === "t" || to === "tonne" || to === "tonnes")) {
    return from === "g" ? magnitude / 1_000_000 : magnitude / 1000;
  }
  if ((from === "t" || from === "tonne" || from === "tonnes") && to === "kg") {
    return magnitude * 1000;
  }
  if (from === "kwh/kg" && to === "kwh") return magnitude;
  if (from === "kg/kwh" && to === "kg/kwh") return magnitude;
  if (from === "m3" && to === "m³") return magnitude;
  if (from === "m³" && to === "m3") return magnitude;
  if (from === "kwh" && to === "mwh") return magnitude / 1000;
  if (from === "mwh" && to === "kwh") return magnitude * 1000;
  if (from === "l" && to === "m3") return magnitude / 1000;
  if (from === "m3" && to === "l") return magnitude * 1000;
  if (to === "1" || to === "%") return magnitude;
  return null;
}

function componentHaystack(component: AccountingComponent): string {
  return `${component.name} ${component.blueprintKey ?? ""}`.toLowerCase();
}

function pickMetric(
  input: AccountingInput,
  component: AccountingComponent,
  metrics: CsvMetric[],
): CsvMetric | null {
  const key = input.key.toLowerCase();
  const kind = (input.quantityKind ?? "").toLowerCase();
  const hay = componentHaystack(component);

  const find = (metricKey: string) => metrics.find((metric) => metric.key === metricKey) ?? null;

  if (key === "energy" && kind.includes("mass_energy")) {
    if (hay.includes("mining")) return find("mining_energy_density");
    if (hay.includes("crusher")) return find("crusher_energy_density");
    if (hay.includes("handling") && hay.includes("electric")) {
      return find("handling_energy_density");
    }
  }

  if (key === "carbon_intensity" || key === "grid_carbon_intensity") {
    if (hay.includes("truck") || (hay.includes("transport") && hay.includes("truck"))) {
      return find("truck_emission_factor");
    }
    if (hay.includes("car") || hay.includes("laboratory") || hay.includes("staff")) {
      return find("truck_emission_factor") ?? find("grid_carbon_intensity");
    }
    return find("grid_carbon_intensity");
  }

  if (key === "emissions_factor" || key === "fuel_combustion_carbon_intensity") {
    if (hay.includes("natural gas") || hay.includes("gas usage")) {
      return find("ng_emission_factor");
    }
    return find("diesel_emission_factor");
  }

  if (key === "volume_material_per_mass") {
    if (hay.includes("natural gas")) return find("handling_ng_specific_volume");
    if (hay.includes("loader")) return find("loader_diesel_specific_volume");
    if (hay.includes("diesel")) return find("handling_diesel_specific_volume");
  }

  if (key === "mass_feedstock" || key === "feedstock_mass") {
    return find("feedstock_mass_t") ?? find("feedstock_mass_kg");
  }

  if (key === "electricity_use" && kind.includes("energy")) {
    if (hay.includes("drying")) return find("drying_electricity_kwh");
    if (hay.includes("laboratory") || hay.includes("analyzing")) {
      return find("lab_electricity_kwh");
    }
    return find("drying_electricity_kwh") ?? find("lab_electricity_kwh");
  }

  if (key === "distance") {
    if (hay.includes("staff")) return find("staff_distance_km");
    if (hay.includes("characterization")) return find("char_distance_km");
    if (hay.includes("truck") || hay.includes("quarry")) return find("truck_distance_km");
    return find("truck_distance_km") ?? find("char_distance_km") ?? find("staff_distance_km");
  }

  if (key === "mass" && hay.includes("sampling")) return find("sampling_mass_kg");

  if (key === "volume_of_fuel") {
    if (hay.includes("spreading")) return find("spreading_diesel_l");
    if (hay.includes("tilling")) return find("tilling_diesel_l");
  }

  if (
    key.includes("sequestration") ||
    key.includes("off_platform") ||
    (kind.includes("carbon") && hay.includes("co₂ stored"))
  ) {
    return find("co2_mass_t") ?? find("co2_mass_kg");
  }

  if (key === "mass" && (hay.includes("load") || hay.includes("transport"))) {
    return find("feedstock_mass_t") ?? find("feedstock_mass_kg");
  }

  return null;
}

export function matchMetricsToTemplate(
  template: AccountingTemplate,
  metrics: CsvMetric[],
  source: string,
): GhgFeedMatch[] {
  const matches: GhgFeedMatch[] = [];

  for (const group of template.groups) {
    for (const component of group.components) {
      for (const input of component.inputs) {
        if (input.bound) continue;
        const metric = pickMetric(input, component, metrics);
        if (!metric) continue;

        const targetUnit = defaultUnit(input.quantityKind);
        const converted = convertMagnitude(metric.magnitude, metric.unit, targetUnit);
        if (converted == null || !Number.isFinite(converted) || converted <= 0) continue;

        matches.push({
          componentId: component.id,
          inputKey: input.key,
          inputName: input.name,
          magnitude: converted,
          unit: targetUnit,
          source,
        });
      }
    }
  }

  return matches;
}

export function feedTemplateFromCsv(
  template: AccountingTemplate,
  csvText: string,
  filename: string,
  periodStart?: string,
  periodEnd?: string,
): GhgFeedResult {
  const metrics = extractMetricsFromCsv(csvText, filename, periodStart, periodEnd);
  const matches = matchMetricsToTemplate(template, metrics, filename);
  const skipped =
    metrics.length === 0
      ? ["No telemetry or accounting columns recognised in this CSV"]
      : matches.length === 0
        ? ["CSV parsed but no template inputs matched — check column names or template"]
        : [];

  return {
    metrics,
    matches,
    fed: matches.length,
    skipped,
  };
}
