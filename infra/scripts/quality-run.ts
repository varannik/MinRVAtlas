/**
 * make quality-run: run the data quality engine on one project now, wait for it,
 * and print its verdict and counts. The findings themselves are on the project's
 * calculation tree (journey, floor 3) and in Ask Cortex.
 *
 *   QUALITY_PROJECT   project id (required), e.g. fujairah-mineral
 *   QUALITY_TENANT    tenant id (default fourfourone)
 *   QUALITY_REGISTRY  registry slug: puro, isometric, verra, gold-standard (default puro)
 *   QUALITY_TZ        the site's time zone for intraday times (e.g. Asia/Dubai; default UTC)
 *   APP               stage, as everywhere in this Makefile (default minrv-ew2-sandbox)
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { ACCOUNT, REGION, qualityRunStateMachineName, type StageName } from "../lib/config";

const ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const SLUGS = ["puro", "isometric", "verra", "gold-standard"];

function aws(args: string[]): string {
  const result = spawnSync("aws", [...args, "--region", REGION, "--output", "json"], { encoding: "utf-8", env: process.env, timeout: 30_000 });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "aws failed").trim().slice(0, 500));
  return result.stdout;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const stage = (process.env.APP ?? "minrv-ew2-sandbox").replace(/^minrv-ew2-/, "") as StageName;
  const project = process.env.QUALITY_PROJECT ?? "";
  const tenant = process.env.QUALITY_TENANT || "fourfourone";
  const registry = process.env.QUALITY_REGISTRY || "puro";
  if (!ID.test(project) || !ID.test(tenant)) throw new Error("Set QUALITY_PROJECT (and QUALITY_TENANT) to ids like fujairah-mineral.");
  if (!SLUGS.includes(registry)) throw new Error(`QUALITY_REGISTRY is one of ${SLUGS.join(", ")}.`);

  const runId = `${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${randomBytes(3).toString("hex")}`;
  const arn = `arn:aws:states:${REGION}:${ACCOUNT}:stateMachine:${qualityRunStateMachineName(stage)}`;
  const input = {
    run: { run_id: runId, tenant_id: tenant, project_id: project, registry_slug: registry, requested_by: "make quality-run", site_tz: process.env.QUALITY_TZ ?? "" },
  };
  const started = JSON.parse(
    aws(["stepfunctions", "start-execution", "--state-machine-arn", arn, "--name", `${project}-${runId}`.slice(-80), "--input", JSON.stringify(input)]),
  ) as { executionArn: string };
  console.log(`Quality run ${runId} on ${tenant}/${registry}/${project} started.`);

  const until = Date.now() + 10 * 60_000;
  while (Date.now() < until) {
    await sleep(5000);
    const execution = JSON.parse(aws(["stepfunctions", "describe-execution", "--execution-arn", started.executionArn])) as {
      status: string;
      output?: string;
      error?: string;
      cause?: string;
    };
    if (execution.status === "RUNNING") continue;
    if (execution.status !== "SUCCEEDED") {
      throw new Error(`The run ${execution.status.toLowerCase()}: ${execution.error ?? ""} ${execution.cause ?? ""}`.trim());
    }
    const detail = (JSON.parse(execution.output ?? "{}") as { judged?: { detail?: Record<string, unknown> } }).judged?.detail ?? {};
    console.log(JSON.stringify(detail, null, 2));
    return;
  }
  throw new Error("The run is still going after 10 minutes; see the minrv-ew2 quality-run state machine.");
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
