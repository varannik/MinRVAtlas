// JITI_TSCONFIG_PATHS=true JITI_ALIAS='{"server-only": "<apps/web>/node_modules/server-only/empty.js"}' \
//   node --import jiti/register --import ./loaders/node-test.mjs --test src/lib/journey/storage.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GetItemCommand, TransactWriteItemsCommand, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";

import { applyAction } from "./engine";
import { JourneyConflict, changeKey, journeyKey, loadJourney, saveJourney, startingPoint, type StoredJourney } from "./storage.server";

const NOW = "2026-11-21T12:00:00.000Z";
const TABLE = "journeys";

class FakeDynamo {
  sent: { name: string; input: Record<string, unknown> }[] = [];
  constructor(
    private readonly stored?: Record<string, unknown>,
    private readonly conflict = false,
  ) {}
  async send(command: GetItemCommand | TransactWriteItemsCommand) {
    this.sent.push({ name: command.constructor.name, input: command.input as unknown as Record<string, unknown> });
    if (command instanceof GetItemCommand) return { Item: this.stored };
    if (this.conflict) {
      throw new TransactionCanceledException({ message: "cancelled", $metadata: {}, CancellationReasons: [{ Code: "ConditionalCheckFailed" }] });
    }
    return {};
  }
  get client() {
    return this as unknown as DynamoDBClient;
  }
}

function storedItem(version: number) {
  return {
    current: { S: "monitor" },
    laps: { N: "1" },
    tasks: { S: JSON.stringify({ "setup.name": { status: "done", value: "Fujairah" }, "monitor.period": { status: "checking" } }) },
    version: { N: String(version) },
    updatedAt: { S: NOW },
  };
}

type Put = { Put: { Item: Record<string, { S?: string; N?: string }>; ConditionExpression: string; ExpressionAttributeValues?: Record<string, unknown> } };

function puts(fake: FakeDynamo): Put[] {
  const write = fake.sent.find((entry) => entry.name === "TransactWriteItemsCommand");
  return (write?.input.TransactItems ?? []) as Put[];
}

describe("reading a journey", () => {
  it("starts an unsaved project from its review scenario, or as a new project", () => {
    const fujairah = startingPoint("fujairah-mineral");
    assert.equal(fujairah.stored, false);
    assert.equal(fujairah.startedFrom, "fujairah-mineral");
    assert.ok(Object.keys(fujairah.tasks).length > 0);
    const other = startingPoint("oman-pilot");
    assert.equal(other.startedFrom, "new");
    assert.equal(other.version, 0);
  });

  it("reads the stored item under the project's own key, and asks again for an interrupted check", async () => {
    const fake = new FakeDynamo(storedItem(7));
    const journey = await loadJourney(fake.client, TABLE, "fourfourone", "fujairah-mineral");
    assert.deepEqual(fake.sent[0].input.Key, { pk: { S: "TENANT#fourfourone#PROJECT#fujairah-mineral" }, sk: { S: "JOURNEY" } });
    assert.equal(fake.sent[0].input.ConsistentRead, true);
    assert.equal(journey.version, 7);
    assert.equal(journey.stored, true);
    assert.equal(journey.tasks["monitor.period"].status, "open");
  });
});

describe("saving a change", () => {
  const save = (fake: FakeDynamo, from: StoredJourney) => {
    const action = { action: "answer" as const, taskId: "setup.name", value: "Fujairah Peridotite" };
    return saveJourney(fake.client, TABLE, {
      tenantId: "fourfourone",
      projectId: "fujairah-mineral",
      by: "sub-1",
      from,
      action,
      outcome: applyAction(from, action, NOW),
      now: NOW,
    });
  };

  it("first save: creates the journey, records where it started and the change", async () => {
    const fake = new FakeDynamo();
    const saved = await save(fake, startingPoint("fujairah-mineral"));
    const bySk = (sk: string) => puts(fake).find((put) => put.Put.Item.sk.S === sk)!;
    const [start, journey, change] = [bySk(changeKey(0)), bySk("JOURNEY"), bySk(changeKey(1))];
    assert.equal(puts(fake).length, 3);
    assert.equal(start.Put.Item.action.S, "start");
    assert.equal(start.Put.Item.scenario.S, "fujairah-mineral");
    assert.equal(journey.Put.ConditionExpression, "attribute_not_exists(pk)");
    assert.equal(journey.Put.Item.version.N, "1");
    // What Cortex's journey tool reads: every step, with the answer just given.
    const summary = JSON.parse(journey.Put.Item.summary.S ?? "{}");
    assert.equal(summary.current, "monitor");
    const name = summary.steps[0].tasks.find((task: { id: string }) => task.id === "setup.name");
    assert.deepEqual([name.status, name.answer], ["done", "Fujairah Peridotite"]);
    assert.equal(change.Put.Item.sk.S, "CHANGE#00000001");
    assert.deepEqual(
      [change.Put.Item.action.S, change.Put.Item.taskId.S, change.Put.Item.status.S, change.Put.Item.value.S, change.Put.Item.by.S],
      ["answer", "setup.name", "done", "Fujairah Peridotite", "sub-1"],
    );
    for (const put of puts(fake)) assert.equal(put.Put.Item.pk.S, journeyKey("fourfourone", "fujairah-mineral"));
    assert.deepEqual([saved.version, saved.stored], [1, true]);
  });

  it("later saves succeed only from the version that was read", async () => {
    const fake = new FakeDynamo();
    const from = { ...startingPoint("fujairah-mineral"), version: 4, stored: true };
    await save(fake, from);
    const [journey, change] = puts(fake);
    assert.equal(puts(fake).length, 2);
    assert.equal(journey.Put.ConditionExpression, "version = :from");
    assert.deepEqual(journey.Put.ExpressionAttributeValues, { ":from": { N: "4" } });
    assert.equal(change.Put.Item.sk.S, "CHANGE#00000005");
  });

  it("someone else saved first: a conflict carrying the journey as it now is", async () => {
    const fake = new FakeDynamo(storedItem(5), true);
    const from = { ...startingPoint("fujairah-mineral"), version: 4, stored: true };
    await assert.rejects(save(fake, from), (error: unknown) => {
      assert.ok(error instanceof JourneyConflict);
      assert.equal(error.current.version, 5);
      return true;
    });
  });
});
