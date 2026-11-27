/**
 * The mock verifier's record of one project: Puro's Audit Document Index as imported
 * (its evidence pieces), the submission as received, and which file is filed under
 * which piece. Plain data, shared by the server routes and the verification page.
 */

/** The Index's three sheets: a Facility audit, an Output audit, or both at once. */
export type AuditKey = "facility" | "output" | "combined";

export const AUDIT_LABEL: Record<AuditKey, string> = {
  facility: "Facility audit",
  output: "Output audit",
  combined: "Combined audit",
};

/** One evidence piece of the Index: what Puro asks for, and the clauses it answers. */
export interface EvidencePiece {
  /** Stable across imports of the same Index: audit, module number and the piece's name. */
  id: string;
  audit: AuditKey;
  /** "06. Storage site" as the Index writes it. */
  module: string;
  /** "06" or "04.1": the number the submission folders start with too. */
  moduleNumber: string;
  name: string;
  description: string;
  instructions: string;
  /** Methodology clauses, e.g. ["3.2.6", "3.2.7"]. */
  clauses: string[];
  /** The supplier's own note on where its evidence is (the Index's remarks column). */
  supplierRemark: string;
  /** Order in the Index. */
  order: number;
}

export interface IndexImport {
  /** The methodology line of the Index's README, e.g. "Geologically Stored Carbon, Edition 2024, …". */
  methodology: string;
  fileName: string;
  sha256: string;
  importedBy: string;
  importedAt: string;
  counts: Record<AuditKey, number>;
}

/** One file of the submission as received. */
export interface SubmissionFile {
  id: string;
  /** Where it sat in the submission folder, e.g. "06. Storage Site/Storage site description.pdf". */
  path: string;
  name: string;
  size: number;
  /** SHA-256, base64, as S3 checks it. */
  sha256: string;
  /** "stored" once it is in the bucket. */
  status: "pending" | "stored";
  uploadedBy: string;
  uploadedAt: string;
  /** The Cortex document it was also given as (PDF and Word only), so Claude can read and cite it. */
  cortexKey?: string;
  /** Why it is not in Cortex, when it is a type Cortex reads but was not sent. */
  cortexNote?: string;
}

/** The files filed under one evidence piece. */
export interface Filing {
  audit: AuditKey;
  pieceId: string;
  fileIds: string[];
  by: string;
  at: string;
}

export interface VerificationView {
  available: boolean;
  reason?: string;
  project?: { id: string; name: string; registry: string };
  index: IndexImport | null;
  pieces: EvidencePiece[];
  files: SubmissionFile[];
  filings: Filing[];
  /** File submissions and evidence (the supplier's side). */
  canFile: boolean;
  /** Review the evidence (verifiers and platform admins). */
  canReview: boolean;
}
