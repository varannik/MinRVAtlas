/**
 * The monitoring metrics a column of a site's spreadsheet can be loaded as: the
 * stream metric names the calculation tree and the data quality engine read.
 * Mirrors apps/quality-engine/quality_engine/catalog.py (name, unit, how a day
 * folds); a metric added there is added here.
 *
 * `tags` suggest a metric for a column whose header names a plant tag from
 * Fujairah's tag dictionary (docs: the monitoring period data requirements).
 */

/** How a column's numbers read. */
export type Reads =
  /** The day's amount: rows on the same day are added. */
  | "daily_total"
  /** A running totaliser: the day's amount is this reading less the previous day's. */
  | "totaliser"
  /** A level or rate: rows on the same day are averaged. */
  | "reading";

export const READS_LABEL: Record<Reads, string> = {
  daily_total: "Daily amount",
  totaliser: "Running totaliser",
  reading: "Reading (averaged per day)",
};

export interface MonitoringMetric {
  id: string;
  name: string;
  unit: string;
  group: "CO₂ chain" | "Energy" | "Transport" | "Losses and reversals" | "Other";
  /** How the engine folds a day: a sum for amounts, a mean for readings. */
  reads: Reads;
  /** Header patterns that suggest this metric. */
  tags?: RegExp[];
}

export const MONITORING_METRICS: MonitoringMetric[] = [
  { id: "CO2_CAPTURED_t", name: "CO₂ captured", unit: "t", group: "CO₂ chain", reads: "daily_total", tags: [/FT_?0209/i, /\bcaptured\b/i] },
  { id: "CO2_LIQUEFIED_t", name: "CO₂ liquefied", unit: "t", group: "CO₂ chain", reads: "daily_total", tags: [/liqu\w*ed in t/i, /ST_01\s*-\s*\w*CL_01/i] },
  { id: "LCO2_DELIVERED_t", name: "Liquid CO₂ delivered", unit: "t", group: "CO₂ chain", reads: "daily_total", tags: [/^in tonne$/i, /deliver/i, /Co2_Last_Loading/i] },
  { id: "CO2_INJECTED_t", name: "CO₂ injected", unit: "t", group: "CO₂ chain", reads: "daily_total", tags: [/FT_04\w*\s*\+\s*FT_05/i, /co2 injected/i] },
  { id: "WATER_INJECTED_t", name: "Water injected", unit: "t", group: "CO₂ chain", reads: "daily_total", tags: [/FT_03/i, /\bwater\b/i] },
  { id: "TRACER_INJECTED_t", name: "Tracer injected", unit: "t", group: "CO₂ chain", reads: "daily_total", tags: [/FT_07/i, /\btracer\b/i] },
  { id: "ENERGY_CAPTURE_kWh", name: "Capture plant electricity", unit: "kWh", group: "Energy", reads: "daily_total", tags: [/CCU_Energy/i] },
  { id: "ENERGY_LIQUEFACTION_kWh", name: "Liquefaction electricity", unit: "kWh", group: "Energy", reads: "daily_total", tags: [/liqu\w* energy/i, /(^|[^A-Za-z_])Energy_Consumed/] },
  { id: "ENERGY_INJECTION_kWh", name: "Injection site electricity", unit: "kWh", group: "Energy", reads: "daily_total", tags: [/Total_Energy_Consumption/i] },
  { id: "CAPTURE_POWER_kW", name: "Capture and liquefaction power", unit: "kW", group: "Energy", reads: "reading" },
  { id: "ENERGY_PER_TONNE_kWht", name: "Injection energy per tonne", unit: "kWh/t", group: "Energy", reads: "reading", tags: [/Energy_Consumption_Per_Ton/i] },
  { id: "LCO2_TANKER_TRIPS", name: "Tanker trips", unit: "trips", group: "Transport", reads: "daily_total" },
  { id: "FUEL_PER_TRIP_L", name: "Diesel per tanker trip", unit: "L", group: "Transport", reads: "reading" },
  { id: "CO2_TRANSIT_LOSS_kg", name: "Transit loss", unit: "kg", group: "Losses and reversals", reads: "daily_total" },
  { id: "CO2_VENTED_SITE_kg", name: "CO₂ vented at the storage site", unit: "kg", group: "Losses and reversals", reads: "daily_total" },
  { id: "CO2_REVERSAL_t", name: "Reservoir reversals", unit: "t", group: "Losses and reversals", reads: "daily_total" },
];

const BY_ID = new Map(MONITORING_METRICS.map((metric) => [metric.id, metric]));

export function monitoringMetric(id: string): MonitoringMetric | undefined {
  return BY_ID.get(id);
}

/** The metric a header most likely is, from the tags and words it names; null when none fits. */
export function suggestMetric(header: string): MonitoringMetric | null {
  return MONITORING_METRICS.find((metric) => metric.tags?.some((tag) => tag.test(header))) ?? null;
}

/** The scale from a column's unit to the metric's, read from the header (kg to t, MWh to kWh); 1 when it says nothing. */
export function suggestScale(header: string, metric: MonitoringMetric): number {
  const unit = /\bin\s+(kg|t|tonnes?|kwh|mwh|l)\b|\((kg|t|kwh|mwh)\)/i.exec(header);
  const said = (unit?.[1] ?? unit?.[2] ?? "").toLowerCase();
  if (metric.unit === "t" && said === "kg") return 0.001;
  if (metric.unit === "kg" && (said === "t" || said.startsWith("tonne"))) return 1000;
  if (metric.unit === "kWh" && said === "mwh") return 1000;
  return 1;
}
