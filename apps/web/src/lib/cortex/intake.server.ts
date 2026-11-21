import "server-only";

import { DynamoDBClient, GetItemCommand, QueryCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { createHash } from "node:crypto";

import {
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type _Object,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";
import { cookies } from "next/headers";

import { SESSION_COOKIE, sessionSecret, unsealSession, type SessionPayload } from "@/lib/auth/session";
import { CAPABILITY_BY_ID, type CapabilityId } from "./capabilities";
import {
  CORTEX_ID,
  DOCUMENT_PINS,
  MAX_UPLOAD_BYTES,
  ORGANISATION_PINS,
  SCAN_TAG,
  allowedProjects,
  canShareAcrossOrganisation,
  canUploadAs,
  documentKey,
  documentPlace,
  documentStatus,
  isHeld,
  isSettled,
  isSha256,
  parseLabel,
  pinAndName,
  safeFileName,
  scopePrefix,
  searchesShared,
  sharedPlace,
  uploadProblem,
  uploadType,
  withLabel,
  type CortexDocument,
  type DocumentLabel,
  type DocumentScope,
  type KnowledgeDocument,
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
  /** Rule passages and labels; without it the knowledge list shows neither passage counts nor labels. */
  parsedBucket?: string;
  /** Decisions on labelled documents (keep a held one, keep one where it is). */
  reviewArn?: string;
  /** Moves to another pin, or to or from every project. */
  moveArn?: string;
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
  const parsedBucket = process.env.CORTEX_PARSED_BUCKET?.trim() || undefined;
  const reviewArn = process.env.CORTEX_REVIEW_STATE_MACHINE_ARN?.trim() || undefined;
  const moveArn = process.env.CORTEX_MOVE_STATE_MACHINE_ARN?.trim() || undefined;
  return { intakeBucket, knowledgeBucket, tenancyTable, sessionRoleArn, removalArn, parsedBucket, reviewArn, moveArn };
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

export async function requireProject(session: SessionPayload, env: CortexEnv, projectId: string): Promise<CortexProject> {
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

/** Organisation-wide documents: method and rule pins only, changed by admins only. */
function requireScope(session: SessionPayload, scope: DocumentScope, pin: CapabilityId, changing: boolean): void {
  if (scope !== "tenant") return;
  if (!ORGANISATION_PINS.has(pin)) throw new CortexRefusal("This pin only takes project documents.", 400);
  if (changing && !canShareAcrossOrganisation(session.role)) {
    throw new CortexRefusal("Only organisation admins add or remove documents for every project.", 403);
  }
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
  input: { projectId: string; pin: string; fileName: string; size: number; sha256: string; scope?: DocumentScope },
): Promise<UploadForm> {
  if (!canUploadAs(session.role)) throw new CortexRefusal("Your role can read Cortex but not add to it.", 403);
  const pin = requirePin(input.pin);
  const scope = input.scope ?? "project";
  requireScope(session, scope, pin, true);
  const problem = uploadProblem({ name: input.fileName, size: input.size });
  if (problem) throw new CortexRefusal(`${input.fileName}: ${problem}.`, 400);
  if (!isSha256(input.sha256)) throw new CortexRefusal("The file's fingerprint is missing. Reload the page and try again.", 400);
  // An organisation document is signed with the session of a project the user holds:
  // that session may also write the tenant's own prefix, and nothing else.
  const project = await requireProject(session, env, input.projectId);

  const key = documentKey(session.tenantId, input.projectId, pin, input.fileName, scope);
  const contentType = uploadType(key) as string;
  const s3 = await projectClient(session, env, input.projectId);
  // Same name, same pin: this upload replaces that document. Not while it is still
  // being scanned or admitted, or two runs would race for its passages.
  const existing = (await documentsIn(s3, env, scopePrefix(scope, session.tenantId, input.projectId, pin))).find(
    (doc) => doc.key === key,
  );
  if (existing && !isSettled(existing.status)) {
    throw new CortexRefusal(`${existing.name} is still being processed. Replace it once that has finished.`, 409);
  }
  await refuseDuplicate(session, env, s3, project, { scope, fileName: input.fileName, sha256: input.sha256 });
  const { url, fields } = await createPresignedPost(s3, {
    Bucket: env.intakeBucket,
    Key: key,
    // S3 refuses the file unless its SHA-256 is this one, and keeps it with the
    // object (as a checksum and as metadata that admission copies along).
    Fields: {
      "Content-Type": contentType,
      "x-amz-checksum-algorithm": "SHA256",
      "x-amz-checksum-sha256": input.sha256,
      "x-amz-meta-sha256": input.sha256,
    },
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
  input: { projectId: string; pin: string; scope?: DocumentScope },
): Promise<CortexDocument[]> {
  const pin = requirePin(input.pin);
  const scope = input.scope ?? "project";
  requireScope(session, scope, pin, false);
  await requireProject(session, env, input.projectId);
  const s3 = await projectClient(session, env, input.projectId);
  return documentsIn(s3, env, scopePrefix(scope, session.tenantId, input.projectId, pin), { labelled: true });
}

// ── Labels ──────────────────────────────────────────────────────────────────

/** Label files already read, by key and ETag: lists poll every few seconds and labels rarely change. */
const labelCache = new Map<string, DocumentLabel | null>();

/**
 * Labels of the documents under a prefix, by document key. Listing first means a
 * missing label is simply absent (a GET of a missing key is refused, not "not found",
 * without list access). Null when this session cannot read labels yet.
 */
async function labelsUnder(s3: S3Client, env: CortexEnv, prefix: string): Promise<Map<string, DocumentLabel> | null> {
  if (!env.parsedBucket) return null;
  const bucket = env.parsedBucket;
  let objects: _Object[];
  try {
    objects = await listAll(s3, bucket, `labels/${prefix}`);
  } catch (error) {
    if (isDenied(error)) return null;
    throw error;
  }
  const found = new Map<string, DocumentLabel>();
  await Promise.all(
    objects.map(async (object) => {
      if (!object.Key?.endsWith(".json")) return;
      const cacheKey = `${object.Key}@${object.ETag ?? ""}`;
      let label = labelCache.get(cacheKey);
      if (label === undefined) {
        try {
          const body = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: object.Key }));
          label = parseLabel(JSON.parse((await body.Body?.transformToString()) ?? "null"));
        } catch (error) {
          if (!isDenied(error) && !(error instanceof SyntaxError)) throw error;
          label = null;
        }
        if (labelCache.size > 5000) labelCache.clear();
        labelCache.set(cacheKey, label);
      }
      if (label) found.set(object.Key.slice("labels/".length, -".json".length), label);
    }),
  );
  return found;
}

async function documentsIn(
  s3: S3Client,
  env: CortexEnv,
  prefix: string,
  options: { labelled?: boolean } = {},
): Promise<CortexDocument[]> {
  const [intake, knowledge, labels] = await Promise.all([
    listAll(s3, env.intakeBucket, prefix),
    listAll(s3, env.knowledgeBucket, prefix),
    options.labelled ? labelsUnder(s3, env, prefix) : Promise.resolve(null),
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
      const { status, detail, label } = withLabel(
        documentStatus({ ...file, scan, now }),
        labels?.get(key) ?? null,
        file.admittedAt,
      );
      return {
        key,
        name: key.slice(prefix.length),
        size: file.size,
        uploadedAt: (file.intakeAt ?? file.admittedAt ?? now).toISOString(),
        status,
        detail,
        label,
      } satisfies CortexDocument;
    }),
  );
  return documents.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

// ── Everything a project searches ───────────────────────────────────────────

export interface ProjectKnowledge {
  documents: KnowledgeDocument[];
  /** Parts that could not be read with this session ("registry", "passages"); the rest is still listed. */
  gaps: string[];
}

function isDenied(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? "";
  return name === "AccessDenied" || name === "AccessDeniedException" || name === "Forbidden";
}

/** Registry documents the project's searches include (same rule as the search filter). */
async function sharedDocuments(s3: S3Client, env: CortexEnv, project: CortexProject): Promise<KnowledgeDocument[]> {
  const [objects, labels] = await Promise.all([listAll(s3, env.knowledgeBucket, "shared/"), labelsUnder(s3, env, "shared/")]);
  const documents: KnowledgeDocument[] = [];
  for (const object of objects) {
    if (!object.Key || object.Key.endsWith(".metadata.json")) continue;
    const place = sharedPlace(object.Key);
    if (!place || !searchesShared(project, place)) continue;
    documents.push({
      key: object.Key,
      name: place.name,
      scope: "shared",
      pin: null,
      size: object.Size ?? 0,
      uploadedAt: (object.LastModified ?? new Date()).toISOString(),
      status: "in_cortex",
      detail: "Registry document. Every organisation's projects on this methodology search it.",
      label: labels?.get(object.Key) ?? null,
      passages: null,
      registry: place.registry,
      methodology: place.methodology,
      edition: place.edition,
    });
  }
  return documents;
}

/** How many rule passages the chunk step wrote for a document (one file each, plus its metadata file). */
async function passageCount(s3: S3Client, bucket: string, key: string): Promise<number> {
  let count = 0;
  let token: string | undefined;
  let pages = 0;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: `chunks/${key}/`, ContinuationToken: token }),
    );
    count += (page.Contents ?? []).filter((object) => !object.Key?.endsWith(".metadata.json")).length;
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
    pages += 1;
  } while (token && pages < 20);
  return count;
}

