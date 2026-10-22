import type { CreditBatchQuantity, RetirementPurpose } from "./types";

export const RETIREMENT_PURPOSES: RetirementPurpose[] = [
  "corporate_targets",
  "public_environmental_claims",
  "insetting",
  "regulatory_requirement",
  "other",
];

export const RETIREMENT_PURPOSE_LABELS: Record<RetirementPurpose, string> = {
  corporate_targets: "Corporate targets",
  public_environmental_claims: "Public environmental claims",
  insetting: "Insetting",
  regulatory_requirement: "Regulatory requirement",
  other: "Other",
};

const ID_BODY = "[A-Za-z0-9]{16,33}";

export function isometricId(prefix: "org" | "spl" | "ctb" | "ord", value: string): boolean {
  return new RegExp(`^${prefix}_${ID_BODY}$`).test(value);
}

export function sumKg(lines: Array<{ credit_quantity_kg: number }>): number {
  return lines.reduce((total, line) => total + line.credit_quantity_kg, 0);
}

export function quantityLinesMessage(lines: CreditBatchQuantity[]): string | null {
  if (lines.length === 0) return "Select at least one active batch.";
  const seen = new Set<string>();
  for (const line of lines) {
    if (!isometricId("ctb", line.credit_batch_id)) {
      return "Each credit batch id must be an Isometric batch id.";
    }
    if (seen.has(line.credit_batch_id)) return "A batch can only appear once.";
    seen.add(line.credit_batch_id);
    if (!Number.isSafeInteger(line.credit_quantity_kg) || line.credit_quantity_kg < 1) {
      return "Each quantity must be a positive whole number of kilograms.";
    }
  }
  return null;
}

export function overQuantityMessage(input: {
  lines: Array<{ credit_quantity_kg: number; availableKg: number }>;
  limitKg?: number;
  limitLabel?: string;
}): string | null {
  for (const line of input.lines) {
    if (line.credit_quantity_kg > line.availableKg) {
      return "A quantity is larger than the active batch.";
    }
  }
  if (input.limitKg != null && sumKg(input.lines) > input.limitKg) {
    return input.limitLabel ?? "The total is larger than the amount still available.";
  }
  return null;
}

export function notesMessage(notes: string): string | null {
  if (notes.trim().length > 256) return "Notes must be 256 characters or fewer.";
  return null;
}

export function purposesMessage(purposes: string[]): string | null {
  if (purposes.length === 0) return "Choose at least one retirement purpose.";
  const unique = new Set(purposes);
  if (unique.size !== purposes.length) return "Each retirement purpose can only be chosen once.";
  for (const purpose of purposes) {
    if (!RETIREMENT_PURPOSES.includes(purpose as RetirementPurpose)) {
      return "Choose a retirement purpose from the list.";
    }
  }
  return null;
}
