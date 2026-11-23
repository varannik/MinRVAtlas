// JITI_TSCONFIG_PATHS=true node --import jiti/register --import ./loaders/node-test.mjs --test <this file>
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampView, latestView, newerView, olderView, panView, revealRange, viewBlocks, zoomView } from "@/legacy/lib/mrv/ledger-view";
import type { LedgerBlock } from "@/lib/mrv/types";

function block(id: string, start: string, end: string): LedgerBlock {
  return { id, sequence: 0, range: { start, end }, label: id, stage: "issued", origin: "registry", hash: "0x", issues: [] };
}

describe("ledger view", () => {
  // Ten quarters, Q1 2024 to Q2 2026, then open days to the end of data.
  const bounds = { start: "2024-01-01", end: "2026-11-09" };
  const quarters = Array.from({ length: 10 }, (_, i) => {
    const start = new Date(Date.UTC(2024, i * 3, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(2024, i * 3 + 3, 0)).toISOString().slice(0, 10);
    return block(`q${i + 1}`, start, end);
  });

  it("opens on the latest six blocks and the open days after them", () => {
    const view = latestView(quarters, bounds);
    assert.deepEqual(view, { start: "2025-01-01", end: "2026-11-09" });
    const { visible, earlier, later } = viewBlocks(quarters, view);
    assert.deepEqual(visible.map((row) => row.id), ["q5", "q6", "q7", "q8", "q9", "q10"]);
    assert.equal(earlier, 4);
    assert.equal(later, 0);
    assert.deepEqual(latestView(quarters.slice(0, 6), bounds), bounds, "few blocks show everything");
  });

  it("pages back through older blocks and returns to the latest", () => {
    const latest = latestView(quarters, bounds);
    const older = olderView(latest, quarters, bounds)!;
    assert.deepEqual(older, { start: "2024-01-01", end: "2024-12-31" });
    assert.equal(olderView(older, quarters, bounds), null);
    assert.deepEqual(newerView(older, quarters, bounds), latest);
    assert.equal(newerView(latest, quarters, bounds), null);
  });

  it("slides inside the history without changing length", () => {
    const view = { start: "2026-10-01", end: "2026-10-31" };
    assert.deepEqual(panView(view, 30, bounds), { start: "2026-10-10", end: "2026-11-09" });
    assert.deepEqual(clampView({ start: "2023-12-20", end: "2024-01-09" }, bounds), { start: "2024-01-01", end: "2024-01-21" });
    assert.deepEqual(clampView({ start: "2025-01-01", end: "2025-01-02" }, bounds), { start: "2025-01-01", end: "2025-01-14" });
  });

  it("zooms around the pointer's day", () => {
    const view = { start: "2025-01-01", end: "2025-12-31" };
    const zoomed = zoomView(view, 0.5, "2025-07-02", bounds);
    assert.equal(zoomed.start, "2025-04-02");
    assert.equal(zoomed.end, "2025-10-01");
    assert.deepEqual(zoomView(view, 100, "2025-07-02", bounds), bounds);
  });

  it("slides just enough to reveal a block outside the view", () => {
    const view = latestView(quarters, bounds);
    const revealed = revealRange(view, quarters[1].range, bounds);
    assert.ok(revealed.start <= "2024-04-01" && revealed.end >= "2024-06-30");
    assert.equal(rangeLength(revealed), rangeLength(view));
    assert.deepEqual(revealRange(view, quarters[7].range, bounds), view, "a visible block leaves the view alone");
  });
});

function rangeLength(range: { start: string; end: string }): number {
  return Math.round((Date.parse(range.end) - Date.parse(range.start)) / 86_400_000) + 1;
}
