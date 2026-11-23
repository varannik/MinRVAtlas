// JITI_TSCONFIG_PATHS=true JITI_ALIAS='{"server-only": "<apps/web>/node_modules/server-only/empty.js"}' \
//   node --import jiti/register --import ./loaders/node-test.mjs --test src/lib/requirements/requirements.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyAction, type JourneyRecord } from "@/lib/journey/engine";
import { seedScenario } from "@/test/seed";
import { STEP_DEFS } from "@/lib/journey/definition";
import { REQUIREMENTS, requirementValue, requirementsFor } from "./catalog";
import { scopeKey, viewOf } from "./store.server";

const GSC = { registry: "puro", methodology: "puro-geologically-stored-carbon", edition: "2024-v5" };
const NOW = "2026-11-22T12:00:00.000Z";

function fujairah(): JourneyRecord {
  const scenario = seedScenario("fujairah-mineral");
  return { current: scenario.current, laps: scenario.laps, tasks: structuredClone(scenario.seed) };
}

describe("registry values", () => {
  it("uses the approved value, or the built-in one", () => {
    assert.equal(requirementValue("puro.crediting_period_years"), 15);
    assert.equal(requirementValue("puro.crediting_period_years", { "puro.crediting_period_years": 20 }), 20);
    assert.throws(() => requirementValue("puro.nothing"));
  });

  it("applies registry-wide values and the methodology's own, never another registry's", () => {
    const ids = requirementsFor(GSC).map((requirement) => requirement.id);
    assert.ok(ids.includes("puro.validation_window_years"));
    assert.ok(ids.includes("puro.bubble_point_margin_bar"));
    assert.ok(!ids.some((id) => id.startsWith("isometric.")));
    assert.ok(!requirementsFor({ registry: "puro", methodology: "puro-biochar" }).some((r) => r.id === "puro.bubble_point_margin_bar"));
  });

  it("names only checks the journey has", () => {
    const checks = new Set(
      STEP_DEFS.flatMap((step) => step.tasks).flatMap((task) =>
        [task, ...Object.values(task.by_registry ?? {})].map((variant) => (variant.cortex as { check?: string } | undefined)?.check),
      ),
    );
    for (const requirement of REQUIREMENTS) for (const check of requirement.usedBy) assert.ok(checks.has(check), `${requirement.id}: ${check}`);
  });

  it("an approved value changes what Cortex decides", () => {
    const answer = { action: "answer" as const, taskId: "monitor.bubble-point", value: "6" };
    const builtIn = applyAction(fujairah(), answer, NOW);
    assert.equal(builtIn.ok, true);
    const approved = applyAction(fujairah(), answer, NOW, { "puro.bubble_point_margin_bar": 7 });
    assert.equal(approved.ok, false);
    assert.match(approved.record.tasks["monitor.bubble-point"].note ?? "", /7 bar/);
  });
});

describe("the stored values", () => {
  const S = (value: string) => ({ S: value });
  const N = (value: number) => ({ N: String(value) });
  const proposal = (id: string, at: string, status: string, value?: number) => ({
    pk: S(scopeKey(GSC)),
    sk: S(`PROPOSAL#${id}#${at}`),
    requirement: S(id),
    status: S(status),
    proposed_at: S(at),
    ...(value !== undefined ? { value: N(value) } : {}),
  });

  it("shows the approved value and the newest proposal for each", () => {
    const view = viewOf(GSC, [
      { pk: S(scopeKey(GSC)), sk: S("VALUE#puro.crediting_period_years"), value: N(15), clause_ref: S("2.2.2"), page: N(13), approved_by_name: S("Reza"), approved_at: S(NOW) },
      proposal("puro.crediting_period_years", "2026-11-20T00:00:00.000Z", "approved", 15),
      proposal("puro.crediting_period_years", "2026-11-22T00:00:00.000Z", "proposed", 15),
      proposal("puro.bubble_point_margin_bar", "2026-11-22T00:00:00.000Z", "not_found"),
    ]);
    const crediting = view.requirements.find((r) => r.id === "puro.crediting_period_years");
    assert.deepEqual([crediting?.approved?.value, crediting?.approved?.clauseRef, crediting?.approved?.approvedBy], [15, "2.2.2", "Reza"]);
    assert.equal(crediting?.proposal?.status, "proposed");
    assert.equal(view.requirements.find((r) => r.id === "puro.bubble_point_margin_bar")?.proposal?.status, "not_found");
  });

  it("a request for proposals runs until it finishes, or stops counting after a while", () => {
    const run = (status: string, started: string) => [{ pk: S(scopeKey(GSC)), sk: S("RUN"), status: S(status), started_at: S(started) }];
    const now = Date.parse(NOW);
    assert.equal(viewOf(GSC, run("running", "2026-11-22T11:55:00.000Z"), now).proposing, true);
    assert.equal(viewOf(GSC, run("done", "2026-11-22T11:55:00.000Z"), now).proposing, false);
    assert.equal(viewOf(GSC, run("running", "2026-11-22T10:00:00.000Z"), now).proposing, false);
  });
});
