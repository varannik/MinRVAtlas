import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PROJECTS } from "../projects";
import { clampToGap, freeGapAt, freeGaps, mergeBlocks, nextOpenDay, presetRange } from "./blocks";
import { equation, fixed, series } from "./calc/build";
import { dailySeries, evaluate, indexDataset, streamCoverage } from "./calc/evaluate";
import { calcSpecFor } from "./calc/specs";
import { fixedKeys, leaves, pathTo, seriesMetrics } from "./calc/tree";
import type { CalcSpec } from "./calc/types";
import { runChecks } from "./checks";
import { clampView, latestView, newerView, olderView, panView, revealRange, viewBlocks, zoomView } from "./ledger-view";
import { ledgerTotals } from "./summary";
import { sampleDataset } from "./data/sample";
import { formatRange } from "./days";
import type { LedgerBlock, MrvDataset } from "./types";

function block(id: string, start: string, end: string, origin: LedgerBlock["origin"] = "registry"): LedgerBlock {
  return { id, sequence: 0, range: { start, end }, label: id, stage: "issued", origin, hash: "0x", issues: [] };
}

const BOUNDS = { start: "2025-01-01", end: "2025-12-31" };
const BLOCKS = [block("q1", "2025-01-01", "2025-03-31"), block("q3", "2025-07-01", "2025-09-30")];

describe("blocks never overlap", () => {
  it("finds the free gap around a day", () => {
    assert.deepEqual(freeGapAt("2025-05-10", BLOCKS, BOUNDS), { start: "2025-04-01", end: "2025-06-30" });
    assert.equal(freeGapAt("2025-02-01", BLOCKS, BOUNDS), null);
  });

  it("clips a drag to its gap", () => {
    assert.deepEqual(clampToGap("2025-05-10", "2025-08-15", BLOCKS, BOUNDS), { start: "2025-05-10", end: "2025-06-30" });
    assert.deepEqual(clampToGap("2025-05-10", "2025-02-01", BLOCKS, BOUNDS), { start: "2025-04-01", end: "2025-05-10" });
  });

  it("lists every gap and the next open day", () => {
    assert.deepEqual(freeGaps(BLOCKS, BOUNDS), [
      { start: "2025-04-01", end: "2025-06-30" },
      { start: "2025-10-01", end: "2025-12-31" },
    ]);
    assert.equal(nextOpenDay(BLOCKS, BOUNDS), "2025-10-01");
  });

  it("presets a calendar quarter inside the gap", () => {
    assert.deepEqual(presetRange("2025-10-01", 3, BLOCKS, BOUNDS), { start: "2025-10-01", end: "2025-12-31" });
    assert.deepEqual(presetRange("2025-04-01", 6, BLOCKS, BOUNDS), { start: "2025-04-01", end: "2025-06-30" });
  });

  it("drops sample history that collides with real periods", () => {
    const merged = mergeBlocks([block("real", "2025-02-15", "2025-05-15")], [block("s1", "2025-01-01", "2025-03-31", "sample"), block("s2", "2025-07-01", "2025-09-30", "sample")]);
    assert.deepEqual(merged.map((row) => [row.id, row.sequence]), [["real", 1], ["s2", 2]]);
  });
});

const TOY: CalcSpec = {
  id: "toy",
  registry: "Test",
  methodology: "Toy",
  edition: "1",
  creditUnit: "credit",
  proxyId: "G",
  sources: [],
  root: equation("R", "R", "Net", "t", "difference", [
    series("G", "G", "Gross", "t", "GROSS", "sum"),
    equation("E", "E", "Emissions", "t", "product", [
      series("P", "P", "Power", "kW", "POWER", "mean"),
      fixed("EF", "EF", "Factor", "t/kW", "EF", "intensity"),
    ]),
    fixed("EMB", "EMB", "Embodied", "t", "EMB", "prorata"),
  ]),
};

function cell(value: number) {
  return { sum: value, mean: value, min: value, max: value, last: value, count: 1 };
}

const DATA: Pick<MrvDataset, "range" | "days" | "fixed"> = {
  range: { start: "2025-01-01", end: "2025-01-04" },
  days: [
    { day: "2025-01-01", metrics: { GROSS: cell(10), POWER: cell(2) } },
    { day: "2025-01-02", metrics: { GROSS: cell(20), POWER: cell(4) } },
    { day: "2025-01-04", metrics: { GROSS: cell(30) } },
  ],
  fixed: [
    { key: "EF", value: 0.5, validFrom: "2025-01-01", validTo: "2025-12-31", source: "test" },
    { key: "EMB", value: 365, validFrom: "2025-01-01", validTo: "2025-12-31", source: "test" },
  ],
};

