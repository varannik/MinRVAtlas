import "server-only";

import { GetItemCommand, PutItemCommand, QueryCommand, type AttributeValue, type DynamoDBClient } from "@aws-sdk/client-dynamodb";

import type { AuditKey, EvidencePiece, Filing, IndexImport, SubmissionFile } from "./types";

/**
 * The verification table, read and written as the user's project (Cortex tenant
 * session: one project's partition only). Layout:
 *
 *   sk INDEX                      the imported Index: methodology, file, who, counts
 *   sk PIECE#<audit>#<order>      one evidence piece
 *   sk FILE#<file id>             one file of the submission as received
 *   sk FILING#<audit>#<piece id>  the files filed under one piece
 */

export interface VerificationEnv {
  table: string;
  bucket: string;
}

export function verificationEnv(): VerificationEnv | null {
  const table = process.env.VERIFICATION_TABLE?.trim();
  const bucket = process.env.VERIFICATION_BUCKET?.trim();
  return table && bucket ? { table, bucket } : null;
}

export function projectKey(tenantId: string, projectId: string): string {
  return `TENANT#${tenantId}#PROJECT#${projectId}`;
}

/** Where a file of the submission is kept: <tenant>/<project>/submission/<file id>/<name>. */
export function fileKey(tenantId: string, projectId: string, fileId: string, name: string): string {
  const safe = name.replace(/[^\w.() -]+/g, "_").slice(-120) || "file";
  return `${tenantId}/${projectId}/submission/${fileId}/${safe}`;
}

async function query(dynamo: DynamoDBClient, table: string, pk: string, prefix: string): Promise<Record<string, AttributeValue>[]> {
  const items: Record<string, AttributeValue>[] = [];
  let start: Record<string, AttributeValue> | undefined;
  do {
    const page = await dynamo.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": { S: pk }, ":prefix": { S: prefix } },
        ExclusiveStartKey: start,
      }),
    );
    items.push(...(page.Items ?? []));
    start = page.LastEvaluatedKey;
  } while (start);
  return items;
}

function json<T>(item: Record<string, AttributeValue> | undefined, field = "data"): T | null {
  const raw = item?.[field]?.S;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function put(dynamo: DynamoDBClient, table: string, pk: string, sk: string, data: unknown, condition?: string) {
  await dynamo.send(
    new PutItemCommand({
      TableName: table,
      Item: { pk: { S: pk }, sk: { S: sk }, data: { S: JSON.stringify(data) } },
      ...(condition ? { ConditionExpression: condition } : {}),
    }),
  );
}

export interface StoredVerification {
  index: IndexImport | null;
  pieces: EvidencePiece[];
  files: SubmissionFile[];
  filings: Filing[];
}

export async function loadVerification(dynamo: DynamoDBClient, table: string, tenantId: string, projectId: string): Promise<StoredVerification> {
  const pk = projectKey(tenantId, projectId);
  const [indexItem, pieceItems, fileItems, filingItems] = await Promise.all([
    dynamo.send(new GetItemCommand({ TableName: table, Key: { pk: { S: pk }, sk: { S: "INDEX" } }, ConsistentRead: true })),
    query(dynamo, table, pk, "PIECE#"),
    query(dynamo, table, pk, "FILE#"),
    query(dynamo, table, pk, "FILING#"),
  ]);
  const index = json<IndexImport>(indexItem.Item);
  // A later, shorter Index leaves its predecessor's extra pieces behind (nothing is
  // deleted): only as many per audit as the latest import counted are current.
  const pieces = pieceItems
    .map((item) => json<EvidencePiece>(item))
    .filter((piece): piece is EvidencePiece => Boolean(piece) && (!index || piece!.order < (index.counts[piece!.audit] ?? 0)));
  pieces.sort((a, b) => a.audit.localeCompare(b.audit) || a.order - b.order);
  return {
    index,
    pieces,
    files: fileItems.map((item) => json<SubmissionFile>(item)).filter((file): file is SubmissionFile => Boolean(file)).sort((a, b) => a.path.localeCompare(b.path)),
    filings: filingItems.map((item) => json<Filing>(item)).filter((filing): filing is Filing => Boolean(filing)),
  };
}

/**
 * Keep an imported Index: its pieces, then the INDEX record. Pieces keep their ids
 * when the same Index is imported again, so filings stay where they were.
 */
export async function saveIndex(dynamo: DynamoDBClient, table: string, tenantId: string, projectId: string, index: IndexImport, pieces: EvidencePiece[]) {
  const pk = projectKey(tenantId, projectId);
  const queue = [...pieces];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let piece = queue.shift(); piece; piece = queue.shift()) {
        await put(dynamo, table, pk, `PIECE#${piece.audit}#${String(piece.order).padStart(4, "0")}`, piece);
      }
    }),
  );
  await put(dynamo, table, pk, "INDEX", index);
}

export async function getFile(dynamo: DynamoDBClient, table: string, tenantId: string, projectId: string, fileId: string): Promise<SubmissionFile | null> {
  const result = await dynamo.send(
    new GetItemCommand({ TableName: table, Key: { pk: { S: projectKey(tenantId, projectId) }, sk: { S: `FILE#${fileId}` } }, ConsistentRead: true }),
  );
  return json<SubmissionFile>(result.Item);
}

export async function saveFile(dynamo: DynamoDBClient, table: string, tenantId: string, projectId: string, file: SubmissionFile) {
  await put(dynamo, table, projectKey(tenantId, projectId), `FILE#${file.id}`, file);
}

export async function saveFiling(dynamo: DynamoDBClient, table: string, tenantId: string, projectId: string, filing: Filing) {
  await put(dynamo, table, projectKey(tenantId, projectId), `FILING#${filing.audit}#${filing.pieceId}`, filing);
}

export function isAudit(value: unknown): value is AuditKey {
  return value === "facility" || value === "output" || value === "combined";
}
