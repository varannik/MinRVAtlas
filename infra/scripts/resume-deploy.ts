#!/usr/bin/env npx ts-node
/**
 * Resume-safe deploy for minrv-ew2.
 *
 * CloudFormation keeps running if the laptop drops. This script:
 *   1. Inventories existing London resources
 *   2. Bootstraps CDKToolkit only if missing
 *   3. Deploys one stack at a time in dependency order
 *   4. Skips a stack when `cdk diff` is empty
 *   5. Waits out CREATE/UPDATE_IN_PROGRESS instead of starting a second update
 *   6. Retries on timeouts / resets / 429s
 *   7. Deletes ROLLBACK_COMPLETE create-failed stacks, then recreates them
 *
 * Usage (from infra/):
 *   npx ts-node --prefer-ts-exts scripts/resume-deploy.ts status
 *   npx ts-node --prefer-ts-exts scripts/resume-deploy.ts bootstrap
 *   npx ts-node --prefer-ts-exts scripts/resume-deploy.ts deploy
 *   APP=minrv-ew2-prod CONFIRM=YES npx ts-node --prefer-ts-exts scripts/resume-deploy.ts deploy
 */
import {
  ACCOUNT,
  REGION,
  STACK_ORDER,
  VPC_CIDR,
  type StageName,
} from "../lib/config";
import { awsJson, isTransient, run, runWithRetry, sleep } from "./aws";

const INFRA_DIR = `${__dirname}/..`;
const APP = process.env.APP ?? "minrv-ew2-sandbox";
const CONFIRM = process.env.CONFIRM ?? "";
const ENABLE_CLOUDFRONT = process.env.ENABLE_CLOUDFRONT === "1";

const IN_PROGRESS = new Set([
  "CREATE_IN_PROGRESS",
  "UPDATE_IN_PROGRESS",
  "DELETE_IN_PROGRESS",
  "REVIEW_IN_PROGRESS",
  "IMPORT_IN_PROGRESS",
  "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS",
  "ROLLBACK_IN_PROGRESS",
  "UPDATE_ROLLBACK_IN_PROGRESS",
  "UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS",
]);

const HEALTHY = new Set([
  "CREATE_COMPLETE",
  "UPDATE_COMPLETE",
  "IMPORT_COMPLETE",
]);

interface CfnStack {
  StackName: string;
  StackStatus: string;
  StackStatusReason?: string;
}

interface Inventory {
  identity?: { Account?: string; Arn?: string };
  toolkit?: CfnStack;
  toolkitUsEast1?: CfnStack;
  appStacks: CfnStack[];
  vpcs: Array<{ VpcId: string; CidrBlock: string; IsDefault?: boolean }>;
  kmsAliases: string[];
  secrets: string[];
  buckets: string[];
  ecr: string[];
  guardDutyDetectors: string[];
  configRecorders: string[];
  githubOidc: boolean;
}

function stageFromApp(): StageName {
  if (APP.includes("prod")) {
    return "prod";
  }
  return "sandbox";
}

function cdkContextArgs(): string[] {
  const args: string[] = [];
  if (ENABLE_CLOUDFRONT) {
    args.push("-c", "enableCloudFront=true");
  }
  if (process.env.WEB_IMAGE_TAG) {
    args.push("-c", `webImageTag=${process.env.WEB_IMAGE_TAG}`);
  }
  if (process.env.SENTINEL_IMAGE_TAG) {
    args.push("-c", `sentinelImageTag=${process.env.SENTINEL_IMAGE_TAG}`);
  }
  if (process.env.SKIP_REGIONAL_SECURITY === "1") {
    args.push("-c", "skipRegionalSecurity=true");
  }
  if (process.env.DOMAIN_NAME) {
    args.push("-c", `domainName=${process.env.DOMAIN_NAME}`);
  }
  if (process.env.HOSTED_ZONE_ID) {
    args.push("-c", `hostedZoneId=${process.env.HOSTED_ZONE_ID}`);
  }
  if (process.env.HOSTED_ZONE_NAME) {
    args.push("-c", `hostedZoneName=${process.env.HOSTED_ZONE_NAME}`);
  }
  if (process.env.OPS_EMAIL) {
    args.push("-c", `opsEmail=${process.env.OPS_EMAIL}`);
  }
  if (process.env.GITHUB_CONNECTION_ARN) {
    args.push("-c", `githubConnectionArn=${process.env.GITHUB_CONNECTION_ARN}`);
  }
  if (process.env.GITHUB_BRANCH) {
    args.push("-c", `githubBranch=${process.env.GITHUB_BRANCH}`);
  }
  if (process.env.GITHUB_BRANCH_PROD) {
    args.push("-c", `githubBranchProd=${process.env.GITHUB_BRANCH_PROD}`);
  }
  return args;
}

