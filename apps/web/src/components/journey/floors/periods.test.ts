// JITI_TSCONFIG_PATHS=true node --import jiti/register --import ./loaders/node-test.mjs --test src/components/journey/floors/periods.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BlockStage, LedgerBlock } from "@/lib/mrv/types";
import { defaultBox, parsePeriod, periodBoxes } from "./periods";

function block(sequence: number, start: string, end: string, stage: BlockStage): LedgerBlock {
  return { id: `b${sequence}`, sequence, range: { start, end }, label: `Q${sequence}`, stage, origin: "sample", hash: "x", issues: [] };
}

const BLOCKS = [
  block(1, "2026-01-01", "2026-03-31", "issued"),
  block(2, "2026-04-01", "2026-06-30", "issues"),
  block(3, "2026-07-01", "2026-09-30", "submitted"),
];

describe("period dates", () => {
  it("reads the Monitor step's stored period", () => {
    assert.deepEqual(parsePeriod("2026-07-17|2026-08-17"), { start: "2026-07-17", end: "2026-08-17" });
  });
  it("refuses missing, malformed or backwards dates", () => {
    assert.equal(parsePeriod(undefined), null);
    assert.equal(parsePeriod("2026-07-17"), null);
    assert.equal(parsePeriod("2026-08-17|2026-07-17"), null);
  });
});

describe("period boxes", () => {
  it("places each ledger block on the verification track", () => {
    const boxes = periodBoxes(BLOCKS, { current: "setup", laps: 0, period: null, flagged: false });
    assert.deepEqual(boxes[0].track, { monitor: "done", report: "done", audit: "done", issued: "done" });
    assert.deepEqual(boxes[1].track, { monitor: "done", report: "done", audit: "flagged", issued: "upcoming" });
    assert.deepEqual(boxes[2].track, { monitor: "done", report: "current", audit: "upcoming", issued: "upcoming" });
  });

  it("adds a locked first period while the facility is being validated", () => {
    const boxes = periodBoxes(BLOCKS, { current: "package", laps: 0, period: null, flagged: false });
    const last = boxes[boxes.length - 1];
    assert.equal(last.locked, true);
    assert.equal(last.live, false);
    assert.equal(boxes.some((box) => box.live), false);
  });

  it("makes the block the journey's period overlaps the live one, following the journey", () => {
    const boxes = periodBoxes(BLOCKS, {
      current: "audit",
      laps: 2,
      period: { start: "2026-07-17", end: "2026-08-17" },
      flagged: true,
    });
    assert.equal(boxes.length, BLOCKS.length);
    const live = boxes.find((box) => box.live);
    assert.equal(live?.id, "b3");
    assert.deepEqual(live?.track, { monitor: "done", report: "done", audit: "flagged", issued: "upcoming" });
    assert.equal(live?.tone, "verification");
  });

  it("adds the journey's period after the ledger when no block holds it", () => {
    const boxes = periodBoxes(BLOCKS, {
      current: "monitor",
      laps: 0,
      period: { start: "2026-10-01", end: "2026-10-31" },
      flagged: false,
    });
    const live = boxes[boxes.length - 1];
    assert.equal(live.live, true);
    assert.equal(live.block, null);
    assert.equal(live.label, "Period 1");
    assert.equal(live.sequence, 4);
    assert.deepEqual(live.track, { monitor: "current", report: "upcoming", audit: "upcoming", issued: "upcoming" });
  });

  it("opens the calculation on the live period, or the newest one with dates", () => {
    const live = periodBoxes(BLOCKS, { current: "report", laps: 0, period: { start: "2026-10-01", end: "2026-10-31" }, flagged: false });
    assert.equal(defaultBox(live)?.id, "journey-period");
    const undated = periodBoxes(BLOCKS, { current: "monitor", laps: 0, period: null, flagged: false });
    assert.equal(defaultBox(undated)?.id, "b3");
    assert.equal(defaultBox(periodBoxes([], { current: "setup", laps: 0, period: null, flagged: false })), null);
  });
});
