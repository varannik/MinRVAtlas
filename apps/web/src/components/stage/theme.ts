import type { NodeStatus } from "@/lib/mrv/calc/types";
import type { BlockStage, DataOrigin, IssueSeverity } from "@/lib/mrv/types";

/**
 * Colours for the project stage, in one place so a restyle is a one-file
 * change. Drawn from the MinRV palette (globals.css): Jasper and Ochre for status only.
 */

export interface BlockTone {
  /** Front face of the block. */
  face: string;
  top: string;
  side: string;
  /** Text on the face. */
  ink: string;
  /** Timeline band and chips. */
  band: string;
}

export const BLOCK_TONE: Record<BlockStage, BlockTone> = {
  issued: { face: "#8B9C44", top: "#B2BE8B", side: "#6F7F35", ink: "#0D1802", band: "#8B9C44" },
  verification: { face: "#BEB290", top: "#D4C6AB", side: "#989077", ink: "#0D1802", band: "#BEB290" },
  submitted: { face: "#6F663F", top: "#8D8465", side: "#5C5733", ink: "#F1F0F0", band: "#6F663F" },
  draft: { face: "#EADAC7", top: "#EEE5DB", side: "#D4C6AB", ink: "#0D1802", band: "#D4C6AB" },
  issues: { face: "#963E32", top: "#B4685C", side: "#74302A", ink: "#F1F0F0", band: "#963E32" },
};

/** The window being dragged, before it is a block. */
export const PROPOSAL = {
  stroke: "#A77618",
  fill: "rgba(167, 118, 24, 0.10)",
  ink: "#835A06",
};

export const SEVERITY_TONE: Record<IssueSeverity, { color: string; label: string }> = {
  blocker: { color: "#963E32", label: "Blocker" },
  warning: { color: "#835A06", label: "Warning" },
  info: { color: "#6F663F", label: "Note" },
};

export const ORIGIN_BADGE: Record<DataOrigin, { label: string; className: string; title: string }> = {
  stream: {
    label: "Stream",
    className: "bg-olivine-100 text-olivine-800",
    title: "Read from the project's stream bucket",
  },
  sample: {
    label: "Sample data",
    className: "bg-ochre-tint text-ochre-ink",
    title: "Generated sample data — no stream rows for this project yet",
  },
  none: {
    label: "No data",
    className: "bg-strata-200 text-strata-700",
    title: "No monitoring data for this project",
  },
};

/** Calculation view, on its dark canvas. */
export const CALC_TONE: Record<NodeStatus, { line: string; ink: string; glow: string; label: string }> = {
  ok: { line: "#9EAD69", ink: "#DCDFCE", glow: "rgba(139, 156, 68, 0.35)", label: "From data" },
  partial: { line: "#EACD9C", ink: "#EACD9C", glow: "rgba(167, 118, 24, 0.4)", label: "Partly covered" },
  missing: { line: "#E0A79D", ink: "#E0A79D", glow: "rgba(150, 62, 50, 0.45)", label: "No data" },
};
