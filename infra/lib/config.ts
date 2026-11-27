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

/**
 * Cortex: knowledge base, MCP tool gateway, approval-workflow state and the
 * evidence graph (see the Cortex AWS Blueprint). Tenant isolation is enforced
 * at the gateway, in IAM (session tags), in the bucket policies and in Postgres
 * row-level security, so a mistake in one layer is caught by the next.
 */
export interface CortexConfig {
  /** Create the Cortex stacks for this stage at all. */
  enabled: boolean;
  /** Knowledge Aurora (Serverless v2, Data API). 0 lets an idle cluster pause. */
  knowledgeMinAcu: number;
  knowledgeMaxAcu: number;
  /** Neptune Database (serverless) for the live evidence graph. Billed while it exists. */
  graph: boolean;
  graphMinNcu: number;
  graphMaxNcu: number;
  /** Neptune Analytics for cross-project analytics (blueprint phase 5). Billed every hour it exists. */
  graphAnalytics: boolean;
  /** Neptune Analytics memory in m-NCU. */
  graphAnalyticsMemory: number;
  /** AgentCore Policy on the gateway: LOG_ONLY until the policies are proven, then ENFORCE. */
  policyMode: "LOG_ONLY" | "ENFORCE";
  /** Cortex agent image tag in ECR. No AgentCore Runtime is created until one is pushed. */
  agentImageTag?: string;
  /** LangGraph checkpoints older than this are removed by DynamoDB TTL. */
  checkpointTtlDays: number;
  /** AgentCore Memory event expiry (conversation only, never knowledge). */
  memoryExpiryDays: number;
  /** EventBridge archive retention; the graph and index are rebuilt from it. */
  eventArchiveDays: number;
}

/**
 * Tenant and project ids. Lowercase letters, digits and hyphens only: no "#",
 * "/" or "_", so they can sit inside DynamoDB keys, S3 prefixes and LangGraph
 * thread ids ("{tenant}#{project}#…") without one id ever matching another's prefix.
 */
export const TENANT_ID_PATTERN = "^[a-z0-9][a-z0-9-]{1,39}$";

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
  /**
   * Force ECS desiredCount 0 even when image tags are known.
   * Empty bootstrap only — omitting tags is no longer how you drain services.
   */
  scaleToZero?: boolean;
  enableCloudFront: boolean;
  /**
   * Extra hosted-UI callback after HTTPS exists (CloudFront `https://*.cloudfront.net/auth/callback`
   * or `https://{DOMAIN_NAME}/auth/callback`). Localhost is always registered.
   * Never pass `http://*.elb.amazonaws.com` — Cognito rejects it and the identity stack rolls back.
   */
  cognitoCallbackUrl?: string;
  cognitoLogoutUrl?: string;
  cortex: CortexConfig;
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
/** The Atlas table: catalogue, 3D site model pointers, practice journeys (apps/web/src/lib/atlas/keys.ts). */
export function atlasTableName(stage: StageName): string {
  return resourceName(stage, "atlas");
}

/** The Atlas bucket: 3D site model versions and seeded monitoring histories. */
export function atlasBucketName(stage: StageName, account = ACCOUNT): string {
  return `${STACK_PREFIX}-${stage}-atlas-assets-${account}`;
}

export function projectLocationsParamName(stage: StageName): string {
  return `/minrv/ew2/${stage}/project-locations`;
}

export function entraSecretName(stage: StageName): string {
  return `minrv/ew2/${stage}/entra`;
}

export function sessionKeySecretName(stage: StageName): string {
  return `minrv/ew2/${stage}/session-key`;
}

export function cognitoClientSecretName(stage: StageName): string {
  return `minrv/ew2/${stage}/cognito`;
}

/** Globally unique Cognito hosted-UI prefix. Created in eu-west-2; not imported. */
export function cognitoDomainPrefix(stage: StageName): string {
  return `${STACK_PREFIX}-${stage}`;
}

export function evidenceBucketName(stage: StageName, account = ACCOUNT): string {
  return `${STACK_PREFIX}-${stage}-evidence-${account}`;
}