async function describeStack(
  name: string,
  region = REGION,
): Promise<CfnStack | undefined> {
  const data = await awsJson<{ Stacks: CfnStack[] }>(
    [
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      name,
      "--region",
      region,
    ],
    { allowNotFound: true },
  );
  return data?.Stacks?.[0];
}

async function waitForStack(name: string, region = REGION): Promise<CfnStack> {
  process.stdout.write(`    waiting for ${name} in ${region}`);
  for (let i = 0; i < 180; i++) {
    const stack = await describeStack(name, region);
    if (!stack) {
      console.log(" — gone");
      throw new Error(`Stack ${name} disappeared while waiting`);
    }
    if (!IN_PROGRESS.has(stack.StackStatus)) {
      console.log(` — ${stack.StackStatus}`);
      return stack;
    }
    process.stdout.write(".");
    await sleep(20_000);
  }
  throw new Error(`Timed out waiting for ${name}`);
}

async function listAppStacks(): Promise<CfnStack[]> {
  const data = await awsJson<{
    StackSummaries: Array<{ StackName: string; StackStatus: string }>;
  }>([
    "cloudformation",
    "list-stacks",
    "--region",
    REGION,
    "--stack-status-filter",
    "CREATE_IN_PROGRESS",
    "CREATE_FAILED",
    "CREATE_COMPLETE",
    "ROLLBACK_IN_PROGRESS",
    "ROLLBACK_FAILED",
    "ROLLBACK_COMPLETE",
    "DELETE_IN_PROGRESS",
    "DELETE_FAILED",
    "UPDATE_IN_PROGRESS",
    "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS",
    "UPDATE_COMPLETE",
    "UPDATE_FAILED",
    "UPDATE_ROLLBACK_IN_PROGRESS",
    "UPDATE_ROLLBACK_FAILED",
    "UPDATE_ROLLBACK_COMPLETE",
    "REVIEW_IN_PROGRESS",
    "IMPORT_IN_PROGRESS",
    "IMPORT_COMPLETE",
    "IMPORT_ROLLBACK_COMPLETE",
  ]);
  return (data?.StackSummaries ?? [])
    .filter(
      (s) =>
        s.StackName === "CDKToolkit" ||
        s.StackName.startsWith("minrv-ew2-") ||
        s.StackName.startsWith("CDKToolkit"),
    )
    .map((s) => ({ StackName: s.StackName, StackStatus: s.StackStatus }));
}

