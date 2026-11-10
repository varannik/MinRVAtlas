import { siteLayoutFor, type SiteSensor } from "../../site-layouts";
import type { Project } from "../../types";
import { addDays, diffDays, isDayKey, rangeDays, todayUtc } from "../days";
import { fixedKeys, leaves } from "../calc/tree";
import type { CalcSpec } from "../calc/types";
import type { BlockIssue, BlockStage, DailyMetrics, DateRange, FixedValue, LedgerBlock, MetricDay, MrvDataset } from "../types";

/**
 * Deterministic sample data for a project with no stream rows yet, so the
 * ledger, timeline and calculation view can be exercised end to end. Every
 * surface that shows it carries a "Sample" badge.
 *
 * Profiles are keyed by metric name; a new methodology gets sample rows for
 * any metric listed here, and its missing ones stay missing on purpose.
 * Levels match the demo readings in the Fujairah site model, so the 3D chain
 * and the ledger tell the same story.
 */

type Profile =
  /** Day total that scales with throughput, e.g. tonnes delivered. */
  | { kind: "flow"; perTonne: number; samples: number; jitter: number }
  /** Level read through the day, e.g. pressure. */
  | { kind: "level"; base: number; jitter: number; samples: number }
  /** Level that follows throughput, e.g. power drawn per t/day handled. */
  | { kind: "load"; perTonneDay: number; jitter: number; samples: number };

/** Lab results arrive this long after the month they cover. */
const LAB_LAG_DAYS = 40;

const PROFILES: Record<string, Profile> = {
  LCO2_DELIVERED_t: { kind: "flow", perTonne: 1, samples: 3, jitter: 0.04 },
  CO2_TRANSIT_LOSS_kg: { kind: "flow", perTonne: 0.55, samples: 3, jitter: 0.2 },
  CO2_VENTED_SITE_kg: { kind: "flow", perTonne: 0.32, samples: 1, jitter: 0.25 },
  LCO2_TANKER_TRIPS: { kind: "flow", perTonne: 1 / 22, samples: 1, jitter: 0 },
  CO2_REVERSAL_t: { kind: "flow", perTonne: 0, samples: 1, jitter: 0 },
  CO2_TOTAL_SENSOR_m3: { kind: "flow", perTonne: 1.18, samples: 720, jitter: 0.03 },
  GROSS_REMOVAL_t: { kind: "flow", perTonne: 1.08, samples: 1, jitter: 0.05 },
  PROJECT_EMISSIONS_t: { kind: "flow", perTonne: 0.05, samples: 1, jitter: 0.12 },
  BIOCHAR_DRY_MASS_t: { kind: "flow", perTonne: 0.48, samples: 24, jitter: 0.06 },
  PRODUCTION_EMISSIONS_t: { kind: "flow", perTonne: 0.06, samples: 24, jitter: 0.1 },
  // 820 kW at Fujairah's ~66 t/day.
  CAPTURE_POWER_kW: { kind: "load", perTonneDay: 12.4, jitter: 0.03, samples: 720 },
  FUEL_PER_TRIP_L: { kind: "level", base: 38, jitter: 3, samples: 3 },
  ENERGY_PER_TONNE_kWht: { kind: "level", base: 118, jitter: 6, samples: 720 },
};