export function streamBucketName(stage: StageName, account = ACCOUNT): string {
  return `${STACK_PREFIX}-${stage}-stream-${account}`;
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

export function ecrCortexAgentRepo(): string {
  return `${STACK_PREFIX}-cortex-agent`;
}

/**
 * Cortex buckets: `intake` (uploads, scanned), `knowledge` (admitted originals)
 * and `parsed` (Data Automation output and rule passages; rebuilt from knowledge).
 */
export function cortexBucketName(
  stage: StageName,
  kind: "intake" | "knowledge" | "parsed",
  account = ACCOUNT,
): string {
  return `${STACK_PREFIX}-${stage}-cortex-${kind}-${account}`;
}

/** Cortex names the web app is told about; fixed, so no cross-stack exports are needed. */
export function cortexTenancyTableName(stage: StageName): string {
  return resourceName(stage, "cortex-tenancy");
}

/** Each project's journey: answers, filings, where it stands, and a record of every change. */
export function cortexJourneyTableName(stage: StageName): string {
  return resourceName(stage, "cortex-journeys");
}

export function cortexTenantSessionRoleName(stage: StageName): string {
  return resourceName(stage, "cortex-tenant-session");
}

/** State machine the web starts to take a project document out of Cortex. */
export function cortexRemovalStateMachineName(stage: StageName): string {
  return resourceName(stage, "cortex-removal");
}

/** State machine the web starts when a person decides on a labelled document (keep it in search, keep it where it is). */
/** Registry values the journey checks with: approved values and Cortex's proposals, per edition. */
export function cortexRequirementsTableName(stage: StageName): string {
  return resourceName(stage, "cortex-requirements");
}

export function cortexProposeStateMachineName(stage: StageName): string {
  return resourceName(stage, "cortex-propose-requirements");
}

export function cortexReviewStateMachineName(stage: StageName): string {
  return resourceName(stage, "cortex-review");
}

/** State machine the web starts to move a document to another pin, or to or from every project. */
export function cortexMoveStateMachineName(stage: StageName): string {
  return resourceName(stage, "cortex-move");
}

/**
 * Data quality engine (infra/lib/quality, apps/quality-engine): each project's runs,
 * findings and people's decisions on them. Fixed names, so the web and the Cortex
 * tool reach them without cross-stack exports.
 */
/** The mock verifier's record per project: the imported Audit Document Index, submission files, filings. */
export function verificationTableName(stage: StageName): string {
  return resourceName(stage, "verification");
}

/** A project's submission as received, every file as delivered, under <tenant>/<project>/. */
export function verificationBucketName(stage: StageName, account = ACCOUNT): string {
  return `${STACK_PREFIX}-${stage}-verification-${account}`;
}

export function qualityTableName(stage: StageName): string {
  return resourceName(stage, "quality");
}

/** Intermediate day summaries of a run (deleted after two weeks). */
export function qualityBucketName(stage: StageName, account = ACCOUNT): string {
  return `${STACK_PREFIX}-${stage}-quality-${account}`;
}

/** State machine the web starts to check a project's monitoring data. */
export function qualityRunStateMachineName(stage: StageName): string {
  return resourceName(stage, "quality-run");
}

export function webTaskRoleName(stage: StageName): string {
  return resourceName(stage, "web-task");
}

/**
 * Browser origins the web app is served from (custom domain, CloudFront), plus
 * localhost on the sandbox. Browsers upload documents straight to the Cortex
 * intake bucket, so these are its CORS origins.
 */
export function webOrigins(cfg: StageConfig): string[] {
  const origins = new Set<string>();
  if (cfg.domainName) origins.add(`https://${cfg.domainName}`);
  for (const url of [cfg.cognitoCallbackUrl, cfg.cognitoLogoutUrl]) {
    if (url?.startsWith("https://")) origins.add(new URL(url).origin);
  }
  if (cfg.stageName === "sandbox") origins.add("http://localhost:3000");
  return [...origins];
}

/**
 * Bedrock Data Automation profile for documents. Created in London it routes only
 * to eu-west-2, so parsing stays in the UK (docs: bda-cris).
 */
export function bdaProfileArn(region: string, account: string): string {
  return `arn:aws:bedrock:${region}:${account}:data-automation-profile/eu.data-automation-v1`;
}

/**
 * Claude for the Cortex agent, through the EU inference profile so prompts stay in
 * EU regions. Effort sets how much it thinks (and so latency and cost) per answer.
 * Sonnet 4.6 because this AWS account is refused newer Claude models (Nov 2026);
 * move to eu.anthropic.claude-opus-5-5 once AWS opens it for the account.
 */
export const CORTEX_AGENT_MODEL = "eu.anthropic.claude-sonnet-4-6";
export const CORTEX_AGENT_EFFORT = "medium";

/**
 * Claude for labelling each admitted document (its kind, title and version), through the
 * EU inference profile. A short classification of the opening pages, so the small model:
 * Haiku 4.5, the newest small Claude this account is allowed (Nov 2026).
 */
export const CORTEX_LABEL_MODEL = "eu.anthropic.claude-haiku-4-5-20251001-v1:0";
/**
 * The model that writes a quality run's optional summary for operators (EU inference
 * profile, so findings stay in EU regions). The agent's model: it already runs here.
 */
export const QUALITY_SUMMARY_MODEL = CORTEX_AGENT_MODEL;

/**
 * Claude for proposing registry values (a number, its clause and a quoted sentence)
 * from the rules: precision matters more than speed, so the agent's model.
 */
export const CORTEX_PROPOSE_MODEL = CORTEX_AGENT_MODEL;

/**
 * SSM parameter holding the Cortex agent runtime's ARN. AgentCore generates the
 * runtime id, so the web app reads the ARN from here instead of being told it.
 */
export function cortexAgentRuntimeParamName(stage: StageName): string {
  return `/minrv/ew2/${stage}/cortex/agent-runtime-arn`;
}

/** AgentCore runtime names allow letters, digits and underscores only. */
export function cortexAgentRuntimeName(stage: StageName): string {
  return `${STACK_PREFIX.replace(/-/g, "_")}_${stage}_cortex`;
}

/** Titan Text Embeddings V2 runs in-region in London; 1024 dimensions. */
export const CORTEX_EMBEDDING_MODEL = "amazon.titan-embed-text-v2:0";
export const CORTEX_EMBEDDING_DIMENSIONS = 1024;

export const STACK_ORDER = [
  "network",
  "security",
  "identity",
  "data",
  "compute",
  "edge",
  "observability",
  "compliance",
  "pipeline",
] as const;

export type StackSuffix = (typeof STACK_ORDER)[number];

/** The quality engine sits on Cortex's rails (event bus, tenant session), so it deploys with them, before the agent whose tool reads it. */
export const CORTEX_STACKS = [
  "cortex-core",
  "cortex-knowledge",
  "cortex-graph",
  "quality",
  "verification",
  "cortex-agent",
] as const;

export type CortexStackSuffix = (typeof CORTEX_STACKS)[number];

/** Deploy order for a stage: Cortex stacks go after compliance, before the pipeline. */
export function stackOrder(cfg: StageConfig): string[] {
  const cortex = cfg.cortex.enabled
    ? CORTEX_STACKS.filter((suffix) => suffix !== "cortex-graph" || cfg.cortex.graph)
    : [];
  return [
    ...STACK_ORDER.filter((suffix) => suffix !== "pipeline"),
    ...cortex,
    "pipeline",
  ];
}

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
    cortex: {
      enabled: true,
      knowledgeMinAcu: 0,
      knowledgeMaxAcu: 4,
      graph: true,
      graphMinNcu: 1,
      graphMaxNcu: 4,
      graphAnalytics: false,
      graphAnalyticsMemory: 16,
      policyMode: "LOG_ONLY",
      checkpointTtlDays: 30,
      memoryExpiryDays: 30,
      eventArchiveDays: 90,
    },
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
    cortex: {
      // Off until the sandbox passes `npm run cortex:readiness`.
      enabled: false,
      knowledgeMinAcu: 0.5,
      knowledgeMaxAcu: 16,
      graph: true,
      graphMinNcu: 1,
      graphMaxNcu: 16,
      graphAnalytics: false,
      graphAnalyticsMemory: 16,
      policyMode: "ENFORCE",
      checkpointTtlDays: 400,
      memoryExpiryDays: 90,
      eventArchiveDays: 3650,
    },
    ...overrides,
  };
}

export function logGroupName(stage: StageName, service: string): string {
  return `/minrv/ew2/${stage}/${service}`;
}
