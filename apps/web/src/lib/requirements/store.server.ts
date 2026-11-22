import "server-only";

import {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
  TransactionCanceledException,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";

import { requirementsFor, type ApprovedValues, type RequirementDef, type RequirementScope } from "./catalog";

/**
 * Registry values in the Cortex requirements table (infra/lib/cortex/core-stack.ts).
 *
 *   pk REQ#<registry>#<methodology>#<edition>
 *     sk VALUE#<id>              the approved value, with its clause, page and quote, who approved it and when
 *     sk PROPOSAL#<id>#<time>    every value Cortex proposed (requirement_propose.py) and what became of it
 *     sk RUN                     the latest request for proposals, and whether it has finished
 *
 * The values are shared by every organisation with a project on that edition, so
 * the web reads and writes them with its own role; only platform admins decide.
 */

const REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "eu-west-2";
/** A request for proposals that has not finished after this long is treated as stuck. */
const RUN_STALE_MS = 20 * 60 * 1000;

let dynamo: DynamoDBClient | null = null;
let sfn: SFNClient | null = null;

export interface RequirementsEnv {
  table: string;
  proposeArn?: string;
}

export function requirementsEnv(): RequirementsEnv | null {
  const table = process.env.CORTEX_REQUIREMENTS_TABLE?.trim();
  if (!table) return null;
  return { table, proposeArn: process.env.CORTEX_PROPOSE_STATE_MACHINE_ARN?.trim() || undefined };
}

export interface Evidence {
  value?: number;
  unit?: string;
  clauseRef?: string;
  document?: string;
  page?: number;
  quote?: string;
}

export interface Approved extends Evidence {
  value: number;
  approvedBy: string;
  approvedAt: string;
}

export interface Proposal extends Evidence {
  sk: string;
  status: "proposed" | "not_found" | "approved" | "rejected";
  confidence?: string;
  note?: string;
  proposedAt: string;
  decidedBy?: string;
  decidedAt?: string;
}

export interface RequirementView extends RequirementDef {
  approved?: Approved;
  /** The newest proposal, whatever became of it. */
  proposal?: Proposal;
}

export interface RequirementsView {
  scope: RequirementScope;
  requirements: RequirementView[];
  /** A request for proposals is still running. */
  proposing: boolean;
}

/** A refusal whose message is safe to show the user. */
export class RequirementRefusal extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function scopeKey(scope: RequirementScope): string {
  return `REQ#${scope.registry}#${scope.methodology}#${scope.edition}`;
}

const text = (item: Record<string, AttributeValue>, field: string) => item[field]?.S;
const number = (item: Record<string, AttributeValue>, field: string) => (item[field]?.N !== undefined ? Number(item[field].N) : undefined);

function evidence(item: Record<string, AttributeValue>): Evidence {
  return {
    value: number(item, "value"),
    unit: text(item, "unit"),
    clauseRef: text(item, "clause_ref"),
    document: text(item, "document"),
    page: number(item, "page"),
    quote: text(item, "quote"),
  };
}

async function items(table: string, scope: RequirementScope): Promise<Record<string, AttributeValue>[]> {
  dynamo ??= new DynamoDBClient({ region: REGION });
  const found: Record<string, AttributeValue>[] = [];
  let start: Record<string, AttributeValue> | undefined;
  do {
    const page = await dynamo.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": { S: scopeKey(scope) } },
        ExclusiveStartKey: start,
      }),
    );
    found.push(...(page.Items ?? []));
    start = page.LastEvaluatedKey;
  } while (start);
  return found;
}

/** Every value that applies to the project, with its approved value and newest proposal. */
export function viewOf(scope: RequirementScope, stored: Record<string, AttributeValue>[], now = Date.now()): RequirementsView {
  const approved = new Map<string, Approved>();
  const proposals = new Map<string, Proposal>();
  let proposing = false;
  for (const item of stored) {
    const sk = text(item, "sk") ?? "";
    if (sk.startsWith("VALUE#")) {
      const value = number(item, "value");
      if (value === undefined) continue;
      approved.set(sk.slice("VALUE#".length), {
        ...evidence(item),
        value,
        approvedBy: text(item, "approved_by_name") ?? text(item, "approved_by") ?? "",
        approvedAt: text(item, "approved_at") ?? "",
      });
    } else if (sk.startsWith("PROPOSAL#")) {
      const id = text(item, "requirement") ?? "";
      const proposal: Proposal = {
        ...evidence(item),
        sk,
        status: (text(item, "status") as Proposal["status"]) ?? "proposed",
        confidence: text(item, "confidence"),
        note: text(item, "note"),
        proposedAt: text(item, "proposed_at") ?? "",
        decidedBy: text(item, "decided_by_name"),
        decidedAt: text(item, "decided_at"),
      };
      const newest = proposals.get(id);
      if (!newest || newest.sk < sk) proposals.set(id, proposal);
    } else if (sk === "RUN") {
      const started = Date.parse(text(item, "started_at") ?? "");
      proposing = text(item, "status") === "running" && Number.isFinite(started) && now - started < RUN_STALE_MS;
    }
  }
  return {
    scope,
    proposing,
    requirements: requirementsFor(scope).map((def) => ({ ...def, approved: approved.get(def.id), proposal: proposals.get(def.id) })),
  };
}

