import { overlaps } from "@/lib/mrv/days";
import type { BlockStage, DateRange, LedgerBlock } from "@/lib/mrv/types";
import type { StepId } from "@/lib/journey/types";

/**
 * The ledger floor's boxes. Every box is one monitoring period, and each goes
 * through the same verification steps as the journey's loop: Monitor, Report,
 * Verification, Credits issued. Past periods take their place on that track
 * from their ledger block; the period the journey is on takes it from the
 * journey itself.
 */

export const TRACK = ["monitor", "report", "audit", "issued"] as const satisfies readonly StepId[];
export type TrackStep = (typeof TRACK)[number];
export type TrackState = "done" | "current" | "flagged" | "upcoming";

export const TRACK_LABEL: Record<TrackStep, string> = {
  monitor: "Monitor",
  report: "Report",
  audit: "Verify",
  issued: "Issue",
};

export interface PeriodBox {
  id: string;
  /** The ledger block behind the box, or null for a period the ledger has no block for yet. */
  block: LedgerBlock | null;
  sequence: number;
  label: string;
  range: DateRange | null;
  /** Colour family, as on the ledger: a block's stage, or the stage the journey has reached. */
  tone: BlockStage;
  /** The period the journey is on now. */
  live: boolean;
  /** The first period, waiting for validation to finish. */
  locked: boolean;
  track: Record<TrackStep, TrackState>;
}

/** How far through the track each ledger stage is, and whether it stopped on a problem. */
const STAGE_REACH: Record<BlockStage, { at: number; flagged?: boolean }> = {
  draft: { at: 0 },
  submitted: { at: 1 },
  verification: { at: 2 },
  issues: { at: 2, flagged: true },
  issued: { at: TRACK.length },
};

/** Ledger colour for the step a live period is on. */
const TONE_AT: Record<TrackStep, BlockStage> = {
  monitor: "draft",
  report: "submitted",
  audit: "verification",
  issued: "issued",
};

function trackFrom(at: number, flagged: boolean): Record<TrackStep, TrackState> {
  return Object.fromEntries(
    TRACK.map((step, index) => [step, index < at ? "done" : index === at ? (flagged ? "flagged" : "current") : "upcoming"]),
  ) as Record<TrackStep, TrackState>;
}

export function isTrackStep(id: StepId): id is TrackStep {
  return (TRACK as readonly StepId[]).includes(id);
}

/** "2026-07-17|2026-08-17", as the Monitor step stores the period, to a range. */
export function parsePeriod(value: string | undefined): DateRange | null {
  const [start, end] = (value ?? "").split("|");
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!start || !end || !day.test(start) || !day.test(end) || end < start) return null;
  return { start, end };
}

export interface JourneyAt {
  /** The journey's current step. */
  current: StepId;
  /** Monitoring periods already closed. */
  laps: number;
  /** The dates the Monitor step holds for the period in progress. */
  period: DateRange | null;
  /** The current step has answers Cortex flagged. */
  flagged: boolean;
}

/**
 * Boxes oldest first: one per ledger block, plus the journey's own period
 * when the ledger has no block for it, or a locked first period while the
 * facility is still being validated.
 */
export function periodBoxes(blocks: LedgerBlock[], journey: JourneyAt): PeriodBox[] {
  const inLoop = isTrackStep(journey.current);
  const liveAt = inLoop ? TRACK.indexOf(journey.current as TrackStep) : -1;
  const liveTrack = trackFrom(liveAt, journey.flagged);
  const liveBlock = inLoop && journey.period ? blocks.find((block) => overlaps(block.range, journey.period!)) : undefined;

  const boxes: PeriodBox[] = blocks.map((block) => {
    const live = block === liveBlock;
    const reach = STAGE_REACH[block.stage];
    return {
      id: block.id,
      block,
      sequence: block.sequence,
      label: block.label,
      range: block.range,
      tone: live ? TONE_AT[journey.current as TrackStep] : block.stage,
      live,
      locked: false,
      track: live ? liveTrack : trackFrom(reach.at, Boolean(reach.flagged)),
    };
  });

  if (inLoop && !liveBlock) {
    boxes.push({
      id: "journey-period",
      block: null,
      sequence: blocks.length + 1,
      label: `Period ${journey.laps + 1}`,
      range: journey.period,
      tone: TONE_AT[journey.current as TrackStep],
      live: true,
      locked: false,
      track: liveTrack,
    });
  } else if (!inLoop) {
    boxes.push({
      id: "journey-first-period",
      block: null,
      sequence: blocks.length + 1,
      label: "First monitoring period",
      range: null,
      tone: "draft",
      live: false,
      locked: true,
      track: trackFrom(-1, false),
    });
  }
  return boxes;
}

/** The box the calculation floor opens on: the live period when it has dates, else the newest with dates. */
export function defaultBox(boxes: PeriodBox[]): PeriodBox | null {
  const live = boxes.find((box) => box.live && box.range);
  if (live) return live;
  return [...boxes].reverse().find((box) => box.range) ?? null;
}
