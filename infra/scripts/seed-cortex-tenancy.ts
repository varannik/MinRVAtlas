/**
 * Seed the Cortex tenancy table: tenants, their projects, and optional member grants.
 *
 *   make seed-cortex
 *   MEMBER_EMAIL=someone@4401.earth MEMBER_ROLE=quality_engineer make seed-cortex
 *
 * Items (read by lib/cortex/lambda/tenancy.py):
 *   TENANT#<tenant>  META                    status, name, isolation
 *   TENANT#<tenant>  PROJECT#<project>       name, registry, methodology, edition
 *   TENANT#<tenant>  MEMBER#<sub>#<project>  role
 *
 * platform_admin and tenant_admin see every project in their tenant without a
 * member item. Other roles need one per project: set MEMBER_EMAIL (and
 * MEMBER_PROJECT to limit it to one project). Re-running writes the same
 * items again, so it is safe to repeat.
 *
 * A project's registry, methodology and edition are slugs. Knowledge search
 * narrows shared documents to the project's registry, methodology and edition,
 * so shared documents for a project must be uploaded under
 *   shared/<registry>/<methodology>/<edition>/<file>
 * with exactly these values, or "any" in a place that applies to all of them
 * (shared/puro/any/any/ for every Puro project, shared/any/any/any/ for every
 * project). See key_scope and retrieval_filter in lib/cortex/lambda/access.py.
 */
import { REGION, TENANT_ID_PATTERN } from "../lib/config";
import { COGNITO_GROUPS } from "../lib/identity-stack";
import { awsJson, runWithRetry } from "./aws";
import { assertAccount, requireOutput, stackOutputs, stageFromApp } from "./cortex-common";

interface ProjectSeed {
  id: string;
  name: string;
  registry: string;
  methodology: string;
  edition: string;
}

interface TenantSeed {
  id: string;
  name: string;
  /** "shared": one knowledge index with a tenant filter (blueprint default). */
  isolation: "shared" | "dedicated";
  projects: ProjectSeed[];
}

// Ids match apps/web/src/lib/projects.ts, so the app and Cortex name projects the same way.
const TENANTS: TenantSeed[] = [
  {
    id: "fourfourone",
    name: "44.01",
    isolation: "shared",
    projects: [
      {
        id: "fujairah-mineral",
        name: "Fujairah Peridotite Mineralisation",
        registry: "puro",
        methodology: "puro-geologically-stored-carbon",
        edition: "2024-v5",
      },
    ],
  },
];

const ID = new RegExp(TENANT_ID_PATTERN);

function checkId(kind: string, value: string): void {
  if (!ID.test(value)) {
    throw new Error(`${kind} "${value}" must match ${TENANT_ID_PATTERN} (lowercase letters, digits, hyphens).`);
  }
}

function checkSlug(kind: string, value: string): void {
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(value)) {
    throw new Error(`${kind} "${value}" must be a lowercase slug: it becomes part of an S3 key.`);
  }
}

type Item = Record<string, { S: string }>;

function item(fields: Record<string, string>): Item {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { S: value }]));
}

async function put(table: string, fields: Record<string, string>): Promise<void> {
  const result = await runWithRetry(
    "aws",
    ["dynamodb", "put-item", "--region", REGION, "--table-name", table, "--item", JSON.stringify(item(fields))],
    { label: `put ${fields.pk} ${fields.sk}`, attempts: 4 },
  );
  if (result.code !== 0) {
    const blob = `${result.stdout}\n${result.stderr}`;
    const hint = /AccessDenied|not authorized/i.test(blob)
      ? "\nYour AWS user needs dynamodb:PutItem on this table and kms:GenerateDataKey/Decrypt on the stage key."
      : "";
    throw new Error(`put-item ${fields.pk} ${fields.sk} failed: ${blob.slice(0, 600)}${hint}`);
  }
  console.log(`  wrote ${fields.pk}  ${fields.sk}`);
}

/** Cognito sub and tenant of a user, by email (the pool's username). */
async function memberOf(userPoolId: string, email: string): Promise<{ sub: string; tenant: string }> {
  const user = await awsJson<{ UserAttributes?: Array<{ Name: string; Value: string }> }>([
    "cognito-idp",
    "admin-get-user",
    "--region",
    REGION,
    "--user-pool-id",
    userPoolId,
    "--username",
    email,
  ]);
  const attrs = Object.fromEntries((user?.UserAttributes ?? []).map((a) => [a.Name, a.Value]));
  if (!attrs.sub) throw new Error(`No Cognito user ${email}.`);
  return { sub: attrs.sub, tenant: attrs["custom:tenant_id"] ?? "" };
}

async function main(): Promise<void> {
  await assertAccount();
  const stage = stageFromApp();
  const core = await stackOutputs(stage, "cortex-core");
  const table = requireOutput(core, "TenancyTableName", "cortex-core");
  console.log(`Seeding ${table} (${stage})`);

  for (const tenant of TENANTS) {
    checkId("Tenant id", tenant.id);
    const pk = `TENANT#${tenant.id}`;
    await put(table, { pk, sk: "META", status: "active", name: tenant.name, isolation: tenant.isolation });
    for (const project of tenant.projects) {
      checkId("Project id", project.id);
      checkSlug("Registry", project.registry);
      checkSlug("Methodology", project.methodology);
      checkSlug("Edition", project.edition);
      await put(table, {
        pk,
        sk: `PROJECT#${project.id}`,
        name: project.name,
        registry: project.registry,
        methodology: project.methodology,
        edition: project.edition,
      });
    }
  }

  const memberEmail = (process.env.MEMBER_EMAIL ?? "").trim().toLowerCase();
  if (!memberEmail) {
    console.log(
      "No MEMBER_EMAIL: only platform_admin and tenant_admin users see these projects. " +
        "Set MEMBER_EMAIL (and MEMBER_ROLE, MEMBER_PROJECT) to grant another user.",
    );
    return;
  }

  const role = (process.env.MEMBER_ROLE ?? "quality_engineer").trim();
  if (!(COGNITO_GROUPS as readonly string[]).includes(role)) {
    throw new Error(`MEMBER_ROLE must be one of: ${COGNITO_GROUPS.join(", ")}`);
  }
  const identity = await stackOutputs(stage, "identity");
  const member = await memberOf(requireOutput(identity, "UserPoolId", "identity"), memberEmail);
  const tenant = TENANTS.find((t) => t.id === member.tenant);
  if (!tenant) {
    throw new Error(
      `${memberEmail} has custom:tenant_id "${member.tenant || "(none)"}", which is not a seeded tenant. ` +
        "Grants only work inside the user's own tenant.",
    );
  }
  const only = (process.env.MEMBER_PROJECT ?? "").trim();
  const projects = only ? tenant.projects.filter((p) => p.id === only) : tenant.projects;
  if (projects.length === 0) throw new Error(`Tenant ${tenant.id} has no project "${only}".`);
  for (const project of projects) {
    await put(table, { pk: `TENANT#${tenant.id}`, sk: `MEMBER#${member.sub}#${project.id}`, role });
  }
  console.log(
    `Granted ${memberEmail} (${role}) on ${projects.map((p) => p.id).join(", ")}. ` +
      "The tool's role still comes from the user's Cognito group; this item only grants the project.",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
