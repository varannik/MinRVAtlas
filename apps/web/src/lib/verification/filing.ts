import type { EvidencePiece, SubmissionFile } from "./types";

/**
 * Where a submitted file probably belongs. The submission's folders carry the
 * Index's module numbers ("06. Storage Site/…"), and the supplier's remark on a
 * piece often names its files. A suggestion is only that: a person files it.
 * Pure, so it is tested.
 */

/** "06. Storage Site/Legal/permit.pdf" → "06"; "04. Capture site/4.1 Biomass/…" → "04". */
export function moduleOfPath(path: string): string {
  const top = path.split("/").find((part) => /^\d/.test(part.trim())) ?? "";
  const match = /^\s*(\d+)(?:\.(\d+))?\.?\s/.exec(top + " ");
  if (!match) return "";
  return match[1].padStart(2, "0");
}

const STOP = new Set(["the", "and", "of", "for", "a", "an", "to", "in", "on", "pdf", "docx", "doc", "xlsx", "xlsm", "final", "rev", "v1", "v2", "puro", "gsc", "description", "word", "docs"]);

function words(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, "")
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !STOP.has(word)),
  );
}

function stem(name: string): string {
  return name.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[_\s]+/g, " ").trim();
}

export interface Suggestion {
  pieceId: string;
  why: "named in the supplier's remark" | "only piece in its module" | "best match in its module";
}

/**
 * The piece a file most likely evidences, within one audit's pieces:
 * the piece whose supplier remark names the file; else, in the file's module, the
 * only piece there or the one whose name shares the most words with the file's path.
 */
export function suggestPiece(file: Pick<SubmissionFile, "path" | "name">, pieces: EvidencePiece[]): Suggestion | null {
  const fileStem = stem(file.name);
  if (fileStem.length >= 6) {
    const named = pieces.find((piece) => piece.supplierRemark && stem(piece.supplierRemark.replace(/[_]+/g, " ")).includes(fileStem));
    if (named) return { pieceId: named.id, why: "named in the supplier's remark" };
  }
  const fileModule = moduleOfPath(file.path);
  if (!fileModule) return null;
  const inModule = pieces.filter((piece) => piece.moduleNumber.split(".")[0].padStart(2, "0") === fileModule);
  if (!inModule.length) return null;
  if (inModule.length === 1) return { pieceId: inModule[0].id, why: "only piece in its module" };
  const fileWords = words(file.path);
  let best: { piece: EvidencePiece; score: number } | null = null;
  for (const piece of inModule) {
    const score = [...words(piece.name)].filter((word) => fileWords.has(word)).length;
    if (score > 0 && (!best || score > best.score)) best = { piece, score };
  }
  return best ? { pieceId: best.piece.id, why: "best match in its module" } : null;
}
