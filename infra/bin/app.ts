#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import {
  ENV_EW2,
  prodConfig,
  sandboxConfig,
  type StageConfig,
} from "../lib/config";
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
const webImageTag = optionalString(app, "webImageTag") ?? process.env.WEB_IMAGE_TAG;
const sentinelImageTag =
  optionalString(app, "sentinelImageTag") ?? process.env.SENTINEL_IMAGE_TAG;

const skipRegionalSecurity =
  app.node.tryGetContext("skipRegionalSecurity") === true ||
  app.node.tryGetContext("skipRegionalSecurity") === "true" ||
  process.env.SKIP_REGIONAL_SECURITY === "1";

const registry = new RegistryStack(app, "minrv-ew2-ecr", { env: ENV_EW2 });

const githubConnectionArn =
  optionalString(app, "githubConnectionArn") ??
  process.env.GITHUB_CONNECTION_ARN ??
  registry.githubConnectionArn;

function extras(stage: "sandbox" | "prod"): Partial<StageConfig> {
  const edge = stage === "prod";
  return {
    domainName: edge ? domainName : undefined,
    hostedZoneId: edge ? hostedZoneId : undefined,
    hostedZoneName: edge ? hostedZoneName : undefined,
    opsEmail,
    githubOrg,
    githubRepo,
    githubConnectionArn,
    githubBranch: stage === "prod" ? githubBranchProd : githubBranchSandbox,
    webImageTag,
    sentinelImageTag,
    enableCloudFront: edge && enableCloudFront,
    enableRegionalSecurityServices: stage === "sandbox" && !skipRegionalSecurity,
  };
}

new MinrvStage(app, "minrv-ew2-sandbox", {
  env: ENV_EW2,
  cfg: sandboxConfig(extras("sandbox")),
});

new MinrvStage(app, "minrv-ew2-prod", {
  env: ENV_EW2,
  cfg: prodConfig(extras("prod")),
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
