/**
 * Seed the stream bucket with mock timeseries for an **existing** catalog project.
 *
 *   make -C infra seed-stream-s3
 *   STREAM_TENANT=fourfourone STREAM_REGISTRY=isometric STREAM_PROJECT=fujairah-mineral make -C infra seed-stream-s3
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
};

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

function loadTenants(): { id: string; name: string }[] {
  const src = fs.readFileSync(path.join(ROOT, "apps/web/src/lib/tenants.ts"), "utf8");
  const ids = [...src.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
  const names = [...src.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);
  return ids.map((id, i) => ({ id, name: names[i] ?? id }));
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
      rows.push({ id, tenantId, name, registry, methodologyKey });
    }
  }
  return rows;
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

  let tenantId = (process.env.STREAM_TENANT ?? "").trim();
  let registrySlug = (process.env.STREAM_REGISTRY ?? "").trim().toLowerCase();
  let projectId = (process.env.STREAM_PROJECT ?? "").trim();
  const from = (process.env.STREAM_FROM ?? "2026-09-01").trim();
  const to = (process.env.STREAM_TO ?? "2026-09-03").trim();
  const pack = (process.env.STREAM_PACK ?? "pass").trim().toLowerCase();

  if (process.stdin.isTTY) {
    console.log("Tenants:");
    for (const tenant of tenants) console.log(`  ${tenant.id}  ${tenant.name}`);
    if (!tenantId) tenantId = await prompt("Tenant id: ");
    const tenantProjects = projects.filter((row) => row.tenantId === tenantId);
    const registries = [...new Set(tenantProjects.map((row) => row.registry))];
    console.log("Registries for this tenant:");
    for (const registry of registries) {
      const slug = Object.entries(SLUG_TO_REGISTRY).find(([, name]) => name === registry)?.[0];
      console.log(`  ${slug ?? "?"}  ${registry}`);
    }
    if (!registrySlug) registrySlug = (await prompt("Registry slug (isometric|puro|verra|gold-standard): ")).toLowerCase();
    const registry = SLUG_TO_REGISTRY[registrySlug];
    const matches = tenantProjects.filter((row) => row.registry === registry);
    console.log("Projects:");
    for (const row of matches) console.log(`  ${row.id}  ${row.name}`);
    if (!projectId) projectId = await prompt("Project id: ");
  }

  if (!tenantId || !registrySlug || !projectId) {
    throw new Error(
      "set STREAM_TENANT, STREAM_REGISTRY, STREAM_PROJECT (must be an existing project)",
    );
  }
  const registry = SLUG_TO_REGISTRY[registrySlug];
  if (!registry) {
    throw new Error(`STREAM_REGISTRY must be one of: ${Object.keys(SLUG_TO_REGISTRY).join(", ")}`);
  }
  const project = projects.find((row) => row.id === projectId);
  if (!project || project.tenantId !== tenantId || project.registry !== registry) {
    const valid = projects
      .filter((row) => row.tenantId === tenantId && row.registry === registry)
      .map((row) => row.id);
    throw new Error(
      `Refusing unknown project ${tenantId}/${registrySlug}/${projectId}. Valid ids: ${valid.join(", ") || "(none)"}`,
    );
  }

  if (process.stdin.isTTY) {
    const ok = await prompt(
      `Write stream fixtures for ${tenantId} / ${registry} / ${project.id} (${project.name}) ${from}–${to}? [y/N] `,
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
  console.log(`prefix=${prefix}`);
  console.log(`project=${project.name}`);
  console.log(`keys=${keyCount} observations + schema/attributes`);
  console.log(`span=${days[0]}…${days[days.length - 1]} pack=${pack}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
