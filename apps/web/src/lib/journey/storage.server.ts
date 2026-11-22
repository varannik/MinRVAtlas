import "server-only";

import {
  GetItemCommand,
  TransactWriteItemsCommand,
  TransactionCanceledException,
  type AttributeValue,
  type DynamoDBClient,
} from "@aws-sdk/client-dynamodb";

import { settledTasks, type JourneyAction, type JourneyRecord, type Outcome, type Tasks } from "./engine";
import { SCENARIO_BY_ID } from "./scenarios";
import { journeySummary } from "./summary";
import type { StepId } from "./types";

/**
 * A project's journey in the Cortex journeys table (infra/lib/cortex/core-stack.ts).
 *
 *   pk TENANT#<tenant>#PROJECT#<project>
 *     sk JOURNEY            where the project stands: current step, periods closed, every task, version,
 *                           and `summary` (summary.ts), which Cortex's journey___status tool reads
 *     sk CHANGE#<version>   one per change: what was done to which task, by whom, when
 *
 * The client comes from the tenant session (intake.server.ts projectDynamo), whose
 * IAM policy allows only keys starting with its own tenant and project.
 */

export interface StoredJourney extends JourneyRecord {
  /** 0 until the first change is saved. */
  version: number;
  /** False while the project still shows its starting point (nothing saved yet). */
  stored: boolean;
  /** The review scenario an unsaved project starts from; its first save records it. */
  startedFrom?: string;
  updatedAt?: string;
}

/** Someone else saved a change first. The current journey comes with it. */
export class JourneyConflict extends Error {
  constructor(readonly current: StoredJourney) {
    super("Someone else changed this journey just now. It shows their change; try yours again.");
  }
}

const JOURNEY_SK = "JOURNEY";
const VALUE_IN_CHANGE = 500;

export function journeyKey(tenantId: string, projectId: string): string {
  return `TENANT#${tenantId}#PROJECT#${projectId}`;
}

export function changeKey(version: number): string {
  return `CHANGE#${String(version).padStart(8, "0")}`;
}

/** Where a project with nothing saved starts: its review scenario if it has one, else a new project. */
export function startingPoint(projectId: string): StoredJourney {
  const scenario = projectId in SCENARIO_BY_ID ? SCENARIO_BY_ID[projectId as keyof typeof SCENARIO_BY_ID] : SCENARIO_BY_ID.new;
  return {
    current: scenario.current,
    laps: scenario.laps,
    tasks: structuredClone(scenario.seed),
    version: 0,
    stored: false,
    startedFrom: scenario.id,
  };
}

function fromItem(item: Record<string, AttributeValue>): StoredJourney {
  return {
    current: item.current.S as StepId,
    laps: Number(item.laps.N),
    tasks: settledTasks(JSON.parse(item.tasks.S ?? "{}") as Tasks),
    version: Number(item.version.N),
    stored: true,
    updatedAt: item.updatedAt?.S,
  };
}

export async function loadJourney(
  dynamo: DynamoDBClient,
  table: string,
  tenantId: string,
  projectId: string,
): Promise<StoredJourney> {
  const { Item } = await dynamo.send(
    new GetItemCommand({
      TableName: table,
      Key: { pk: { S: journeyKey(tenantId, projectId) }, sk: { S: JOURNEY_SK } },
      ConsistentRead: true,
    }),
  );
  return Item ? fromItem(Item) : startingPoint(projectId);
}

/** What the change record keeps of an action: enough to audit it, never a whole draft. */
export function changeRecord(action: JourneyAction, outcome: Outcome) {
  const record: Record<string, AttributeValue> = { action: { S: action.action } };
  if ("taskId" in action) {
    record.taskId = { S: action.taskId };
    const state = outcome.record.tasks[action.taskId];
    if (state) record.status = { S: state.status };
    if (state?.note) record.note = { S: state.note.slice(0, VALUE_IN_CHANGE) };
  }
  if (action.action === "answer") {
    if (action.value !== undefined) record.value = { S: action.value.slice(0, VALUE_IN_CHANGE) };
    if (action.files) record.files = { S: JSON.stringify(action.files) };
  }
  if (action.action === "advance") record.step = { S: outcome.record.current };
  return record;
}

/**
 * Save the journey a change produced, and its change record, in one transaction.
 * It succeeds only if nobody saved since `from` was read.
 */
export async function saveJourney(
  dynamo: DynamoDBClient,
  table: string,
  input: { tenantId: string; projectId: string; by: string; from: StoredJourney; action: JourneyAction; outcome: Outcome; now: string },
): Promise<StoredJourney> {
  const pk = journeyKey(input.tenantId, input.projectId);
  const version = input.from.version + 1;
  const { record } = input.outcome;
  try {
    await dynamo.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Put: {
              TableName: table,
              Item: {
                pk: { S: pk },
                sk: { S: JOURNEY_SK },
                current: { S: record.current },
                laps: { N: String(record.laps) },
                tasks: { S: JSON.stringify(record.tasks) },
                summary: { S: JSON.stringify(journeySummary(record)) },
                version: { N: String(version) },
                updatedAt: { S: input.now },
                updatedBy: { S: input.by },
              },
              ...(input.from.stored
                ? { ConditionExpression: "version = :from", ExpressionAttributeValues: { ":from": { N: String(input.from.version) } } }
                : { ConditionExpression: "attribute_not_exists(pk)" }),
            },
          },
          // The first save also records what the journey started from (a review
          // scenario's answers are saved with it, so the record says where they came from).
          ...(input.from.stored
            ? []
            : [
                {
                  Put: {
                    TableName: table,
                    Item: {
                      pk: { S: pk },
                      sk: { S: changeKey(0) },
                      action: { S: "start" },
                      scenario: { S: input.from.startedFrom ?? "new" },
                      version: { N: "0" },
                      by: { S: input.by },
                      at: { S: input.now },
                    },
                    ConditionExpression: "attribute_not_exists(pk)",
                  },
                },
              ]),
          {
            Put: {
              TableName: table,
              Item: {
                pk: { S: pk },
                sk: { S: changeKey(version) },
                ...changeRecord(input.action, input.outcome),
                version: { N: String(version) },
                by: { S: input.by },
                at: { S: input.now },
              },
              ConditionExpression: "attribute_not_exists(pk)",
            },
          },
        ],
      }),
    );
  } catch (error) {
    if (error instanceof TransactionCanceledException) {
      throw new JourneyConflict(await loadJourney(dynamo, table, input.tenantId, input.projectId));
    }
    throw error;
  }
  return { ...record, version, stored: true, updatedAt: input.now };
}
