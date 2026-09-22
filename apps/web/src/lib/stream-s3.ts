import "server-only";

import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  assertKeyInPrefix,
  dtFromKey,
  sourcePrefix,
} from "@/lib/stream-schema";
import type { Registry } from "@/lib/types";

function client(): S3Client {
  return new S3Client({
    region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "eu-west-2",
  });
}

export function streamBucketName(): string | null {
  const name = process.env.STREAM_S3_BUCKET?.trim();
  return name || null;
}

export function streamConfigured(): boolean {
  return Boolean(streamBucketName());
}

async function bodyText(body: unknown): Promise<string> {
  if (!body || typeof body !== "object") return "";
  const blob = body as { transformToString?: () => Promise<string> };
  if (typeof blob.transformToString === "function") {
    return blob.transformToString();
  }
  return "";
}

export async function listObservationKeys(input: {
  tenantId: string;
  registry: Registry;
  projectId: string;
  from: string;
  to: string;
}): Promise<{ key: string; day: string; size: number }[]> {
  const bucket = streamBucketName();
  if (!bucket) throw new Error("STREAM_S3_BUCKET is not configured");
  const prefix = sourcePrefix(input.tenantId, input.registry, input.projectId);
  const s3 = client();
  const keys: { key: string; day: string; size: number }[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of page.Contents ?? []) {
      const key = obj.Key ?? "";
      if (!key.endsWith("/observations.csv")) continue;
      const day = dtFromKey(key);
      if (!day || day < input.from || day > input.to) continue;
      keys.push({ key, day, size: obj.Size ?? 0 });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  keys.sort((a, b) => a.day.localeCompare(b.day) || a.key.localeCompare(b.key));
  return keys;
}

export async function getObjectText(key: string, prefix: string): Promise<string> {
  assertKeyInPrefix(key, prefix);
  const bucket = streamBucketName();
  if (!bucket) throw new Error("STREAM_S3_BUCKET is not configured");
  const s3 = client();
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return bodyText(result.Body);
}

export async function getPrefixObject(
  tenantId: string,
  registry: Registry,
  projectId: string,
  name: "_schema.json" | "attributes.json",
): Promise<string | null> {
  const prefix = sourcePrefix(tenantId, registry, projectId);
  try {
    return await getObjectText(`${prefix}${name}`, prefix);
  } catch (error) {
    const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (
      err.name === "NoSuchKey" ||
      err.name === "NotFound" ||
      err.$metadata?.httpStatusCode === 404
    ) {
      return null;
    }
    throw error;
  }
}