/** One lab result per calendar month, for months whose report is back. */
function monthlyLab(key: string, range: DateRange, base: number, jitter: number, unit: string, source: string): FixedValue[] {
  const cutoff = addDays(range.end, -LAB_LAG_DAYS);
  const rows: FixedValue[] = [];
  let [year, month] = range.start.split("-").map(Number);
  for (;;) {
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    if (end > cutoff) break;
    const next = rng(`${key}:${start}`);
    rows.push({ key, value: base + (next() - 0.5) * 2 * jitter, unit, validFrom: start, validTo: end, source: `${source} ${start.slice(0, 7)}` });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return rows;
}

/** Period attributes, as an operator would file them in attributes.json. */
function fixedFor(key: string, range: DateRange): FixedValue[] {
  const years: DateRange[] = [];
  for (let year = Number(range.start.slice(0, 4)); year <= Number(range.end.slice(0, 4)); year += 1) {
    years.push({ start: `${year}-01-01`, end: `${year}-12-31` });
  }
  const yearly = (values: number[], unit: string, source: string) =>
    years.map((window, index) => ({
      key,
      value: values[Math.min(index, values.length - 1)],
      unit,
      validFrom: window.start,
      validTo: window.end,
      source,
    }));
  const open = (value: number, unit: string, source: string): FixedValue[] => [
    { key, value, unit, validFrom: range.start, validTo: addDays(range.end, 365), source },
  ];
  switch (key) {
    case "BIOGENIC_FRACTION_pct":
      return monthlyLab(key, range, 38, 1.2, "%", "C-14 lab report (sample)");
    case "GRID_EMISSION_FACTOR_kg_per_kWh":
      return yearly([0.43, 0.41, 0.4], "kg/kWh", "National grid factor (sample)");
    case "DIESEL_EF_kg_per_L":
      return open(2.68, "kg/L", "LCA factor library (sample)");
    case "EMBODIED_EMISSIONS_t":
      return yearly([126], "t", "Plant LCA, amortised per year (sample)");
    case "UNCERTAINTY_DISCOUNT":
      return yearly([0.06, 0.05], "fraction", "Uncertainty assessment (sample)");
    case "ORGANIC_CARBON_FRACTION":
      return open(0.81, "fraction", "Lab analysis (sample)");
    case "PERSISTENCE_FRACTION":
      return open(0.74, "fraction", "Persistence model (sample)");
    case "BIOMASS_EMISSIONS_t":
      return yearly([310], "t", "Biomass LCA (sample)");
    case "USE_EMISSIONS_t":
      return yearly([95], "t", "End-use LCA (sample)");
    case "LEAKAGE_FRACTION":
      return open(0.03, "fraction", "Leakage assessment (sample)");
    default:
      return [];
  }
}

/** Mulberry32 seeded from a string. */
function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hex(seed: string): string {
  const next = rng(seed);
  let out = "0x";
  for (let i = 0; i < 12; i += 1) out += Math.floor(next() * 16).toString(16);
  return out;
}

function sampleWindow(project: Project, today: string): DateRange {
  const candidates: string[] = [];
  if (project.creditingStart >= 2015) candidates.push(`${project.creditingStart}-01-01`);
  if (project.createdOn && isDayKey(project.createdOn.slice(0, 10))) candidates.push(project.createdOn.slice(0, 10));
  let start = candidates.sort().pop() ?? addDays(today, -540);
  if (diffDays(start, today) > 900) start = addDays(today, -900);
  if (diffDays(start, today) < 240) start = addDays(today, -365);
  return { start, end: today };
}

/** Site sensors' demo signals, so sample rows match the 3D chain. */
function sensorProfiles(projectId: string): Map<string, SiteSensor["demo"]> {
  const layout = siteLayoutFor(projectId);
  const map = new Map<string, SiteSensor["demo"]>();
  if (!layout) return map;
  const chains = [layout.feedstock, layout.water].filter((row) => row != null);
  const hosts = [...layout.objects, ...chains.flatMap((chain) => [...chain.nodes, ...chain.routes])];
  for (const host of hosts) {
    for (const sensor of host.sensors ?? []) {
      if (!map.has(sensor.metric)) map.set(sensor.metric, sensor.demo);
    }
  }
  return map;
}

function cell(value: number, spread: number, samples: number, isTotal: boolean): MetricDay {
  const count = Math.max(1, samples);
  const mean = isTotal ? value / count : value;
  return {
    sum: isTotal ? value : value * count,
    mean,
    min: mean - spread,
    max: mean + spread,
    last: mean + spread * 0.3,
    count,
  };
}

/** Throughput multiplier for a day: ramp-up, weekly rhythm, summer heat. */
function throughput(day: string, start: string, next: () => number): number {
  const age = diffDays(start, day);
  const ramp = Math.min(1, 0.3 + (age / 75) * 0.7);
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  const weekly = weekday === 5 ? 0.72 : 1;
  const month = Number(day.slice(5, 7));
  const summer = month >= 6 && month <= 8 ? 0.9 : 1;
  return ramp * weekly * summer * (0.93 + next() * 0.14);
}

/** Outages: whole days with no telemetry at all. */
function outageDays(range: DateRange, seed: string): Set<string> {
  const next = rng(`${seed}:outages`);
  const days = new Set<string>();
  let cursor = addDays(range.start, 40);
  while (cursor < range.end) {
    cursor = addDays(cursor, 45 + Math.floor(next() * 60));
    const length = 1 + Math.floor(next() * 4);
    for (let i = 0; i < length; i += 1) days.add(addDays(cursor, i));
  }
  return days;
}

const SAMPLE_STAGES: BlockStage[] = ["submitted", "verification", "issues"];

function sampleIssues(stage: BlockStage, id: string, range: DateRange): BlockIssue[] {
  if (stage === "issues") {
    return [
      {
        id: `${id}:tickets`,
        severity: "blocker",
        title: "Weighbridge tickets do not match the trip log",
        detail: `Verifier query on ${range.start.slice(0, 7)}: four trips have a trip-log entry but no net-weight ticket.`,
        source: "vvb",
      },
      {
        id: `${id}:c14`,
        severity: "warning",
        title: "C-14 sampling below the monitoring plan",
        detail: "One composite sample for the quarter; the plan commits to monthly.",
        source: "registry",
      },
    ];
  }
  if (stage === "verification") {
    return [{ id: `${id}:visit`, severity: "info", title: "Site visit booked by the verifier", source: "vvb" }];
  }
  return [];
}

/** Quarter blocks up to ~7 months ago: oldest issued, newest still moving. */
function sampleBlocks(project: Project, range: DateRange, today: string): LedgerBlock[] {
  const cutoff = addDays(today, -200);
  const quarters: DateRange[] = [];
  let [year, month] = range.start.split("-").map(Number);
  month = Math.floor((month - 1) / 3) * 3 + 1;
  for (;;) {
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const end = new Date(Date.UTC(year, month + 2, 0)).toISOString().slice(0, 10);
    if (end > cutoff) break;
    quarters.push({ start: start < range.start ? range.start : start, end });
    month += 3;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  const tail = [...SAMPLE_STAGES];
  return quarters.map((window, index) => {
    const fromEnd = quarters.length - 1 - index;
    const stage: BlockStage = fromEnd < tail.length ? tail[fromEnd] : "issued";
    const id = `sample-${project.id}-${window.start}`;
    return {
      id,
      sequence: index + 1,
      range: window,
      label: `Q${Math.floor((Number(window.start.slice(5, 7)) - 1) / 3) + 1} ${window.start.slice(0, 4)}`,
      stage,
      origin: "sample",
      hash: hex(id),
      issues: sampleIssues(stage, id, window),
      registryRef: `SAMPLE-${String(index + 1).padStart(4, "0")}`,
      updatedOn: addDays(window.end, 30 + index * 3),
      verifier: stage === "draft" ? undefined : "Sample verifier",
    };
  });
}

export function sampleDataset(project: Project, spec: CalcSpec, extraMetrics: string[], now = Date.now()): MrvDataset {
  const today = todayUtc(now);
  const range = sampleWindow(project, today);
  const daily = (project.annualForecast || 15_000) / 365;
  const sensors = sensorProfiles(project.id);
  const seriesMetrics = new Set<string>(extraMetrics);
  for (const node of leaves(spec.root)) {
    if (node.kind === "input" && node.source.type === "series") seriesMetrics.add(node.source.metric);
  }
  const outages = outageDays(range, project.id);
  const spikes = new Set([addDays(range.start, Math.floor(rangeDays(range) * 0.37)), addDays(range.start, Math.floor(rangeDays(range) * 0.81))]);

  const days: DailyMetrics[] = [];
  for (let i = 0; i < rangeDays(range); i += 1) {
    const day = addDays(range.start, i);
    if (outages.has(day)) continue;
    const next = rng(`${project.id}:${day}`);
    const tonnes = daily * throughput(day, range.start, next) * (spikes.has(day) ? 2.7 : 1);
    const metrics: Record<string, MetricDay> = {};
    for (const metric of seriesMetrics) {
      const profile = PROFILES[metric];
      const sensor = sensors.get(metric);
      if (profile?.kind === "flow") {
        const value = tonnes * profile.perTonne * (1 + (next() - 0.5) * 2 * profile.jitter);
        metrics[metric] = cell(metric === "LCO2_TANKER_TRIPS" ? Math.round(value) : value, value * 0.1, profile.samples, true);
      } else if (profile?.kind === "load") {
        const value = tonnes * profile.perTonneDay * (1 + (next() - 0.5) * 2 * profile.jitter);
        metrics[metric] = cell(value, value * profile.jitter, profile.samples, false);
      } else if (profile?.kind === "level") {
        metrics[metric] = cell(profile.base + (next() - 0.5) * 2 * profile.jitter, profile.jitter, profile.samples, false);
      } else if (sensor && !sensor.risePerSec) {
        metrics[metric] = cell(sensor.base + (next() - 0.5) * 2 * sensor.jitter, sensor.jitter, 720, false);
      }
    }
    days.push({ day, metrics });
  }

  const fixed = fixedKeys(spec.root).flatMap((key) => fixedFor(key, range));
  const latest = new Date(now - 90_000).toISOString();

  return {
    projectId: project.id,
    origin: "sample",
    asOf: today,
    note: "No stream rows for this project yet — showing generated sample data.",
    range,
    days,
    fixed,
    latestAt: latest,
    blocks: sampleBlocks(project, range, today),
  };
}
