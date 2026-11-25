import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Construct } from "constructs";
import {
  QUALITY_SUMMARY_MODEL,
  atlasBucketName,
  cfnStackName,
  cortexTenantSessionRoleName,
  logGroupName,
  qualityBucketName,
  qualityRunStateMachineName,
  qualityTableName,
  resourceName,
  streamBucketName,
  webTaskRoleName,
} from "../config";
import { anthropicSdkLayer } from "../cortex/knowledge-stack";
import { Ew2Stack, type Ew2StackProps } from "../ew2-stack";

/** The engine's Python package (standard library only), deployed as the Lambda asset. */
export const QUALITY_ENGINE_DIR = path.join(__dirname, "..", "..", "..", "apps", "quality-engine");

export interface QualityStackProps extends Ew2StackProps {
  keyArn: string;
  /** The Cortex event bus: every finished run is announced on it as QualityRunCompleted. */
  eventBus: events.IEventBus;
}

/**
 * Data quality engine: checks a project's monitoring data (the stream metrics the
 * calculation tree reads), words every finding in plain English and records a
 * verdict the same data and rule version always reproduce.
 *
 * Its own stack and store, on Cortex's rails: the web reads and decides through the
 * Cortex tenant session (one project's partition only), runs are announced on the
 * Cortex bus, and the Cortex agent reads findings through its gateway tool.
 */
