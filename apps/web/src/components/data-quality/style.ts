import { QUALITY_TONE } from "@/components/stage/calc/calc-trend";
import type { QualityVerdict } from "@/lib/quality/types";

/** Shared look of the data quality page: the floor's dark panels and the checks' verdict colours. */
export const PANEL = "rounded-[20px] border border-calcite/10 bg-[#141E06]";
export const FIELD = "rounded-lg border border-calcite/15 bg-[#0D1802] px-2 py-1.5 text-[12.5px] text-calcite focus-visible:outline-2 focus-visible:outline-[#B2BE8B]";
export const VERDICT_COLOR: Record<QualityVerdict, string> = { blocked: QUALITY_TONE.blocks.color, needs_look: QUALITY_TONE.look.color, clear: "#9EAD69" };