describe("calculation tree", () => {
  const index = indexDataset(DATA);

  it("evaluates a full window; inputs are partial only against stream days", () => {
    const range = { start: "2025-01-01", end: "2025-01-04" };
    const { root, byId } = evaluate(TOY, index, range);
    assert.equal(byId.get("G")?.value, 60);
    assert.equal(byId.get("G")?.status, "ok");
    assert.equal(byId.get("P")?.value, 3);
    assert.equal(byId.get("EMB")?.value, 4);
    assert.equal(root.value, 60 - 3 * 0.5 - 4);
    assert.equal(root.status, "partial");
    // POWER is absent on 2025-01-04 although the stream reported that day.
    assert.deepEqual(root.partial, ["P"]);
    // 2025-01-03 had no rows at all: a window-level gap, not an input gap.
    assert.equal(streamCoverage(index, range), 0.75);
  });

  it("marks a branch missing when its data is absent", () => {
    const { root, byId } = evaluate(TOY, index, { start: "2025-01-04", end: "2025-01-04" });
    assert.equal(byId.get("P")?.status, "missing");
    assert.equal(byId.get("E")?.value, null);
    assert.equal(root.value, null);
    assert.deepEqual(root.missing, ["P"]);
  });

  it("gives a proxy for days whose net cannot be calculated", () => {
    const days = dailySeries(TOY, index, { start: "2025-01-03", end: "2025-01-04" });
    assert.deepEqual(days.map((point) => [point.day, point.value, point.proxy, point.hasData]), [
      ["2025-01-03", null, null, false],
      ["2025-01-04", null, 30, true],
    ]);
  });

  it("finds paths for navigation", () => {
    assert.deepEqual(pathTo(TOY.root, "EF"), ["R", "E", "EF"]);
    assert.deepEqual(pathTo(TOY.root, "nope"), []);
  });
});

describe("methodology specs with sample data", () => {
  for (const project of PROJECTS) {
    it(`${project.methodologyKey} has unique ids and evaluates on sample data`, () => {
      const spec = calcSpecFor(project);
      const ids = new Set<string>();
      for (const node of leaves(spec.root)) {
        assert.ok(!ids.has(node.id), `duplicate id ${node.id}`);
        ids.add(node.id);
      }
      const dataset = sampleDataset(project, spec, seriesMetrics(spec.root), Date.UTC(2026, 10, 9));
      assert.equal(dataset.origin, "sample");
      assert.ok(dataset.days.length > 200);
      for (const key of fixedKeys(spec.root)) assert.ok(dataset.fixed.some((row) => row.key === key), `no sample for ${key}`);
      const index = indexDataset(dataset);
      // Lab results lag, so an old window is complete and a fresh one is not.
      const old = evaluate(spec, index, { start: dataset.range!.start, end: dataset.blocks[0]?.range.end ?? dataset.range!.end });
      assert.notEqual(old.root.value, null, `root not calculable for ${project.methodologyKey}`);
      assert.ok((old.root.value ?? 0) > 0);
      for (const sample of dataset.blocks) {
        const net = evaluate(spec, index, sample.range).root.value ?? 0;
        assert.ok(net > 0, `${project.id} ${sample.label} nets ${net}`);
      }
    });
  }

  it("sample blocks are quarters, oldest issued, and never overlap", () => {
    const project = PROJECTS.find((row) => row.id === "fujairah-mineral")!;
    const spec = calcSpecFor(project);
    const dataset = sampleDataset(project, spec, [], Date.UTC(2026, 10, 9));
    assert.equal(dataset.blocks[0].stage, "issued");
    assert.equal(dataset.blocks[dataset.blocks.length - 1].stage, "submitted");
    for (let i = 1; i < dataset.blocks.length; i += 1) {
      assert.ok(dataset.blocks[i].range.start > dataset.blocks[i - 1].range.end);
    }
    assert.equal(formatRange(dataset.blocks[0].range), "Jan – Mar 2025");
  });

  it("checks flag the lab lag and stream gaps", () => {
    const project = PROJECTS.find((row) => row.id === "fujairah-mineral")!;
    const spec = calcSpecFor(project);
    const dataset = sampleDataset(project, spec, seriesMetrics(spec.root), Date.UTC(2026, 10, 9));
    const index = indexDataset(dataset);
    const range = { start: "2026-09-15", end: "2026-11-09" };
    const evaluation = evaluate(spec, index, range);
    const findings = runChecks({ spec, range, evaluation, daily: dailySeries(spec, index, range) });
    assert.ok(findings.some((finding) => finding.nodeId === "f_bio"), "biogenic share should be partial or missing");
  });
});

describe("ledger summary", () => {
  it("files every calculated tonne in exactly one bucket", () => {
    const blocks: LedgerBlock[] = [
      { ...block("a", "2025-01-01", "2025-01-01"), stage: "issued" },
      { ...block("b", "2025-01-02", "2025-01-02"), stage: "verification" },
      { ...block("c", "2025-01-03", "2025-01-03"), stage: "draft" },
    ];
    const point = (day: string, value: number | null, proxy: number | null = null) => ({ day, value, proxy, status: "ok" as const, hasData: true });
    const totals = ledgerTotals(
      [point("2025-01-01", 10), point("2025-01-02", 20), point("2025-01-03", 30), point("2025-01-04", 40), point("2025-01-05", null, 99)],
      blocks,
    );
    assert.deepEqual(totals, { net: 100, issued: 10, inReview: 20, draft: 30, unclaimed: 40, pendingDays: 1 });
  });
});

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
