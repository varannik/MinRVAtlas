import { spawnSync } from "node:child_process";
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
  CORTEX_LABEL_MODEL,
  bdaProfileArn,
  cfnStackName,
  cortexBucketName,
  cortexMoveStateMachineName,
  cortexRemovalStateMachineName,
  cortexReviewStateMachineName,
  cortexTenantSessionRoleName,
  logGroupName,
  resourceName,
  webOrigins,
  webTaskRoleName,
} from "../config";
import { Ew2Stack, type Ew2StackProps } from "../ew2-stack";

export const LAMBDA_DIR = path.join(__dirname, "lambda");
export const PYTHON = lambda.Runtime.PYTHON_3_13;
/** requirements.txt of the layer with the Claude SDK, for the label task. */
const ANTHROPIC_LAYER_DIR = path.join(__dirname, "anthropic-layer");

/**
 * Installs the layer's packages for Lambda's platform with this machine's pip, so a
 * deploy needs no Docker. When it cannot (no python3 or pip), CDK bundles in Docker.
 */
function pipForLambda(outputDir: string): boolean {
  const result = spawnSync(
    "python3",
    [
      "-m", "pip", "install",
      "-r", path.join(ANTHROPIC_LAYER_DIR, "requirements.txt"),
      "--target", path.join(outputDir, "python"),
      "--platform", "manylinux2014_x86_64",
      "--implementation", "cp",
      "--python-version", PYTHON.name.replace("python", ""),
      "--only-binary=:all:",
      "--no-compile",
      "--quiet",
      "--disable-pip-version-check",
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  return result.status === 0;
}

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
  /** Data Automation output and rule passages: a projection, rebuilt from the knowledge bucket. */
  public readonly parsedBucket: s3.Bucket;
  public readonly cluster: rds.DatabaseCluster;
  public readonly appSecret: secretsmanager.Secret;
  public readonly knowledgeBase: bedrock.CfnKnowledgeBase;
  public readonly dataSource: bedrock.CfnDataSource;
  public readonly ingestion: sfn.StateMachine;
  /** Takes one project document out of Cortex; the web starts it for the user. */
  public readonly removal: sfn.StateMachine;
  /** Records a person's decision on a labelled document; the web starts it. */
  public readonly review: sfn.StateMachine;
  /** Moves a document to another pin, or to or from every project; the web starts it. */
  public readonly move: sfn.StateMachine;
  public readonly admitFn: lambda.Function;
  public readonly removeFn: lambda.Function;
  public readonly parseFn: lambda.Function;
  public readonly chunkFn: lambda.Function;
  public readonly labelFn: lambda.Function;
  public readonly reviewFn: lambda.Function;
  public readonly moveFn: lambda.Function;
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
      // The web app signs a POST form with a tenant-scoped session; the browser
      // sends the file straight here, so documents never pass through the web tasks.
      cors: [
        {
          allowedMethods: [s3.HttpMethods.POST],
          allowedOrigins: webOrigins(cfg),
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag", "x-amz-version-id"],
          maxAge: 3000,
        },
      ],
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
    // Nothing here is the record: it is rebuilt by re-ingesting from the knowledge
    // bucket, so it is not versioned and is emptied when the stack goes.
    this.parsedBucket = new s3.Bucket(this, "Parsed", {
      ...bucketBase,
      bucketName: cortexBucketName(stage, "parsed"),
      versioned: false,
      autoDeleteObjects: !cfg.deletionProtection,
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: cdk.Duration.days(1) },
        // Raw Data Automation output is only read once, by the chunk task.
        { prefix: "bda/", expiration: cdk.Duration.days(30) },
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
        // The index is built from rule passages, never from the originals.
        new iam.PolicyStatement({ actions: ["s3:ListBucket"], resources: [this.parsedBucket.bucketArn] }),
        new iam.PolicyStatement({ actions: ["s3:GetObject"], resources: [this.parsedBucket.arnForObjects("chunks/*")] }),
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
    // One file per rule passage (ingest_chunk.py), so the knowledge base does no
    // chunking of its own: each passage is one search result, cited by its rule.
    this.dataSource = new bedrock.CfnDataSource(this, "ClauseSource", {
      knowledgeBaseId: this.knowledgeBase.attrKnowledgeBaseId,
      name: resourceName(stage, "cortex-knowledge-clauses"),
      description:
        "Rule passages from Data Automation output, with scope, clause_ref, section and page metadata (chunks/ in the parsed bucket)",
      dataDeletionPolicy: "DELETE",
      dataSourceConfiguration: {
        type: "S3",
        s3Configuration: { bucketArn: this.parsedBucket.bucketArn, inclusionPrefixes: ["chunks/"] },
      },
      vectorIngestionConfiguration: {
        chunkingConfiguration: { chunkingStrategy: "NONE" },
      },
    });

    // ── Document parsing (Bedrock Data Automation, London only) ─────────
    const parsing = new bedrock.CfnDataAutomationProject(this, "DocumentParsing", {
      projectName: resourceName(stage, "cortex-documents"),
      projectDescription: "Layout elements of admitted documents, in reading order, for rule-by-rule passages",
      standardOutputConfiguration: {
        document: {
          extraction: {
            granularity: { types: ["PAGE", "ELEMENT"] },
            boundingBox: { state: "DISABLED" },
          },
          generativeField: { state: "DISABLED" },
          outputFormat: {
            textFormat: { types: ["MARKDOWN", "PLAIN_TEXT"] },
            additionalFileFormat: { state: "DISABLED" },
          },
        },
      },
    });
    const profileArn = bdaProfileArn(this.region, this.account);

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

    // Removal of a project's own document (tenants/ only: shared documents are never
    // removed this way, whatever the request says).
    this.removeFn = new lambda.Function(this, "Remove", {
      functionName: resourceName(stage, "cortex-remove"),
      description: "Take one project document out of Cortex: original, passages and parse output",
      runtime: PYTHON,
      handler: "ingest_remove.handler",
      code,
      timeout: cdk.Duration.minutes(2),
      memorySize: 256,
      logGroup: fnLog("Remove"),
      environment: {
        KNOWLEDGE_BUCKET: this.knowledgeBucket.bucketName,
        INTAKE_BUCKET: this.intakeBucket.bucketName,
        PARSED_BUCKET: this.parsedBucket.bucketName,
      },
    });
    this.knowledgeBucket.grantRead(this.removeFn, "tenants/*");
    this.knowledgeBucket.grantDelete(this.removeFn, "tenants/*");
    this.intakeBucket.grantDelete(this.removeFn, "tenants/*");
    for (const prefix of ["chunks/tenants/*", "held/tenants/*"]) {
      this.parsedBucket.grantRead(this.removeFn, prefix);
      this.parsedBucket.grantDelete(this.removeFn, prefix);
    }
    this.parsedBucket.grantDelete(this.removeFn, "labels/tenants/*");
    this.parsedBucket.grantDelete(this.removeFn, "bda/*");

    // Only admission writes the knowledge bucket, and only removal deletes from it.
    // Deleting leaves the file as a noncurrent version (and under Object Lock on prod).
    this.knowledgeBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "OnlyAdmissionWritesKnowledge",
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ["s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion", "s3:PutObjectTagging"],
        resources: [this.knowledgeBucket.arnForObjects("*")],
        conditions: {
          ArnNotEquals: { "aws:PrincipalArn": [this.admitFn.role!.roleArn, this.removeFn.role!.roleArn] },
        },
      }),
    );

    // Data Automation reads the admitted copy and writes its output with this
    // function's permissions, so it can read the knowledge bucket and write bda/.
    this.parseFn = new lambda.Function(this, "Parse", {
      functionName: resourceName(stage, "cortex-parse"),
      description: "Start Bedrock Data Automation on an admitted document, and report its status",
      runtime: PYTHON,
      handler: "ingest_parse.handler",
      code,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logGroup: fnLog("Parse"),
      environment: {
        KNOWLEDGE_BUCKET: this.knowledgeBucket.bucketName,
        PARSED_BUCKET: this.parsedBucket.bucketName,
        BDA_PROJECT_ARN: parsing.attrProjectArn,
        BDA_PROFILE_ARN: profileArn,
      },
    });
    this.knowledgeBucket.grantRead(this.parseFn);
    this.parsedBucket.grantReadWrite(this.parseFn, "bda/*");
    this.parseFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeDataAutomationAsync"],
        resources: [parsing.attrProjectArn, profileArn],
      }),
    );
    this.parseFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:GetDataAutomationStatus"],
        resources: [`arn:aws:bedrock:${this.region}:${this.account}:data-automation-invocation/*`],
      }),
    );

    this.chunkFn = new lambda.Function(this, "Chunk", {
      functionName: resourceName(stage, "cortex-chunk"),
      description: "Turn Data Automation output into one passage per methodology rule",
      runtime: PYTHON,
      handler: "ingest_chunk.handler",
      code,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      logGroup: fnLog("Chunk"),
      environment: {
        PARSED_BUCKET: this.parsedBucket.bucketName,
        // To check the document was not removed or replaced while it was parsed.
        KNOWLEDGE_BUCKET: this.knowledgeBucket.bucketName,
      },
    });
    this.knowledgeBucket.grantRead(this.chunkFn, "*.metadata.json");
    this.parsedBucket.grantRead(this.chunkFn, "bda/*");
    this.parsedBucket.grantReadWrite(this.chunkFn, "chunks/*");
    this.parsedBucket.grantDelete(this.chunkFn, "chunks/*");
    // Passages of a held document go to held/, which the index does not read.
    this.parsedBucket.grantReadWrite(this.chunkFn, "held/*");
    this.parsedBucket.grantDelete(this.chunkFn, "held/*");

    // ── Labels: what each document is, where it belongs, whether it is searched ──
    const anthropicSdk = new lambda.LayerVersion(this, "AnthropicSdk", {
      layerVersionName: resourceName(stage, "cortex-anthropic-sdk"),
      description: "Anthropic Python SDK (Bedrock client) for the Cortex label task",
      compatibleRuntimes: [PYTHON],
      compatibleArchitectures: [lambda.Architecture.X86_64],
      code: lambda.Code.fromAsset(ANTHROPIC_LAYER_DIR, {
        bundling: {
          image: PYTHON.bundlingImage,
          command: [
            "bash",
            "-c",
            "pip install -r requirements.txt --target /asset-output/python --only-binary=:all: --no-compile --quiet",
          ],
          local: { tryBundle: (outputDir) => pipForLambda(outputDir) },
        },
      }),
    });
    this.labelFn = new lambda.Function(this, "Label", {
      functionName: resourceName(stage, "cortex-label"),
      description: "Label a parsed document with Claude (kind, title, version) and hold it out of search when it is not MRV material or a copy",
      runtime: PYTHON,
      handler: "ingest_label.handler",
      code,
      layers: [anthropicSdk],
      timeout: cdk.Duration.minutes(3),
      memorySize: 512,
      logGroup: fnLog("Label"),
      environment: {
        PARSED_BUCKET: this.parsedBucket.bucketName,
        TENANCY_TABLE: props.tenancyTable.tableName,
        LABEL_MODEL: CORTEX_LABEL_MODEL,
      },
    });
    this.parsedBucket.grantRead(this.labelFn, "bda/*");
    this.parsedBucket.grantReadWrite(this.labelFn, "labels/*");
    props.tenancyTable.grantReadData(this.labelFn);
    // The EU inference profile, and the model in whichever EU region it routes to.
    this.labelFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${CORTEX_LABEL_MODEL}`,
          `arn:aws:bedrock:eu-*::foundation-model/${CORTEX_LABEL_MODEL.replace(/^eu\./, "")}`,
        ],
      }),
    );

    // A person's decision on a label: keep a held document (its passages move to
    // chunks/), or keep a document where it is despite a suggested move.
    this.reviewFn = new lambda.Function(this, "Review", {
      functionName: resourceName(stage, "cortex-review"),
      description: "Record a person's decision on a labelled Cortex document",
      runtime: PYTHON,
      handler: "ingest_review.handler",
      code,
      timeout: cdk.Duration.minutes(2),
      memorySize: 256,
      logGroup: fnLog("Review"),
      environment: { PARSED_BUCKET: this.parsedBucket.bucketName },
    });
    for (const prefix of ["held/tenants/*", "chunks/tenants/*", "labels/tenants/*"]) {
      this.parsedBucket.grantReadWrite(this.reviewFn, prefix);
    }
    this.parsedBucket.grantDelete(this.reviewFn, "held/tenants/*");

    // A move copies the admitted file back into intake at its new key, so it is scanned,
    // admitted, parsed and labelled there like any upload; removal then clears the old place.
    this.moveFn = new lambda.Function(this, "Move", {
      functionName: resourceName(stage, "cortex-move"),
      description: "Copy a Cortex document into intake at its new pin or scope",
      runtime: PYTHON,
      handler: "ingest_move.handler",
      code,
      timeout: cdk.Duration.minutes(2),
      memorySize: 256,
      logGroup: fnLog("Move"),
      environment: {
        KNOWLEDGE_BUCKET: this.knowledgeBucket.bucketName,
        INTAKE_BUCKET: this.intakeBucket.bucketName,
      },
    });
    this.knowledgeBucket.grantRead(this.moveFn, "tenants/*");
    this.intakeBucket.grantRead(this.moveFn, "tenants/*");
    this.intakeBucket.grantPut(this.moveFn, "tenants/*");

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
    // Sync the index with the passage files (new, changed and deleted ones).
    const indexKnowledge = (id: string) => {
      const task = new tasks.CallAwsService(this, id, {
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
      task.addRetry({
        errors: ["BedrockAgent.ConflictException", "BedrockAgent.ThrottlingException"],
        interval: cdk.Duration.seconds(30),
        backoffRate: 1.5,
        maxAttempts: 20,
      });
      // With knowledgeMinAcu 0 the knowledge cluster pauses after 5 idle minutes, and
      // Bedrock refuses the job with a ValidationException ("resuming after being
      // auto-paused") until it is back, about 15 seconds later.
      task.addRetry({
        errors: ["BedrockAgent.ValidationException"],
        interval: cdk.Duration.seconds(15),
        backoffRate: 2,
        maxAttempts: 4,
      });
      return task;
    };
    const startIndex = indexKnowledge("IndexKnowledge");
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

    // Parse: start Data Automation, then poll until it finishes (a 100-page PDF takes minutes).
    const parseStatusFields = {
      "invocationArn.$": "$.Payload.invocationArn",
      "status.$": "$.Payload.status",
      "jobMetadata.$": "$.Payload.jobMetadata",
      "error.$": "$.Payload.error",
    };
    const startParse = new tasks.LambdaInvoke(this, "StartParse", {
      lambdaFunction: this.parseFn,
      payload: sfn.TaskInput.fromObject({ action: "start", "document.$": "$.admitted.document" }),
      resultSelector: parseStatusFields,
      resultPath: "$.parse",
      retryOnServiceExceptions: true,
    });
    const waitForParse = new sfn.Wait(this, "WaitForParse", {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(20)),
    });
    const parseStatus = new tasks.LambdaInvoke(this, "ParseStatus", {
      lambdaFunction: this.parseFn,
      payload: sfn.TaskInput.fromObject({ action: "status", "invocationArn.$": "$.parse.invocationArn" }),
      resultSelector: parseStatusFields,
      resultPath: "$.parse",
      retryOnServiceExceptions: true,
    });
    // Label before writing passages: a held document's passages go where search does not read.
    const label = new tasks.LambdaInvoke(this, "LabelDocument", {
      lambdaFunction: this.labelFn,
      payload: sfn.TaskInput.fromObject({
        "document.$": "$.admitted.document",
        "jobMetadata.$": "$.parse.jobMetadata",
      }),
      resultSelector: { "label.$": "$.Payload" },
      resultPath: "$.labelled",
      retryOnServiceExceptions: true,
    });
    // Labelling never stands between a document and search: on any failure it is searched unlabelled.
    const unlabelled = new sfn.Pass(this, "Unlabelled", {
      result: sfn.Result.fromObject({ label: { checked: false, held: null } }),
      resultPath: "$.labelled",
    });
    label.addCatch(unlabelled, { errors: ["States.ALL"], resultPath: "$.labelError" });
    const chunk = new tasks.LambdaInvoke(this, "ChunkByRule", {
      lambdaFunction: this.chunkFn,
      payload: sfn.TaskInput.fromObject({
        "document.$": "$.admitted.document",
        "jobMetadata.$": "$.parse.jobMetadata",
        "label.$": "$.labelled.label",
      }),
      resultSelector: { "passages.$": "$.Payload.passages", "rules.$": "$.Payload.rules", "held.$": "$.Payload.held" },
      resultPath: "$.chunks",
      retryOnServiceExceptions: true,
    });
    unlabelled.next(chunk);
    const parseFailed = announce("AnnounceParseFailed", "DocumentParseFailed", "$.parse").next(
      // The DocumentParseFailed event carries BDA's own error; it can be empty, so the cause is fixed.
      new sfn.Fail(this, "ParseFailed", { error: "ParseFailed", cause: "Bedrock Data Automation did not succeed" }),
    );
    const noText = announce("AnnounceNoText", "DocumentParseFailed", "$.noText");
    chunk.addCatch(noText, { errors: ["NoText"], resultPath: "$.noText" });
    // Removed or replaced while it was parsed: write nothing; the removal or the newer run wins.
    const supersededRun = announce("AnnounceSuperseded", "DocumentSuperseded", "$.superseded");
    chunk.addCatch(supersededRun, { errors: ["Superseded"], resultPath: "$.superseded" });
    const parsed = new sfn.Choice(this, "ParseDone")
      .when(
        sfn.Condition.stringEquals("$.parse.status", "Success"),
        label.next(chunk).next(startIndex).next(announce("AnnounceAdmitted", "DocumentAdmitted", "$.admitted.document")),
      )
      .when(
        sfn.Condition.or(
          sfn.Condition.stringEquals("$.parse.status", "Created"),
          sfn.Condition.stringEquals("$.parse.status", "InProgress"),
        ),
        waitForParse,
      )
      .otherwise(parseFailed);

    this.ingestion = new sfn.StateMachine(this, "Ingestion", {
      stateMachineName: resourceName(stage, "cortex-ingestion"),
      definitionBody: sfn.DefinitionBody.fromChainable(
        admit.next(startParse).next(waitForParse).next(parseStatus).next(parsed),
      ),
      tracingEnabled: true,
      logs: {
        destination: fnLog("Ingestion"),
        level: sfn.LogLevel.ERROR,
        includeExecutionData: false,
      },
    });

    // Removal: the web starts this for a user who may add to the project.
    const remove = new tasks.LambdaInvoke(this, "RemoveDocument", {
      lambdaFunction: this.removeFn,
      payload: sfn.TaskInput.fromObject({
        "key.$": "$.key",
        "tenant_id.$": "$.tenant_id",
        "project_id.$": "$.project_id",
        "requested_by.$": "$.requested_by",
      }),
      resultSelector: { "document.$": "$.Payload" },
      resultPath: "$.removed",
      retryOnServiceExceptions: true,
    });
    remove.addCatch(
      new sfn.Fail(this, "RemovalRefused", { error: "NotAllowed", cause: "Not a document of the requesting project" }),
      { errors: ["NotAllowed"] },
    );
    this.removal = new sfn.StateMachine(this, "Removal", {
      stateMachineName: cortexRemovalStateMachineName(stage),
      definitionBody: sfn.DefinitionBody.fromChainable(
        remove
          .next(indexKnowledge("IndexAfterRemoval"))
          .next(announce("AnnounceRemoved", "DocumentRemoved", "$.removed.document")),
      ),
      tracingEnabled: true,
      logs: {
        destination: fnLog("Removal"),
        level: sfn.LogLevel.ERROR,
        includeExecutionData: false,
      },
    });

    // Review: a person keeps a held document in search, or keeps one where it is.
    const runLogs = (name: string) => ({
      destination: fnLog(name),
      level: sfn.LogLevel.ERROR,
      includeExecutionData: false,
    });
    const reviewDocument = new tasks.LambdaInvoke(this, "ReviewDocument", {
      lambdaFunction: this.reviewFn,
      payload: sfn.TaskInput.fromObject({
        "key.$": "$.key",
        "action.$": "$.action",
        "tenant_id.$": "$.tenant_id",
        "project_id.$": "$.project_id",
        "requested_by.$": "$.requested_by",
      }),
      resultSelector: { "document.$": "$.Payload" },
      resultPath: "$.reviewed",
      retryOnServiceExceptions: true,
    });
    reviewDocument.addCatch(
      new sfn.Fail(this, "ReviewRefused", { error: "NotAllowed", cause: "Not a decision this user can make on this document" }),
      { errors: ["NotAllowed"] },
    );
    const announceReviewed = announce("AnnounceReviewed", "DocumentReviewed", "$.reviewed.document");
    const released = new sfn.Choice(this, "PassagesReleased")
      .when(
        sfn.Condition.booleanEquals("$.reviewed.document.reindex", true),
        indexKnowledge("IndexAfterReview").next(announceReviewed),
      )
      .otherwise(announceReviewed);
    this.review = new sfn.StateMachine(this, "ReviewStateMachine", {
      stateMachineName: cortexReviewStateMachineName(stage),
      definitionBody: sfn.DefinitionBody.fromChainable(reviewDocument.next(released)),
      tracingEnabled: true,
      logs: runLogs("Reviews"),
    });

    // Move: copy into intake at the new key (scanned and ingested there like any upload),
    // then take the document out of its old place.
    const copyToNewPlace = new tasks.LambdaInvoke(this, "CopyToNewPlace", {
      lambdaFunction: this.moveFn,
      payload: sfn.TaskInput.fromObject({
        "key.$": "$.key",
        "to_key.$": "$.to_key",
        "tenant_id.$": "$.tenant_id",
        "project_id.$": "$.project_id",
        "requested_by.$": "$.requested_by",
      }),
      resultSelector: { "document.$": "$.Payload" },
      resultPath: "$.moved",
      retryOnServiceExceptions: true,
    });
    copyToNewPlace.addCatch(
      new sfn.Fail(this, "MoveRefused", { error: "NotAllowed", cause: "Not a move this user can make" }),
      { errors: ["NotAllowed"] },
    );
    const removeFromOldPlace = new tasks.LambdaInvoke(this, "RemoveFromOldPlace", {
      lambdaFunction: this.removeFn,
      payload: sfn.TaskInput.fromObject({
        "key.$": "$.moved.document.key",
        "tenant_id.$": "$.tenant_id",
        "project_id.$": "$.project_id",
        "requested_by.$": "$.requested_by",
      }),
      resultSelector: { "document.$": "$.Payload" },
      resultPath: "$.removed",
      retryOnServiceExceptions: true,
    });
    this.move = new sfn.StateMachine(this, "MoveStateMachine", {
      stateMachineName: cortexMoveStateMachineName(stage),
      definitionBody: sfn.DefinitionBody.fromChainable(
        copyToNewPlace
          .next(removeFromOldPlace)
          .next(indexKnowledge("IndexAfterMove"))
          .next(announce("AnnounceMoved", "DocumentMoved", "$.moved.document")),
      ),
      tracingEnabled: true,
      logs: runLogs("Moves"),
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
      // Room to wait out the knowledge cluster resuming from auto-pause (knowledge_tool.py).
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      logGroup: fnLog("Search"),
      environment: {
        KNOWLEDGE_BASE_ID: this.knowledgeBase.attrKnowledgeBaseId,
        // Citations point at the original document, not the passage file.
        KNOWLEDGE_BUCKET: this.knowledgeBucket.bucketName,
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
      roleName: cortexTenantSessionRoleName(stage),
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
        sid: "ScanResultOfOwnUploads",
        actions: ["s3:GetObjectTagging"],
        resources: [
          this.intakeBucket.arnForObjects(`tenants/${TENANT_TAG}/tenant/*`),
          this.intakeBucket.arnForObjects(`tenants/${TENANT_TAG}/projects/${PROJECT_TAG}/*`),
        ],
      }),
    );
    // Listing is how the web shows what a project has given Cortex and how far each
    // upload has got (in intake = being scanned, in knowledge = admitted).
    this.tenantSessionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "ListOwnTenantOrGrantedProject",
        actions: ["s3:ListBucket"],
        resources: [this.intakeBucket.bucketArn, this.knowledgeBucket.bucketArn],
        conditions: {
          StringLike: {
            "s3:prefix": [`tenants/${TENANT_TAG}/tenant/*`, `tenants/${TENANT_TAG}/projects/${PROJECT_TAG}/*`],
          },
        },
      }),
    );
    // The Cortex page lists everything a project searches: the registry documents every
    // tenant may read, and how many rule passages each document became.
    this.tenantSessionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "ListSharedKnowledge",
        actions: ["s3:ListBucket"],
        resources: [this.knowledgeBucket.bucketArn],
        conditions: { StringLike: { "s3:prefix": ["shared/*"] } },
      }),
    );
    this.tenantSessionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "CountPassagesAndListLabelsOfVisibleDocuments",
        actions: ["s3:ListBucket"],
        resources: [this.parsedBucket.bucketArn],
        conditions: {
          StringLike: {
            "s3:prefix": ["chunks", "labels"].flatMap((area) => [
              `${area}/shared/*`,
              `${area}/tenants/${TENANT_TAG}/tenant/*`,
              `${area}/tenants/${TENANT_TAG}/projects/${PROJECT_TAG}/*`,
            ]),
          },
        },
      }),
    );
    // Labels: what each document is, whether it is held, and where Cortex suggests it goes.
    this.tenantSessionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "ReadLabelsOfVisibleDocuments",
        actions: ["s3:GetObject"],
        resources: [
          this.parsedBucket.arnForObjects("labels/shared/*"),
          this.parsedBucket.arnForObjects(`labels/tenants/${TENANT_TAG}/tenant/*`),
          this.parsedBucket.arnForObjects(`labels/tenants/${TENANT_TAG}/projects/${PROJECT_TAG}/*`),
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

    // ── Web app: signs document uploads as the user's tenant and project ──
    // The web checks the user's project grant in the tenancy table, then assumes the
    // tenant-session role tagged with that tenant and project and signs the upload
    // with it, so S3 itself refuses any key outside them. The web role gets no
    // access to the Cortex buckets of its own.
    const webRole = iam.Role.fromRoleName(this, "WebTaskRole", webTaskRoleName(stage));
    new iam.Policy(this, "WebCortexUploads", {
      policyName: resourceName(stage, "web-cortex-uploads"),
      roles: [webRole],
      statements: [
        new iam.PolicyStatement({
          sid: "AssumeTenantSession",
          actions: ["sts:AssumeRole", "sts:TagSession"],
          resources: [this.tenantSessionRole.roleArn],
        }),
        new iam.PolicyStatement({
          sid: "StartRemovalsReviewsAndMoves",
          actions: ["states:StartExecution"],
          resources: [this.removal.stateMachineArn, this.review.stateMachineArn, this.move.stateMachineArn],
        }),
        // Tenant status, its projects and the user's grants (the web role already
        // decrypts with the stage key; see compute-stack.ts).
        new iam.PolicyStatement({
          sid: "ReadProjectGrants",
          actions: ["dynamodb:GetItem", "dynamodb:Query"],
          resources: [props.tenancyTable.tableArn],
        }),
      ],
    });

    new cdk.CfnOutput(this, "IntakeBucketName", { value: this.intakeBucket.bucketName });
    new cdk.CfnOutput(this, "KnowledgeBucketName", { value: this.knowledgeBucket.bucketName });
    new cdk.CfnOutput(this, "KnowledgeClusterArn", { value: this.cluster.clusterArn });
    new cdk.CfnOutput(this, "AppDbSecretArn", { value: this.appSecret.secretArn });
    new cdk.CfnOutput(this, "KnowledgeBaseId", { value: this.knowledgeBase.attrKnowledgeBaseId });
    new cdk.CfnOutput(this, "DataSourceId", { value: this.dataSource.attrDataSourceId });
    new cdk.CfnOutput(this, "ParsedBucketName", { value: this.parsedBucket.bucketName });
    new cdk.CfnOutput(this, "DocumentParsingProjectArn", { value: parsing.attrProjectArn });
    new cdk.CfnOutput(this, "IngestionStateMachineArn", { value: this.ingestion.stateMachineArn });
    new cdk.CfnOutput(this, "RemovalStateMachineArn", { value: this.removal.stateMachineArn });
    new cdk.CfnOutput(this, "ReviewStateMachineArn", { value: this.review.stateMachineArn });
    new cdk.CfnOutput(this, "MoveStateMachineArn", { value: this.move.stateMachineArn });
    new cdk.CfnOutput(this, "MalwareProtectionPlanId", { value: scanPlan.attrMalwareProtectionPlanId });
    new cdk.CfnOutput(this, "TenantSessionRoleArn", { value: this.tenantSessionRole.roleArn });
    new cdk.CfnOutput(this, "SearchFunctionName", { value: this.searchFn.functionName });
  }
}
