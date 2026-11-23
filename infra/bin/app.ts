#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import {
  ENV_EW2,
  prodConfig,
  sandboxConfig,
  type StageConfig,
} from "../lib/config";
import { liveCognitoUrls } from "../lib/live-cognito-urls";
import { liveCortexAgentImageTag, resolveLiveImageTags } from "../lib/live-image-tags";
import { PipelineStack } from "../lib/pipeline-stack";
import { RegistryStack } from "../lib/registry-stack";
import { MinrvStage } from "../lib/stage";

const app = new cdk.App();

const enableCloudFront =
  app.node.tryGetContext("enableCloudFront") === true ||
  app.node.tryGetContext("enableCloudFront") === "true" ||
  process.env.ENABLE_CLOUDFRONT === "1";

const domainName = optionalString(app, "domainName");
const hostedZoneId = optionalString(app, "hostedZoneId");
const hostedZoneName = optionalString(app, "hostedZoneName");
const opsEmail = optionalString(app, "opsEmail");
const githubOrg = optionalString(app, "githubOrg");
const githubRepo = optionalString(app, "githubRepo");
const githubBranchSandbox =
  optionalString(app, "githubBranch") ?? process.env.GITHUB_BRANCH ?? "main";
const githubBranchProd =
  optionalString(app, "githubBranchProd") ??
  process.env.GITHUB_BRANCH_PROD ??
  "main";
const scaleToZero =
  app.node.tryGetContext("scaleToZero") === true ||
  app.node.tryGetContext("scaleToZero") === "true" ||
  process.env.SCALE_TO_ZERO === "1";
const webImageTagOverride =
  optionalString(app, "webImageTag") ?? process.env.WEB_IMAGE_TAG;
const sentinelImageTagOverride =
  optionalString(app, "sentinelImageTag") ?? process.env.SENTINEL_IMAGE_TAG;
const liveSandbox = scaleToZero ? {} : resolveLiveImageTags("sandbox");
const liveProd = scaleToZero ? {} : resolveLiveImageTags("prod");
if (liveSandbox.webImageTag || liveSandbox.sentinelImageTag) {
  console.log(
    `[minrv] live ECS tags sandbox: web=${liveSandbox.webImageTag ?? "(none)"} sentinel=${liveSandbox.sentinelImageTag ?? "(none)"}`,
  );
}
if (liveProd.webImageTag || liveProd.sentinelImageTag) {
  console.log(
    `[minrv] live ECS tags prod: web=${liveProd.webImageTag ?? "(none)"} sentinel=${liveProd.sentinelImageTag ?? "(none)"}`,
  );
}

const skipRegionalSecurity =
  app.node.tryGetContext("skipRegionalSecurity") === true ||
  app.node.tryGetContext("skipRegionalSecurity") === "true" ||
  process.env.SKIP_REGIONAL_SECURITY === "1";

const registry = new RegistryStack(app, "minrv-ew2-ecr", { env: ENV_EW2 });

const githubConnectionArn =
  optionalString(app, "githubConnectionArn") ??
  process.env.GITHUB_CONNECTION_ARN ??
  registry.githubConnectionArn;

/**
 * Sign-in and sign-out addresses: given (context or COGNITO_CALLBACK_URL / COGNITO_LOGOUT_URL),
 * or the ones the stage's web runs with now, so a deploy from a terminal without the
 * variables keeps sandbox sign-in on its HTTPS address instead of localhost.
 */
const loggedCognito = new Set<string>();
function cognitoUrls(stage: "sandbox" | "prod"): { cognitoCallbackUrl?: string; cognitoLogoutUrl?: string } {
  const callback = optionalString(app, "cognitoCallbackUrl") ?? process.env.COGNITO_CALLBACK_URL;
  const logout = optionalString(app, "cognitoLogoutUrl") ?? process.env.COGNITO_LOGOUT_URL;
  if (domainName || (callback && logout)) return { cognitoCallbackUrl: callback, cognitoLogoutUrl: logout };
  const live = liveCognitoUrls(stage);
  if (live.callbackUrl && !callback && !loggedCognito.has(stage)) {
    loggedCognito.add(stage);
    console.log(`[minrv] live Cognito sign-in ${stage}: ${live.callbackUrl}`);
  }
  return { cognitoCallbackUrl: callback ?? live.callbackUrl, cognitoLogoutUrl: logout ?? live.logoutUrl };
}

function extras(stage: "sandbox" | "prod"): Partial<StageConfig> {
  return {
    domainName,
    hostedZoneId,
    hostedZoneName,
    opsEmail,
    githubOrg,
    githubRepo,
    githubConnectionArn,
    githubBranch: stage === "prod" ? githubBranchProd : githubBranchSandbox,
    webImageTag:
      webImageTagOverride ??
      (stage === "prod" ? liveProd.webImageTag : liveSandbox.webImageTag),
    sentinelImageTag:
      sentinelImageTagOverride ??
      (stage === "prod" ? liveProd.sentinelImageTag : liveSandbox.sentinelImageTag),
    scaleToZero,
    enableCloudFront,
    enableRegionalSecurityServices: stage === "sandbox" && !skipRegionalSecurity,
    ...cognitoUrls(stage),
  };
}

/**
 * Cortex agent image: no AgentCore Runtime is created until a tag is given. Without
 * CORTEX_AGENT_IMAGE_TAG the runtime keeps the image it runs now.
 */
const cortexAgentImageTag =
  optionalString(app, "cortexAgentImageTag") ?? process.env.CORTEX_AGENT_IMAGE_TAG;
function withCortex(cfg: StageConfig): StageConfig {
  if (!cfg.cortex.enabled) return cfg;
  const tag = cortexAgentImageTag ?? liveCortexAgentImageTag(cfg.stageName);
  if (tag && !cortexAgentImageTag) {
    console.log(`[minrv] live Cortex agent tag ${cfg.stageName}: ${tag}`);
  }
  return tag ? { ...cfg, cortex: { ...cfg.cortex, agentImageTag: tag } } : cfg;
}

new MinrvStage(app, "minrv-ew2-sandbox", {
  env: ENV_EW2,
  cfg: withCortex(sandboxConfig(extras("sandbox"))),
});

new MinrvStage(app, "minrv-ew2-prod", {
  env: ENV_EW2,
  cfg: withCortex(prodConfig(extras("prod"))),
});

const sandboxPipeline = new PipelineStack(app, "minrv-ew2-sandbox-pipeline", {
  env: ENV_EW2,
  cfg: sandboxConfig(extras("sandbox")),
});
sandboxPipeline.addStackDependency(registry);

const prodPipeline = new PipelineStack(app, "minrv-ew2-prod-pipeline", {
  env: ENV_EW2,
  cfg: prodConfig(extras("prod")),
});
prodPipeline.addStackDependency(registry);

app.synth();

function optionalString(cdkApp: cdk.App, key: string): string | undefined {
  const value = cdkApp.node.tryGetContext(key);
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return undefined;
}
