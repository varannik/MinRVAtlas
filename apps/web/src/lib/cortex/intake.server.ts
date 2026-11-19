import "server-only";

import { DynamoDBClient, GetItemCommand, QueryCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { GetObjectTaggingCommand, ListObjectsV2Command, S3Client, type _Object } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";
import { cookies } from "next/headers";

import { SESSION_COOKIE, sessionSecret, unsealSession, type SessionPayload } from "@/lib/auth/session";
import type { CapabilityId } from "./capabilities";
import {
  CORTEX_ID,
  DOCUMENT_PINS,
  MAX_UPLOAD_BYTES,
  SCAN_TAG,
  allowedProjects,
  canUploadAs,
  documentKey,
  documentPrefix,
  documentStatus,
  isSettled,
  safeFileName,
  uploadProblem,
  uploadType,
  type CortexDocument,
} from "./uploads";

/**
 * Cortex document intake for the web app.
 *
 * The web never writes the Cortex buckets with its own role. It checks the
 * user's project grant in the tenancy table, assumes the tenant-session role
 * tagged with the user's tenant and project, and signs with that session, so
 * S3 refuses any key outside them even if this code were wrong.
 */

const REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "eu-west-2";
/** Shorter than the signed session (15 minutes), so a form never outlives its credentials. */
const FORM_SECONDS = 10 * 60;

export interface CortexEnv {
  intakeBucket: string;
  knowledgeBucket: string;
  tenancyTable: string;
  sessionRoleArn: string;
  /** Removal state machine; without it documents can be added but not removed. */
  removalArn?: string;
}

export interface CortexProject {
  id: string;
  name: string;
  registry?: string;
  methodology?: string;
  edition?: string;
}

/** A refusal whose message is safe to show the user. */
export class CortexRefusal extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function cortexEnv(): CortexEnv | null {
  const intakeBucket = process.env.CORTEX_INTAKE_BUCKET?.trim();
  const knowledgeBucket = process.env.CORTEX_KNOWLEDGE_BUCKET?.trim();
  const tenancyTable = process.env.CORTEX_TENANCY_TABLE?.trim();
  const sessionRoleArn = process.env.CORTEX_TENANT_SESSION_ROLE_ARN?.trim();
  if (!intakeBucket || !knowledgeBucket || !tenancyTable || !sessionRoleArn) return null;
  const removalArn = process.env.CORTEX_REMOVAL_STATE_MACHINE_ARN?.trim() || undefined;
  return { intakeBucket, knowledgeBucket, tenancyTable, sessionRoleArn, removalArn };
}

export async function currentSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  return unsealSession(jar.get(SESSION_COOKIE)?.value, sessionSecret());
}

// ── Tenancy ─────────────────────────────────────────────────────────────────

let dynamo: DynamoDBClient | null = null;

function text(item: Record<string, AttributeValue> | undefined, field: string): string | undefined {
  return item?.[field]?.S;
}

