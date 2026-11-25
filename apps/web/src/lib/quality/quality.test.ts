// JITI_TSCONFIG_PATHS=true node --import jiti/register --import ./loaders/node-test.mjs --test src/lib/quality/quality.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { constant, equation, fixed, series } from "@/lib/mrv/calc/build";
import { indexDataset } from "@/lib/mrv/calc/evaluate";
import { nodeSources, nodeTrend, trendShape } from "@/lib/mrv/calc/trend";
import type { DailyMetrics, FixedValue } from "@/lib/mrv/types";
import { nodeFlags } from "@/components/stage/calc/node-flags";
import { periodOf, submitBlockReason } from "./gate";
import { findingsForSources, isBlocking, verdictFor, withReview, type QualityFinding, type QualityRun } from "./types";

function finding(over: Partial<QualityFinding>): QualityFinding {
  const base: QualityFinding = {
    id: "F-0000000000000000",
    kind: "missing_days",
    severity: "blocks",
    advisory: false,
    metric: null,
    fixedKey: null,
    start: "2026-08-03",
    end: "2026-08-05",
    at: null,
    observed: {},
    expected: {},
    impact: null,
    rule: { id: "C01", name: "Missing days", origin: "Sentinel C01, ported", version: 1 },
    status: "open",
    review: null,
    text: { headline: "No readings at all for 3 days, 3–5 Aug 2026.", saw: "", matters: "", todo: "", how: "" },
    blocking: true,
  };
  const out = { ...base, ...over };
  return { ...out, blocking: isBlocking(out) };
}

const AUGUST = { start: "2026-08-01", end: "2026-08-31" };

describe("the engine's verdict, per period", () => {
  it("blocks on an open block, and clears when it is dismissed", () => {
    const gap = finding({});
    assert.equal(verdictFor([gap], AUGUST), "blocked");
    assert.equal(verdictFor([gap], { start: "2026-09-01", end: "2026-09-30" }), "clear");
    const dismissed = withReview(gap, { decision: "dismissed", reason: "Site export lost, substitute agreed" });
    assert.equal(dismissed.blocking, false);
    assert.equal(verdictFor([dismissed], AUGUST), "clear");
  });

  it("a detector needs a look until someone confirms it", () => {
    const spike = finding({ id: "F-1111111111111111", kind: "spike", severity: "look", advisory: true, metric: "CAPTURE_POWER_kW" });
    assert.equal(spike.blocking, false);
    assert.equal(verdictFor([spike], AUGUST), "needs_look");
    assert.equal(verdictFor([withReview(spike, { decision: "confirmed" })], AUGUST), "blocked");
    assert.equal(withReview(withReview(spike, { decision: "confirmed" }), { decision: "open" }).status, "open");
  });
});

const delivered = series("M_del", "M_del", "Liquid CO₂ delivered", "t", "LCO2_DELIVERED_t", "sum");
const share = fixed("f_bio", "f_bio", "Biogenic share", "fraction", "BIOGENIC_FRACTION_pct", "intensity", { scale: 0.01 });
const one = constant("one", "1", "Whole", "fraction", 1, "Identity");
const stored = equation("S", "S", "Eligible CO₂", "t", "product", [delivered, share, one]);

function day(dayKey: string, tonnes: number): DailyMetrics {
  return { day: dayKey, metrics: { LCO2_DELIVERED_t: { sum: tonnes, mean: tonnes, min: tonnes, max: tonnes, last: tonnes, count: 1 } } };
}
const FIXED: FixedValue[] = [
  { key: "BIOGENIC_FRACTION_pct", value: 40, validFrom: "2026-08-01", validTo: "2026-08-02", source: "lab A" },
  { key: "BIOGENIC_FRACTION_pct", value: 50, validFrom: "2026-08-03", validTo: "2026-08-31", source: "lab B" },
];
const INDEX = indexDataset({ range: { start: "2026-08-01", end: "2026-08-04" }, days: [day("2026-08-01", 60), day("2026-08-02", 70), day("2026-08-04", 50)], fixed: FIXED });
const FOUR = { start: "2026-08-01", end: "2026-08-04" };

