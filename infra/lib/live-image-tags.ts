import { spawnSync } from "node:child_process";
import {
  cortexAgentRuntimeName,
  ecrCortexAgentRepo,
  ecrSentinelRepo,
  ecrWebRepo,
  REGION,
  type StageName,
} from "./config";

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

/**
 * The image tag the stage's Cortex agent runtime runs now, or undefined when it has
 * none yet. The runtime only exists while synth is given a tag, so a deploy without
 * CORTEX_AGENT_IMAGE_TAG keeps this one instead of removing the runtime. A failed
 * lookup stops the synth rather than guess.
 */
export function liveCortexAgentImageTag(stage: StageName): string | undefined {
  const name = cortexAgentRuntimeName(stage);
  const listed = awsCall<{ agentRuntimes?: Array<{ agentRuntimeId?: string; agentRuntimeName?: string }> }>([
    "bedrock-agentcore-control",
    "list-agent-runtimes",
  ]);
  const runtimeId = listed.agentRuntimes?.find((runtime) => runtime.agentRuntimeName === name)?.agentRuntimeId;
  if (!runtimeId) {
    return undefined;
  }
  const runtime = awsCall<{
    agentRuntimeArtifact?: { containerConfiguration?: { containerUri?: string } };
  }>(["bedrock-agentcore-control", "get-agent-runtime", "--agent-runtime-id", runtimeId]);
  const tag = parseEcrImageTag(runtime.agentRuntimeArtifact?.containerConfiguration?.containerUri, ecrCortexAgentRepo());
  if (!tag) {
    throw new Error(`Cortex agent runtime ${name} runs an image without a commit tag; set CORTEX_AGENT_IMAGE_TAG.`);
  }
  return tag;
}

function awsCall<T>(args: string[]): T {
  const result = spawnSync("aws", [...args, "--region", REGION, "--output", "json"], {
    encoding: "utf-8",
    env: process.env,
    timeout: 25_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `Could not read the live Cortex agent runtime (aws ${args.slice(0, 2).join(" ")}): ` +
        `${(result.stderr ?? "").trim().slice(0, 300)}\n` +
        "Give your user bedrock-agentcore:ListAgentRuntimes and GetAgentRuntime " +
        "(infra/iam/minrv-ew2-cortex-operator.json), or set CORTEX_AGENT_IMAGE_TAG.",
    );
  }
  return JSON.parse(result.stdout || "{}") as T;
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
