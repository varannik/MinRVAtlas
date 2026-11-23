// JITI_TSCONFIG_PATHS=true node --import jiti/register --import ./loaders/node-test.mjs --test src/lib/journey/summary.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { JOURNEY_VERSION } from "./definition";
import { seedScenario } from "@/test/seed";
import { journeySummary } from "./summary";

describe("the journey as Cortex reads it", () => {
  const scenario = seedScenario("fujairah-mineral");
  const record = { current: scenario.current, laps: scenario.laps, tasks: structuredClone(scenario.seed) };

  it("names the registry, methodology, current step and definition", () => {
    const summary = journeySummary(record);
    assert.equal(summary.definition, JOURNEY_VERSION);
    assert.ok(summary.registry);
    assert.ok(summary.methodology);
    assert.equal(summary.current, scenario.current);
    assert.equal(summary.steps.find((step) => step.id === scenario.current)?.place, "current");
    assert.equal(summary.steps[0].place, "done");
  });

  it("counts each step's required tasks and keeps every task's status", () => {
    const summary = journeySummary(record);
    for (const step of summary.steps) {
      assert.ok(step.done <= step.total);
      assert.equal(step.flagged, step.tasks.filter((task) => task.status === "flagged").length);
    }
    const setup = summary.steps[0];
    assert.equal(setup.done, setup.total);
  });

  it("says which files are in Cortex, and never carries a draft's text", () => {
    const tasks = {
      ...record.tasks,
      "onboarding.kyc": {
        status: "done" as const,
        files: [
          { name: "kyc.pdf", size: 1, key: "tenants/t/projects/p/evidence/kyc.pdf" },
          { name: "register.xlsx", size: 1 },
        ],
      },
    };
    const kyc = journeySummary({ ...record, tasks })
      .steps.flatMap((step) => step.tasks)
      .find((task) => task.id === "onboarding.kyc");
    assert.deepEqual(kyc?.files, [
      { name: "kyc.pdf", in_cortex: true },
      { name: "register.xlsx", in_cortex: false },
    ]);
    const drafted = journeySummary(record)
      .steps.flatMap((step) => step.tasks)
      .find((task) => task.kind === "generate" && task.draft_lines);
    if (drafted) assert.equal(drafted.answer, undefined);
  });
});