/** Every document a project's searches read, without passage counts. */
async function searchedDocuments(
  session: SessionPayload,
  env: CortexEnv,
  s3: S3Client,
  project: CortexProject,
  gaps: Set<string>,
  options: { labelled?: boolean } = {},
): Promise<KnowledgeDocument[]> {
  const projectPrefix = `tenants/${session.tenantId}/projects/${project.id}/`;
  const organisationPrefix = `tenants/${session.tenantId}/tenant/`;
  const [own, organisation, shared] = await Promise.all([
    documentsIn(s3, env, projectPrefix, options),
    documentsIn(s3, env, organisationPrefix, options),
    sharedDocuments(s3, env, project).catch((error: unknown) => {
      if (!isDenied(error)) throw error;
      gaps.add("registry");
      return [] as KnowledgeDocument[];
    }),
  ]);
  const scoped = (docs: CortexDocument[], scope: DocumentScope, prefix: string): KnowledgeDocument[] =>
    docs.map((doc) => ({ ...doc, ...pinAndName(doc.key.slice(prefix.length)), scope, passages: null }));
  return [...shared, ...scoped(organisation, "tenant", organisationPrefix), ...scoped(own, "project", projectPrefix)];
}

/**
 * Every document a project's searches read: registry documents for its methodology
 * and edition, the organisation's documents and the project's own, across all pins.
 */