export async function loadRequirements(env: RequirementsEnv, scope: RequirementScope): Promise<RequirementsView> {
  return viewOf(scope, await items(env.table, scope));
}

/** The approved values a project's journey checks with (the built-in ones apply to the rest). */
export async function approvedValues(env: RequirementsEnv, scope: RequirementScope): Promise<ApprovedValues> {
  const view = await loadRequirements(env, scope);
  return Object.fromEntries(view.requirements.flatMap((requirement) => (requirement.approved ? [[requirement.id, requirement.approved.value]] : [])));
}

/** Ask Cortex to propose every value that applies to this scope. */
export async function startProposals(
  env: RequirementsEnv,
  scope: RequirementScope,
  by: { sub: string; name: string },
): Promise<void> {
  if (!env.proposeArn) throw new RequirementRefusal("Cortex cannot propose values on this deployment yet.", 503);
  const now = new Date();
  dynamo ??= new DynamoDBClient({ region: REGION });
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: env.table,
        Item: {
          pk: { S: scopeKey(scope) },
          sk: { S: "RUN" },
          status: { S: "running" },
          started_at: { S: now.toISOString() },
          started_by: { S: by.sub },
        },
        // One request at a time; a stuck one stops blocking after a while.
        ConditionExpression: "attribute_not_exists(pk) OR #status <> :running OR started_at < :stale",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":running": { S: "running" },
          ":stale": { S: new Date(now.getTime() - RUN_STALE_MS).toISOString() },
        },
      }),
    );
  } catch (error) {
    if ((error as Error).name === "ConditionalCheckFailedException") {
      throw new RequirementRefusal("Cortex is already proposing values for this edition.", 409);
    }
    throw error;
  }
  sfn ??= new SFNClient({ region: REGION });
  await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: env.proposeArn,
      input: JSON.stringify({
        pk: scopeKey(scope),
        scope,
        requested_by: by.sub,
        requirements: requirementsFor(scope).map(({ id, label, unit, question, search }) => ({ id, label, unit, question, search })),
      }),
    }),
  );
}

/** Approve a proposal (its value becomes the one the checks use) or reject it. */
export async function decide(
  env: RequirementsEnv,
  scope: RequirementScope,
  input: { requirement: string; proposal: string; action: "approve" | "reject"; by: { sub: string; name: string } },
): Promise<void> {
  if (!requirementsFor(scope).some((requirement) => requirement.id === input.requirement)) {
    throw new RequirementRefusal("That value does not apply to this methodology.", 400);
  }
  if (!input.proposal.startsWith(`PROPOSAL#${input.requirement}#`)) throw new RequirementRefusal("That is not a proposal for this value.", 400);
  const view = viewOf(scope, await items(env.table, scope));
  const proposal = view.requirements.find((requirement) => requirement.id === input.requirement)?.proposal;
  if (!proposal || proposal.sk !== input.proposal) {
    throw new RequirementRefusal("A newer proposal has arrived for this value. Look at it first.", 409);
  }
  if (proposal.status !== "proposed" || proposal.value === undefined) {
    throw new RequirementRefusal("Only a proposal with a value, not yet decided, can be approved or rejected.", 409);
  }
  const now = new Date().toISOString();
  const pk = { S: scopeKey(scope) };
  const status = input.action === "approve" ? "approved" : "rejected";
  const markProposal = {
    Update: {
      TableName: env.table,
      Key: { pk, sk: { S: proposal.sk } },
      UpdateExpression: "SET #status = :status, decided_by = :by, decided_by_name = :name, decided_at = :at",
      ConditionExpression: "#status = :proposed",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": { S: status },
        ":proposed": { S: "proposed" },
        ":by": { S: input.by.sub },
        ":name": { S: input.by.name },
        ":at": { S: now },
      },
    },
  };
  const evidenceItem: Record<string, AttributeValue> = { value: { N: String(proposal.value) } };
  for (const [field, value] of [
    ["unit", proposal.unit],
    ["clause_ref", proposal.clauseRef],
    ["document", proposal.document],
    ["quote", proposal.quote],
  ] as const) {
    if (value) evidenceItem[field] = { S: value };
  }
  if (proposal.page !== undefined) evidenceItem.page = { N: String(proposal.page) };
  try {
    await (dynamo ??= new DynamoDBClient({ region: REGION })).send(
      new TransactWriteItemsCommand({
        TransactItems:
          input.action === "approve"
            ? [
                markProposal,
                {
                  Put: {
                    TableName: env.table,
                    Item: {
                      pk,
                      sk: { S: `VALUE#${input.requirement}` },
                      ...evidenceItem,
                      proposal: { S: proposal.sk },
                      approved_by: { S: input.by.sub },
                      approved_by_name: { S: input.by.name },
                      approved_at: { S: now },
                    },
                  },
                },
              ]
            : [markProposal],
      }),
    );
  } catch (error) {
    if (error instanceof TransactionCanceledException) {
      throw new RequirementRefusal("Someone decided on this proposal just now.", 409);
    }
    throw error;
  }
}
