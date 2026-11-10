import type { NodeStatus } from "@/lib/mrv/calc/types";
import type { BlockStage, DataOrigin, IssueSeverity } from "@/lib/mrv/types";

/**
 * Colours for the project stage, in one place so a restyle is a one-file
 * change. Drawn from the 44.01 palette in lib/brand.ts.
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
  issued: { face: "#8B9C44", top: "#B5C36E", side: "#6C7A31", ink: "#FFFFFF", band: "#8B9C44" },
  verification: { face: "#BEB290", top: "#D9CFB0", side: "#A19570", ink: "#070808", band: "#BEB290" },
  submitted: { face: "#6F663F", top: "#8F865C", side: "#544C2C", ink: "#FFFFFF", band: "#6F663F" },
  draft: { face: "#EADAC7", top: "#F5ECE0", side: "#D2BEA3", ink: "#070808", band: "#D2BEA3" },
  issues: { face: "#9C3A2F", top: "#C46A5C", side: "#7A2B22", ink: "#FFFFFF", band: "#9C3A2F" },
};

/** The window being dragged, before it is a block. */
export const PROPOSAL = {
  stroke: "#DF7626",
  fill: "rgba(223, 118, 38, 0.10)",
  ink: "#B85616",
};

export const SEVERITY_TONE: Record<IssueSeverity, { color: string; label: string }> = {
  blocker: { color: "#9C3A2F", label: "Blocker" },
  warning: { color: "#B85616", label: "Warning" },
  info: { color: "#6F663F", label: "Note" },
};

export const ORIGIN_BADGE: Record<DataOrigin, { label: string; className: string; title: string }> = {
  stream: {
    label: "Stream",
    className: "bg-carbon-400/15 text-carbon-400",
    title: "Read from the project's stream bucket",
  },
  sample: {
    label: "Sample data",
    className: "bg-canyon/15 text-signal-amber",
    title: "Generated sample data — no stream rows for this project yet",
  },
  none: {
    label: "No data",
    className: "bg-ink-700 text-mist",
    title: "No monitoring data for this project",
  },
};

/** Calculation view, on its dark canvas. */
export const CALC_TONE: Record<NodeStatus, { line: string; ink: string; glow: string; label: string }> = {
  ok: { line: "#BEB290", ink: "#E9E2CC", glow: "rgba(190, 178, 144, 0.35)", label: "From data" },
  partial: { line: "#E8923A", ink: "#F4C08A", glow: "rgba(232, 146, 58, 0.35)", label: "Partly covered" },
  missing: { line: "#F07A6A", ink: "#F6B3A8", glow: "rgba(240, 122, 106, 0.35)", label: "No data" },
};
