import type { Cell, Sheet } from "@/lib/monitoring/table";
import type { AuditKey, EvidencePiece } from "./types";

/**
 * Puro's Audit Document Index, read from its workbook: the Facility, Output and
 * Combined audit sheets, each a list of evidence pieces under numbered modules
 * with the methodology clauses they answer. The module is written once, on its
 * first piece, and carried down. Pure: the .xlsx reader hands it the cells.
 */

const SHEET_AUDIT: [RegExp, AuditKey][] = [
  [/facility/i, "facility"],
  [/output/i, "output"],
  [/combined/i, "combined"],
];

const COLUMNS = {
  module: /^module$/i,
  piece: /evidence piece/i,
  description: /^description$/i,
  instructions: /^instructions$/i,
  clauses: /associated requirements/i,
  remark: /remarks/i,
};

function text(cell: Cell | undefined): string {
  return cell == null ? "" : String(cell).replace(/\s+/g, " ").trim();
}

export function clausesIn(raw: string): string[] {
  return [...new Set(raw.match(/\b\d+(?:\.\d+)+\b|\b\d+\b(?=['"\]])/g) ?? [])];
}

/** "06. Storage site" → "06"; "04.1 Biomass sourcing" → "04.1". */
export function moduleNumber(module: string): string {
  return /^\s*(\d+(?:\.\d+)?)/.exec(module)?.[1]?.replace(/\.$/, "") ?? "";
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function auditOf(sheetName: string): AuditKey | null {
  return SHEET_AUDIT.find(([pattern]) => pattern.test(sheetName))?.[1] ?? null;
}

/** The evidence pieces of one audit sheet; null when the sheet has no Index header. */
export function piecesOf(sheet: Sheet, audit: AuditKey): EvidencePiece[] | null {
  const headerAt = sheet.rows.findIndex((row) => row.some((cell) => COLUMNS.piece.test(text(cell))));
  if (headerAt < 0) return null;
  const header = sheet.rows[headerAt].map(text);
  const at = (pattern: RegExp) => header.findIndex((name) => pattern.test(name));
  const col = { module: at(COLUMNS.module), piece: at(COLUMNS.piece), description: at(COLUMNS.description), instructions: at(COLUMNS.instructions), clauses: at(COLUMNS.clauses), remark: at(COLUMNS.remark) };
  const pieces: EvidencePiece[] = [];
  const seen = new Set<string>();
  let currentModule = "";
  for (const row of sheet.rows.slice(headerAt + 1)) {
    const cell = (index: number) => (index >= 0 ? text(row[index]) : "");
    if (cell(col.module)) currentModule = cell(col.module);
    const name = cell(col.piece);
    if (!name || !currentModule) continue;
    const number = moduleNumber(currentModule);
    let id = `${audit}-${number || "x"}-${slug(name)}`;
    for (let n = 2; seen.has(id); n += 1) id = `${audit}-${number || "x"}-${slug(name)}-${n}`;
    seen.add(id);
    pieces.push({
      id,
      audit,
      module: currentModule,
      moduleNumber: number,
      name,
      description: cell(col.description),
      instructions: cell(col.instructions),
      clauses: clausesIn(cell(col.clauses)),
      supplierRemark: cell(col.remark),
      order: pieces.length,
    });
  }
  return pieces;
}

/** Every audit sheet's pieces, and the methodology line from the README sheet. */
export function importIndex(sheets: Sheet[]): { methodology: string; pieces: EvidencePiece[] } {
  const readme = sheets.find((sheet) => /readme/i.test(sheet.name));
  const methodology =
    readme?.rows
      .flat()
      .map(text)
      .find((value) => /methodology/i.test(value) && /edition/i.test(value))
      ?.replace(/^methodology\s*[—–-]\s*/i, "") ?? "";
  const pieces: EvidencePiece[] = [];
  for (const sheet of sheets) {
    const audit = auditOf(sheet.name);
    if (!audit) continue;
    pieces.push(...(piecesOf(sheet, audit) ?? []));
  }
  return { methodology, pieces };
}
