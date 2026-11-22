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
  /** Ochre ink: warnings and validation, in place of Canyon. AA on Off-white. */
  alert: "#835A06",
  /** Jasper: rejections and alarms. AA on Off-white. */
  reject: "#963E32",
  neutral: "#57544A",
} as const;

/** MinRV palette steps for inline styles and charts. Mirrors the ramps in globals.css. */
export const PALETTE = {
  olivine300: "#B2BE8B",
  olivine500: "#8B9C44",
  olivine700: "#576627",
  olivine800: "#414F1B",
  serpentine500: "#6F663F",
  strata700: "#57544A",
  ochre: "#A77618",
  jasper: "#963E32",
} as const;

/** Brighter fills for 3D chips and bars (no type inside the colour). */
export const FILL = {
  complete: "#B5C36E",
  submitted: "#8B9C44",
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
