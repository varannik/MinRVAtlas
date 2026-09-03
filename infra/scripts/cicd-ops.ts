#!/usr/bin/env npx ts-node
/**
 * Operator helpers for the AWS-native pipeline (no GitHub Actions).
 *
 *   npx ts-node --prefer-ts-exts scripts/cicd-ops.ts pipeline-start
 *   npx ts-node --prefer-ts-exts scripts/cicd-ops.ts pipeline-status
 *   npx ts-node --prefer-ts-exts scripts/cicd-ops.ts ecs-status
 *   npx ts-node --prefer-ts-exts scripts/cicd-ops.ts logs
 *   npx ts-node --prefer-ts-exts scripts/cicd-ops.ts rollback
 */
import { ACCOUNT, REGION, type StageName } from "../lib/config";
import { awsJson, run } from "./aws";

const APP = process.env.APP ?? "minrv-ew2-sandbox";
const SERVICE = process.env.SERVICE ?? "web";
const SINCE = process.env.SINCE ?? "1h";

const ECS_SERVICES = ["web", "api", "worker", "beat"] as const;

function stageFromApp(): StageName {
  return APP.includes("prod") ? "prod" : "sandbox";
}

async function assertIdentity(): Promise<void> {
  const identity = await awsJson<{ Account?: string; Arn?: string }>([
    "sts",
    "get-caller-identity",
  ]);
  console.log(`Caller: ${identity?.Arn ?? "unknown"}`);
  console.log(`Account: ${identity?.Account ?? "unknown"}`);
  if (identity?.Account && identity.Account !== ACCOUNT) {
    throw new Error(`Wrong account ${identity.Account}; expected ${ACCOUNT}`);
  }
}

function pipelineName(stage: StageName): string {
  return process.env.CODEPIPELINE_NAME ?? `minrv-ew2-${stage}-app`;
}

function clusterName(stage: StageName): string {
  return process.env.ECS_CLUSTER ?? `minrv-ew2-${stage}-ecs`;
}

function serviceName(stage: StageName, short: string): string {
  return `minrv-ew2-${stage}-${short}`;
}

function logGroup(stage: StageName, short: string): string {
  return `/minrv/ew2/${stage}/${short}`;
}

async function cmdPipelineStart(): Promise<void> {
  const stage = stageFromApp();
  const name = pipelineName(stage);
  await assertIdentity();
  const result = run("aws", [
    "codepipeline",
    "start-pipeline-execution",
    "--name",
    name,
    "--region",
    REGION,
  ]);
  if (result.code !== 0) {
    throw new Error(result.stderr || "start-pipeline-execution failed");
  }
  console.log(result.stdout.trim());
}

async function cmdPipelineStatus(): Promise<void> {
  const stage = stageFromApp();
  const name = pipelineName(stage);
  await assertIdentity();
  const state = await awsJson<{
    pipelineName?: string;
    stageStates?: Array<{
      stageName?: string;
      latestExecution?: { status?: string; pipelineExecutionId?: string };
      actionStates?: Array<{
        actionName?: string;
        latestExecution?: {
          status?: string;
          errorDetails?: { message?: string };
          externalExecutionUrl?: string;
        };
      }>;
    }>;
  }>(["codepipeline", "get-pipeline-state", "--name", name, "--region", REGION]);

  console.log(`Pipeline: ${state?.pipelineName ?? name}`);
  console.log(
    `Console: https://${REGION}.console.aws.amazon.com/codesuite/codepipeline/pipelines/${name}/view`,
  );
  for (const stageState of state?.stageStates ?? []) {
    const st = stageState.latestExecution?.status ?? "Unknown";
    const exec = stageState.latestExecution?.pipelineExecutionId ?? "";
    console.log(`\n[${stageState.stageName}] ${st} ${exec}`);
    for (const action of stageState.actionStates ?? []) {
      const a = action.latestExecution?.status ?? "Unknown";
      const err = action.latestExecution?.errorDetails?.message;
      console.log(`  - ${action.actionName}: ${a}`);
      if (err) {
        console.log(`      ${err}`);
      }
    }
  }
}

