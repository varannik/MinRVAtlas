import "server-only";

import { inflateRawSync } from "node:zlib";

import type { Cell, Sheet } from "./table";

/**
 * Reads an .xlsx workbook's cells: its zip entries (Node's own inflate), the
 * workbook and its relationships, shared strings, and each sheet's cells. No
 * formulas are evaluated (a cell keeps the value Excel saved), no styles are read
 * beyond the 1904 date flag, and no DTD or entity is ever resolved.
 *
 * Sizes are capped so a crafted file cannot exhaust memory.
 */

const MAX_ENTRY_BYTES = 40 * 1024 * 1024;
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;
const MAX_CELLS = 400_000;

export class WorkbookError extends Error {}

interface Entry {
  method: number;
  compressed: number;
  size: number;
  offset: number;
}

function entries(buffer: Buffer): Map<string, Entry> {
  // End of central directory: the last 22+ bytes, scanned back over a comment.
  let end = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 22 - 65_535); index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      end = index;
      break;
    }
  }
  if (end < 0) throw new WorkbookError("This is not an .xlsx file (no zip directory).");
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const out = new Map<string, Entry>();
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== 0x02014b50) throw new WorkbookError("The workbook's zip directory is damaged.");
    const method = buffer.readUInt16LE(at + 10);
    const compressed = buffer.readUInt32LE(at + 20);
    const size = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extra = buffer.readUInt16LE(at + 30);
    const comment = buffer.readUInt16LE(at + 32);
    const offset = buffer.readUInt32LE(at + 42);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);
    total += size;
    if (size > MAX_ENTRY_BYTES || total > MAX_TOTAL_BYTES) throw new WorkbookError("The workbook is too large to read here.");
    out.set(name, { method, compressed, size, offset });
    at += 46 + nameLength + extra + comment;
  }
  return out;
}

function read(buffer: Buffer, files: Map<string, Entry>, name: string): string | null {
  const entry = files.get(name);
  if (!entry) return null;
  const at = entry.offset;
  if (at + 30 > buffer.length || buffer.readUInt32LE(at) !== 0x04034b50) throw new WorkbookError("The workbook's zip entries are damaged.");
  const start = at + 30 + buffer.readUInt16LE(at + 26) + buffer.readUInt16LE(at + 28);
  const data = buffer.subarray(start, start + entry.compressed);
  if (entry.method === 0) return data.toString("utf8");
  if (entry.method !== 8) throw new WorkbookError("The workbook uses a compression this reader does not know.");
  return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }).toString("utf8");
}

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, code: string) => {
    const lower = code.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    const point = lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
  });
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:]+)="([^"]*)"/g)) out[match[1]] = decode(match[2]);
  return out;
}

/** The text runs of a string item (<si> or <is>), joined. */
function runs(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => decode(match[1])).join("");
}

function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/.exec(reference)?.[0] ?? "A";
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function sheetCells(xml: string, shared: string[], budget: { cells: number }): Cell[][] {
  const rows: Cell[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowIndex = Number(attributes(rowMatch[1]).r ?? rows.length + 1) - 1;
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex > 1_048_575) continue;
    const row: Cell[] = [];
    for (const cellMatch of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      budget.cells += 1;
      if (budget.cells > MAX_CELLS) throw new WorkbookError("The workbook has too many cells to read here.");
      const attrs = attributes(cellMatch[1]);
      const body = cellMatch[2] ?? "";
      const at = columnIndex(attrs.r ?? "");
      if (at < 0 || at > 16_383) continue;
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: Cell = null;
      if (attrs.t === "s") value = raw != null ? (shared[Number(raw)] ?? null) : null;
      else if (attrs.t === "inlineStr") value = runs(body);
      else if (attrs.t === "str") value = raw != null ? decode(raw) : null;
      else if (attrs.t === "b") value = raw === "1" ? "TRUE" : "FALSE";
      else if (attrs.t === "e") value = null;
      else if (raw != null && raw.trim() !== "") {
        const number = Number(raw);
        value = Number.isFinite(number) ? number : decode(raw);
      }
      row[at] = value;
    }
    for (let index = 0; index < row.length; index += 1) if (row[index] === undefined) row[index] = null;
    rows[rowIndex] = row;
  }
  for (let index = 0; index < rows.length; index += 1) if (!rows[index]) rows[index] = [];
  return rows;
}

/** Every sheet's cells, in the workbook's order. */
export function readXlsx(buffer: Buffer): Sheet[] {
  const files = entries(buffer);
  const workbook = read(buffer, files, "xl/workbook.xml");
  if (!workbook) throw new WorkbookError("This is not an .xlsx workbook (no xl/workbook.xml).");
  const rels = read(buffer, files, "xl/_rels/workbook.xml.rels") ?? "";
  const targets = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = attributes(match[1]);
    if (attrs.Id && attrs.Target) targets.set(attrs.Id, attrs.Target);
  }
  const sharedXml = read(buffer, files, "xl/sharedStrings.xml");
  const shared = sharedXml ? [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => runs(match[1])) : [];
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(workbook);

  const budget = { cells: 0 };
  const sheets: Sheet[] = [];
  for (const match of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attrs = attributes(match[1]);
    const target = targets.get(attrs["r:id"] ?? "");
    if (!target) continue;
    const path = target.startsWith("/") ? target.slice(1) : target.startsWith("xl/") ? target : `xl/${target}`;
    if (path.includes("..")) continue;
    const xml = read(buffer, files, path);
    if (xml) sheets.push({ name: attrs.name ?? path, rows: sheetCells(xml, shared, budget), date1904 });
  }
  return sheets;
}