export async function projectKnowledge(
  session: SessionPayload,
  env: CortexEnv,
  projectId: string,
): Promise<ProjectKnowledge> {
  const project = await requireProject(session, env, projectId);
  const s3 = await projectClient(session, env, projectId);
  const gaps = new Set<string>();
  const documents = await searchedDocuments(session, env, s3, project, gaps, { labelled: true });

  if (env.parsedBucket) {
    const bucket = env.parsedBucket;
    await Promise.all(
      documents
        .filter((doc) => doc.status === "in_cortex")
        .map(async (doc) => {
          try {
            doc.passages = await passageCount(s3, bucket, doc.key);
          } catch (error) {
            if (!isDenied(error)) throw error;
            gaps.add("passages");
          }
        }),
    );
  }
  return { documents, gaps: [...gaps] };
}

// ── Duplicates ──────────────────────────────────────────────────────────────

/** Content fingerprints of documents uploaded before fingerprints were kept, by bucket/key/ETag. */
const computed = new Map<string, string>();

/**
 * A document's SHA-256 (base64). Uploads carry it as x-amz-meta-sha256, which S3 checked
 * against the file and admission copies along; older documents are read and hashed once.
 */
async function fingerprintOf(s3: S3Client, env: CortexEnv, doc: KnowledgeDocument): Promise<string | null> {
  const bucket = doc.status === "in_cortex" || doc.scope === "shared" ? env.knowledgeBucket : env.intakeBucket;
  const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: doc.key }));
  const stored = head.Metadata?.sha256;
  if (isSha256(stored)) return stored;
  const cacheKey = `${bucket}/${doc.key}@${head.ETag ?? ""}`;
  const known = computed.get(cacheKey);
  if (known) return known;
  const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: doc.key }));
  const body = object.Body as AsyncIterable<Uint8Array> | undefined;
  if (!body) return null;
  const hash = createHash("sha256");
  for await (const chunk of body) hash.update(chunk);
  const digest = hash.digest("base64");
  if (computed.size > 2000) computed.clear();
  computed.set(cacheKey, digest);
  return digest;
}

