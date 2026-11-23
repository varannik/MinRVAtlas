// Loads apps/web/seed into the Atlas table and its assets bucket.
//   npm run seed                      the local containers (ATLAS_*_ENDPOINT set)
//   make seed  (repo root)            an AWS stage's table and bucket (runs this with --target=aws and the stage's names)
// With ATLAS_LOCATIONS_PARAM, map pins a stage saved in SSM before the Atlas are copied into
// the table once; a pin already in the table is never replaced.
// Safe to run again: every item and object is overwritten with the same content.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  CreateTableCommand,
  DescribeTableCommand,
  PutItemCommand,
  ResourceNotFoundException,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

import { atlasConfig, dynamoFor, s3For } from "@/lib/atlas/clients";
import {
  CATALOG_PK,
  SCENARIO_PK,
  SITE_MODEL_CURRENT,
  locationSk,
  projectPk,
  projectSk,
  scenarioSk,
  siteModelVersionSk,
  tenantSk,
} from "@/lib/atlas/keys";
import { parseLocationOverlay } from "@/lib/project-locations";
import type { Project, Tenant } from "@/lib/types";
import type { JourneyScenario } from "@/lib/journey/types";
import { SEED_DIR } from "./layout";

const config = atlasConfig();
if (!config) {
  console.error("Set ATLAS_TABLE and ATLAS_BUCKET (see .env.example).");
  process.exit(1);
}
const local = Boolean(config.dynamoEndpoint && config.s3Endpoint);
if (!local && !process.argv.includes("--target=aws")) {
  console.error(`No local endpoints set, so this would write to AWS (${config.table}, ${config.bucket}). Add --target=aws to do that on purpose.`);
  process.exit(1);
}

const dynamo = dynamoFor(config);
const s3 = s3For(config);

function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(path.join(SEED_DIR, relative), "utf8")) as T;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

const CONTENT_TYPE: Record<string, string> = { ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".glb": "model/gltf-binary", ".ktx2": "image/ktx2" };

async function ensureTable() {
  try {
    await dynamo.send(new DescribeTableCommand({ TableName: config!.table }));
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException) || !local) throw error;
    await dynamo.send(
      new CreateTableCommand({
        TableName: config!.table,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [
          { AttributeName: "pk", AttributeType: "S" },
          { AttributeName: "sk", AttributeType: "S" },
        ],
        KeySchema: [
          { AttributeName: "pk", KeyType: "HASH" },
          { AttributeName: "sk", KeyType: "RANGE" },
        ],
      }),
    );
    await waitUntilTableExists({ client: dynamo, maxWaitTime: 30 }, { TableName: config!.table });
    console.log(`Created table ${config!.table}`);
  }
}

async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config!.bucket }));
  } catch (error) {
    if (!local) throw error;
    await s3.send(new CreateBucketCommand({ Bucket: config!.bucket, CreateBucketConfiguration: { LocationConstraint: config!.region as never } }));
    console.log(`Created bucket ${config!.bucket}`);
  }
}

async function put(pk: string, sk: string, doc: unknown) {
  await dynamo.send(
    new PutItemCommand({
      TableName: config!.table,
      Item: { pk: { S: pk }, sk: { S: sk }, doc: { S: JSON.stringify(doc) }, updatedAt: { S: new Date().toISOString() } },
    }),
  );
}

async function upload(key: string, file: string) {
  await s3.send(
    new PutObjectCommand({
      Bucket: config!.bucket,
      Key: key,
      Body: readFileSync(file),
      ContentType: CONTENT_TYPE[path.extname(file)] ?? "application/octet-stream",
    }),
  );
}

await ensureTable();
await ensureBucket();

const tenants = readJson<Tenant[]>("catalog/tenants.json");
for (const tenant of tenants) await put(CATALOG_PK, tenantSk(tenant.id), tenant);

const projects = readJson<Project[]>("catalog/projects.json");
for (const project of projects) await put(CATALOG_PK, projectSk(project.tenantId, project.id), project);

const scenarios = readJson<JourneyScenario[]>("journey/scenarios.json");
for (const scenario of scenarios) await put(SCENARIO_PK, scenarioSk(scenario.id), scenario);

// Every file under site-models/ and mrv/ goes to the bucket at the same path.
let objects = 0;
for (const root of ["site-models", "mrv"]) {
  for (const file of files(path.join(SEED_DIR, root))) {
    await upload(path.relative(SEED_DIR, file).split(path.sep).join("/"), file);
    objects += 1;
  }
}

// Each site model's manifest becomes the project's current model, and a kept version.
let models = 0;
for (const manifestFile of files(path.join(SEED_DIR, "site-models")).filter((file) => file.endsWith("manifest.json"))) {
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { projectId: string; version: number };
  const prefix = path.relative(SEED_DIR, path.dirname(manifestFile)).split(path.sep).join("/");
  const doc = { ...manifest, prefix };
  await put(projectPk(manifest.projectId), siteModelVersionSk(manifest.version), doc);
  await put(projectPk(manifest.projectId), SITE_MODEL_CURRENT, doc);
  models += 1;
}

/** Pins saved before the Atlas, from the stage's SSM parameter: added where the table has none. */
async function copySavedPins(parameter: string): Promise<string> {
  let raw: string | undefined;
  try {
    const found = await new SSMClient({ region: config!.region }).send(new GetParameterCommand({ Name: parameter }));
    raw = found.Parameter?.Value;
  } catch (error) {
    const name = (error as Error).name;
    if (name === "ParameterNotFound") return "no map pins were saved before the Atlas";
    if (name === "AccessDeniedException") return `map pins not copied: no permission to read ${parameter} (ssm:GetParameter)`;
    throw error;
  }
  let overlay;
  try {
    overlay = parseLocationOverlay(JSON.parse(raw ?? "{}") as unknown);
  } catch {
    return `map pins not copied: ${parameter} is not JSON`;
  }
  let copied = 0;
  let kept = 0;
  for (const [projectId, location] of Object.entries(overlay)) {
    try {
      await dynamo.send(
        new PutItemCommand({
          TableName: config!.table,
          Item: {
            pk: { S: CATALOG_PK },
            sk: { S: locationSk(projectId) },
            doc: { S: JSON.stringify(location) },
            version: { N: "1" },
            updatedAt: { S: new Date().toISOString() },
          },
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
      copied += 1;
    } catch (error) {
      if ((error as Error).name !== "ConditionalCheckFailedException") throw error;
      kept += 1;
    }
  }
  return `${copied} saved map pin(s) copied${kept ? `, ${kept} already in the table kept` : ""}`;
}

const pinsParameter = process.env.ATLAS_LOCATIONS_PARAM?.trim();
const pins = pinsParameter && !local ? `; ${await copySavedPins(pinsParameter)}` : "";

console.log(
  `Seeded ${config.table} and ${config.bucket}${local ? " (local)" : ""}: ${tenants.length} tenants, ${projects.length} projects, ${scenarios.length} scenarios, ${models} site model(s), ${objects} objects${pins}.`,
);
