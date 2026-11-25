import "server-only";

import { PutItemCommand, QueryCommand, type AttributeValue, type DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { randomBytes } from "node:crypto";

import type { Registry } from "@/lib/types";
import { registrySlug } from "@/lib/stream-schema";
import { withReview, type FindingReview, type FindingStatus, type QualityFinding, type QualityRun, type RunSummary } from "./types";

/**
 * The data quality engine's table, read and written as the user's project.
 *
 * Every call takes a DynamoDB client from the Cortex tenant session for this
 * tenant and project (lib/cortex/intake.server.ts projectDynamo), so IAM
 * refuses any other partition. Layout: apps/quality-engine/quality_engine/store.py.
 */

const REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "eu-west-2";
/** A run still "running" after this long has died without a record; another may start. */
const STUCK_MS = 30 * 60 * 1000;

export interface QualityEnv {
  table: string;
  runArn: string;
}

export function qualityEnv(): QualityEnv | null {
  const table = process.env.QUALITY_TABLE?.trim();
  const runArn = process.env.QUALITY_RUN_STATE_MACHINE_ARN?.trim();
  return table && runArn ? { table, runArn } : null;
}

function projectKey(tenantId: string, projectId: string): string {
  return `TENANT#${tenantId}#PROJECT#${projectId}`;
}

async function query(
  dynamo: DynamoDBClient,
  table: string,
  pk: string,
  prefix: string,
  options: { newestFirst?: boolean; limit?: number } = {},
): Promise<Record<string, AttributeValue>[]> {
  const items: Record<string, AttributeValue>[] = [];
  let start: Record<string, AttributeValue> | undefined;
  do {
    const page = await dynamo.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": { S: pk }, ":prefix": { S: prefix } },
        ScanIndexForward: !options.newestFirst,
        Limit: options.limit,
        ExclusiveStartKey: start,
      }),
    );
    items.push(...(page.Items ?? []));
    start = page.LastEvaluatedKey;
  } while (start && !(options.limit && items.length >= options.limit));
  return items;
}

function text(item: Record<string, AttributeValue>, field: string): string | undefined {
  return item[field]?.S;
}

function parseJson<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function runFromItem(item: Record<string, AttributeValue>): QualityRun {
  const result = parseJson<Pick<QualityRun, "verdict" | "counts" | "range" | "versions">>(text(item, "result")) ?? {};
  return {
    id: text(item, "runId") ?? "",
    status: (text(item, "status") as QualityRun["status"]) ?? "running",
    startedAt: text(item, "startedAt") ?? "",
    finishedAt: text(item, "finishedAt"),
    source: text(item, "source"),
    verdict: result.verdict,
    counts: result.counts,
    range: result.range ?? null,
    versions: result.versions,
    error: text(item, "error"),
    summary: parseJson<RunSummary>(text(item, "summary")) ?? undefined,
  };
}

function isLive(run: QualityRun, now = Date.now()): boolean {
  return run.status === "running" && now - Date.parse(run.startedAt) < STUCK_MS;
}

export interface StoredQuality {
  run: QualityRun | null;
  running: QualityRun | null;
  findings: QualityFinding[];
}

/** The latest finished run, any run in progress, and the finished run's findings with today's decisions applied. */
export async function loadQuality(dynamo: DynamoDBClient, table: string, tenantId: string, projectId: string): Promise<StoredQuality> {
  const pk = projectKey(tenantId, projectId);
  const [runItems, reviewItems] = await Promise.all([
    query(dynamo, table, pk, "RUN#", { newestFirst: true, limit: 10 }),
    query(dynamo, table, pk, "REVIEW#"),
  ]);
  const runs = runItems.map(runFromItem);
  const run = runs.find((candidate) => candidate.status === "done") ?? null;
  const running = runs.find((candidate) => isLive(candidate)) ?? null;
  if (!run) return { run, running, findings: [] };

  const reviews = new Map(
    reviewItems.map((item) => [(text(item, "sk") ?? "").slice("REVIEW#".length), parseJson<FindingReview>(text(item, "review"))] as const),
  );
  const findingItems = await query(dynamo, table, pk, `FINDING#${run.id}#`);
  const findings = findingItems
    .map((item) => parseJson<QualityFinding>(text(item, "finding")))
    .filter((finding): finding is QualityFinding => Boolean(finding))
    .map((finding) => (reviews.has(finding.id) ? withReview(finding, reviews.get(finding.id) ?? null) : finding));
  return { run, running, findings };
}