/**
 * Refuse a file whose exact content the project already searches. A project upload is
 * checked against the project (every pin), its organisation and the registry; an
 * organisation upload against the organisation and the registry, so a document can
 * move up from one project to every project.
 */
async function refuseDuplicate(
  session: SessionPayload,
  env: CortexEnv,
  s3: S3Client,
  project: CortexProject,
  input: { scope: DocumentScope; fileName: string; sha256: string },
): Promise<void> {
  const documents = await searchedDocuments(session, env, s3, project, new Set());
  const candidates = documents.filter(
    (doc) => doc.status !== "rejected" && (input.scope === "project" || doc.scope !== "project"),
  );
  const fingerprints = await Promise.all(
    candidates.map((doc) =>
      fingerprintOf(s3, env, doc).catch((error: unknown) => {
        if (isDenied(error)) return null; // cannot read it with this session: do not block on it
        throw error;
      }),
    ),
  );
  const match = candidates.find((_, index) => fingerprints[index] === input.sha256);
  if (match) {
    throw new CortexRefusal(
      `${input.fileName} is already in Cortex as ${match.name}, in ${documentPlace(match, project.name)}. ` +
        "Cortex searches it from there, so it was not added again.",
      409,
    );
  }
}

// ── Removal, decisions and moves ────────────────────────────────────────────

let sfn: SFNClient | null = null;

interface DocumentRequest {
  projectId: string;
  pin: string;
  name: string;
  scope?: DocumentScope;
}

/**
 * One settled document the user may change: their role adds to Cortex, an organisation
 * document needs an admin, and nothing still being scanned or admitted.
 */
async function changeableDocument(
  session: SessionPayload,
  env: CortexEnv,
  input: DocumentRequest,
  verb: string,
): Promise<{ key: string; doc: CortexDocument; scope: DocumentScope; pin: CapabilityId; project: CortexProject }> {
  if (!canUploadAs(session.role)) throw new CortexRefusal("Your role can read Cortex but not change it.", 403);
  const pin = requirePin(input.pin);
  const scope = input.scope ?? "project";
  requireScope(session, scope, pin, true);
  if (!input.name || safeFileName(input.name) !== input.name) throw new CortexRefusal("Unknown document.", 400);
  const project = await requireProject(session, env, input.projectId);

  const prefix = scopePrefix(scope, session.tenantId, input.projectId, pin);
  const key = `${prefix}${input.name}`;
  const s3 = await projectClient(session, env, input.projectId);
  const doc = (await documentsIn(s3, env, prefix, { labelled: true })).find((item) => item.key === key);
  if (!doc) {
    throw new CortexRefusal(`That document is not in Cortex for ${scope === "tenant" ? "your organisation" : "this project"}.`, 404);
  }
  if (!isSettled(doc.status)) {
    throw new CortexRefusal(`${doc.name} is still being processed. ${verb} it once that has finished.`, 409);
  }
  return { key, doc, scope, pin, project };
}

