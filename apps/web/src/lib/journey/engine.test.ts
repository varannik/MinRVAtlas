// JITI_TSCONFIG_PATHS=true node --import jiti/register --import ./loaders/node-test.mjs --test src/lib/journey/engine.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { JourneyRefusal, applyAction, parseAction, settledTasks, type JourneyRecord } from "./engine";
import { seedScenario } from "@/test/seed";
import { nextStep, planFor, planOf, stepIndex } from "./steps";

const NOW = "2026-11-21T12:00:00.000Z";

function fujairah(): JourneyRecord {
  const scenario = seedScenario("fujairah-mineral");
  return { current: scenario.current, laps: scenario.laps, tasks: structuredClone(scenario.seed) };
}

function fresh(): JourneyRecord {
  return { current: "setup", laps: 0, tasks: {} };
}

describe("answers", () => {
  it("settles an answer nobody checks as done, dated now", () => {
    const { record, ok } = applyAction(fresh(), { action: "answer", taskId: "setup.name", value: "Fujairah" }, NOW);
    assert.equal(ok, true);
    assert.deepEqual(record.tasks["setup.name"], { status: "done", value: "Fujairah", note: undefined, at: NOW });
  });

  it("clears every later answer when the registry changes, and goes back to step 2", () => {
    const before = fujairah();
    assert.ok(stepIndex(before.current) > stepIndex("methodology"));
    const registry = before.tasks["methodology.registry"]?.value;
    assert.ok(registry);
    const { record } = applyAction(before, { action: "answer", taskId: "methodology.registry", value: `${registry}-other` }, NOW);
    assert.equal(record.current, "methodology");
    assert.equal(record.laps, 0);
    assert.equal(record.tasks["methodology.pick"], undefined);
    const later = Object.keys(record.tasks).filter((id) => !id.startsWith("setup.") && !id.startsWith("methodology."));
    assert.deepEqual(later, []);
  });

  it("keeps later answers when the same registry is given again", () => {
    const before = fujairah();
    const registry = before.tasks["methodology.registry"]?.value;
    const { record } = applyAction(before, { action: "answer", taskId: "methodology.registry", value: registry }, NOW);
    assert.equal(record.current, before.current);
    assert.ok(Object.keys(record.tasks).length >= Object.keys(before.tasks).length - 1);
  });

  it("keeps the files given before when only a value is answered", () => {
    const before: JourneyRecord = { ...fresh(), tasks: { "setup.name": { status: "done", value: "Old", files: [{ name: "a.pdf", size: 1 }] } } };
    const { record } = applyAction(before, { action: "answer", taskId: "setup.name", value: "New" }, NOW);
    assert.deepEqual(record.tasks["setup.name"].files, [{ name: "a.pdf", size: 1 }]);
    assert.equal(record.tasks["setup.name"].value, "New");
  });

  it("refuses a task that is not on this journey", () => {
    assert.throws(() => applyAction(fresh(), { action: "answer", taskId: "nope.task", value: "x" }, NOW), JourneyRefusal);
  });
});

describe("drafts and accepting a flag", () => {
  it("drafts only the documents Cortex writes", () => {
    assert.throws(() => applyAction(fresh(), { action: "draft", taskId: "setup.name" }, NOW), JourneyRefusal);
  });

  it("accepts only an answer Cortex flagged", () => {
    const flagged: JourneyRecord = { ...fujairah() };
    flagged.tasks["methodology.registry"] = { ...flagged.tasks["methodology.registry"], status: "flagged", note: "Check this" };
    const { record } = applyAction(flagged, { action: "accept", taskId: "methodology.registry" }, NOW);
    assert.equal(record.tasks["methodology.registry"].status, "done");
    assert.equal(record.tasks["methodology.registry"].at, NOW);

    assert.throws(() => applyAction(fujairah(), { action: "accept", taskId: "methodology.registry" }, NOW), JourneyRefusal);
    const unchecked = { ...fresh(), tasks: { "setup.name": { status: "flagged" as const, value: "" } } };
    assert.throws(() => applyAction(unchecked, { action: "accept", taskId: "setup.name" }, NOW), JourneyRefusal);
  });
});

