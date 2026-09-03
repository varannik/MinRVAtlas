/**
 * 44.01 brand book colours, plus darkened inks that stay AA on Off-white / White.
 * Neon mint / cyan from the old dark UI fail contrast on a light canvas.
 */
export const BRAND = {
  rock: "#070808",
  offWhite: "#F1F0F0",
  canyon: "#DF7626",
  serpentine: "#6F663F",
  earth: "#0D1802",
  olivine: "#8B9C44",
  shale: "#57544A",
  sand: "#BEB290",
  calcite: "#EADAC7",
} as const;

export const ACCENT = {
  land: "#55632A",
  tech: "#6F663F",
  storage: "#6F6750",
  alert: "#B85616",
  reject: "#9C3A2F",
  neutral: "#57544A",
} as const;

/** Brighter fills for 3D chips and bars (no type inside the colour). */
export const FILL = {
  complete: "#B5C36E",
  pending: "#E8923A",
  rejected: "#F0A89A",
  missing: "#DDD4C2",
} as const;

export function statusFill(
  status: "assembling" | "submitted" | "in-verification" | "issued" | "rejected",
): string {
  if (status === "rejected") return FILL.rejected;
  if (status === "assembling") return FILL.pending;
  if (status === "in-verification") return BRAND.sand;
  return FILL.complete;
}
