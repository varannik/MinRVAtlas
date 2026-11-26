import "server-only";

import { GetItemCommand, PutItemCommand, QueryCommand, type DynamoDBClient } from "@aws-sdk/client-dynamodb";

import { cleanEntries, type MapEntries, type TagMap } from "./mapping";

/**
 * A project's tag map and its uploads, in the data quality engine's table, read and
 * written through the Cortex tenant session (one project's partition only):
 *
 *   sk TAGMAP              the column-to-metric map, its version and whether it is approved
 *   sk UPLOAD#<uploadId>   one per load: the file, the days, the metrics, who and when
 */

export interface UploadRecord {
  id: string;
  fileName: string;
  bytes: number;
  sha256: string;
  period: { start: string; end: string };
  days: number;
  metrics: string[];
  by: string;
  at: string;
  tagMapVersion: number;
  runId?: string;
  notes: string[];
}

export class TagMapConflict extends Error {}

function projectKey(tenantId: string, projectId: string): string {
  return `TENANT#${tenantId}#PROJECT#${projectId}`;
}

function parse<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function loadTagMap(dynamo: DynamoDBClient, table: string, tenantId: string, projectId: string): Promise<TagMap | null> {
  const result = await dynamo.send(
    new GetItemCommand({ TableName: table, Key: { pk: { S: projectKey(tenantId, projectId) }, sk: { S: "TAGMAP" } }, ConsistentRead: true }),
  );
  const stored = parse<TagMap>(result.Item?.map?.S);
  return stored ? { ...stored, entries: cleanEntries(stored.entries) } : null;
}

async function putTagMap(dynamo: DynamoDBClient, table: string, tenantId: string, projectId: string, map: TagMap, expected: number | null) {
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: table,
        Item: {
          pk: { S: projectKey(tenantId, projectId) },
          sk: { S: "TAGMAP" },
          version: { N: String(map.version) },
          status: { S: map.status },
          map: { S: JSON.stringify(map) },
        },
        ...(expected == null
          ? { ConditionExpression: "attribute_not_exists(sk)" }
          : { ConditionExpression: "version = :expected", ExpressionAttributeValues: { ":expected": { N: String(expected) } } }),
      }),
    );
  } catch (error) {
    if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
      throw new TagMapConflict("Someone changed the tag map while you worked on it. Reload the page and try again.");
    }
    throw error;
  }
}

/**
 * Propose mappings for some columns. Columns not named keep what they had. Any
 * change sends the whole map back to "proposed" until a platform admin approves it.
 */
export async function proposeTagMap(
  dynamo: DynamoDBClient,
  table: string,
  input: { tenantId: string; projectId: string; entries: MapEntries; by: string; version: number | null },
): Promise<TagMap> {
  const current = await loadTagMap(dynamo, table, input.tenantId, input.projectId);
  if ((current?.version ?? null) !== input.version) throw new TagMapConflict("The tag map changed since you opened it. Reload the page and try again.");
  const entries = { ...(current?.entries ?? {}), ...input.entries };
  const changed = !current || JSON.stringify(entries) !== JSON.stringify(current.entries);
  if (!changed) return current;
  const map: TagMap = {
    entries,
    status: "proposed",
    version: (current?.version ?? 0) + 1,
    proposedBy: input.by,
    proposedAt: new Date().toISOString(),
  };
  await putTagMap(dynamo, table, input.tenantId, input.projectId, map, current?.version ?? null);
  return map;
}

/** A platform admin approves the map as it stands at `version`. */
export async function approveTagMap(
  dynamo: DynamoDBClient,
  table: string,
  input: { tenantId: string; projectId: string; version: number; by: string },
): Promise<TagMap> {
  const current = await loadTagMap(dynamo, table, input.tenantId, input.projectId);
  if (!current || current.version !== input.version) throw new TagMapConflict("The tag map changed since you opened it. Reload the page and look again.");
  const map: TagMap = { ...current, status: "approved", version: current.version + 1, approvedBy: input.by, approvedAt: new Date().toISOString() };
  await putTagMap(dynamo, table, input.tenantId, input.projectId, map, current.version);
  return map;
}

export async function saveUpload(dynamo: DynamoDBClient, table: string, tenantId: string, projectId: string, upload: UploadRecord): Promise<void> {
  await dynamo.send(
    new PutItemCommand({
      TableName: table,
      Item: {
        pk: { S: projectKey(tenantId, projectId) },
        sk: { S: `UPLOAD#${upload.id}` },
        upload: { S: JSON.stringify(upload) },
      },
      ConditionExpression: "attribute_not_exists(sk)",
    }),
  );
}

/** The newest uploads first. */
export async function listUploads(dynamo: DynamoDBClient, table: string, tenantId: string, projectId: string, limit = 20): Promise<UploadRecord[]> {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :upload)",
      ExpressionAttributeValues: { ":pk": { S: projectKey(tenantId, projectId) }, ":upload": { S: "UPLOAD#" } },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (result.Items ?? []).map((item) => parse<UploadRecord>(item.upload?.S)).filter((upload): upload is UploadRecord => Boolean(upload));
}