describe("moving on", () => {
  it("refuses while the step has work left", () => {
    assert.throws(() => applyAction(fresh(), { action: "advance" }, NOW), JourneyRefusal);
  });

  it("moves to the next step once every required task is done", () => {
    let record = fresh();
    for (const [taskId, value] of [
      ["setup.name", "Fujairah"],
      ["setup.location", "25.1,56.3"],
      ["setup.commitment", "2025-01-15"],
    ]) {
      record = applyAction(record, { action: "answer", taskId, value }, NOW).record;
    }
    for (const id of ["setup.name", "setup.location", "setup.commitment"]) record.tasks[id] = { ...record.tasks[id], status: "done" };
    assert.equal(applyAction(record, { action: "advance" }, NOW).record.current, nextStep("setup"));
  });

  it("closes a period after issuance: the loop starts again from the next period's start", () => {
    const record = fujairah();
    record.current = "issued";
    for (const task of planOf(record.tasks).stepById.issued.tasks) record.tasks[task.id] = { status: "done", value: "x" };
    record.tasks["issued.next"] = { status: "done", value: "2027-01-01" };
    record.tasks["report.corc"] = { status: "done" };
    const { record: next } = applyAction(record, { action: "advance" }, NOW);
    assert.equal(next.current, nextStep("issued"));
    assert.equal(next.laps, record.laps + 1);
    assert.deepEqual(next.tasks["monitor.period"], { status: "open", value: "2027-01-01|" });
    assert.equal(next.tasks["report.corc"], undefined);
    assert.equal(next.tasks["issued.next"], undefined);
  });
});

describe("requests", () => {
  it("reads an answer with files, a draft, an accept and an advance", () => {
    assert.deepEqual(parseAction({ action: "answer", taskId: "onboarding.kyc", files: [{ name: "kyc.pdf", size: 10 }] }), {
      action: "answer",
      taskId: "onboarding.kyc",
      value: undefined,
      files: [{ name: "kyc.pdf", size: 10 }],
    });
    assert.deepEqual(parseAction({ action: "draft", taskId: "package.description" }), { action: "draft", taskId: "package.description" });
    assert.deepEqual(parseAction({ action: "advance", taskId: "ignored" }), { action: "advance" });
  });

  it("reads where a filed document is in Cortex and its fingerprint", () => {
    const sha256 = "A".repeat(43) + "=";
    const key = "tenants/fourfourone/projects/fujairah-mineral/evidence/kyc.pdf";
    assert.deepEqual(parseAction({ action: "answer", taskId: "onboarding.kyc", files: [{ name: "kyc.pdf", size: 10, key, sha256 }] }), {
      action: "answer",
      taskId: "onboarding.kyc",
      value: undefined,
      files: [{ name: "kyc.pdf", size: 10, key, sha256 }],
    });
    for (const file of [
      { name: "a.pdf", size: 1, key: "tenants/x/projects/y/../z/a.pdf" },
      { name: "a.pdf", size: 1, key: "/tenants/x/a.pdf" },
      { name: "a.pdf", size: 1, key: 7 },
      { name: "a.pdf", size: 1, sha256: "not-a-hash" },
    ]) {
      assert.equal(parseAction({ action: "answer", taskId: "onboarding.kyc", files: [file] }), null, JSON.stringify(file));
    }
  });

  it("refuses anything else", () => {
    for (const body of [
      null,
      "answer",
      { action: "delete", taskId: "setup.name" },
      { action: "answer", taskId: "setup.name" },
      { action: "answer", value: "x" },
      { action: "answer", taskId: "onboarding.kyc", files: [{ name: "", size: 1 }] },
      { action: "answer", taskId: "onboarding.kyc", files: [{ name: "a.pdf", size: -1 }] },
      { action: "accept" },
    ]) {
      assert.equal(parseAction(body), null, JSON.stringify(body));
    }
  });

  it("asks again for a check a closed tab interrupted", () => {
    assert.deepEqual(settledTasks({ a: { status: "checking", value: "x", note: "old" }, b: { status: "done" } }), {
      a: { status: "open", value: "x", note: undefined },
      b: { status: "done" },
    });
  });
});

describe("where filed documents go", () => {
  it("files each document where Cortex's labels would put it", () => {
    const pinOf = (registry: string, methodology: string, taskId: string) => {
      const input = planFor(registry, methodology).taskById[taskId]?.input;
      return input?.type === "file" ? input.pin : null;
    };
    assert.equal(pinOf("puro", "puro-gsc", "onboarding.kyc"), "evidence");
    assert.equal(pinOf("puro", "puro-gsc", "package.monitoring"), "knowledge");
    assert.equal(pinOf("puro", "puro-gsc", "monitor.calibration"), "calibration");
    assert.equal(pinOf("puro", "puro-gsc", "validation.report"), "reviewer");
    assert.equal(pinOf("puro", "puro-gsc", "onboarding.jurisdiction"), "reviewer");
    assert.equal(pinOf("isometric", "isometric-bioccs", "package.ownership"), "evidence");
  });
});
