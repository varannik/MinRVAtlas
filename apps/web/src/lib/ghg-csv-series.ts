import {
  GHG_ACCOUNTING_HEADERS,
  GHG_COLUMN_METRICS,
  GHG_SERIES_LABELS,
} from "./ghg-csv-columns";
import { canonicalFromHeader, splitCsvLine } from "./sentinel/column-map";

const SKIP_KEYS = new Set([
  "timestamp_utc",
  "operational_state",
  "batch_id",
  "TIMESTAMP_UTC",
  "STATE",
  "BATCH_ID",
  ...GHG_ACCOUNTING_HEADERS,
]);

const SKIP_NORMALIZED = new Set(
  [...SKIP_KEYS].map((name) => name.replace(/^\uFEFF/, "").trim().toUpperCase()),
);

export type GhgSeriesEntity = {
  key: string;
  header: string;
  label: string;
  unit: string;
  colIndex: number;
  values: (number | null)[];
  min: number;
  max: number;
};

export type GhgPeriodConstant = {
  header: string;
  label: string;
  value: number;
};

export type GhgSeriesTable = {
  fileName: string;
  headers: string[];
  rows: string[][];
  times: (number | null)[];
  timeMin: number;
  timeMax: number;
  entities: GhgSeriesEntity[];
  constants: GhgPeriodConstant[];
};

export function parseCsvTable(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]).map((cell) => cell.trim());
  const rows = lines.slice(1).map((line) => splitCsvLine(line));
  return { headers, rows };
}

function parseTime(value: string): number | null {
  const raw = value.trim();
  if (!raw) return null;
  const ms = Date.parse(raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`);
  return Number.isFinite(ms) ? ms : null;
}

function timeColumnIndex(headers: string[]): number {
  const exact = headers.findIndex((header) => {
    const canonical = canonicalFromHeader(header) ?? header;
    return canonical === "timestamp_utc" || header.toLowerCase().includes("timestamp");
  });
  return exact;
}

function numericCell(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function isSkippedHeader(header: string): boolean {
  const canonical = canonicalFromHeader(header) ?? header;
  return SKIP_NORMALIZED.has(header.toUpperCase()) || SKIP_NORMALIZED.has(canonical.toUpperCase());
}

function seriesMeta(
  header: string,
  canonical: string,
): { label: string; unit: string } {
  const series =
    GHG_SERIES_LABELS[canonical] ??
    GHG_SERIES_LABELS[header] ??
    GHG_COLUMN_METRICS[header] ??
    GHG_COLUMN_METRICS[canonical];
  if (series) return { label: series.label, unit: series.unit };
  const unitMatch = canonical.match(/_(bar|m3h|m3|degC|ppm|sec|kWht|kWh)$/i);
  const unit = unitMatch?.[1] ?? "";
  const base = unit ? canonical.slice(0, -(unit.length + 1)) : canonical;
  const label = base
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
  return { label: label || header, unit };
}

function uniqueFinite(values: (number | null)[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const value of values) {
    if (value == null) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function parseGhgSeries(text: string, fileName: string): GhgSeriesTable {
  const { headers, rows } = parseCsvTable(text);
  const tsIndex = timeColumnIndex(headers);
  const times = rows.map((row) =>
    tsIndex >= 0 ? parseTime(row[tsIndex] ?? "") : null,
  );
  const finiteTimes = times.filter((ms): ms is number => ms != null);
  const timeMin = finiteTimes.length ? Math.min(...finiteTimes) : Date.now();
  const timeMax = finiteTimes.length ? Math.max(...finiteTimes) : timeMin + 1;

  const entities: GhgSeriesEntity[] = [];
  const constants: GhgPeriodConstant[] = [];

  const accounting = new Set<string>(GHG_ACCOUNTING_HEADERS);
  headers.forEach((header, colIndex) => {
    if (!header || isSkippedHeader(header)) {
      if (accounting.has(header)) {
        const values = rows.map((row) => numericCell(row[colIndex] ?? ""));
        const last = [...values].reverse().find((n) => n != null);
        if (last != null) {
          constants.push({
            header,
            label: seriesMeta(header, canonicalFromHeader(header) ?? header).label,
            value: last,
          });
        }
      }
      return;
    }
    const values = rows.map((row) => numericCell(row[colIndex] ?? ""));
    const finite = uniqueFinite(values);
    if (finite.length === 0) return;
    if (finite.length === 1) {
      constants.push({
        header,
        label: seriesMeta(header, canonicalFromHeader(header) ?? header).label,
        value: finite[0],
      });
      return;
    }
    const canonical = canonicalFromHeader(header) ?? header;
    const meta = seriesMeta(header, canonical);
    entities.push({
      key: canonical,
      header,
      label: meta.label,
      unit: meta.unit,
      colIndex,
      values,
      min: Math.min(...finite),
      max: Math.max(...finite),
    });
  });

  return {
    fileName,
    headers,
    rows,
    times,
    timeMin,
    timeMax: timeMax === timeMin ? timeMin + 1 : timeMax,
    entities,
    constants,
  };
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function serializeGhgTable(table: Pick<GhgSeriesTable, "headers" | "rows">): string {
  const lines = [table.headers.map(csvEscape).join(",")];
  for (const row of table.rows) {
    lines.push(table.headers.map((_, i) => csvEscape(row[i] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function patchGhgCell(
  table: GhgSeriesTable,
  colIndex: number,
  rowIndex: number,
  value: number,
): GhgSeriesTable {
  const rows = table.rows.map((row, i) =>
    i === rowIndex ? row.map((cell, j) => (j === colIndex ? String(value) : cell)) : row,
  );
  const entities = table.entities.map((entity) => {
    if (entity.colIndex !== colIndex) return entity;
    const values = entity.values.map((current, i) => (i === rowIndex ? value : current));
    const finite = values.filter((n): n is number => n != null);
    return {
      ...entity,
      values,
      min: finite.length ? Math.min(...finite) : entity.min,
      max: finite.length ? Math.max(...finite) : entity.max,
    };
  });
  return { ...table, rows, entities };
}

export function tableToFile(table: GhgSeriesTable): File {
  return new File([serializeGhgTable(table)], table.fileName, { type: "text/csv" });
}
