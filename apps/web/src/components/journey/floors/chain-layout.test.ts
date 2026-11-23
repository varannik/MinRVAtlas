// JITI_TSCONFIG_PATHS=true node --import jiti/register --import ./loaders/node-test.mjs --test src/components/journey/floors/chain-layout.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DailyPoint } from "@/lib/mrv/calc/evaluate";
import { addDays } from "@/lib/mrv/days";
import { BOX_GAP, BOX_SPAN, CHAIN_PAD, averageWindow, boxAt, chainLayout, runningMean, spread, trendBinDays, trendBins } from "./chain-layout";

const QUARTERS = [
  { id: "q1", range: { start: "2025-01-01", end: "2025-03-31" } },
  { id: "q2", range: { start: "2025-04-01", end: "2025-06-30" } },
  { id: "q3", range: { start: "2025-07-01", end: "2025-09-30" } },
];
const HISTORY = { start: "2024-10-01", end: "2025-11-30" };

function centre(layout: ReturnType<typeof chainLayout>, id: string): number {
  return layout.left.get(id)! + BOX_SPAN / 2;
}

describe("spread", () => {
  it("leaves boxes that do not touch where they want to be", () => {
    assert.deepEqual(spread([40, 400, 900], 0, 200), [40, 400, 900]);
  });
  it("shares the push between boxes that collide, and keeps them a slot apart", () => {
    assert.deepEqual(spread([100, 150], 0, 200), [25, 225]);
  });
  it("never puts the first box left of the edge", () => {
    assert.deepEqual(spread([-50, 0], 10, 200), [10, 210]);
  });
});

describe("chain layout", () => {
  it("runs the axis from the first day of the history to today", () => {
    const layout = chainLayout(QUARTERS, HISTORY, 1200);
    assert.deepEqual(layout.domain, HISTORY);
    assert.equal(layout.x(HISTORY.start), CHAIN_PAD);
    assert.equal(layout.dayAt(CHAIN_PAD), HISTORY.start);
    assert.equal(layout.dayAt(layout.axisRight + 500), HISTORY.end);
  });

  it("sits each quarter over its own days, without overlap", () => {
    const layout = chainLayout(QUARTERS, HISTORY, 1200);
    for (const box of QUARTERS) {
      const mid = (layout.x(box.range.start) + layout.x(addDays(box.range.end, 1))) / 2;
      assert.ok(Math.abs(centre(layout, box.id) - mid) < 2, `${box.id} sits over its days`);
    }
    const lefts = layout.order.map((id) => layout.left.get(id)!);
    for (let i = 1; i < lefts.length; i += 1) assert.ok(lefts[i] - lefts[i - 1] >= BOX_SPAN + BOX_GAP - 0.01);
  });

  it("pushes a short period's box aside rather than overlapping, and keeps time order", () => {
    const boxes = [...QUARTERS, { id: "month", range: { start: "2025-10-01", end: "2025-10-31" } }];
    const layout = chainLayout(boxes, HISTORY, 900);
    assert.deepEqual(layout.order, ["q1", "q2", "q3", "month"]);
    const lefts = layout.order.map((id) => layout.left.get(id)!);
    for (let i = 1; i < lefts.length; i += 1) assert.ok(lefts[i] - lefts[i - 1] >= BOX_SPAN + BOX_GAP - 0.01);
    assert.ok(layout.width >= lefts[lefts.length - 1] + BOX_SPAN);
  });

  it("queues a box without dates after today", () => {
    const layout = chainLayout([...QUARTERS, { id: "locked", range: null }], HISTORY, 900);
    assert.equal(layout.order[layout.order.length - 1], "locked");
    assert.ok(layout.left.get("locked")! > layout.axisRight);
  });

  it("stretches a short history to fill the view", () => {
    const layout = chainLayout([], { start: "2025-01-01", end: "2025-01-10" }, 1000);
    assert.ok(layout.axisRight >= 1000 - CHAIN_PAD - 0.01);
  });

  it("lays boxes out in a row when there is no history at all", () => {
    const layout = chainLayout([{ id: "locked", range: null }], null, 800);
    assert.equal(layout.domain, null);
    assert.equal(layout.left.get("locked"), CHAIN_PAD);
    assert.equal(layout.dayAt(100), null);
  });

  it("finds the box that holds a day", () => {
    assert.equal(boxAt(QUARTERS, "2025-05-17")?.id, "q2");
    assert.equal(boxAt(QUARTERS, "2024-12-01"), null);
  });
});

function day(index: number, value: number | null, proxy: number | null = null): DailyPoint {
  return { day: addDays("2025-01-01", index), value, proxy, status: value == null ? "missing" : "ok", hasData: value != null || proxy != null } as DailyPoint;
}

describe("trend", () => {
  it("picks bars a day to four weeks wide", () => {
    assert.equal(trendBinDays(8), 1);
    assert.equal(trendBinDays(2.3), 7);
    assert.equal(trendBinDays(0.6), 14);
    assert.equal(trendBinDays(0.1), 28);
    assert.equal(averageWindow(7), 4);
    assert.equal(averageWindow(28), 3);
  });

  it("averages each bar per day, so a short last bar does not read as a drop", () => {
    const daily = [day(0, 10), day(1, 12), day(2, null, 30), day(3, 14)];
    const bins = trendBins(daily, 3);
    assert.equal(bins.length, 2);
    assert.equal(bins[0].perDay, 11);
    assert.equal(bins[0].ghostPerDay, 30);
    assert.equal(bins[1].perDay, 14);
    assert.equal(bins[1].start, bins[1].end);
  });

  it("breaks the running mean at gaps", () => {
    assert.deepEqual(runningMean([1, 3, null, 5], 3), [2, 2, null, 5]);
  });
});
