#!/usr/bin/env node
/**
 * Step A smoke: Next BFF → Data Sentinel DQA.
 *
 * Requires:
 *   - Next on MINRV_ORIGIN (default http://localhost:3000)
 *   - Sentinel FastAPI on SENTINEL_BASE_URL (default http://localhost:8000)
 *   - Matching SENTINEL_SERVICE_TOKEN on both
 *
 * Usage (repo root):
 *   npm run sentinel:smoke
 *
 * Does not touch the globe, Certify, or session drafts.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const ORIGIN = process.env.MINRV_ORIGIN ?? "http://localhost:3000";
const TENANT = process.env.SENTINEL_TENANT_ID ?? "fourfourone";
const CSV_PATH =
  process.env.SENTINEL_SMOKE_CSV ??
  path.join(
    ROOT,
    "apps/sentinel/data/sample_data/STR1_FAIL_2024-03-15.csv",
  );

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function headers(extra = {}) {
  return { "x-tenant-id": TENANT, ...extra };
}

async function api(pathname, init = {}) {
  const response = await fetch(`${ORIGIN}${pathname}`, {
    ...init,
    headers: { ...headers(init.headers), ...init.headers },
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { response, json };
}

function fail(message, extra) {
  console.error(`FAIL  ${message}`);
  if (extra !== undefined) console.error(extra);
  process.exit(1);
}

async function ensureProject() {
  const configured = process.env.SENTINEL_PROJECT_ID?.trim();
  if (configured && UUID_RE.test(configured)) {
    return { id: configured, mapped: true };
  }

  const list = await api("/api/sentinel/v1/projects");
  if (!list.response.ok) {
    fail(
      `GET /api/sentinel/v1/projects → ${list.response.status}`,
      list.json,
    );
  }

  const projects = Array.isArray(list.json) ? list.json : [];
  const existing = projects.find(
    (project) =>
      typeof project?.name === "string" &&
      project.name.toLowerCase().includes("fujairah"),
  );
  if (existing?.id) {
    console.log(`Using existing Sentinel project ${existing.id} (${existing.name})`);
    console.log(
      `Add to .env: SENTINEL_PROJECT_ID=${existing.id}  (maps fujairah-mineral)`,
    );
    return { id: existing.id, mapped: false };
  }

  const created = await api("/api/sentinel/v1/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Fujairah Peridotite Mineralisation",
      description: "3DMinRV Step A smoke project",
      domain: "ccs",
    }),
  });
  if (!created.response.ok) {
    fail(
      `POST /api/sentinel/v1/projects → ${created.response.status}`,
      created.json,
    );
  }
  console.log(`Created Sentinel project ${created.json.id}`);
  console.log(
    `Add to .env: SENTINEL_PROJECT_ID=${created.json.id}  (maps fujairah-mineral)`,
  );
  return { id: created.json.id, mapped: false };
}

async function pollRun(runId) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const { response, json } = await api(`/api/sentinel/v1/runs/${runId}`);
    if (!response.ok) {
      fail(`GET run ${runId} → ${response.status}`, json);
    }
    const status = json?.status;
    process.stdout.write(`  run ${runId} status=${status}\n`);
    if (status === "completed" || status === "failed") return json;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  fail(`Run ${runId} did not finish within 90s`);
}

async function main() {
  console.log(`Origin ${ORIGIN}`);
  console.log(`Tenant ${TENANT}`);
  console.log(`CSV    ${CSV_PATH}`);

  const health = await api("/api/sentinel/health");
  if (!health.response.ok) {
    fail(
      `GET /api/sentinel/health → ${health.response.status}. Start Next (:3000) and Sentinel (:8000).`,
      health.json,
    );
  }
  console.log("PASS  health", health.json);

  const denied = await api("/api/sentinel/v1/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (denied.response.status !== 403) {
    fail(
      `Expected 403 on /v1/auth/register, got ${denied.response.status}`,
      denied.json,
    );
  }
  console.log("PASS  auth register denied");

  const foreign = await api("/api/sentinel/health", {
    headers: { "x-tenant-id": "verdant" },
  });
  if (foreign.response.status !== 403) {
    fail(
      `Expected 403 for tenant verdant, got ${foreign.response.status}`,
      foreign.json,
    );
  }
  console.log("PASS  other tenant denied");

  const project = await ensureProject();
  const formProjectId = project.mapped ? "fujairah-mineral" : project.id;

  const seed = await api(`/api/sentinel/v1/rules/seed/${project.id}`, {
    method: "POST",
  });
  if (!seed.response.ok) {
    fail(
      `POST /v1/rules/seed/${project.id} → ${seed.response.status}`,
      seed.json,
    );
  }
  console.log("PASS  seeded CO2 rules", seed.json);

  const csv = await readFile(CSV_PATH);
  const form = new FormData();
  form.set("project_id", formProjectId);
  form.set(
    "file",
    new Blob([csv], { type: "text/csv" }),
    path.basename(CSV_PATH),
  );

  const upload = await api("/api/sentinel/v1/datasets/upload", {
    method: "POST",
    body: form,
  });
  if (!upload.response.ok) {
    fail(
      `POST datasets/upload → ${upload.response.status}`,
      upload.json,
    );
  }
  const datasetId = upload.json?.id;
  if (!datasetId) fail("Upload returned no dataset id", upload.json);
  console.log(`PASS  dataset ${datasetId} (${upload.json.row_count} rows)`);

  const runCreate = await api("/api/sentinel/v1/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      dataset_id: datasetId,
      project_id: formProjectId,
    }),
  });
  if (!runCreate.response.ok) {
    fail(`POST /v1/runs → ${runCreate.response.status}`, runCreate.json);
  }
  const runId = runCreate.json?.id;
  if (!runId) fail("Create run returned no id", runCreate.json);
  console.log(`PASS  queued run ${runId}`);

  const run = await pollRun(runId);
  console.log(
    `PASS  run ${runId} ${run.status}  violations=${run.total_violations}  gate_passed=${run.gate_passed}`,
  );

  const violations = await api(
    `/api/sentinel/v1/violations?run_id=${encodeURIComponent(runId)}&limit=20`,
  );
  if (!violations.response.ok) {
    fail(
      `GET violations → ${violations.response.status}`,
      violations.json,
    );
  }
  const items = Array.isArray(violations.json?.items)
    ? violations.json.items
    : [];
  console.log(`PASS  ${violations.json?.total ?? items.length} violation(s)`);
  for (const item of items.slice(0, 8)) {
    console.log(
      `       ${item.rule_id}  ${item.severity}  ${item.affected_field ?? ""}`,
    );
  }

  console.log("\nStep A exit: Next BFF produced a DQA run id. Browser still has no token.");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