export class QualityStack extends Ew2Stack {
  public readonly table: dynamodb.Table;
  public readonly bucket: s3.Bucket;
  public readonly run: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: QualityStackProps) {
    super(scope, id, {
      ...props,
      stackName: cfnStackName(props.cfg.stageName, "quality"),
      description: `minrv-ew2 ${props.cfg.stageName} data quality engine: runs, findings, decisions`,
    });
    const { cfg } = props;
    const stage = cfg.stageName;
    const key = kms.Key.fromKeyArn(this, "Cmk", props.keyArn);
    const removal = cfg.deletionProtection ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;
    const retention = cfg.logRetentionDays >= 365 ? logs.RetentionDays.ONE_YEAR : logs.RetentionDays.ONE_MONTH;

    // pk TENANT#<t>#PROJECT#<p>; sk RUN#<run>, FINDING#<run>#<finding>, REVIEW#<finding>
    // (apps/quality-engine/quality_engine/store.py). Findings expire; runs and decisions stay.
    this.table = new dynamodb.Table(this, "Quality", {
      tableName: qualityTableName(stage),
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: "expiresAt",
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: key,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: cfg.deletionProtection,
      removalPolicy: removal,
    });

    // A run's day summaries between its fold and judge steps; nothing reads them later.
    this.bucket = new s3.Bucket(this, "Runs", {
      bucketName: qualityBucketName(stage),
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: key,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [
        { prefix: "runs/", expiration: cdk.Duration.days(14) },
        { abortIncompleteMultipartUploadAfter: cdk.Duration.days(1) },
      ],
      removalPolicy: removal,
    });

    const streamBucket = s3.Bucket.fromBucketName(this, "Stream", streamBucketName(stage));
    const atlasBucket = s3.Bucket.fromBucketName(this, "Atlas", atlasBucketName(stage));
    const code = lambda.Code.fromAsset(QUALITY_ENGINE_DIR, {
      exclude: ["tests", "__pycache__", "*.pyc", "README.md", ".venv"],
    });
    const environment = {
      QUALITY_TABLE: this.table.tableName,
      QUALITY_BUCKET: this.bucket.bucketName,
      STREAM_BUCKET: streamBucket.bucketName,
      ATLAS_BUCKET: atlasBucket.bucketName,
    };
    const step = (
      name: string,
      handler: string,
      description: string,
      memorySize: number,
      seconds: number,
      extra: Pick<lambda.FunctionProps, "architecture" | "layers"> & { environment?: Record<string, string> } = {},
    ) =>
      new lambda.Function(this, name, {
        functionName: resourceName(stage, `quality-${name.toLowerCase()}`),
        description,
        runtime: lambda.Runtime.PYTHON_3_13,
        architecture: extra.architecture ?? lambda.Architecture.ARM_64,
        layers: extra.layers,
        handler: `quality_engine.handlers.${handler}`,
        code,
        memorySize,
        timeout: cdk.Duration.seconds(seconds),
        environment: { ...environment, ...extra.environment },
        logGroup: new logs.LogGroup(this, `${name}Logs`, {
          logGroupName: logGroupName(stage, `quality-${name.toLowerCase()}`),
          retention,
          removalPolicy: removal,
        }),
      });

    const planFn = step("Plan", "plan", "Quality run: record it, find the project's data, batch the stream days", 256, 60);
    const foldFn = step("Fold", "fold", "Quality run: one batch of days' raw readings to daily cells and intraday notes", 1024, 300);
    const judgeFn = step("Judge", "judge", "Quality run: every check and detector, worded findings, verdict", 1024, 300);
    const failFn = step("Fail", "fail", "Quality run: mark a run failed", 128, 15);
    // Optional, after the verdict is recorded and announced: Claude groups the open
    // findings and says what to fix first, for operators. x86_64 for the SDK layer.
    const summariseFn = step("Summarise", "summarise", "Quality run: Claude's summary of a finished run for operators (never the verdict)", 256, 120, {
      architecture: lambda.Architecture.X86_64,
      layers: [anthropicSdkLayer(this, "AnthropicSdk", resourceName(stage, "quality-anthropic-sdk"), "Anthropic Python SDK (Bedrock client) for the quality run summary")],
      environment: { SUMMARY_MODEL: QUALITY_SUMMARY_MODEL },
    });

    // Reads: the project's stream days and attributes, its seeded history. Never writes them.
    streamBucket.grantRead(planFn);
    streamBucket.grantRead(foldFn);
    streamBucket.grantRead(judgeFn);
    atlasBucket.grantRead(planFn, "mrv/*");
    atlasBucket.grantRead(judgeFn, "mrv/*");
    this.bucket.grantPut(foldFn, "runs/*");
    this.bucket.grantRead(judgeFn, "runs/*");
    for (const fn of [planFn, foldFn, judgeFn, failFn, summariseFn]) key.grantEncryptDecrypt(fn);
    this.table.grant(planFn, "dynamodb:PutItem");
    this.table.grant(judgeFn, "dynamodb:Query", "dynamodb:BatchWriteItem", "dynamodb:UpdateItem");
    this.table.grant(failFn, "dynamodb:UpdateItem");
    this.table.grant(summariseFn, "dynamodb:Query", "dynamodb:UpdateItem");
    // The EU inference profile, and the model in whichever EU region it routes to.
    summariseFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "SummaryModelOnly",
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${QUALITY_SUMMARY_MODEL}`,
          `arn:aws:bedrock:eu-*::foundation-model/${QUALITY_SUMMARY_MODEL.replace(/^eu\./, "")}`,
        ],
      }),
    );

    // ── The run ──────────────────────────────────────────────────────────
    const runInput = { "run.$": "$.run" };
    const recordFailure = new tasks.LambdaInvoke(this, "RecordFailure", {
      lambdaFunction: failFn,
      payload: sfn.TaskInput.fromObject({ ...runInput, "error.$": "$.error" }),
      resultPath: sfn.JsonPath.DISCARD,
    }).next(new sfn.Fail(this, "RunFailed", { error: "QualityRunFailed", cause: "A step of the quality run failed; see the run record" }));
    const refused = new sfn.Fail(this, "RunRefused", { error: "NotAllowed", cause: "The run names a tenant, project or registry it may not" });

    const plan = new tasks.LambdaInvoke(this, "PlanRun", {
      lambdaFunction: planFn,
      payload: sfn.TaskInput.fromObject(runInput),
      resultSelector: { "source.$": "$.Payload.source", "batches.$": "$.Payload.batches", "dataHash.$": "$.Payload.dataHash" },
      resultPath: "$.plan",
    });
    plan.addCatch(refused, { errors: ["NotAllowed"] });
    plan.addCatch(recordFailure, { resultPath: "$.error" });

    const fold = new tasks.LambdaInvoke(this, "FoldDays", {
      lambdaFunction: foldFn,
      payload: sfn.TaskInput.fromJsonPathAt("$"),
      outputPath: "$.Payload",
    });
    const days = new sfn.Map(this, "EachBatchOfDays", {
      itemsPath: "$.plan.batches",
      maxConcurrency: 8,
      itemSelector: { "run.$": "$.run", "keys.$": "$$.Map.Item.Value.keys" },
      resultPath: "$.parts",
    }).itemProcessor(fold);
    days.addCatch(recordFailure, { resultPath: "$.error" });

    const judge = new tasks.LambdaInvoke(this, "JudgeRun", {
      lambdaFunction: judgeFn,
      payload: sfn.TaskInput.fromObject({ ...runInput, "plan.$": "$.plan", "parts.$": "$.parts" }),
      resultSelector: { "detail.$": "$.Payload" },
      resultPath: "$.judged",
    });
    judge.addCatch(recordFailure, { resultPath: "$.error" });

    // Announced on the Cortex bus: the journey and the graph react to it, the archive keeps it.
    const announce = new tasks.EventBridgePutEvents(this, "AnnounceRun", {
      entries: [
        {
          eventBus: props.eventBus,
          source: "minrv.quality",
          detailType: "QualityRunCompleted",
          detail: sfn.TaskInput.fromJsonPathAt("$.judged.detail"),
        },
      ],
      resultPath: sfn.JsonPath.DISCARD,
    });
    // The summary never holds a run up or fails it: the verdict is already recorded.
    const summarise = new tasks.LambdaInvoke(this, "SummariseRun", {
      lambdaFunction: summariseFn,
      payload: sfn.TaskInput.fromObject({ ...runInput, "verdict.$": "$.judged.detail.verdict" }),
      resultPath: sfn.JsonPath.DISCARD,
    });
    summarise.addCatch(new sfn.Succeed(this, "RunWithoutSummary"), { resultPath: sfn.JsonPath.DISCARD });
    judge.next(announce).next(summarise);

    const noParts = new sfn.Pass(this, "SeededOrEmpty", { result: sfn.Result.fromArray([]), resultPath: "$.parts" }).next(judge);
    const bySource = new sfn.Choice(this, "StreamDays")
      .when(sfn.Condition.stringEquals("$.plan.source", "stream"), days.next(judge))
      .otherwise(noParts);

    this.run = new sfn.StateMachine(this, "Run", {
      stateMachineName: qualityRunStateMachineName(stage),
      definitionBody: sfn.DefinitionBody.fromChainable(plan.next(bySource)),
      timeout: cdk.Duration.minutes(30),
      tracingEnabled: true,
      logs: {
        destination: new logs.LogGroup(this, "RunLogs", {
          logGroupName: logGroupName(stage, "quality-run"),
          retention,
          removalPolicy: removal,
        }),
        level: sfn.LogLevel.ERROR,
        includeExecutionData: false,
      },
    });

    // ── The web: starts runs; reads and decides as the user's project ────
    // The web checks the user's project grant, then uses the Cortex tenant session
    // tagged with that tenant and project, so DynamoDB itself refuses another partition.
    const tenantSession = iam.Role.fromRoleName(this, "TenantSession", cortexTenantSessionRoleName(stage));
    new iam.Policy(this, "TenantSessionQuality", {
      policyName: resourceName(stage, "tenant-session-quality"),
      roles: [tenantSession],
      statements: [
        new iam.PolicyStatement({
          sid: "OwnProjectQualityOnly",
          // Reads runs and findings; writes decisions (REVIEW#). No delete: decisions are kept.
          actions: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem"],
          resources: [this.table.tableArn],
          conditions: {
            "ForAllValues:StringEquals": {
              "dynamodb:LeadingKeys": ["TENANT#${aws:PrincipalTag/tenant_id}#PROJECT#${aws:PrincipalTag/project_id}"],
            },
          },
        }),
      ],
    });
    const webRole = iam.Role.fromRoleName(this, "WebTaskRole", webTaskRoleName(stage));
    new iam.Policy(this, "WebQualityRuns", {
      policyName: resourceName(stage, "web-quality-runs"),
      roles: [webRole],
      statements: [
        new iam.PolicyStatement({ sid: "StartQualityRuns", actions: ["states:StartExecution"], resources: [this.run.stateMachineArn] }),
      ],
    });

    new cdk.CfnOutput(this, "QualityTableName", { value: this.table.tableName });
    new cdk.CfnOutput(this, "QualityRunStateMachineArn", { value: this.run.stateMachineArn });
  }
}
