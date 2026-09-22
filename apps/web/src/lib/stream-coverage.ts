import { GHG_ACCOUNTING_HEADERS } from "@/lib/ghg-csv-columns";
import { splitCsvLine } from "@/lib/sentinel/column-map";
import {
  cadenceSeconds,
  eachUtcDay,
  MAX_ASSEMBLED_CSV_BYTES,
  type StreamContract,
} from "@/lib/stream-schema";

export type StreamQuality = "ok" | "missing" | "estimated" | "flag";

export type StreamObservation = {
  timestampUtc: string;
  metric: string;
  value: string;
  unit: string;
  quality: StreamQuality;
};

export type StreamAttributes = {
  schemaVersion: number;
  periodStart?: string;
  periodEnd?: string;
  values: Record<string, number | string | null>;
};

export type StreamGap = {
  metric: string;
  missingSlots: number;
};

export type StreamCoverage = {
  daysExpected: string[];
  daysPresent: string[];
  daysMissing: string[];
  seriesMissing: string[];
  attributesMissing: string[];
  gaps: StreamGap[];
  nullSamples: number;
  complete: boolean;
};

const QUALITIES = new Set<StreamQuality>(["ok", "missing", "estimated", "flag"]);

export function parseCsvTable(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]).map((cell) => cell.trim());
  const rows = lines.slice(1).map((line) => splitCsvLine(line));
  return { headers, rows };
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function parseObservationsCsv(text: string): StreamObservation[] {
  const { headers, rows } = parseCsvTable(text);
  const index = (name: string) =>
    headers.findIndex((header) => header.trim().toLowerCase() === name);
  const ts = index("timestamp_utc");
  const metric = index("metric");
  const value = index("value");
  const unit = index("unit");
  const quality = index("quality");
  if (ts < 0 || metric < 0 || value < 0) return [];
  const out: StreamObservation[] = [];
  for (const row of rows) {
    const timestampUtc = (row[ts] ?? "").trim();
    const metricName = (row[metric] ?? "").trim();
    if (!timestampUtc || !metricName) continue;
    const rawQuality = (row[quality] ?? "ok").trim().toLowerCase();
    const q: StreamQuality = QUALITIES.has(rawQuality as StreamQuality)
      ? (rawQuality as StreamQuality)
      : "ok";
    out.push({
      timestampUtc,
      metric: metricName,
      value: (row[value] ?? "").trim(),
      unit: (row[unit] ?? "").trim(),
      quality: q,
    });
  }
  return out;
}

export function parseAttributesJson(text: string): StreamAttributes {
  try {
    const parsed = JSON.parse(text) as StreamAttributes;
    if (!parsed || typeof parsed !== "object" || !parsed.values) {
      return { schemaVersion: 1, values: {} };
    }
    return {
      schemaVersion: Number(parsed.schemaVersion) || 1,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      values: parsed.values,
    };
  } catch {
    return { schemaVersion: 1, values: {} };
  }
}

function observationDay(row: StreamObservation): string | null {
  const day = row.timestampUtc.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function inPeriod(row: StreamObservation, from: string, to: string): boolean {
  const day = observationDay(row);
  return day != null && day >= from && day <= to;
}

export function buildCoverage(input: {
  contract: StreamContract;
  daysPresent: string[];
  observations: StreamObservation[];
  attributes: StreamAttributes;
  from: string;
  to: string;
}): StreamCoverage {
  const daysExpected = eachUtcDay(input.from, input.to);
  const present = new Set(input.daysPresent.filter((day) => daysExpected.includes(day)));
  const daysPresent = daysExpected.filter((day) => present.has(day));
  const daysMissing = daysExpected.filter((day) => !present.has(day));
  const window = input.observations.filter((row) => inPeriod(row, input.from, input.to));
  const okByMetric = new Map<string, number>();
  let nullSamples = 0;
  for (const row of window) {
    const empty = row.value === "" || row.quality === "missing";
    if (empty) {
      nullSamples += 1;
      continue;
    }
    if (row.quality === "ok") {
      okByMetric.set(row.metric, (okByMetric.get(row.metric) ?? 0) + 1);
    }
  }

  const seriesMissing = input.contract.requiredSeries.filter(
    (metric) => !okByMetric.has(metric),
  );
  const attributesMissing = input.contract.requiredAttributes.filter((key) => {
    const raw = input.attributes.values[key];
    return raw == null || raw === "" || !Number.isFinite(Number(raw));
  });

  const step = cadenceSeconds(input.contract.cadence);
  const gaps: StreamGap[] = [];
  if (step && daysPresent.length) {
    const expectedSlots = daysPresent.length * Math.floor(86_400 / step);
    for (const metric of input.contract.requiredSeries) {
      const have = okByMetric.get(metric) ?? 0;
      if (have < expectedSlots) {
        gaps.push({ metric, missingSlots: expectedSlots - have });
      }
    }
  }

  const contractReady =
    input.contract.requiredSeries.length > 0 || input.contract.requiredAttributes.length > 0;
  const complete =
    contractReady &&
    daysMissing.length === 0 &&
    seriesMissing.length === 0 &&
    attributesMissing.length === 0;

  return {
    daysExpected,
    daysPresent,
    daysMissing,
    seriesMissing: contractReady
      ? seriesMissing
      : ["schema unknown — cannot verify required data"],
    attributesMissing,
    gaps,
    nullSamples,
    complete,
  };
}

export function assembleWideCsv(
  observations: StreamObservation[],
  attributes: StreamAttributes,
  from: string,
  to: string,
): string {
  const window = observations
    .filter((row) => inPeriod(row, from, to))
    .sort((a, b) => a.timestampUtc.localeCompare(b.timestampUtc) || a.metric.localeCompare(b.metric));
  const metrics = [...new Set(window.map((row) => row.metric))];
  const byTs = new Map<string, Map<string, StreamObservation>>();
  for (const row of window) {
    const stamp = row.timestampUtc;
    const bucket = byTs.get(stamp) ?? new Map();
    bucket.set(row.metric, row);
    byTs.set(stamp, bucket);
  }
  const stamps = [...byTs.keys()].sort();
  const accounting = [...GHG_ACCOUNTING_HEADERS];
  const headers = ["timestamp_utc", ...metrics, ...accounting];
  const lines = [headers.map(csvCell).join(",")];
  for (const stamp of stamps) {
    const sample = byTs.get(stamp)!;
    const cells = [
      stamp,
      ...metrics.map((metric) => {
        const hit = sample.get(metric);
        if (!hit || hit.quality === "missing") return "";
        return hit.value;
      }),
      ...accounting.map((key) => {
        const raw = attributes.values[key];
        return raw == null ? "" : String(raw);
      }),
    ];
    lines.push(cells.map(csvCell).join(","));
  }
  const csv = `${lines.join("\n")}\n`;
  if (Buffer.byteLength(csv, "utf8") > MAX_ASSEMBLED_CSV_BYTES) {
    throw new AssembleTooLargeError();
  }
  return csv;
}

export class AssembleTooLargeError extends Error {
  constructor() {
    super("Assembled stream CSV exceeds 50 MB. Narrow the period or partition by day.");
    this.name = "AssembleTooLargeError";
  }
}
