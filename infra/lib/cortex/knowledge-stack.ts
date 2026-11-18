import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as guardduty from "aws-cdk-lib/aws-guardduty";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as cr from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import {
  CORTEX_EMBEDDING_DIMENSIONS,
  CORTEX_EMBEDDING_MODEL,
  cfnStackName,
  cortexBucketName,
  logGroupName,
  resourceName,
} from "../config";
import { Ew2Stack, type Ew2StackProps } from "../ew2-stack";

export const LAMBDA_DIR = path.join(__dirname, "lambda");
export const PYTHON = lambda.Runtime.PYTHON_3_13;

/** The tag every tenant-scoped session carries; S3, DynamoDB and the bucket policies key on it. */
export const TENANT_TAG = "${aws:PrincipalTag/tenant_id}";
export const PROJECT_TAG = "${aws:PrincipalTag/project_id}";

export interface CortexKnowledgeStackProps extends Ew2StackProps {
  vpc: ec2.IVpc;
  keyArn: string;
  tenancyTable: dynamodb.ITable;
  checkpointsTable: dynamodb.ITable;
  eventBus: events.IEventBus;
}

/**
 * Cortex knowledge: uploads are scanned, admitted under a shared, tenant or
 * project scope, and indexed into a Bedrock knowledge base on Aurora
 * PostgreSQL (pgvector, hybrid search). Structured knowledge (requirements,
 * documents, project facts, approvals) lives in the same cluster under
 * row-level security.
 */
export class CortexKnowledgeStack extends Ew2Stack {
  public readonly intakeBucket: s3.Bucket;
  public readonly knowledgeBucket: s3.Bucket;
  public readonly cluster: rds.DatabaseCluster;
  public readonly appSecret: secretsmanager.Secret;
  public readonly knowledgeBase: bedrock.CfnKnowledgeBase;
  public readonly dataSource: bedrock.CfnDataSource;
  public readonly ingestion: sfn.StateMachine;
  public readonly admitFn: lambda.Function;
  public readonly searchFn: lambda.Function;
  /** Assumed with tenant_id (and project_id) session tags; can only reach that tenant's data. */
  public readonly tenantSessionRole: iam.Role;