async function start(arn: string, kind: string, input: Record<string, unknown>): Promise<void> {
  sfn ??= new SFNClient({ region: REGION });
  await sfn.send(
    new StartExecutionCommand({ stateMachineArn: arn, name: `${kind}-${crypto.randomUUID()}`, input: JSON.stringify(input) }),
  );
}

/**
 * Take one of the project's documents out of Cortex. The removal state machine
 * deletes the original, its passages, label and parse output, then syncs the index;
 * the original is kept as a deleted (noncurrent) version for audit.
 */
export async function removeDocument(session: SessionPayload, env: CortexEnv, input: DocumentRequest): Promise<{ key: string }> {
  if (!env.removalArn) throw new CortexRefusal("Removing documents is not set up on this deployment.", 503);
  const { key } = await changeableDocument(session, env, input, "Remove");
  await start(env.removalArn, "remove", {
    key,
    tenant_id: session.tenantId,
    project_id: input.projectId,
    requested_by: session.sub,
  });
  return { key };
}

/**
 * A person's decision on what Cortex made of a document:
 *   keep  search a held document after all (not MRV material, or a copy, by Cortex's label);
 *   stay  keep it where it is, although Cortex suggested another place.
 */
export async function decideOnDocument(
  session: SessionPayload,
  env: CortexEnv,
  input: DocumentRequest & { action: "keep" | "stay" },
): Promise<{ key: string }> {
  if (!env.reviewArn) throw new CortexRefusal("Deciding on Cortex's labels is not set up on this deployment.", 503);
  const { key, doc } = await changeableDocument(session, env, input, "Decide on");
  if (!doc.label?.checked) throw new CortexRefusal(`Cortex has not labelled ${doc.name}.`, 409);
  if (input.action === "keep" && !isHeld(doc.label)) {
    throw new CortexRefusal(`${doc.name} is already searched.`, 409);
  }
  await start(env.reviewArn, input.action, {
    key,
    action: input.action,
    tenant_id: session.tenantId,
    project_id: input.projectId,
    requested_by: session.sub,
  });
  return { key };
}

/**
 * Move a document to another pin of the project, or give it to (or take it back from)
 * every project. The move state machine copies it into intake at the new place, where
 * it is scanned, admitted, parsed and labelled again, and removes it from the old one.
 */
export async function moveDocument(
  session: SessionPayload,
  env: CortexEnv,
  input: DocumentRequest & { toPin: string; toScope: DocumentScope },
): Promise<{ key: string; toKey: string }> {
  if (!env.moveArn) throw new CortexRefusal("Moving documents is not set up on this deployment.", 503);
  const { key, doc } = await changeableDocument(session, env, input, "Move");
  if (isHeld(doc.label)) {
    throw new CortexRefusal(`${doc.name} is held out of search. Keep it in Cortex or remove it before moving it.`, 409);
  }
  const toPin = requirePin(input.toPin);
  requireScope(session, input.toScope, toPin, true);
  const toPrefix = scopePrefix(input.toScope, session.tenantId, input.projectId, toPin);
  const toKey = `${toPrefix}${doc.name}`;
  if (toKey === key) throw new CortexRefusal(`${doc.name} is already there.`, 400);
  const s3 = await projectClient(session, env, input.projectId);
  if ((await documentsIn(s3, env, toPrefix)).some((item) => item.key === toKey)) {
    const owner = input.toScope === "tenant" ? "for every project" : "on this project";
    throw new CortexRefusal(
      `There is already a document named ${doc.name} on the ${CAPABILITY_BY_ID[toPin].name} pin ${owner}. Remove one of them first.`,
      409,
    );
  }
  await start(env.moveArn, "move", {
    key,
    to_key: toKey,
    tenant_id: session.tenantId,
    project_id: input.projectId,
    requested_by: session.sub,
  });
  return { key, toKey };
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
