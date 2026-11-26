/**
 * From a spreadsheet's sheets to dated tables: in each sheet, the column that
 * holds dates, the header above it, and the columns of numbers beside it. A row
 * without a date (a total, a note, a group label such as a supplier's name) is
 * kept out and counted, so the page can say what was left and why.
 *
 * Pure: the xlsx and CSV readers hand it cells; nothing here reads a file.
 */

export type Cell = string | number | null;

export interface Sheet {
  name: string;
  rows: Cell[][];
  /** Excel's 1904 date system (old Mac workbooks). */
  date1904?: boolean;
}

export interface SourceColumn {
  /** Position in the sheet's rows. */
  index: number;
  /** The header as written, e.g. "Captured in t- FT_0209_Totalizer". */
  header: string;
  /** The key the project's tag map is kept under: the header, trimmed and lower case. */
  key: string;
  /** Plant tags named in the header, e.g. ["FT_0209_Totalizer"]. */
  tags: string[];
  /** Rows with a date and a number in this column. */
  numbers: number;
}

export interface SourceRow {
  day: string;
  values: Record<number, number | null>;
}

export interface SourceTable {
  sheet: string;
  dateHeader: string;
  columns: SourceColumn[];
  rows: SourceRow[];
  /** Rows with numbers but no date: totals, notes. */
  undated: number;
  /** Rows with only words: group labels such as a supplier. */
  labels: string[];
}

export interface ReadResult {
  tables: SourceTable[];
  /** Sheets with no column of dates, and why. */
  skipped: { sheet: string; reason: string }[];
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const DMY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;
/** Plant tags: words joined by underscores with a capital or a digit in them (FT_0209_Totalizer, Energy_Consumed). */
const TAG = /\b(?=\w*[A-Z0-9])[A-Za-z]{1,8}\d*(?:_[A-Za-z0-9]+)+\b/g;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function validDay(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 ? `${year}-${pad(month)}-${pad(day)}` : null;
}

/** A day from an Excel date serial (1900 or 1904 system), or null outside 1990–2100. */
export function serialDay(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial) || Math.abs(serial - Math.round(serial)) > 1e-6) return null;
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const date = new Date(base + Math.round(serial) * 86_400_000);
  return validDay(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** A day from a cell: an Excel serial, yyyy-mm-dd (with or without a time), or dd/mm/yyyy as the site writes it. */
export function cellDay(cell: Cell, date1904 = false): string | null {
  if (typeof cell === "number") return serialDay(cell, date1904);
  if (typeof cell !== "string") return null;
  const text = cell.trim();
  const iso = DAY.exec(text);
  if (iso) return validDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dmy = DMY.exec(text);
  if (dmy) return validDay(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  return null;
}

/** A number from a cell, including numbers written as text ("2.55", "1,204.5"). */
export function cellNumber(cell: Cell): number | null {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  if (typeof cell !== "string") return null;
  const text = cell.trim().replace(/,(?=\d{3}\b)/g, "");
  if (!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function text(cell: Cell): string {
  return typeof cell === "string" ? cell.replace(/\s+/g, " ").trim() : "";
}

export function columnKey(header: string): string {
  return header.replace(/\s+/g, " ").trim().toLowerCase();
}

export function tagsIn(header: string): string[] {
  return [...new Set(header.match(TAG) ?? [])];
}

/**
 * The column holding the most different days, if it holds at least three: a
 * time series. A summary sheet's timestamps (first and last reading) fall on one
 * or two days and do not count.
 */
function dateColumn(sheet: Sheet): number | null {
  const days = new Map<number, Set<string>>();
  for (const row of sheet.rows) {
    row.forEach((cell, index) => {
      const day = cellDay(cell, sheet.date1904);
      if (!day) return;
      const set = days.get(index) ?? new Set<string>();
      set.add(day);
      days.set(index, set);
    });
  }
  const best = [...days].sort((a, b) => b[1].size - a[1].size || a[0] - b[0])[0];
  return best && best[1].size >= 3 ? best[0] : null;
}

export function readTable(sheet: Sheet): SourceTable | { reason: string } {
  const dateAt = dateColumn(sheet);
  if (dateAt == null) return { reason: "No column of dates: a summary or notes sheet." };
  const firstDated = sheet.rows.findIndex((row) => cellDay(row[dateAt] ?? null, sheet.date1904));
  // The header is the nearest row above the first date that names at least two columns.
  let headerAt = -1;
  for (let index = firstDated - 1; index >= 0; index -= 1) {
    if (sheet.rows[index].filter((cell) => text(cell)).length >= 2) {
      headerAt = index;
      break;
    }
  }
  const header = headerAt >= 0 ? sheet.rows[headerAt] : [];

  const rows: SourceRow[] = [];
  const labels: string[] = [];
  let undated = 0;
  const numbers = new Map<number, number>();
  for (const row of sheet.rows.slice(headerAt >= 0 ? headerAt + 1 : firstDated)) {
    const day = cellDay(row[dateAt] ?? null, sheet.date1904);
    const values: Record<number, number | null> = {};
    let any = false;
    row.forEach((cell, index) => {
      if (index === dateAt) return;
      const value = cellNumber(cell);
      values[index] = value;
      if (value != null) any = true;
    });
    if (!day) {
      if (any) undated += 1;
      else if (row.some((cell) => text(cell))) labels.push(row.map(text).filter(Boolean).join(" ").slice(0, 60));
      continue;
    }
    rows.push({ day, values });
    for (const [index, value] of Object.entries(values)) if (value != null) numbers.set(Number(index), (numbers.get(Number(index)) ?? 0) + 1);
  }

  const columns: SourceColumn[] = [...numbers.keys()]
    .sort((a, b) => a - b)
    .map((index) => {
      const name = text(header[index] ?? null) || `Column ${index + 1}`;
      return { index, header: name, key: columnKey(name), tags: tagsIn(name), numbers: numbers.get(index) ?? 0 };
    });
  return { sheet: sheet.name, dateHeader: text(header[dateAt] ?? null) || "Date", columns, rows, undated, labels };
}

export function readSheets(sheets: Sheet[]): ReadResult {
  const tables: SourceTable[] = [];
  const skipped: ReadResult["skipped"] = [];
  for (const sheet of sheets) {
    const table = readTable(sheet);
    if ("reason" in table) skipped.push({ sheet: sheet.name, reason: table.reason });
    else if (!table.columns.length) skipped.push({ sheet: sheet.name, reason: "Dates, but no column of numbers beside them." });
    else tables.push(table);
  }
  return { tables, skipped };
}