async function inventory(): Promise<Inventory> {
  const identity = await awsJson<{ Account?: string; Arn?: string }>([
    "sts",
    "get-caller-identity",
  ]);

  const toolkit = await describeStack("CDKToolkit", REGION);
  const toolkitUsEast1 = ENABLE_CLOUDFRONT
    ? await describeStack("CDKToolkit", "us-east-1")
    : undefined;

  const vpcs =
    (
      await awsJson<{ Vpcs: Inventory["vpcs"] }>([
        "ec2",
        "describe-vpcs",
        "--region",
        REGION,
        "--filters",
        `Name=cidr-block,Values=${VPC_CIDR}`,
      ])
    )?.Vpcs ?? [];

  const aliases =
    (
      await awsJson<{ Aliases: Array<{ AliasName: string }> }>([
        "kms",
        "list-aliases",
        "--region",
        REGION,
      ])
    )?.Aliases?.map((a) => a.AliasName).filter((n) =>
      n.startsWith("alias/minrv-ew2-"),
    ) ?? [];

  const secrets =
    (
      await awsJson<{ SecretList: Array<{ Name: string }> }>([
        "secretsmanager",
        "list-secrets",
        "--region",
        REGION,
        "--filters",
        "Key=name,Values=minrv/ew2/",
      ])
    )?.SecretList?.map((s) => s.Name) ?? [];

  const buckets =
    (await awsJson<{ Buckets: Array<{ Name: string }> }>(["s3api", "list-buckets"]))
      ?.Buckets?.map((b) => b.Name)
      .filter((n) => n.startsWith("minrv-ew2-")) ?? [];

  const ecr =
    (
      await awsJson<{ repositories: Array<{ repositoryName: string }> }>(
        ["ecr", "describe-repositories", "--region", REGION],
        { allowNotFound: true },
      )
    )?.repositories
      ?.map((r) => r.repositoryName)
      .filter((n) => n.startsWith("minrv-ew2-")) ?? [];

  const detectors =
    (
      await awsJson<{ DetectorIds: string[] }>([
        "guardduty",
        "list-detectors",
        "--region",
        REGION,
      ])
    )?.DetectorIds ?? [];

  const recorders =
    (
      await awsJson<{ ConfigurationRecorders: Array<{ name: string }> }>([
        "configservice",
        "describe-configuration-recorders",
        "--region",
        REGION,
      ])
    )?.ConfigurationRecorders?.map((r) => r.name) ?? [];

  let githubOidc = false;
  try {
    const oidc = await awsJson(
      [
        "iam",
        "get-open-id-connect-provider",
        "--open-id-connect-provider-arn",
        `arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com`,
      ],
      { allowNotFound: true },
    );
    githubOidc = Boolean(oidc);
  } catch {
    githubOidc = false;
  }

  return {
    identity,
    toolkit,
    toolkitUsEast1,
    appStacks: await listAppStacks(),
    vpcs,
    kmsAliases: aliases,
    secrets,
    buckets,
    ecr,
    guardDutyDetectors: detectors,
    configRecorders: recorders,
    githubOidc,
  };
}

function printInventory(inv: Inventory): void {
  console.log("\n=== minrv-ew2 inventory (eu-west-2) ===");
  console.log(`Account:     ${inv.identity?.Account ?? "unknown"}`);
  console.log(`Caller:      ${inv.identity?.Arn ?? "unknown"}`);
  console.log(
    `CDKToolkit:  ${inv.toolkit ? inv.toolkit.StackStatus : "MISSING"}`,
  );
  if (ENABLE_CLOUDFRONT) {
    console.log(
      `Toolkit use1:${inv.toolkitUsEast1 ? inv.toolkitUsEast1.StackStatus : "MISSING"}`,
    );
  }
  console.log(`GitHub OIDC: ${inv.githubOidc ? "present" : "MISSING (will create)"}`);
  console.log(`VPC ${VPC_CIDR}: ${inv.vpcs.map((v) => v.VpcId).join(", ") || "none"}`);
  console.log(`KMS aliases: ${inv.kmsAliases.join(", ") || "none"}`);
  console.log(`Secrets:     ${inv.secrets.join(", ") || "none"}`);
  console.log(`Buckets:     ${inv.buckets.join(", ") || "none"}`);
  console.log(`ECR:         ${inv.ecr.join(", ") || "none"}`);
  console.log(
    `GuardDuty:   ${inv.guardDutyDetectors.length ? inv.guardDutyDetectors.join(", ") : "none"}`,
  );
  console.log(
    `Config:      ${inv.configRecorders.length ? inv.configRecorders.join(", ") : "none"}`,
  );
  console.log("CloudFormation stacks:");
  if (inv.appStacks.length === 0) {
    console.log("  (none)");
  }
  for (const s of inv.appStacks.sort((a, b) =>
    a.StackName.localeCompare(b.StackName),
  )) {
    console.log(`  ${s.StackName.padEnd(42)} ${s.StackStatus}`);
  }
  console.log("");
}

async function ensureGithubOidc(): Promise<void> {
  const arn = `arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com`;
  const existing = await awsJson(
    ["iam", "get-open-id-connect-provider", "--open-id-connect-provider-arn", arn],
    { allowNotFound: true },
  );
  if (existing) {
    console.log("GitHub OIDC provider exists — skip");
    return;
  }
  console.log("Creating GitHub OIDC provider…");
  const result = await runWithRetry("aws", [
    "iam",
    "create-open-id-connect-provider",
    "--url",
    "https://token.actions.githubusercontent.com",
    "--client-id-list",
    "sts.amazonaws.com",
    "--thumbprint-list",
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]);
  if (result.code !== 0) {
    throw new Error(`Failed to create GitHub OIDC provider: ${result.stderr}`);
  }
}