async function cmdEcsStatus(): Promise<void> {
  const stage = stageFromApp();
  const cluster = clusterName(stage);
  await assertIdentity();
  const names = ECS_SERVICES.map((s) => serviceName(stage, s));
  const data = await awsJson<{
    services?: Array<{
      serviceName?: string;
      status?: string;
      desiredCount?: number;
      runningCount?: number;
      pendingCount?: number;
      taskDefinition?: string;
      deployments?: Array<{
        id?: string;
        status?: string;
        rolloutState?: string;
        desiredCount?: number;
        runningCount?: number;
        failedTasks?: number;
        taskDefinition?: string;
      }>;
      events?: Array<{ message?: string; createdAt?: string }>;
    }>;
  }>([
    "ecs",
    "describe-services",
    "--cluster",
    cluster,
    "--services",
    ...names,
    "--region",
    REGION,
  ]);

  console.log(`Cluster: ${cluster}`);
  for (const svc of data?.services ?? []) {
    console.log(`\n${svc.serviceName}`);
    console.log(`  status:           ${svc.status}`);
    console.log(`  desired/running/pending: ${svc.desiredCount}/${svc.runningCount}/${svc.pendingCount}`);
    console.log(`  task definition:  ${svc.taskDefinition}`);
    for (const d of svc.deployments ?? []) {
      console.log(
        `  deployment ${d.id}: ${d.status} rollout=${d.rolloutState ?? "n/a"} desired=${d.desiredCount} running=${d.runningCount} failed=${d.failedTasks ?? 0}`,
      );
      console.log(`    td: ${d.taskDefinition}`);
    }
    for (const ev of (svc.events ?? []).slice(0, 3)) {
      console.log(`  event: ${ev.message}`);
    }
  }
}

async function cmdLogs(): Promise<void> {
  const stage = stageFromApp();
  const group = process.env.LOG_GROUP ?? logGroup(stage, SERVICE);
  await assertIdentity();
  console.log(`Tailing ${group} (since ${SINCE})`);
  const result = run(
    "aws",
    ["logs", "tail", group, "--since", SINCE, "--region", REGION, "--format", "short"],
    { inherit: true },
  );
  if (result.code !== 0) {
    throw new Error(`aws logs tail failed for ${group}`);
  }
}

async function cmdRollback(): Promise<void> {
  const stage = stageFromApp();
  if (!ECS_SERVICES.includes(SERVICE as (typeof ECS_SERVICES)[number])) {
    throw new Error(`SERVICE must be one of ${ECS_SERVICES.join(", ")}`);
  }
  const cluster = clusterName(stage);
  const name = serviceName(stage, SERVICE);
  await assertIdentity();

  const described = await awsJson<{
    services?: Array<{ taskDefinition?: string }>;
  }>([
    "ecs",
    "describe-services",
    "--cluster",
    cluster,
    "--services",
    name,
    "--region",
    REGION,
  ]);
  const current = described?.services?.[0]?.taskDefinition;
  if (!current) {
    throw new Error(`No task definition on ${name}`);
  }

  let target = process.env.TASK_DEFINITION;
  if (!target) {
    const arnParts = current.split("/");
    const familyRevision = arnParts[arnParts.length - 1] ?? "";
    const sep = familyRevision.lastIndexOf(":");
    const family = familyRevision.slice(0, sep);
    const revision = Number(familyRevision.slice(sep + 1));
    if (!family || !Number.isFinite(revision) || revision < 2) {
      throw new Error(
        `Cannot infer previous revision from ${current}. Set TASK_DEFINITION=family:revision`,
      );
    }
    target = `${family}:${revision - 1}`;
  }

  console.log(`Current:  ${current}`);
  console.log(`Rollback: ${target}`);
  console.log("This updates the ECS service to an existing task-definition revision (no image rebuild).");

  const update = run("aws", [
    "ecs",
    "update-service",
    "--cluster",
    cluster,
    "--service",
    name,
    "--task-definition",
    target,
    "--region",
    REGION,
  ]);
  if (update.code !== 0) {
    throw new Error(update.stderr || "update-service failed");
  }
  console.log("Waiting for services-stable…");
  const wait = run(
    "aws",
    [
      "ecs",
      "wait",
      "services-stable",
      "--cluster",
      cluster,
      "--services",
      name,
      "--region",
      REGION,
    ],
    { inherit: true },
  );
  if (wait.code !== 0) {
    throw new Error("ecs wait services-stable failed — inspect events with make ecs-status");
  }
  console.log("Rollback reached steady state.");
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  process.env.AWS_REGION = process.env.AWS_REGION ?? REGION;
  process.env.AWS_DEFAULT_REGION = process.env.AWS_DEFAULT_REGION ?? REGION;

  if (cmd === "pipeline-start") {
    await cmdPipelineStart();
    return;
  }
  if (cmd === "pipeline-status" || cmd === "pipeline") {
    await cmdPipelineStatus();
    return;
  }
  if (cmd === "ecs-status") {
    await cmdEcsStatus();
    return;
  }
  if (cmd === "logs") {
    await cmdLogs();
    return;
  }
  if (cmd === "rollback") {
    await cmdRollback();
    return;
  }
  throw new Error(
    "Unknown command. Use: pipeline-start | pipeline-status | ecs-status | logs | rollback",
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
