import "server-only";

import {
  ConditionalCheckFailedException,
  DeleteItemCommand,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  type AttributeValue,
  type DynamoDBClient,
  type QueryCommandOutput,
} from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, NoSuchKey, type S3Client } from "@aws-sdk/client-s3";

import { atlasConfig, dynamoFor, s3For, type AtlasConfig } from "./clients";

/**
 * Reads and writes the Atlas table and bucket. Every item keeps its fields as
 * JSON in `doc`, with a `version` for optimistic writes where two people may
 * change the same thing.
 */

export class AtlasUnavailable extends Error {
  constructor() {
    super("Atlas data is not set up on this deployment (ATLAS_TABLE, ATLAS_BUCKET).");
  }
}

export class AtlasConflict extends Error {
  constructor() {
    super("Someone else changed this first. Reload and try again.");
  }
}

interface Store {
  config: AtlasConfig;
  dynamo: DynamoDBClient;
  s3: S3Client;
}

let store: Store | null = null;

export function atlasStore(): Store {
  if (store) return store;
  const config = atlasConfig();
  if (!config) throw new AtlasUnavailable();
  store = { config, dynamo: dynamoFor(config), s3: s3For(config) };
  return store;
}

export function atlasConfigured(): boolean {
  return atlasConfig() !== null;
}

export interface Stored<T> {
  doc: T;
  version: number;
  updatedAt?: string;
}

function parse<T>(item: Record<string, AttributeValue>): Stored<T> | null {
  const raw = item?.doc?.S;
  if (!raw) return null;
  return { doc: JSON.parse(raw) as T, version: Number(item.version?.N ?? 0), updatedAt: item.updatedAt?.S };
}

export async function getDoc<T>(pk: string, sk: string): Promise<Stored<T> | null> {
  const { config, dynamo } = atlasStore();
  const result = await dynamo.send(
    new GetItemCommand({ TableName: config.table, Key: { pk: { S: pk }, sk: { S: sk } }, ConsistentRead: true }),
  );
  return result.Item ? parse<T>(result.Item) : null;
}

/** Every item under a partition whose sort key starts with `prefix`. */
export async function queryDocs<T>(pk: string, prefix: string): Promise<{ sk: string; stored: Stored<T> }[]> {
  const { config, dynamo } = atlasStore();
  const out: { sk: string; stored: Stored<T> }[] = [];
  let start: QueryCommandOutput["LastEvaluatedKey"];
  do {
    const page = await dynamo.send(
      new QueryCommand({
        TableName: config.table,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": { S: pk }, ":prefix": { S: prefix } },
        ExclusiveStartKey: start,
      }),
    );
    for (const item of page.Items ?? []) {
      const stored = parse<T>(item);
      if (stored && item.sk?.S) out.push({ sk: item.sk.S, stored });
    }
    start = page.LastEvaluatedKey;
  } while (start);
  return out;
}

/**
 * Writes an item. With `expectVersion` the write only lands if the stored
 * item is still at that version (0: it must not exist yet), so a stale
 * browser cannot overwrite a newer change.
 */
export async function putDoc<T>(pk: string, sk: string, doc: T, expectVersion?: number): Promise<number> {
  const { config, dynamo } = atlasStore();
  const version = (expectVersion ?? 0) + 1;
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: config.table,
        Item: {
          pk: { S: pk },
          sk: { S: sk },
          doc: { S: JSON.stringify(doc) },
          version: { N: String(version) },
          updatedAt: { S: new Date().toISOString() },
        },
        ...(expectVersion === undefined
          ? {}
          : expectVersion === 0
            ? { ConditionExpression: "attribute_not_exists(pk)" }
            : { ConditionExpression: "version = :expected", ExpressionAttributeValues: { ":expected": { N: String(expectVersion) } } }),
      }),
    );
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) throw new AtlasConflict();
    throw error;
  }
  return version;
}

export async function deleteDoc(pk: string, sk: string): Promise<void> {
  const { config, dynamo } = atlasStore();
  await dynamo.send(new DeleteItemCommand({ TableName: config.table, Key: { pk: { S: pk }, sk: { S: sk } } }));
}

/** An object in the Atlas bucket, or null when there is none at that key. */
export async function getObject(key: string): Promise<{ body: Uint8Array; contentType?: string; etag?: string } | null> {
  const { config, s3 } = atlasStore();
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
    const body = await result.Body?.transformToByteArray();
    return body ? { body, contentType: result.ContentType, etag: result.ETag } : null;
  } catch (error) {
    if (error instanceof NoSuchKey || (error as { name?: string }).name === "NoSuchKey") return null;
    throw error;
  }
}

export async function getJsonObject<T>(key: string): Promise<T | null> {
  const object = await getObject(key);
  return object ? (JSON.parse(new TextDecoder().decode(object.body)) as T) : null;
}