async function ensureBootstrap(region: string): Promise<void> {
  const stack = await describeStack("CDKToolkit", region);
  if (stack && IN_PROGRESS.has(stack.StackStatus)) {
    await waitForStack("CDKToolkit", region);
    return;
  }
  if (stack && HEALTHY.has(stack.StackStatus)) {
    console.log(`CDKToolkit already ${stack.StackStatus} in ${region} — skip bootstrap`);
    return;
  }
  if (
    stack &&
    (stack.StackStatus === "ROLLBACK_COMPLETE" ||
      stack.StackStatus === "ROLLBACK_FAILED" ||
      stack.StackStatus === "DELETE_FAILED")
  ) {
    console.log(`CDKToolkit is ${stack.StackStatus} — deleting before bootstrap`);
    const deleteArgs = [
      "cloudformation",
      "delete-stack",
      "--stack-name",
      "CDKToolkit",
      "--region",
      region,
    ];
    if (stack.StackStatus === "DELETE_FAILED") {
      deleteArgs.push("--retain-resources", "CdkBootstrapVersion");
    }
    await runWithRetry("aws", deleteArgs);
    for (let i = 0; i < 60; i++) {
      const current = await describeStack("CDKToolkit", region);
      if (!current || current.StackStatus === "DELETE_COMPLETE") {
        console.log("CDKToolkit deleted");
        break;
      }
      if (current.StackStatus === "DELETE_FAILED") {
        throw new Error("CDKToolkit DELETE_FAILED — inspect in console");
      }
      await sleep(10_000);
    }
  }
  console.log(`Bootstrapping aws://${ACCOUNT}/${region} …`);
  const result = await runWithRetry(
    "npx",
    ["cdk", "bootstrap", `aws://${ACCOUNT}/${region}`],
    { cwd: INFRA_DIR, inherit: true, label: `cdk bootstrap ${region}` },
  );
  if (result.code !== 0) {
    throw new Error(`cdk bootstrap failed in ${region}`);
  }
}

function desiredCdkStacks(stage: StageName): string[] {
  const names = [
    "minrv-ew2-ecr",
    ...STACK_ORDER.map((suffix) => `minrv-ew2-${stage}-${suffix}`),
  ];
  if (ENABLE_CLOUDFRONT && stage === "prod") {
    names.push("minrv-ew2-prod-cloudfront");
  }
  return names;
}

async function cdkList(): Promise<string[]> {
  const result = await runWithRetry("npx", ["cdk", "ls", ...cdkContextArgs()], {
    cwd: INFRA_DIR,
    label: "cdk ls",
  });
  if (result.code !== 0) {
    throw new Error(`cdk ls failed: ${result.stderr}`);
  }
  return result.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith("[") && !l.startsWith(">") && !l.startsWith("AI "))
    .map((l) => {
      const match = l.match(/^(\S+)(?: \((\S+)\))?$/);
      if (!match) {
        return l;
      }
      return match[1];
    });
}

async function stackHasDiff(artifactId: string): Promise<boolean> {
  // `cdk diff --fail` exits 1 when the template differs. That is success for
  // our purposes — do not treat it as a network error.
  const result = await runWithRetry(
    "npx",
    ["cdk", "diff", artifactId, "--fail", "--exclusively", ...cdkContextArgs()],
    { cwd: INFRA_DIR, label: `cdk diff ${artifactId}`, attempts: 6, okCodes: [0, 1] },
  );
  const blob = `${result.stdout}\n${result.stderr}`;
  if (/no stack named|no stacks match|does not exist/i.test(blob)) {
    return true;
  }
  if (result.code === 0) {
    return false;
  }
  if (result.code === 1) {
    return true;
  }
  if (isTransient(blob)) {
    throw new Error(`transient error during cdk diff ${artifactId}: ${blob.slice(0, 500)}`);
  }
  return true;
}

