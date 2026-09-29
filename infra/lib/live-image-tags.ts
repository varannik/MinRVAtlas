import { spawnSync } from "node:child_process";
import { ecrSentinelRepo, ecrWebRepo, REGION, type StageName } from "./config";

/**
 * Read the Git-SHA ECR tag currently registered on an ECS service.
 *
 * `make deploy` used to omit WEB_IMAGE_TAG / SENTINEL_IMAGE_TAG, so CDK set
 * desiredCount to 0 and the ALB returned 503. Synth/deploy pin these tags
 * from live task definitions unless SCALE_TO_ZERO=1.
 */
export function parseEcrImageTag(
  image: string | undefined,
  repositoryName: string,
): string | undefined {
  if (!image || image.includes("public.ecr.aws/nginx")) {
    return undefined;
  }
  const escaped = repositoryName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = image.match(new RegExp(`${escaped}:([^@\\s]+)`));
  const tag = match?.[1]?.trim();
  if (!tag || tag === "latest") {
    return undefined;
  }
  return tag;
}

export function resolveLiveImageTags(stage: StageName): {
  webImageTag?: string;
  sentinelImageTag?: string;
} {
  if (process.env.SCALE_TO_ZERO === "1") {
    return {};
  }
  return {
    webImageTag: firstLiveTag(stage, ["web"], ecrWebRepo()),
    sentinelImageTag: firstLiveTag(
      stage,
      ["api", "worker", "beat"],
      ecrSentinelRepo(),
    ),
  };
}

function firstLiveTag(
  stage: StageName,
  services: string[],
  repositoryName: string,
): string | undefined {
  for (const short of services) {
    const tag = tagFromService(stage, short, repositoryName);
    if (tag) {
      return tag;
    }
  }
  return undefined;
}

function tagFromService(
  stage: StageName,
  short: string,
  repositoryName: string,
): string | undefined {
  const cluster = `minrv-ew2-${stage}-ecs`;
  const service = `minrv-ew2-${stage}-${short}`;
  const described = awsJson<{
    services?: Array<{ taskDefinition?: string }>;
  }>([
    "ecs",
    "describe-services",
    "--cluster",
    cluster,
    "--services",
    service,
  ]);
  const taskDefinition = described?.services?.[0]?.taskDefinition;
  if (!taskDefinition) {
    return undefined;
  }
  const td = awsJson<{
    taskDefinition?: { containerDefinitions?: Array<{ image?: string }> };
  }>(["ecs", "describe-task-definition", "--task-definition", taskDefinition]);
  return parseEcrImageTag(
    td?.taskDefinition?.containerDefinitions?.[0]?.image,
    repositoryName,
  );
}

function awsJson<T>(args: string[]): T | undefined {
  const result = spawnSync(
    "aws",
    [...args, "--region", REGION, "--output", "json"],
    {
      encoding: "utf-8",
      env: process.env,
      timeout: 25_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    return undefined;
  }
  const text = (result.stdout ?? "").trim();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}