describe("a node's trend, day by day", () => {
  it("works an equation out from its terms each day", () => {
    assert.deepEqual(
      nodeTrend(stored, INDEX, FOUR).map((point) => point.value),
      [24, 28, null, 25],
    );
  });

  it("holds a dated value until the next one, and a constant flat", () => {
    assert.deepEqual(nodeTrend(share, INDEX, FOUR).map((point) => point.value), [0.4, 0.4, 0.5, 0.5]);
    assert.deepEqual(nodeTrend(one, INDEX, FOUR).map((point) => point.value), [1, 1, 1, 1]);
    assert.equal(trendShape(share), "step");
    assert.equal(trendShape(stored), "line");
  });

  it("marks only what the node reads", () => {
    const sources = nodeSources(stored);
    const findings = [
      finding({}),
      finding({ id: "F-2222222222222222", kind: "fixed_coverage", fixedKey: "BIOGENIC_FRACTION_pct" }),
      finding({ id: "F-3333333333333333", kind: "spike", metric: "CAPTURE_POWER_kW", severity: "look", advisory: true }),
    ];
    assert.deepEqual(findingsForSources(findings, sources).map((f) => f.kind), ["missing_days", "fixed_coverage"]);
    assert.deepEqual(findingsForSources(findings, nodeSources(one)), []);
    assert.deepEqual(findingsForSources(findings, nodeSources(share)).map((f) => f.kind), ["fixed_coverage"]);
  });

  it("flags each card with its worst open finding", () => {
    const flags = nodeFlags(stored, [finding({}), finding({ id: "F-4444444444444444", fixedKey: "BIOGENIC_FRACTION_pct", severity: "look", kind: "fixed_coverage" })], AUGUST);
    assert.deepEqual(flags.get("S"), { severity: "blocks", count: 2 });
    assert.deepEqual(flags.get("f_bio"), { severity: "look", count: 1 });
    assert.equal(flags.get("one"), undefined);
  });
});

describe("the registry submit rule", () => {
  const run: QualityRun = { id: "20261125T121007Z-610135", status: "done", startedAt: "2026-11-25T12:10:07Z", range: { start: "2026-01-01", end: "2026-11-21" } };

  it("refuses a period the engine blocks, and names the first block", () => {
    const refused = submitBlockReason(run, [finding({})], AUGUST);
    assert.match(refused ?? "", /^Data quality blocks this period: No readings at all for 3 days/);
    assert.equal(submitBlockReason(run, [finding({})], { start: "2026-09-01", end: "2026-09-30" }), null);
  });

  it("lets a period through that only needs a look: a detector never blocks on its own", () => {
    const unusual = finding({ kind: "spike", severity: "look", advisory: true });
    assert.equal(submitBlockReason(run, [unusual], AUGUST), null);
    assert.notEqual(submitBlockReason(run, [withReview(unusual, { decision: "confirmed" })], AUGUST), null);
  });

  it("fails closed when no run has seen the whole period", () => {
    assert.match(submitBlockReason(null, [], AUGUST) ?? "", /have not run/);
    assert.match(submitBlockReason({ ...run, range: null }, [], AUGUST) ?? "", /no monitoring data/);
    assert.match(submitBlockReason(run, [], { start: "2026-11-01", end: "2026-11-30" }) ?? "", /only seen data up to 21 Nov 2026/);
  });

  it("reads a period only from two day keys in order", () => {
    assert.deepEqual(periodOf("2026-08-01", "2026-08-31"), AUGUST);
    assert.equal(periodOf("2026-08-31", "2026-08-01"), null);
    assert.equal(periodOf("2026-08-01", undefined), null);
  });
});