async function deleteRollbackComplete(name: string, region = REGION): Promise<void> {
  console.log(`    ${name} is failed/rolled back — deleting so it can be recreated`);
  const result = await runWithRetry("aws", [
    "cloudformation",
    "delete-stack",
    "--stack-name",
    name,
    "--region",
    region,
  ]);
  if (result.code !== 0) {
    throw new Error(`Failed to delete ${name}: ${result.stderr}`);
  }
  for (let i = 0; i < 60; i++) {
    const stack = await describeStack(name, region);
    if (!stack || stack.StackStatus === "DELETE_COMPLETE") {
      console.log(`    ${name} deleted`);
      return;
    }
    if (stack.StackStatus === "DELETE_FAILED") {
      throw new Error(`${name} DELETE_FAILED — inspect in console`);
    }
    await sleep(10_000);
  }
  throw new Error(`Timed out deleting ${name}`);
}

async function deployOne(artifactId: string, cfnName: string, region: string): Promise<"skip" | "deployed"> {
  let stack = await describeStack(cfnName, region);
  if (stack && IN_PROGRESS.has(stack.StackStatus)) {
    stack = await waitForStack(cfnName, region);
  }
  if (
    stack?.StackStatus === "ROLLBACK_COMPLETE" ||
    stack?.StackStatus === "ROLLBACK_FAILED"
  ) {
    await deleteRollbackComplete(cfnName, region);
    stack = undefined;
  }
  if (stack?.StackStatus === "UPDATE_ROLLBACK_COMPLETE") {
    console.log(`    ${cfnName} is UPDATE_ROLLBACK_COMPLETE — retrying update`);
  } else if (stack && HEALTHY.has(stack.StackStatus)) {
    const differs = await stackHasDiff(artifactId);
    if (!differs) {
      console.log(`    ${cfnName} matches template — skip`);
      return "skip";
    }
    console.log(`    ${cfnName} exists (${stack.StackStatus}) and differs — update`);
  } else if (!stack) {
    console.log(`    ${cfnName} not found — create`);
  } else {
    console.log(`    ${cfnName} status ${stack.StackStatus} — attempting deploy`);
  }

  const result = await runWithRetry(
    "npx",
    [
      "cdk",
      "deploy",
      artifactId,
      "--exclusively",
      "--require-approval",
      process.stdout.isTTY ? "broadening" : "never",
      "--progress",
      "events",
      ...cdkContextArgs(),
    ],
    { cwd: INFRA_DIR, inherit: true, label: `cdk deploy ${artifactId}`, attempts: 6 },
  );

  if (result.code !== 0) {
    const current = await describeStack(cfnName, region);
    if (current && IN_PROGRESS.has(current.StackStatus)) {
      console.warn(
        `    local CLI failed but CloudFormation is still ${current.StackStatus} — waiting`,
      );
      const done = await waitForStack(cfnName, region);
      if (HEALTHY.has(done.StackStatus)) {
        return "deployed";
      }
    }
    throw new Error(`cdk deploy ${artifactId} failed`);
  }
  return "deployed";
}

