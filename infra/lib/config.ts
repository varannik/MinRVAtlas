import * as cdk from "aws-cdk-lib";

export const ACCOUNT = "625239230739";
export const REGION = "eu-west-2";
export const EDGE_REGION = "us-east-1";
export const VPC_CIDR = "10.44.0.0/16";
export const AZS = ["eu-west-2a", "eu-west-2b", "eu-west-2c"] as const;

export const PROJECT = "minrv-ew2";
export const STACK_PREFIX = "minrv-ew2";

export type StageName = "sandbox" | "prod";
export type IsometricApi = "sandbox" | "production";

export interface StageConfig {
  stageName: StageName;
  isometricApi: IsometricApi;
  natGateways: number;
  auroraMinAcu: number;
  auroraMaxAcu: number;
  webCount: number;
  apiCount: number;
  workerCount: number;
  beatCount: 1;
  deletionProtection: boolean;
  backupDays: number;
  logRetentionDays: number;
  objectLock: boolean;
  fargateSpot: boolean;
  /** GuardDuty / Security Hub / Config / Analyzer — once per region, not per stage. */
  enableRegionalSecurityServices: boolean;
  cloudTrailDataEvents: boolean;
  domainName?: string;
  hostedZoneId?: string;
  hostedZoneName?: string;
  opsEmail?: string;
  githubOrg?: string;
  githubRepo?: string;
  /** CodeConnections / CodeStar connection in eu-west-2 (not a PAT). */
  githubConnectionArn?: string;
  /** Branch that starts this stage's pipeline. */
  githubBranch?: string;
  webImageTag?: string;
  sentinelImageTag?: string;
  enableCloudFront: boolean;
}

export const ENV_EW2: cdk.Environment = { account: ACCOUNT, region: REGION };
export const ENV_EDGE: cdk.Environment = { account: ACCOUNT, region: EDGE_REGION };

export const BEDROCK_INFERENCE_PROFILE =
  "eu.anthropic.claude-sonnet-4-5-20250929-v1:0";

export const PLACEHOLDER_IMAGE = "public.ecr.aws/nginx/nginx:1.27-alpine";

export function isometricHost(api: IsometricApi): string {
  return api === "sandbox"
    ? "https://api.sandbox.isometric.com"
    : "https://api.isometric.com";
}

export function cfnStackName(stage: StageName, suffix: string): string {
  return `${STACK_PREFIX}-${stage}-${suffix}`;
}

export function resourceName(stage: StageName, suffix: string): string {
  return `${STACK_PREFIX}-${stage}-${suffix}`;
}

export function kmsAlias(stage: StageName): string {
  return `alias/${STACK_PREFIX}-${stage}`;
}

export function appSecretName(stage: StageName): string {
  return `minrv/ew2/${stage}/app`;
}

export function isometricSecretName(stage: StageName): string {
  return `minrv/ew2/${stage}/isometric`;
}

/** Operator-entered WGS84 pins. Not a secret; Isometric does not return site coordinates. */
export function projectLocationsParamName(stage: StageName): string {
  return `/minrv/ew2/${stage}/project-locations`;
}

export function entraSecretName(stage: StageName): string {
  return `minrv/ew2/${stage}/entra`;
}

export function evidenceBucketName(stage: StageName, account = ACCOUNT): string {
  return `${STACK_PREFIX}-${stage}-evidence-${account}`;
}

export function logsBucketName(stage: StageName, account = ACCOUNT): string {
  return `${STACK_PREFIX}-${stage}-logs-${account}`;
}

export function ecrWebRepo(): string {
  return `${STACK_PREFIX}-web`;
}

export function ecrSentinelRepo(): string {
  return `${STACK_PREFIX}-sentinel`;
}

export const STACK_ORDER = [
  "network",
  "security",
  "data",
  "compute",
  "edge",
  "observability",
  "compliance",
  "pipeline",
] as const;

export type StackSuffix = (typeof STACK_ORDER)[number];

export function sandboxConfig(overrides: Partial<StageConfig> = {}): StageConfig {
  return {
    stageName: "sandbox",
    isometricApi: "sandbox",
    natGateways: 1,
    auroraMinAcu: 0.5,
    auroraMaxAcu: 4,
    webCount: 1,
    apiCount: 1,
    workerCount: 1,
    beatCount: 1,
    deletionProtection: false,
    backupDays: 7,
    logRetentionDays: 30,
    objectLock: false,
    fargateSpot: false,
    enableRegionalSecurityServices: true,
    cloudTrailDataEvents: false,
    githubOrg: "varannik",
    githubRepo: "MinRVAtlas",
    githubBranch: "main",
    enableCloudFront: false,
    ...overrides,
  };
}

export function prodConfig(overrides: Partial<StageConfig> = {}): StageConfig {
  return {
    stageName: "prod",
    isometricApi: "production",
    natGateways: 3,
    auroraMinAcu: 0.5,
    auroraMaxAcu: 16,
    webCount: 2,
    apiCount: 2,
    workerCount: 2,
    beatCount: 1,
    deletionProtection: true,
    backupDays: 35,
    logRetentionDays: 365,
    objectLock: true,
    fargateSpot: false,
    enableRegionalSecurityServices: false,
    cloudTrailDataEvents: true,
    githubOrg: "varannik",
    githubRepo: "MinRVAtlas",
    githubBranch: "main",
    enableCloudFront: false,
    ...overrides,
  };
}

export function logGroupName(stage: StageName, service: string): string {
  return `/minrv/ew2/${stage}/${service}`;
}