/** Run ids start with the UTC start time, so RUN# items sort oldest first (store.py RUN_ID). */
export function newRunId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

/** Site time zones for single-zone countries; elsewhere times are shown in UTC. */
const SITE_ZONES: Record<string, string> = {
  "United Arab Emirates": "Asia/Dubai",
  Oman: "Asia/Muscat",
  Iceland: "Atlantic/Reykjavik",
  "United Kingdom": "Europe/London",
  Norway: "Europe/Oslo",
  Finland: "Europe/Helsinki",
  India: "Asia/Kolkata",
  Kenya: "Africa/Nairobi",
  Niger: "Africa/Niamey",
  China: "Asia/Shanghai",
  Peru: "America/Lima",
};

export function siteZone(country: string | undefined): string | undefined {
  return country ? SITE_ZONES[country] : undefined;
}

let sfn: SFNClient | null = null;

/**
 * Start a run of the engine on the project's data. The run is recorded as running
 * first, so the page follows it from the start (the engine's first step keeps an
 * existing record); if the state machine will not start, the record says so.
 */
export async function startRun(
  dynamo: DynamoDBClient,
  env: QualityEnv,
  input: { tenantId: string; projectId: string; registry: Registry; requestedBy: string; country?: string },
): Promise<QualityRun> {
  sfn ??= new SFNClient({ region: REGION });
  const runId = newRunId();
  const startedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const record = (status: QualityRun["status"], error?: string) => ({
    pk: { S: projectKey(input.tenantId, input.projectId) },
    sk: { S: `RUN#${runId}` },
    runId: { S: runId },
    status: { S: status },
    startedAt: { S: startedAt },
    requestedBy: { S: input.requestedBy },
    registry: { S: registrySlug(input.registry) },
    ...(error ? { error: { S: error }, finishedAt: { S: startedAt } } : {}),
  });
  await dynamo.send(new PutItemCommand({ TableName: env.table, Item: record("running"), ConditionExpression: "attribute_not_exists(sk)" }));
  try {
    await sfn.send(
      new StartExecutionCommand({
        stateMachineArn: env.runArn,
        name: `${input.projectId}-${runId}`.slice(-80),
        input: JSON.stringify({
          run: {
            run_id: runId,
            tenant_id: input.tenantId,
            project_id: input.projectId,
            registry_slug: registrySlug(input.registry),
            requested_by: input.requestedBy,
            site_tz: siteZone(input.country) ?? "",
          },
        }),
      }),
    );
  } catch (error) {
    await dynamo.send(new PutItemCommand({ TableName: env.table, Item: record("failed", "The run could not be started.") }));
    throw error;
  }
  return { id: runId, status: "running", startedAt };
}

/** True when no run is going, and either none has finished or the data reaches past what was checked. */
export function isStale(stored: StoredQuality, dataEnd: string | null | undefined): boolean {
  if (stored.running) return false;
  if (!stored.run) return true;
  if (!dataEnd) return false;
  return !stored.run.range || stored.run.range.end < dataEnd;
}

/** Record a person's decision on a finding. The next run applies it; the view applies it now. */
export async function saveReview(
  dynamo: DynamoDBClient,
  table: string,
  input: { tenantId: string; projectId: string; finding: QualityFinding; decision: FindingStatus; reason: string; by: string },
): Promise<FindingReview> {
  const review = {
    decision: input.decision,
    reason: input.reason,
    by: input.by,
    at: new Date().toISOString(),
    // The judge keeps dismissed days out of detector baselines by these.
    kind: input.finding.kind,
    metric: input.finding.metric,
    start: input.finding.start,
    end: input.finding.end,
  };
  await dynamo.send(
    new PutItemCommand({
      TableName: table,
      Item: {
        pk: { S: projectKey(input.tenantId, input.projectId) },
        sk: { S: `REVIEW#${input.finding.id}` },
        review: { S: JSON.stringify(review) },
        decidedAt: { S: review.at },
        decidedBy: { S: input.by },
      },
    }),
  );
  return review;
}
