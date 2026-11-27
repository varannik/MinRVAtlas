import type { NodeStatus } from "@/lib/mrv/calc/types";
import { addDays, formatDay } from "@/lib/mrv/days";
import type { BlockStage, DataOrigin, DateRange, IssueSeverity, MrvDataset } from "@/lib/mrv/types";

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
    label: "Loaded data",
    className: "bg-olivine-100 text-olivine-800",
    title: "The project's loaded monitoring data (its stream)",
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

type Badge = (typeof ORIGIN_BADGE)[DataOrigin];

/**
 * The data badge for a dataset, or for one period of it. Loaded data with sample
 * history before it says where the sample stops; a period says which it is.
 */
export function originBadge(dataset: Pick<MrvDataset, "origin" | "sampleUntil" | "range"> | null | undefined, period?: DateRange | null): Badge {
  const base = ORIGIN_BADGE[dataset?.origin ?? "none"];
  const until = dataset?.origin === "stream" ? dataset.sampleUntil : undefined;
  if (!until) return base;
  const from = formatDay(addDays(until, 1));
  if (period && period.end <= until) {
    return { ...ORIGIN_BADGE.sample, title: `Sample history: this period ends before the loaded data starts on ${from}` };
  }
  if (period && period.start > until) return { ...base, title: `Loaded data, from ${from}` };
  if (period) return { ...ORIGIN_BADGE.sample, label: "Sample, then loaded", title: `Sample history until ${formatDay(until)}, loaded data from ${from}` };
  return { ...base, label: `Loaded from ${from}`, title: `Sample history before ${from}, labelled sample; the project's loaded data from then on` };
}

/** Calculation view, on its dark canvas. */
export const CALC_TONE: Record<NodeStatus, { line: string; ink: string; glow: string; label: string }> = {
  ok: { line: "#9EAD69", ink: "#DCDFCE", glow: "rgba(139, 156, 68, 0.35)", label: "From data" },
  partial: { line: "#EACD9C", ink: "#EACD9C", glow: "rgba(167, 118, 24, 0.4)", label: "Partly covered" },
  missing: { line: "#E0A79D", ink: "#E0A79D", glow: "rgba(150, 62, 50, 0.45)", label: "No data" },
};