  constructor(scope: Construct, id: string, props: CortexKnowledgeStackProps) {
    super(scope, id, {
      ...props,
      stackName: cfnStackName(props.cfg.stageName, "cortex-knowledge"),
      description: `minrv-ew2 ${props.cfg.stageName} Cortex knowledge base, ingestion and tenant-scoped access`,
    });
    const { cfg, vpc } = props;
    const stage = cfg.stageName;
    const key = kms.Key.fromKeyArn(this, "Cmk", props.keyArn);
    const removal = cfg.deletionProtection ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;
    const retention = cfg.logRetentionDays >= 365 ? logs.RetentionDays.ONE_YEAR : logs.RetentionDays.ONE_MONTH;
    const code = lambda.Code.fromAsset(LAMBDA_DIR, { exclude: ["__pycache__", "*.pyc"] });

    // ── Buckets ───────────────────────────────────────────────────────────
    const bucketBase: s3.BucketProps = {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: key,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: removal,
    };
    this.intakeBucket = new s3.Bucket(this, "Intake", {
      ...bucketBase,
      bucketName: cortexBucketName(stage, "intake"),
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: cdk.Duration.days(1) },
        // Admitted files live on in the knowledge bucket; the intake copy is only for the scan.
        { expiration: cdk.Duration.days(30), noncurrentVersionExpiration: cdk.Duration.days(7) },
      ],
    });
    this.knowledgeBucket = new s3.Bucket(this, "Knowledge", {
      ...bucketBase,
      bucketName: cortexBucketName(stage, "knowledge"),
      objectLockEnabled: cfg.objectLock,
      objectLockDefaultRetention: cfg.objectLock ? s3.ObjectLockRetention.governance(cdk.Duration.days(365)) : undefined,
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: cdk.Duration.days(1) },
        { noncurrentVersionExpiration: cdk.Duration.days(cfg.deletionProtection ? 3650 : 90) },
      ],
    });

    // Guardrail: a principal carrying a tenant tag can only touch its own tenant prefix
    // (and read shared/ in the knowledge bucket), whatever its own IAM policy says.
    this.intakeBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "TenantTaggedPrincipalsStayInTheirPrefix",
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion"],
        notResources: [this.intakeBucket.arnForObjects(`tenants/${TENANT_TAG}/*`)],
        conditions: { Null: { "aws:PrincipalTag/tenant_id": "false" } },
      }),
    );
    this.intakeBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "NobodyUploadsIndexMetadata",
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ["s3:PutObject"],
        resources: [this.intakeBucket.arnForObjects("*.metadata.json")],
      }),
    );
    this.knowledgeBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "TenantTaggedPrincipalsReadSharedOrOwnTenant",
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ["s3:GetObject", "s3:GetObjectVersion"],
        notResources: [
          this.knowledgeBucket.arnForObjects("shared/*"),
          this.knowledgeBucket.arnForObjects(`tenants/${TENANT_TAG}/*`),
        ],
        conditions: { Null: { "aws:PrincipalTag/tenant_id": "false" } },
      }),
    );

    // ── GuardDuty malware scan on every upload ───────────────────────────
    const scanRole = new iam.Role(this, "MalwareScanRole", {
      roleName: resourceName(stage, "cortex-malware-scan"),
      assumedBy: new iam.ServicePrincipal("malware-protection-plan.guardduty.amazonaws.com"),
    });
    const managedRule = `arn:aws:events:${this.region}:${this.account}:rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*`;
    scanRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["events:PutRule", "events:DeleteRule", "events:PutTargets", "events:RemoveTargets"],
        resources: [managedRule],
        conditions: { StringLike: { "events:ManagedBy": "malware-protection-plan.guardduty.amazonaws.com" } },
      }),
    );
    scanRole.addToPolicy(new iam.PolicyStatement({ actions: ["events:DescribeRule", "events:ListTargetsByRule"], resources: [managedRule] }));
    scanRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:PutObjectTagging",
          "s3:GetObjectTagging",
          "s3:PutObjectVersionTagging",
          "s3:GetObjectVersionTagging",
        ],
        resources: [this.intakeBucket.arnForObjects("*")],
      }),
    );
    scanRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutBucketNotification", "s3:GetBucketNotification", "s3:ListBucket"],
        resources: [this.intakeBucket.bucketArn],
      }),
    );
    scanRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject"],
        resources: [this.intakeBucket.arnForObjects("malware-protection-resource-validation-object")],
      }),
    );
    scanRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["kms:GenerateDataKey", "kms:Decrypt"],
        resources: [props.keyArn],
        conditions: { StringLike: { "kms:ViaService": `s3.${this.region}.amazonaws.com` } },
      }),
    );
    const scanPlan = new guardduty.CfnMalwareProtectionPlan(this, "UploadScan", {
      role: scanRole.roleArn,
      protectedResource: { s3Bucket: { bucketName: this.intakeBucket.bucketName } },
      actions: { tagging: { status: "ENABLED" } },
    });
    scanPlan.node.addDependency(scanRole);

    // ── Knowledge database (Aurora Serverless v2, Data API, pgvector) ────
    const dbSg = new ec2.SecurityGroup(this, "KnowledgeDbSg", {
      vpc,
      description: "Cortex knowledge Aurora: no network ingress; reached only through the Data API",
      allowAllOutbound: false,
    });
    this.cluster = new rds.DatabaseCluster(this, "KnowledgeDb", {
      clusterIdentifier: resourceName(stage, "cortex-knowledge"),
      engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_16_13 }),
      credentials: rds.Credentials.fromGeneratedSecret("cortex_admin", {
        secretName: `minrv/ew2/${stage}/cortex/db-admin`,
        encryptionKey: key,
      }),
      defaultDatabaseName: "cortex",
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      serverlessV2MinCapacity: cfg.cortex.knowledgeMinAcu,
      serverlessV2MaxCapacity: cfg.cortex.knowledgeMaxAcu,
      writer: rds.ClusterInstance.serverlessV2("writer"),
      enableDataApi: true,
      storageEncrypted: true,
      storageEncryptionKey: key,
      iamAuthentication: true,
      deletionProtection: cfg.deletionProtection,
      backup: { retention: cdk.Duration.days(cfg.backupDays) },
      cloudwatchLogsExports: ["postgresql"],
      parameters: { "rds.force_ssl": "1" },
      removalPolicy: cfg.deletionProtection ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.SNAPSHOT,
    });

    const loginSecret = (idName: string, username: string, description: string) =>
      new secretsmanager.Secret(this, idName, {
        secretName: `minrv/ew2/${stage}/cortex/db-${username.replace("_", "-")}`,
        description,
        encryptionKey: key,
        removalPolicy: removal,
        generateSecretString: {
          secretStringTemplate: JSON.stringify({ username }),
          generateStringKey: "password",
          excludePunctuation: true,
          passwordLength: 40,
        },
      });
    // Tools: subject to row-level security, never BYPASSRLS.
    this.appSecret = loginSecret("AppDbSecret", "cortex_app", "Cortex tools (row-level security applies)");
    // Bedrock Knowledge Bases: the vector table only.
    const kbSecret = loginSecret("KbDbSecret", "bedrock_kb", "Bedrock Knowledge Bases vector store user");

    const migrateLog = new logs.LogGroup(this, "MigrateLogs", {
      logGroupName: logGroupName(stage, "cortex-schema"),
      retention,
      removalPolicy: removal,
    });
    const migrateFn = new lambda.Function(this, "Migrate", {
      functionName: resourceName(stage, "cortex-schema"),
      description: "Create the Cortex schema (row-level security, vector table) through the Data API",
      runtime: PYTHON,
      handler: "migrate.handler",
      code,
      timeout: cdk.Duration.minutes(10),
      memorySize: 256,
      logGroup: migrateLog,
      environment: {
        CLUSTER_ARN: this.cluster.clusterArn,
        ADMIN_SECRET_ARN: this.cluster.secret!.secretArn,
        DATABASE: "cortex",
        ROLE_SECRET_ARNS: [this.appSecret.secretArn, kbSecret.secretArn].join(","),
      },
    });
    this.cluster.grantDataApiAccess(migrateFn);
    this.cluster.secret!.grantRead(migrateFn);
    this.appSecret.grantRead(migrateFn);
    kbSecret.grantRead(migrateFn);
    // grantRead() above leaves out kms:Decrypt: CDK drops a Secrets Manager-scoped
    // grant on a key imported by a deploy-time ARN, and GetSecretValue (direct or
    // through the Data API) then fails with "Access to KMS is not allowed".
    migrateFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["kms:Decrypt"],
        resources: [props.keyArn],
        conditions: { StringEquals: { "kms:ViaService": `secretsmanager.${this.region}.amazonaws.com` } },
      }),
    );
    const sql = readFileSync(path.join(LAMBDA_DIR, "sql", "001_cortex.sql"), "utf8");
    const schema = new cdk.CustomResource(this, "Schema", {
      serviceToken: new cr.Provider(this, "SchemaProvider", { onEventHandler: migrateFn }).serviceToken,
      properties: { SqlSha256: createHash("sha256").update(sql).digest("hex") },
    });
    schema.node.addDependency(this.cluster);

    // ── Bedrock knowledge base ───────────────────────────────────────────
    const embeddingModelArn = `arn:aws:bedrock:${this.region}::foundation-model/${CORTEX_EMBEDDING_MODEL}`;
    const kbRole = new iam.Role(this, "KnowledgeBaseRole", {
      roleName: resourceName(stage, "cortex-kb"),
      assumedBy: new iam.ServicePrincipal("bedrock.amazonaws.com", {
        conditions: {
          StringEquals: { "aws:SourceAccount": this.account },
          ArnLike: { "aws:SourceArn": `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*` },
        },
      }),
    });
    const kbPolicy = new iam.Policy(this, "KnowledgeBasePolicy", {
      roles: [kbRole],
      statements: [
        new iam.PolicyStatement({ actions: ["bedrock:InvokeModel"], resources: [embeddingModelArn] }),
        new iam.PolicyStatement({ actions: ["rds:DescribeDBClusters"], resources: [this.cluster.clusterArn] }),
        new iam.PolicyStatement({
          actions: ["rds-data:ExecuteStatement", "rds-data:BatchExecuteStatement"],
          resources: [this.cluster.clusterArn],
        }),
        new iam.PolicyStatement({ actions: ["secretsmanager:GetSecretValue"], resources: [kbSecret.secretArn] }),
        new iam.PolicyStatement({ actions: ["s3:ListBucket"], resources: [this.knowledgeBucket.bucketArn] }),
        new iam.PolicyStatement({ actions: ["s3:GetObject"], resources: [this.knowledgeBucket.arnForObjects("*")] }),
        new iam.PolicyStatement({ actions: ["kms:Decrypt", "kms:GenerateDataKey"], resources: [props.keyArn] }),
      ],
    });
    this.knowledgeBase = new bedrock.CfnKnowledgeBase(this, "KnowledgeBase", {
      name: resourceName(stage, "cortex-knowledge"),
      description: "Cortex knowledge: shared registry documents, tenant and project documents (filtered per caller)",
      roleArn: kbRole.roleArn,
      knowledgeBaseConfiguration: {
        type: "VECTOR",
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn,
          embeddingModelConfiguration: {
            bedrockEmbeddingModelConfiguration: {
              dimensions: CORTEX_EMBEDDING_DIMENSIONS,
              embeddingDataType: "FLOAT32",
            },
          },
        },
      },
      storageConfiguration: {
        type: "RDS",
        rdsConfiguration: {
          resourceArn: this.cluster.clusterArn,
          credentialsSecretArn: kbSecret.secretArn,
          databaseName: "cortex",
          tableName: "bedrock_integration.bedrock_kb",
          fieldMapping: {
            primaryKeyField: "id",
            vectorField: "embedding",
            textField: "chunks",
            metadataField: "metadata",
            customMetadataField: "custom_metadata",
          },
        },
      },
    });
    this.knowledgeBase.node.addDependency(schema, kbPolicy);
    this.dataSource = new bedrock.CfnDataSource(this, "KnowledgeSource", {
      knowledgeBaseId: this.knowledgeBase.attrKnowledgeBaseId,
      name: resourceName(stage, "cortex-knowledge-s3"),
      description: "Admitted documents with .metadata.json scope files (shared/, tenants/<t>/tenant/, tenants/<t>/projects/<p>/)",
      dataDeletionPolicy: "DELETE",
      dataSourceConfiguration: {
        type: "S3",
        s3Configuration: { bucketArn: this.knowledgeBucket.bucketArn },
      },
      vectorIngestionConfiguration: {
        chunkingConfiguration: {
          chunkingStrategy: "HIERARCHICAL",
          hierarchicalChunkingConfiguration: {
            levelConfigurations: [{ maxTokens: 1500 }, { maxTokens: 300 }],
            overlapTokens: 60,
          },
        },
      },
    });

    // ── Ingestion: scanned upload -> admit -> index -> event ────────────
    const fnLog = (name: string) =>
      new logs.LogGroup(this, `${name}Logs`, {
        logGroupName: logGroupName(stage, `cortex-${name.toLowerCase()}`),
        retention,
        removalPolicy: removal,
      });
    this.admitFn = new lambda.Function(this, "Admit", {
      functionName: resourceName(stage, "cortex-admit"),
      description: "Admit a scanned upload under its shared, tenant or project scope",
      runtime: PYTHON,
      handler: "ingest_admit.handler",
      code,
      timeout: cdk.Duration.minutes(2),
      memorySize: 256,
      logGroup: fnLog("Admit"),
      environment: {
        TENANCY_TABLE: props.tenancyTable.tableName,
        KNOWLEDGE_BUCKET: this.knowledgeBucket.bucketName,
      },
    });
    this.intakeBucket.grantRead(this.admitFn);
    this.knowledgeBucket.grantPut(this.admitFn);
    props.tenancyTable.grantReadData(this.admitFn);

    // Only the admit function writes the knowledge bucket.
    this.knowledgeBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "OnlyAdmissionWritesKnowledge",
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ["s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion", "s3:PutObjectTagging"],
        resources: [this.knowledgeBucket.arnForObjects("*")],
        conditions: { ArnNotEquals: { "aws:PrincipalArn": this.admitFn.role!.roleArn } },
      }),
    );

    const admit = new tasks.LambdaInvoke(this, "AdmitUpload", {
      lambdaFunction: this.admitFn,
      payload: sfn.TaskInput.fromObject({
        bucket: sfn.JsonPath.stringAt("$.detail.s3ObjectDetails.bucketName"),
        key: sfn.JsonPath.stringAt("$.detail.s3ObjectDetails.objectKey"),
        "versionId.$": "$.detail.s3ObjectDetails.versionId",
      }),
      resultSelector: { "document.$": "$.Payload" },
      resultPath: "$.admitted",
      retryOnServiceExceptions: true,
    });
    const startIndex = new tasks.CallAwsService(this, "IndexKnowledge", {
      service: "bedrockagent",
      action: "startIngestionJob",
      parameters: {
        KnowledgeBaseId: this.knowledgeBase.attrKnowledgeBaseId,
        DataSourceId: this.dataSource.attrDataSourceId,
      },
      iamResources: [this.knowledgeBase.attrKnowledgeBaseArn],
      iamAction: "bedrock:StartIngestionJob",
      resultPath: "$.ingestion",
    });
    // One ingestion job per data source at a time: wait and try again.
    startIndex.addRetry({
      errors: ["BedrockAgent.ConflictException", "BedrockAgent.ThrottlingException"],
      interval: cdk.Duration.seconds(30),
      backoffRate: 1.5,
      maxAttempts: 20,
    });
    const announce = (id: string, detailType: string, detailPath: string) =>
      new tasks.EventBridgePutEvents(this, id, {
        entries: [
          {
            eventBus: props.eventBus,
            source: "minrv.cortex",
            detailType,
            detail: sfn.TaskInput.fromJsonPathAt(detailPath),
          },
        ],
        resultPath: sfn.JsonPath.DISCARD,
      });
    const rejected = announce("AnnounceRejected", "DocumentRejected", "$.rejection");
    admit.addCatch(rejected, { errors: ["Rejected"], resultPath: "$.rejection" });
    this.ingestion = new sfn.StateMachine(this, "Ingestion", {
      stateMachineName: resourceName(stage, "cortex-ingestion"),
      definitionBody: sfn.DefinitionBody.fromChainable(
        admit.next(startIndex).next(announce("AnnounceAdmitted", "DocumentAdmitted", "$.admitted.document")),
      ),
      tracingEnabled: true,
      logs: {
        destination: fnLog("Ingestion"),
        level: sfn.LogLevel.ERROR,
        includeExecutionData: false,
      },
    });

    // GuardDuty publishes scan results on the default bus.
    const scanResult = (status: string[]) => ({
      source: ["aws.guardduty"],
      detailType: ["GuardDuty Malware Protection Object Scan Result"],
      detail: {
        s3ObjectDetails: { bucketName: [this.intakeBucket.bucketName] },
        scanResultDetails: { scanResultStatus: status },
      },
    });
    new events.Rule(this, "CleanUploadRule", {
      ruleName: resourceName(stage, "cortex-clean-upload"),
      description: "A clean upload starts ingestion",
      eventPattern: scanResult(["NO_THREATS_FOUND"]),
      targets: [new targets.SfnStateMachine(this.ingestion)],
    });
    new events.Rule(this, "BlockedUploadRule", {
      ruleName: resourceName(stage, "cortex-blocked-upload"),
      description: "Infected, unscannable or failed uploads are recorded on the Cortex bus and never admitted",
      eventPattern: scanResult(["THREATS_FOUND", "UNSUPPORTED", "ACCESS_DENIED", "FAILED"]),
      targets: [new targets.EventBus(props.eventBus)],
    });

    // ── knowledge.search tool ────────────────────────────────────────────
    this.searchFn = new lambda.Function(this, "Search", {
      functionName: resourceName(stage, "cortex-tool-knowledge"),
      description: "MCP knowledge.search: hybrid search filtered to the caller's tenant and granted project",
      runtime: PYTHON,
      handler: "knowledge_tool.handler",
      code,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logGroup: fnLog("Search"),
      environment: {
        KNOWLEDGE_BASE_ID: this.knowledgeBase.attrKnowledgeBaseId,
        TENANCY_TABLE: props.tenancyTable.tableName,
      },
    });
    this.searchFn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ["bedrock:Retrieve"], resources: [this.knowledgeBase.attrKnowledgeBaseArn] }),
    );
    this.searchFn.addToRolePolicy(new iam.PolicyStatement({ actions: ["bedrock:InvokeModel"], resources: [embeddingModelArn] }));
    props.tenancyTable.grantReadData(this.searchFn);

    // ── Tenant-scoped session role (ABAC) ────────────────────────────────
    // Callers (agent runtime, web) assume this with tenant_id / project_id session
    // tags taken from a verified token. Every grant below is written in terms of
    // those tags, so the session can reach one tenant's objects and checkpoints only.
    this.tenantSessionRole = new iam.Role(this, "TenantSession", {
      roleName: resourceName(stage, "cortex-tenant-session"),
      description: "Tenant-scoped access: assumed with tenant_id/project_id session tags only",
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.SessionTagsPrincipal(
        new iam.AccountRootPrincipal().withConditions({
          StringLike: { "aws:RequestTag/tenant_id": "?*" },
          "ForAllValues:StringEquals": { "aws:TagKeys": ["tenant_id", "project_id"] },
        }),
      ),
    });
    this.tenantSessionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "UploadToOwnTenantOrGrantedProject",
        actions: ["s3:PutObject", "s3:GetObject"],
        resources: [
          this.intakeBucket.arnForObjects(`tenants/${TENANT_TAG}/tenant/*`),
          this.intakeBucket.arnForObjects(`tenants/${TENANT_TAG}/projects/${PROJECT_TAG}/*`),
        ],
      }),
    );
    this.tenantSessionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "ReadSharedOwnTenantOrGrantedProject",
        actions: ["s3:GetObject"],
        resources: [
          this.knowledgeBucket.arnForObjects("shared/*"),
          this.knowledgeBucket.arnForObjects(`tenants/${TENANT_TAG}/tenant/*`),
          this.knowledgeBucket.arnForObjects(`tenants/${TENANT_TAG}/projects/${PROJECT_TAG}/*`),
        ],
      }),
    );
    this.tenantSessionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "OwnTenantCheckpointsOnly",
        actions: [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:ConditionCheckItem",
        ],
        resources: [props.checkpointsTable.tableArn],
        conditions: {
          // Thread ids are "{tenant}#{project}#…". The saver may prefix the key ("CHECKPOINT_…");
          // tenant ids never contain "_" or "#", so neither pattern can match another tenant.
          "ForAllValues:StringLike": { "dynamodb:LeadingKeys": [`${TENANT_TAG}#*`, `*_${TENANT_TAG}#*`] },
        },
      }),
    );
    this.tenantSessionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "KeyThroughS3AndDynamoDbOnly",
        actions: ["kms:Decrypt", "kms:GenerateDataKey"],
        resources: [props.keyArn],
        conditions: {
          StringEquals: {
            "kms:ViaService": [`s3.${this.region}.amazonaws.com`, `dynamodb.${this.region}.amazonaws.com`],
          },
        },
      }),
    );

    new cdk.CfnOutput(this, "IntakeBucketName", { value: this.intakeBucket.bucketName });
    new cdk.CfnOutput(this, "KnowledgeBucketName", { value: this.knowledgeBucket.bucketName });
    new cdk.CfnOutput(this, "KnowledgeClusterArn", { value: this.cluster.clusterArn });
    new cdk.CfnOutput(this, "AppDbSecretArn", { value: this.appSecret.secretArn });
    new cdk.CfnOutput(this, "KnowledgeBaseId", { value: this.knowledgeBase.attrKnowledgeBaseId });
    new cdk.CfnOutput(this, "DataSourceId", { value: this.dataSource.attrDataSourceId });
    new cdk.CfnOutput(this, "IngestionStateMachineArn", { value: this.ingestion.stateMachineArn });
    new cdk.CfnOutput(this, "MalwareProtectionPlanId", { value: scanPlan.attrMalwareProtectionPlanId });
    new cdk.CfnOutput(this, "TenantSessionRoleArn", { value: this.tenantSessionRole.roleArn });
    new cdk.CfnOutput(this, "SearchFunctionName", { value: this.searchFn.functionName });
  }
}
