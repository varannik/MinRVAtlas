/**
 * Seed the stream bucket with mock timeseries for an **existing** project id.
 *
 * IDs only — not display names:
 *   STREAM_TENANT_ID     fourfourone | verdant | helios | terrafix
 *   STREAM_REGISTRY_ID   isometric | puro | verra | gold-standard
 *   STREAM_PROJECT_ID    catalog id, or live Isometric Certify `prj_…`
 *
 * From the repo root (do not use -C infra if you already cd'd into infra/):
 *
 *   STREAM_TENANT_ID=fourfourone STREAM_REGISTRY_ID=isometric STREAM_PROJECT_ID=prj_… \
 *     make seed-stream-s3
 *
 * From infra/:
 *   make seed-stream-s3
 *
 * Aliases STREAM_TENANT / STREAM_REGISTRY / STREAM_PROJECT still work (must be ids).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { ACCOUNT, REGION, cfnStackName, type StageName } from "../lib/config";
import { awsJson, runWithRetry } from "./aws";

const HEALTHY = new Set(["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"]);
const ROOT = path.resolve(__dirname, "../..");

const SLUG_TO_REGISTRY: Record<string, string> = {
  isometric: "Isometric",
  puro: "Puro.earth",
  verra: "Verra VCS",
  "gold-standard": "Gold Standard",
};

const GHG_ACCOUNTING_HEADERS = [
  "FEEDSTOCK_MASS_t",
  "MINING_EQUIPMENT_ENERGY_kWh_per_kg",
  "PRIMARY_CRUSHER_ENERGY_kWh_per_kg",
  "HANDLING_EQUIPMENT_ENERGY_kWh_per_kg",
  "GRID_EMISSION_FACTOR_kg_per_kWh",
  "NATURAL_GAS_EF_kg_per_m3",
  "DIESEL_EF_kg_per_L",
  "TRUCK_EF_kg_per_tkm",
  "HANDLING_NG_m3_per_kg",
  "HANDLING_DIESEL_L_per_kg",
  "LOADER_DIESEL_L_per_kg",
  "DRYING_ELECTRICITY_kWh",
  "LAB_ELECTRICITY_kWh",
  "TRUCK_DISTANCE_km",
  "CHAR_DISTANCE_km",
  "STAFF_DISTANCE_km",
  "SPREADING_DIESEL_L",
  "TILLING_DIESEL_L",
  "SAMPLING_MASS_kg",
];

const OPERATOR_TO_METRIC: Record<string, string> = {
  TIMESTAMP_UTC: "timestamp_utc",
  STATE: "operational_state",
  BATCH_ID: "batch_id",
  WELLHEAD_PRESSURE: "WHP_WELL_A_bar",
  WELLHEAD_PRESSURE_B: "WHP_WELL_B_bar",
  ANNULUS_PRESSURE: "ANNULUS_PRESS_bar",
  INJECTION_RATE: "INJ_RATE_FT01_m3h",
  INJ_RATE_2: "INJ_RATE_FT02_m3h",
  CO2_TOTALIZER: "CO2_TOTAL_SENSOR_m3",
  CO2_TOTAL_CALC: "CO2_TOTAL_CALC_m3",
  TEMP_SURF: "TEMP_SURF_01_degC",
  TEMP_SURF_02: "TEMP_SURF_02_degC",
  CO2_TRACER: "CO2_TRACER_01_ppm",
  WATER_FLOW: "WATER_FLOW_m3h",
  ENERGY_PER_TONNE: "ENERGY_PER_TONNE_kWht",
  INGESTION_LATENCY: "INGESTION_LATENCY_sec",
};

const INSITU_SERIES = [
  "WHP_WELL_A_bar",
  "WHP_WELL_B_bar",
  "ANNULUS_PRESS_bar",
  "INJ_RATE_FT01_m3h",
  "INJ_RATE_FT02_m3h",
  "CO2_TOTAL_SENSOR_m3",
  "CO2_TOTAL_CALC_m3",
  "TEMP_SURF_01_degC",
  "TEMP_SURF_02_degC",
  "CO2_TRACER_01_ppm",
  "WATER_FLOW_m3h",
  "ENERGY_PER_TONNE_kWht",
  "INGESTION_LATENCY_sec",
];

type CatalogProject = {
  id: string;
  tenantId: string;
  name: string;
  registry: string;
  methodologyKey: string;
  origin?: "catalog" | "isometric";
  externalProjectId?: string;
};

type CertifyNode = {
  id: string;
  name: string;
  country_code?: string;
  description?: string | null;
  short_description?: string | null;
};

const LIVE_ISOMETRIC_TENANT = "fourfourone";

type CfnStack = {
  StackStatus?: string;
  Outputs?: Array<{ OutputKey?: string; OutputValue?: string }>;
};

function stageFromApp(): StageName {
  const app = process.env.APP ?? "minrv-ew2-sandbox";
  if (app.endsWith("-prod") || app === "prod") return "prod";
  return "sandbox";
}

function parseQuoted(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

function envId(...keys: string[]): string {
  for (const key of keys) {
    const value = (process.env[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function loadTenants(): { id: string; name: string }[] {
  const src = fs.readFileSync(path.join(ROOT, "apps/web/src/lib/tenants.ts"), "utf8");
  const ids = [...src.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
  const names = [...src.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);
  return ids.map((id, i) => ({ id, name: names[i] ?? id }));
}

function parseTenantId(raw: string, tenants: { id: string; name: string }[]): string {
  const value = raw.trim();
  const byId = tenants.find((row) => row.id === value);
  if (byId) return byId.id;
  const byName = tenants.find((row) => row.name.toLowerCase() === value.toLowerCase());
  if (byName) {
    throw new Error(`STREAM_TENANT_ID must be the tenant id "${byName.id}", not the name "${byName.name}"`);
  }
  throw new Error(`Unknown tenant id ${value}. Valid ids: ${tenants.map((row) => row.id).join(", ")}`);
}

function parseRegistryId(raw: string): string {
  const value = raw.trim();
  const named = Object.entries(SLUG_TO_REGISTRY).find(([, name]) => name === value);
  if (named) {
    throw new Error(
      `STREAM_REGISTRY_ID must be the registry id "${named[0]}", not the name "${named[1]}"`,
    );
  }
  const slug = value.toLowerCase();
  if (SLUG_TO_REGISTRY[slug] && /^[a-z0-9-]+$/.test(slug)) {
    return slug;
  }
  throw new Error(
    `Unknown registry id ${value}. Valid ids: ${Object.keys(SLUG_TO_REGISTRY).join(", ")}`,
  );
}

function loadProjects(): CatalogProject[] {
  const src = fs.readFileSync(path.join(ROOT, "apps/web/src/lib/projects.ts"), "utf8");
  const blocks = src.split(/\{\s*\n\s*id:/).slice(1);
  const rows: CatalogProject[] = [];
  for (const block of blocks) {
        const id = /^\s*"([^"]+)"/.exec(block)?.[1];
    const tenantId = /tenantId:\s*"([^"]+)"/.exec(block)?.[1];
    const name = /name:\s*"([^"]+)"/.exec(block)?.[1];
    const registry = /registry:\s*"([^"]+)"/.exec(block)?.[1];
    const methodologyKey = /methodologyKey:\s*"([^"]+)"/.exec(block)?.[1];
    if (id && tenantId && name && registry && methodologyKey) {
      rows.push({
        id,
        tenantId,
        name,
        registry,
        methodologyKey,
        origin: "catalog",
      });
    }
  }
  return rows;
}

function looksLikeFujairah(row: CertifyNode): boolean {
  const hay = `${row.name} ${row.short_description ?? ""} ${row.description ?? ""}`.toLowerCase();
  return hay.includes("fujairah") || hay.includes("peridotite");
}

function mapLiveIsometric(
  tenantId: string,
  rows: CertifyNode[],
  catalog: CatalogProject[],
  preferredExternalId?: string,
): CatalogProject[] {
  const aliasCatalog = catalog.find(
    (row) => row.tenantId === tenantId && row.id === "fujairah-mineral",
  );
  const aliasRow =
    rows.find((row) => looksLikeFujairah(row)) ??
    (preferredExternalId ? rows.find((row) => row.id === preferredExternalId) : undefined);
  const mapped: CatalogProject[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const aliased = Boolean(aliasCatalog && aliasRow && row.id === aliasRow.id);
    const project: CatalogProject = aliased && aliasCatalog
      ? {
          ...aliasCatalog,
          name: row.name || aliasCatalog.name,
          origin: "isometric",
          externalProjectId: row.id,
        }
      : {
          id: row.id,
          tenantId,
          name: row.name,
          registry: "Isometric",
          methodologyKey: "isometric-insitu-mineralization",
          origin: "isometric",
          externalProjectId: row.id,
        };
    if (seen.has(project.id)) continue;
    seen.add(project.id);
    mapped.push(project);
  }
  return mapped;
}

async function isometricCredentials(stage: StageName): Promise<{
  accessToken: string;
  clientSecret: string;
  preferredProjectId?: string;
} | null> {
  const envToken = process.env.ISOMETRIC_ACCESS_TOKEN?.trim();
  const envSecret = process.env.ISOMETRIC_CLIENT_SECRET?.trim();
  const envProject = process.env.ISOMETRIC_PROJECT_ID?.trim();
  if (envToken && envSecret && envToken !== "REPLACE_ME" && envSecret !== "REPLACE_ME") {
    return {
      accessToken: envToken,
      clientSecret: envSecret,
      preferredProjectId: envProject && envProject !== "REPLACE_ME" ? envProject : undefined,
    };
  }
  const data = await awsJson<{ SecretString?: string }>(
    [
      "secretsmanager",
      "get-secret-value",
      "--region",
      REGION,
      "--secret-id",
      `minrv/ew2/${stage}/isometric`,
    ],
    { allowNotFound: true },
  );
  if (!data?.SecretString) return null;
  const parsed = JSON.parse(data.SecretString) as Record<string, string>;
  const accessToken = parsed.ISOMETRIC_ACCESS_TOKEN?.trim();
  const clientSecret = parsed.ISOMETRIC_CLIENT_SECRET?.trim();
  const preferredProjectId = parsed.ISOMETRIC_PROJECT_ID?.trim();
  if (!accessToken || !clientSecret || accessToken === "REPLACE_ME" || clientSecret === "REPLACE_ME") {
    return null;
  }
  return {
    accessToken,
    clientSecret,
    preferredProjectId:
      preferredProjectId && preferredProjectId !== "REPLACE_ME" ? preferredProjectId : undefined,
  };
}

async function listCertifyProjects(creds: {
  accessToken: string;
  clientSecret: string;
}): Promise<CertifyNode[]> {
  const nodes: CertifyNode[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const url = new URL("https://api.sandbox.isometric.com/mrv/v0/projects");
    url.searchParams.set("first", "50");
    if (after) url.searchParams.set("after", after);
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${creds.accessToken}`,
        "x-client-secret": creds.clientSecret,
      },
    });
    const body = (await response.json()) as {
      nodes?: CertifyNode[];
      page_info?: { has_next_page?: boolean; end_cursor?: string };
      message?: string;
    };
    if (!response.ok) {
      throw new Error(
        `Isometric GET /projects ${response.status}: ${JSON.stringify(body).slice(0, 240)}`,
      );
    }
    nodes.push(...(body.nodes ?? []));
    if (!body.page_info?.has_next_page || !body.page_info.end_cursor) break;
    after = body.page_info.end_cursor;
  }
  return nodes;
}

async function isometricProjectsForTenant(
  stage: StageName,
  tenantId: string,
  catalog: CatalogProject[],
): Promise<CatalogProject[]> {
  if (tenantId !== LIVE_ISOMETRIC_TENANT) {
    return catalog.filter((row) => row.tenantId === tenantId && row.registry === "Isometric");
  }
  const creds = await isometricCredentials(stage);
  if (!creds) {
    throw new Error(
      "Cannot list live Isometric projects. Set ISOMETRIC_ACCESS_TOKEN / ISOMETRIC_CLIENT_SECRET or fill minrv/ew2/{stage}/isometric.",
    );
  }
  const rows = await listCertifyProjects(creds);
  if (!rows.length) {
    throw new Error("Isometric GET /projects returned no project ids for this organisation.");
  }
  return mapLiveIsometric(tenantId, rows, catalog, creds.preferredProjectId);
}

function resolveSeedProject(
  projectId: string,
  candidates: CatalogProject[],
): CatalogProject {
  const exact = candidates.find((row) => row.id === projectId);
  if (exact) return exact;
  const byExternal = candidates.find((row) => row.externalProjectId === projectId);
  if (byExternal) return byExternal;
  const byName = candidates.find((row) => row.name.toLowerCase() === projectId.toLowerCase());
  if (byName) {
    throw new Error(
      `STREAM_PROJECT_ID must be the project id "${byName.id}", not the name "${byName.name}"`,
    );
  }
  const valid = candidates.map((row) =>
    row.externalProjectId && row.externalProjectId !== row.id
      ? `${row.id} (certify ${row.externalProjectId})`
      : row.id,
  );
  throw new Error(
    `Refusing unknown project id ${projectId}. Valid ids: ${valid.join(", ") || "(none)"}`,
  );
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function metricName(header: string): string {
  const trimmed = header.replace(/^\uFEFF/, "").trim();
  return OPERATOR_TO_METRIC[trimmed] ?? OPERATOR_TO_METRIC[trimmed.toUpperCase()] ?? trimmed;
}

function splitWideToLong(text: string): {
  observations: Map<string, string[]>;
  attributes: Record<string, number>;
} {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  const headers = parseQuoted(lines[0]).map((h) => h.trim());
  const accounting = new Set(GHG_ACCOUNTING_HEADERS);
  const tsIndex = headers.findIndex((h) => metricName(h) === "timestamp_utc");
  if (tsIndex < 0) throw new Error("Seed CSV has no timestamp_utc / TIMESTAMP_UTC column");
  const observations = new Map<string, string[]>();
  const attributes: Record<string, number> = {};
  const headerLine = "timestamp_utc,metric,value,unit,quality,source";
  for (const line of lines.slice(1)) {
    const cells = parseQuoted(line);
    const ts = (cells[tsIndex] ?? "").trim();
    if (!ts) continue;
    const day = ts.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const rows = observations.get(day) ?? [headerLine];
    for (let i = 0; i < headers.length; i += 1) {
      const header = headers[i];
      const metric = metricName(header);
      const raw = (cells[i] ?? "").trim();
      if (accounting.has(header) || accounting.has(metric)) {
        const num = Number(raw);
        if (Number.isFinite(num)) attributes[header] = num;
        continue;
      }
      if (metric === "timestamp_utc" || metric === "operational_state" || metric === "batch_id") {
        continue;
      }
      rows.push(`${ts},${metric},${raw},,ok,seed`);
    }
    observations.set(day, rows);
  }
  return { observations, attributes };
}

async function putObject(bucket: string, key: string, body: string, contentType: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "minrv-stream-"));
  const file = path.join(dir, "body");
  fs.writeFileSync(file, body);
  const result = await runWithRetry("aws", [
    "s3api",
    "put-object",
    "--region",
    REGION,
    "--bucket",
    bucket,
    "--key",
    key,
    "--body",
    file,
    "--content-type",
    contentType,
  ]);
  fs.rmSync(dir, { recursive: true, force: true });
  if (result.code !== 0) {
    throw new Error(`put-object ${key} failed: ${result.stderr.slice(0, 1500)}`);
  }
}

async function main(): Promise<void> {
  const identity = await awsJson<{ Account?: string }>(["sts", "get-caller-identity"]);
  if (identity?.Account && identity.Account !== ACCOUNT) {
    throw new Error(`Caller account ${identity.Account} is not ${ACCOUNT}`);
  }

  const stage = stageFromApp();
  const tenants = loadTenants();
  const projects = loadProjects();
  if (!projects.length) throw new Error("Could not parse catalog projects from apps/web/src/lib/projects.ts");

  let tenantRaw = envId("STREAM_TENANT_ID", "STREAM_TENANT");
  let registryRaw = envId("STREAM_REGISTRY_ID", "STREAM_REGISTRY");
  let projectRaw = envId("STREAM_PROJECT_ID", "STREAM_PROJECT");
  const from = (process.env.STREAM_FROM || "2026-09-01").trim();
  const to = (process.env.STREAM_TO || "2026-09-03").trim();
  const pack = (process.env.STREAM_PACK || "pass").trim().toLowerCase();
  const listOnly = process.env.STREAM_LIST === "1";

  if (process.stdin.isTTY) {
    console.log("Tenant ids:");
    for (const tenant of tenants) console.log(`  ${tenant.id}`);
    if (!tenantRaw) tenantRaw = await prompt("Tenant id: ");
  }

  if (!tenantRaw) {
    throw new Error("set STREAM_TENANT_ID (tenant id, not name)");
  }
  const tenantId = parseTenantId(tenantRaw, tenants);

  if (process.stdin.isTTY) {
    const tenantProjects = projects.filter((row) => row.tenantId === tenantId);
    const registryIds = [
      ...new Set(
        tenantProjects
          .map((row) => Object.entries(SLUG_TO_REGISTRY).find(([, name]) => name === row.registry)?.[0])
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (tenantId === LIVE_ISOMETRIC_TENANT && !registryIds.includes("isometric")) {
      registryIds.unshift("isometric");
    }
    console.log("Registry ids:");
    for (const id of registryIds) console.log(`  ${id}`);
    if (!registryRaw) registryRaw = await prompt("Registry id: ");
  }

  if (!registryRaw) {
    throw new Error(
      `set STREAM_REGISTRY_ID (registry id, not name). Valid ids: ${Object.keys(SLUG_TO_REGISTRY).join(", ")}`,
    );
  }
  const registrySlug = parseRegistryId(registryRaw);
  const registry = SLUG_TO_REGISTRY[registrySlug];

  const candidates =
    registry === "Isometric"
      ? await isometricProjectsForTenant(stage, tenantId, projects)
      : projects.filter((row) => row.tenantId === tenantId && row.registry === registry);

  if (process.stdin.isTTY || listOnly) {
    console.log("Project ids:");
    for (const row of candidates) {
      const certify =
        row.externalProjectId && row.externalProjectId !== row.id
          ? `  certify=${row.externalProjectId}`
          : "";
      console.log(`  ${row.id}${certify}`);
    }
  }

  if (listOnly) {
    console.log(
      `Use STREAM_TENANT_ID=${tenantId} STREAM_REGISTRY_ID=${registrySlug} STREAM_PROJECT_ID=<id above>`,
    );
    return;
  }

  if (process.stdin.isTTY && !projectRaw) {
    projectRaw = await prompt("Project id: ");
  }

  if (!projectRaw) {
    throw new Error("set STREAM_PROJECT_ID (existing project id, not a name)");
  }
  const project = resolveSeedProject(projectRaw, candidates);
  if (project.tenantId !== tenantId || project.registry !== registry) {
    throw new Error(
      `Project ${project.id} is ${project.tenantId}/${project.registry}, not ${tenantId}/${registrySlug}`,
    );
  }

  if (process.stdin.isTTY) {
    const certifyNote = project.externalProjectId
      ? ` certify=${project.externalProjectId}`
      : "";
    const ok = await prompt(
      `Write stream fixtures for ${tenantId} / ${registrySlug} / ${project.id}${certifyNote} ${from}–${to}? [y/N] `,
    );
    if (ok.toLowerCase() !== "y" && ok.toLowerCase() !== "yes") {
      console.log("Aborted.");
      return;
    }
  }

  const stackName = cfnStackName(stage, "data");
  const stacks = await awsJson<{ Stacks?: CfnStack[] }>([
    "cloudformation",
    "describe-stacks",
    "--region",
    REGION,
    "--stack-name",
    stackName,
  ]);
  const stack = stacks?.Stacks?.[0];
  if (!stack?.StackStatus || !HEALTHY.has(stack.StackStatus)) {
    throw new Error(
      `${stackName} is not complete (status=${stack?.StackStatus ?? "missing"}). Deploy data first.`,
    );
  }
  const bucket =
    process.env.STREAM_S3_BUCKET?.trim() ||
    stack.Outputs?.find((o) => o.OutputKey === "StreamBucketName")?.OutputValue;
  if (!bucket) {
    throw new Error(`${stackName} has no StreamBucketName output. STREAM_S3_BUCKET unset.`);
  }

  const packFile =
    pack === "fail" ? "GHG_ENTRY_FAIL_2026-09.csv" : "GHG_ENTRY_PASS_2026-09.csv";
  const csvPath = path.join(ROOT, "apps/web/test-data/ghg-entry", packFile);
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Missing ${csvPath}. Run node apps/web/test-data/ghg-entry/generate.mjs`);
  }
  const { observations, attributes } = splitWideToLong(fs.readFileSync(csvPath, "utf8"));
  const days = [...observations.keys()].sort().filter((day) => day >= from && day <= to);
  if (!days.length) throw new Error(`No seed rows in ${from}–${to}`);

  let dropDay: string | null = null;
  let dropMetric: string | null = null;
  const attrValues = { ...attributes };
  if (pack === "gaps") {
    dropDay = days[days.length - 1] ?? null;
    dropMetric = "INJ_RATE_FT02_m3h";
    delete attrValues.GRID_EMISSION_FACTOR_kg_per_kWh;
  }

  const isometric = registry === "Isometric";
  const schema = {
    schemaVersion: 1,
    kind: "timeseries",
    timezone: "UTC",
    cadence: isometric ? "PT2M" : "PT1H",
    registry,
    methodologyKey: project.methodologyKey,
    requiredSeries: isometric ? INSITU_SERIES : [],
    requiredAttributes: isometric ? GHG_ACCOUNTING_HEADERS : [],
  };
  const prefix = `${tenantId}/${registrySlug}/${project.id}/`;
  await putObject(bucket, `${prefix}_schema.json`, `${JSON.stringify(schema, null, 2)}\n`, "application/json");
  await putObject(
    bucket,
    `${prefix}attributes.json`,
    `${JSON.stringify({ schemaVersion: 1, periodStart: from, periodEnd: to, values: attrValues }, null, 2)}\n`,
    "application/json",
  );

  let keyCount = 0;
  for (const day of days) {
    if (dropDay && day === dropDay) continue;
    let csv = (observations.get(day) ?? []).join("\n");
    if (dropMetric) {
      csv = csv
        .split("\n")
        .filter((line, i) => i === 0 || !line.includes(`,${dropMetric},`))
        .join("\n");
    }
    if (!csv.endsWith("\n")) csv += "\n";
    await putObject(bucket, `${prefix}dt=${day}/observations.csv`, csv, "text/csv");
    keyCount += 1;
  }

  const listed = await awsJson<{ Contents?: Array<{ Key?: string }> }>([
    "s3api",
    "list-objects-v2",
    "--region",
    REGION,
    "--bucket",
    bucket,
    "--prefix",
    prefix,
  ]);
  const first = listed?.Contents?.find((row) => row.Key?.endsWith("observations.csv"))?.Key;
  if (!first) throw new Error("ListObjectsV2 returned no observations.csv under prefix");
  const head = await runWithRetry("aws", [
    "s3api",
    "head-object",
    "--region",
    REGION,
    "--bucket",
    bucket,
    "--key",
    `${prefix}_schema.json`,
  ]);
  if (head.code !== 0) throw new Error(`Get/Head _schema.json failed: ${head.stderr.slice(0, 800)}`);
  const got = await runWithRetry("aws", [
    "s3api",
    "get-object",
    "--region",
    REGION,
    "--bucket",
    bucket,
    "--key",
    first,
    path.join(os.tmpdir(), "minrv-stream-get.csv"),
  ]);
  if (got.code !== 0) throw new Error(`GetObject ${first} failed: ${got.stderr.slice(0, 800)}`);

  console.log(`bucket=${bucket}`);
  console.log(`tenant_id=${tenantId}`);
  console.log(`registry_id=${registrySlug}`);
  console.log(`project_id=${project.id}`);
  if (project.externalProjectId) {
    console.log(`certify_id=${project.externalProjectId}`);
  }
  console.log(`prefix=${prefix}`);
  console.log(`keys=${keyCount} observations + schema/attributes`);
  console.log(`span=${days[0]}…${days[days.length - 1]} pack=${pack}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
