#!/usr/bin/env npx ts-node
/**
 * Build and push web + sentinel images to eu-west-2 ECR.
 * Skips a repo if the git-sha tag already exists. Retries on flaky links.
 */
import { spawnSync } from "node:child_process";
import { ACCOUNT, REGION, ecrSentinelRepo, ecrWebRepo } from "../lib/config";
import { awsJson, runWithRetry } from "./aws";

const ROOT = `${__dirname}/../..`;

function gitSha(): string {
  const r = spawnSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf-8",
  });
  if (r.status !== 0) {
    throw new Error(
      "Need a git sha for immutable image tags (set IMAGE_TAG if this tree has no .git)",
    );
  }
  return r.stdout.trim();
}

async function imageExists(repo: string, tag: string): Promise<boolean> {
  const data = await awsJson(
    [
      "ecr",
      "describe-images",
      "--region",
      REGION,
      "--repository-name",
      repo,
      "--image-ids",
      `imageTag=${tag}`,
    ],
    { allowNotFound: true },
  );
  return Boolean(data);
}

async function login(): Promise<void> {
  const result = await runWithRetry(
    "bash",
    [
      "-lc",
      `aws ecr get-login-password --region ${REGION} | docker login --username AWS --password-stdin ${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com`,
    ],
    { label: "ecr login", attempts: 5 },
  );
  if (result.code !== 0) {
    throw new Error("ECR login failed");
  }
}

async function buildPush(opts: {
  repo: string;
  dockerfile: string;
  context: string;
  tag: string;
}): Promise<void> {
  const uri = `${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${opts.repo}:${opts.tag}`;
  if (await imageExists(opts.repo, opts.tag)) {
    console.log(`${opts.repo}:${opts.tag} already in ECR — skip`);
    return;
  }
  console.log(`Building ${uri}`);
  const build = await runWithRetry(
    "docker",
    [
      "build",
      "--platform",
      "linux/amd64",
      "-f",
      opts.dockerfile,
      "-t",
      uri,
      opts.context,
    ],
    { cwd: ROOT, inherit: true, label: `docker build ${opts.repo}`, attempts: 3 },
  );
  if (build.code !== 0) {
    throw new Error(`docker build ${opts.repo} failed`);
  }
  const push = await runWithRetry("docker", ["push", uri], {
    inherit: true,
    label: `docker push ${opts.repo}`,
    attempts: 6,
  });
  if (push.code !== 0) {
    throw new Error(`docker push ${opts.repo} failed`);
  }
}

async function main(): Promise<void> {
  const tag = process.env.IMAGE_TAG || gitSha();
  await login();
  await buildPush({
    repo: ecrWebRepo(),
    dockerfile: "apps/web/Dockerfile",
    context: `${ROOT}/apps/web`,
    tag,
  });
  await buildPush({
    repo: ecrSentinelRepo(),
    dockerfile: "apps/sentinel/backend/Dockerfile",
    context: `${ROOT}/apps/sentinel/backend`,
    tag,
  });
  console.log(
    `\nImages in ECR as ${tag}. Production deploy is AWS CodePipeline, not this script.\n` +
      `  make pipeline-start\n` +
      `To keep CDK compute in sync later: WEB_IMAGE_TAG=${tag} SENTINEL_IMAGE_TAG=${tag} make -C infra deploy`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