function resolveArtifactId(cdkStacks: string[], cfnName: string): string {
  if (cdkStacks.includes(cfnName)) {
    return cfnName;
  }
  const withSlash = cfnName.replace(/^(minrv-ew2-(?:sandbox|prod))-/, "$1/");
  if (cdkStacks.includes(withSlash)) {
    return withSlash;
  }
  const fuzzy = cdkStacks.find((s) => s.replace(/\//g, "-") === cfnName);
  if (fuzzy) {
    return fuzzy;
  }
  return cfnName;
}

async function cmdStatus(): Promise<void> {
  const inv = await inventory();
  printInventory(inv);
  if (inv.identity?.Account && inv.identity.Account !== ACCOUNT) {
    console.warn(
      `WARNING: caller account ${inv.identity.Account} is not ${ACCOUNT}`,
    );
  }
}

async function cmdBootstrap(): Promise<void> {
  await ensureGithubOidc();
  await ensureBootstrap(REGION);
  if (ENABLE_CLOUDFRONT) {
    await ensureBootstrap("us-east-1");
  }
}

async function cmdDiff(): Promise<void> {
  const stage = stageFromApp();
  const listed = await cdkList();
  for (const name of desiredCdkStacks(stage)) {
    const artifact = resolveArtifactId(listed, name);
    console.log(`\n--- diff ${artifact} ---`);
    run("npx", ["cdk", "diff", artifact, ...cdkContextArgs()], {
      cwd: INFRA_DIR,
      inherit: true,
    });
  }
}

async function cmdDeploy(): Promise<void> {
  const stage = stageFromApp();
  if (stage === "prod" && CONFIRM !== "YES") {
    throw new Error("Prod deploy requires CONFIRM=YES");
  }

  const inv = await inventory();
  printInventory(inv);

  if (inv.identity?.Account && inv.identity.Account !== ACCOUNT) {
    throw new Error(`Wrong account ${inv.identity.Account}; expected ${ACCOUNT}`);
  }

  const ourCompliance = inv.appStacks.some((s) =>
    /minrv-ew2-(sandbox|prod)-compliance$/.test(s.StackName),
  );
  if (
    (inv.guardDutyDetectors.length > 0 || inv.configRecorders.length > 0) &&
    !ourCompliance
  ) {
    process.env.SKIP_REGIONAL_SECURITY = "1";
    console.log(
      "Regional GuardDuty/Config already present and not owned by minrv-ew2 compliance — skipping them",
    );
  }

  if (
    inv.vpcs.length &&
    !inv.appStacks.some((s) => s.StackName.includes("-network"))
  ) {
    console.warn(
      `A VPC already uses ${VPC_CIDR}: ${inv.vpcs.map((vpc) => vpc.VpcId).join(", ")}. If it is not a minrv-ew2 stack, abort and pick another CIDR.`,
    );
  }

  await cmdBootstrap();

  const listed = await cdkList();
  const wanted = desiredCdkStacks(stage);
  console.log("Deploy plan:");
  for (const name of wanted) {
    console.log(`  - ${resolveArtifactId(listed, name)}`);
  }

  let skipped = 0;
  let deployed = 0;
  for (const name of wanted) {
    const artifact = resolveArtifactId(listed, name);
    const region = name.includes("cloudfront") ? "us-east-1" : REGION;
    console.log(`\n>>> ${artifact}`);
    const outcome = await deployOne(artifact, name, region);
    if (outcome === "skip") {
      skipped += 1;
    } else {
      deployed += 1;
    }
  }
  console.log(`\nDone. updated=${deployed} skipped=${skipped}`);
  console.log(
    "Next: complete the eu-west-2 GitHub connection if it is PENDING, then git push (or make pipeline-start). See docs/cicd.md.",
  );
}

async function cmdDestroy(): Promise<void> {
  const stage = stageFromApp();
  if (stage === "prod" && CONFIRM !== "YES") {
    throw new Error("Prod destroy requires CONFIRM=YES");
  }
  const listed = await cdkList();
  const wanted = desiredCdkStacks(stage).slice().reverse();
  for (const name of wanted) {
    if (name === "minrv-ew2-ecr") {
      console.log("Leaving shared ECR stack minrv-ew2-ecr in place (images).");
      continue;
    }
    const artifact = resolveArtifactId(listed, name);
    console.log(`\n>>> destroy ${artifact}`);
    const result = await runWithRetry(
      "npx",
      ["cdk", "destroy", artifact, "--exclusively", "--force", ...cdkContextArgs()],
      { cwd: INFRA_DIR, inherit: true, label: `cdk destroy ${artifact}` },
    );
    if (result.code !== 0) {
      throw new Error(`destroy ${artifact} failed`);
    }
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "status";
  process.env.AWS_REGION = process.env.AWS_REGION ?? REGION;
  process.env.AWS_DEFAULT_REGION = process.env.AWS_DEFAULT_REGION ?? REGION;
  process.env.CDK_DEFAULT_ACCOUNT = process.env.CDK_DEFAULT_ACCOUNT ?? ACCOUNT;
  process.env.CDK_DEFAULT_REGION = process.env.CDK_DEFAULT_REGION ?? REGION;

  if (cmd === "status" || cmd === "inventory") {
    await cmdStatus();
    return;
  }
  if (cmd === "bootstrap") {
    await cmdStatus();
    await cmdBootstrap();
    return;
  }
  if (cmd === "diff") {
    await cmdDiff();
    return;
  }
  if (cmd === "deploy") {
    await cmdDeploy();
    return;
  }
  if (cmd === "destroy") {
    await cmdDestroy();
    return;
  }
  console.error(
    "Unknown command. Use: status | bootstrap | diff | deploy | destroy",
  );
  process.exit(2);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