async function queryPrefix(env: CortexEnv, pk: string, prefix: string): Promise<Record<string, AttributeValue>[]> {
  dynamo ??= new DynamoDBClient({ region: REGION });
  const items: Record<string, AttributeValue>[] = [];
  let start: Record<string, AttributeValue> | undefined;
  do {
    const page = await dynamo.send(
      new QueryCommand({
        TableName: env.tenancyTable,
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

/** The user's tenant status on Cortex and the projects they may work on. */
export async function projectsFor(
  session: SessionPayload,
  env: CortexEnv,
): Promise<{ tenantStatus: string; projects: CortexProject[] }> {
  if (!CORTEX_ID.test(session.tenantId)) return { tenantStatus: "missing", projects: [] };
  dynamo ??= new DynamoDBClient({ region: REGION });
  const pk = `TENANT#${session.tenantId}`;
  const meta = await dynamo.send(
    new GetItemCommand({ TableName: env.tenancyTable, Key: { pk: { S: pk }, sk: { S: "META" } } }),
  );
  const tenantStatus = text(meta.Item, "status") ?? "missing";
  if (tenantStatus !== "active") return { tenantStatus, projects: [] };

  const [projectItems, memberItems] = await Promise.all([
    queryPrefix(env, pk, "PROJECT#"),
    queryPrefix(env, pk, `MEMBER#${session.sub}#`),
  ]);
  const byId = new Map(
    projectItems.map((item) => {
      const id = (text(item, "sk") ?? "").split("#").slice(1).join("#");
      return [id, item] as const;
    }),
  );
  const members = memberItems.map((item) => (text(item, "sk") ?? "").split("#").pop() ?? "");
  const projects = allowedProjects(session.role, [...byId.keys()], members).map((id) => {
    const item = byId.get(id);
    return {
      id,
      name: text(item, "name") ?? id,
      registry: text(item, "registry"),
      methodology: text(item, "methodology"),
      edition: text(item, "edition"),
    };
  });
  return { tenantStatus, projects };
}

async function requireProject(session: SessionPayload, env: CortexEnv, projectId: string): Promise<CortexProject> {
  if (!CORTEX_ID.test(projectId)) throw new CortexRefusal("Unknown project.", 400);
  const { tenantStatus, projects } = await projectsFor(session, env);
  if (tenantStatus !== "active") throw new CortexRefusal("Your organisation is not active on Cortex.", 403);
  const project = projects.find((item) => item.id === projectId);
  if (!project) throw new CortexRefusal("You have no access to that project.", 403);
  return project;
}

function requirePin(pin: string): CapabilityId {
  if (!DOCUMENT_PINS.has(pin as CapabilityId)) throw new CortexRefusal("This pin does not take documents.", 400);
  return pin as CapabilityId;
}

// ── Tenant-scoped session ───────────────────────────────────────────────────

let sts: STSClient | null = null;
/** Sessions per user and project, reused until shortly before they expire (status polls every few seconds). */
const sessions = new Map<string, { client: S3Client; until: number }>();

/** An S3 client that can reach this tenant's and project's prefixes only. */
async function projectClient(session: SessionPayload, env: CortexEnv, projectId: string): Promise<S3Client> {
  const cacheKey = `${session.sub}|${session.tenantId}|${projectId}`;
  const cached = sessions.get(cacheKey);
  if (cached && cached.until > Date.now()) return cached.client;
  const client = await assumeProjectSession(session, env, projectId);
  for (const [key, entry] of sessions) if (entry.until <= Date.now()) sessions.delete(key);
  // A signed form must stay valid for FORM_SECONDS after it is issued.
  sessions.set(cacheKey, { client, until: Date.now() + (900 - FORM_SECONDS - 60) * 1000 });
  return client;
}

async function assumeProjectSession(session: SessionPayload, env: CortexEnv, projectId: string): Promise<S3Client> {
  sts ??= new STSClient({ region: REGION });
  const { Credentials: creds } = await sts.send(
    new AssumeRoleCommand({
      RoleArn: env.sessionRoleArn,
      // Names the user in CloudTrail for every request signed with this session.
      RoleSessionName: `web-${session.sub}`.replace(/[^\w+=,.@-]/g, "-").slice(0, 64),
      DurationSeconds: 900,
      Tags: [
        { Key: "tenant_id", Value: session.tenantId },
        { Key: "project_id", Value: projectId },
      ],
    }),
  );
  if (!creds?.AccessKeyId || !creds.SecretAccessKey || !creds.SessionToken) {
    throw new CortexRefusal("Cortex could not open a session for this project.", 502);
  }
  return new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: creds.AccessKeyId,
      secretAccessKey: creds.SecretAccessKey,
      sessionToken: creds.SessionToken,
      expiration: creds.Expiration,
    },
  });
}

// ── Uploads ─────────────────────────────────────────────────────────────────

export interface UploadForm {
  url: string;
  fields: Record<string, string>;
  key: string;
  expiresAt: string;
}

/** A signed form for one document: fixed key, type and size range. */
export async function signUpload(
  session: SessionPayload,
  env: CortexEnv,
  input: { projectId: string; pin: string; fileName: string; size: number },
): Promise<UploadForm> {
  if (!canUploadAs(session.role)) throw new CortexRefusal("Your role can read Cortex but not add to it.", 403);
  const pin = requirePin(input.pin);
  const problem = uploadProblem({ name: input.fileName, size: input.size });
  if (problem) throw new CortexRefusal(`${input.fileName}: ${problem}.`, 400);
  await requireProject(session, env, input.projectId);

  const key = documentKey(session.tenantId, input.projectId, pin, input.fileName);
  const contentType = uploadType(key) as string;
  const s3 = await projectClient(session, env, input.projectId);
  // Same name, same pin: this upload replaces that document. Not while it is still
  // being scanned or admitted, or two runs would race for its passages.
  const existing = (await documentsIn(s3, env, documentPrefix(session.tenantId, input.projectId, pin))).find(
    (doc) => doc.key === key,
  );
  if (existing && !isSettled(existing.status)) {
    throw new CortexRefusal(`${existing.name} is still being processed. Replace it once that has finished.`, 409);
  }
  const { url, fields } = await createPresignedPost(s3, {
    Bucket: env.intakeBucket,
    Key: key,
    Fields: { "Content-Type": contentType },
    Conditions: [
      ["content-length-range", 1, MAX_UPLOAD_BYTES],
      ["eq", "$Content-Type", contentType],
    ],
    Expires: FORM_SECONDS,
  });
  return { url, fields, key, expiresAt: new Date(Date.now() + FORM_SECONDS * 1000).toISOString() };
}

// ── What the project has given Cortex ───────────────────────────────────────

async function listAll(s3: S3Client, bucket: string, prefix: string): Promise<_Object[]> {
  const objects: _Object[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    objects.push(...(page.Contents ?? []));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token && objects.length < 1000);
  return objects;
}

async function scanVerdict(s3: S3Client, bucket: string, key: string): Promise<string | null> {
  const tags = await s3.send(new GetObjectTaggingCommand({ Bucket: bucket, Key: key }));
  return tags.TagSet?.find((tag) => tag.Key === SCAN_TAG)?.Value ?? null;
}

/** Documents a project has given one pin, newest first, with how far each has got. */
export async function listDocuments(
  session: SessionPayload,
  env: CortexEnv,
  input: { projectId: string; pin: string },
): Promise<CortexDocument[]> {
  const pin = requirePin(input.pin);
  await requireProject(session, env, input.projectId);
  const s3 = await projectClient(session, env, input.projectId);
  return documentsIn(s3, env, documentPrefix(session.tenantId, input.projectId, pin));
}

async function documentsIn(s3: S3Client, env: CortexEnv, prefix: string): Promise<CortexDocument[]> {
  const [intake, knowledge] = await Promise.all([
    listAll(s3, env.intakeBucket, prefix),
    listAll(s3, env.knowledgeBucket, prefix),
  ]);

  const files = new Map<string, { size: number; intakeAt?: Date; admittedAt?: Date }>();
  for (const object of intake) {
    if (!object.Key) continue;
    files.set(object.Key, { size: object.Size ?? 0, intakeAt: object.LastModified });
  }
  for (const object of knowledge) {
    if (!object.Key || object.Key.endsWith(".metadata.json")) continue;
    const file = files.get(object.Key) ?? { size: object.Size ?? 0 };
    files.set(object.Key, { ...file, admittedAt: object.LastModified });
  }

  const now = new Date();
  const documents = await Promise.all(
    [...files.entries()].map(async ([key, file]) => {
      const waiting = file.intakeAt && (!file.admittedAt || file.admittedAt < file.intakeAt);
      const scan = waiting ? await scanVerdict(s3, env.intakeBucket, key) : null;
      const { status, detail } = documentStatus({ ...file, scan, now });
      return {
        key,
        name: key.slice(prefix.length),
        size: file.size,
        uploadedAt: (file.intakeAt ?? file.admittedAt ?? now).toISOString(),
        status,
        detail,
      } satisfies CortexDocument;
    }),
  );
  return documents.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

// ── Removal ─────────────────────────────────────────────────────────────────

let sfn: SFNClient | null = null;

/**
 * Take one of the project's documents out of Cortex. The removal state machine
 * deletes the original, its passages and parse output, then syncs the index;
 * the original is kept as a deleted (noncurrent) version for audit.
 */
export async function removeDocument(
  session: SessionPayload,
  env: CortexEnv,
  input: { projectId: string; pin: string; name: string },
): Promise<{ key: string }> {
  if (!env.removalArn) throw new CortexRefusal("Removing documents is not set up on this deployment.", 503);
  if (!canUploadAs(session.role)) throw new CortexRefusal("Your role can read Cortex but not change it.", 403);
  const pin = requirePin(input.pin);
  if (!input.name || safeFileName(input.name) !== input.name) throw new CortexRefusal("Unknown document.", 400);
  await requireProject(session, env, input.projectId);

  const prefix = documentPrefix(session.tenantId, input.projectId, pin);
  const key = `${prefix}${input.name}`;
  const s3 = await projectClient(session, env, input.projectId);
  const doc = (await documentsIn(s3, env, prefix)).find((item) => item.key === key);
  if (!doc) throw new CortexRefusal("That document is not in Cortex for this project.", 404);
  if (!isSettled(doc.status)) {
    throw new CortexRefusal(`${doc.name} is still being processed. Remove it once that has finished.`, 409);
  }

  sfn ??= new SFNClient({ region: REGION });
  await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: env.removalArn,
      name: `remove-${crypto.randomUUID()}`,
      input: JSON.stringify({
        key,
        tenant_id: session.tenantId,
        project_id: input.projectId,
        requested_by: session.sub,
      }),
    }),
  );
  return { key };
}

/** A message for an AWS failure that does not leak internals. */
export function describeFailure(error: unknown): { message: string; status: number } {
  if (error instanceof CortexRefusal) return { message: error.message, status: error.status };
  const name = (error as { name?: string })?.name ?? "";
  if (name === "AccessDenied" || name === "AccessDeniedException") {
    return { message: "Cortex refused the request for this project (access denied).", status: 403 };
  }
  if (name === "CredentialsProviderError" || name === "ExpiredToken" || name === "ExpiredTokenException") {
    return { message: "The web app has no AWS credentials for Cortex.", status: 503 };
  }
  return { message: "Cortex could not complete the request.", status: 502 };
}
