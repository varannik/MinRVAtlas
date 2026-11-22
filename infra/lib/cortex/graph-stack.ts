import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as neptune from "aws-cdk-lib/aws-neptune";
import * as neptunegraph from "aws-cdk-lib/aws-neptunegraph";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import { CORTEX_EMBEDDING_DIMENSIONS, cfnStackName, logGroupName, resourceName } from "../config";
import { Ew2Stack, type Ew2StackProps } from "../ew2-stack";
import { LAMBDA_DIR, PYTHON } from "./knowledge-stack";

export interface CortexGraphStackProps extends Ew2StackProps {
  vpc: ec2.IVpc;
  keyArn: string;
  /** The Cortex event bus: journey changes arrive on it (core stack's JourneyChanges pipe). */
  eventBus: events.IEventBus;
}

/**
 * Cortex graph. Neptune Database holds the live evidence graph (claim -> term
 * -> stream -> evidence -> requirement) that the graph.trace tool reads.
 * Neptune Analytics, when switched on, holds a copy for analytics across
 * projects. Neither has row-level security, so only the graph tool role may
 * query them, through fixed templates that always filter by tenant.
 */
export class CortexGraphStack extends Ew2Stack {
  public readonly cluster: neptune.CfnDBCluster;
  public readonly traceFn: lambda.Function;
  public readonly writerFn: lambda.Function;
  public readonly analytics?: neptunegraph.CfnGraph;

  constructor(scope: Construct, id: string, props: CortexGraphStackProps) {
    super(scope, id, {
      ...props,
      stackName: cfnStackName(props.cfg.stageName, "cortex-graph"),
      description: `minrv-ew2 ${props.cfg.stageName} Cortex evidence graph (Neptune) and graph tools`,
    });
    const { cfg, vpc } = props;
    const stage = cfg.stageName;
    const removal = cfg.deletionProtection ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.SNAPSHOT;
    const isolated = vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED });

    const toolSg = new ec2.SecurityGroup(this, "GraphToolSg", {
      vpc,
      description: "Cortex graph tools (Lambda) to Neptune",
      allowAllOutbound: false,
    });
    const neptuneSg = new ec2.SecurityGroup(this, "NeptuneSg", {
      vpc,
      description: "Cortex Neptune: 8182 from the graph tools only",
      allowAllOutbound: false,
    });
    neptuneSg.addIngressRule(toolSg, ec2.Port.tcp(8182), "Graph tools to Neptune");
    toolSg.addEgressRule(neptuneSg, ec2.Port.tcp(8182), "Graph tools to Neptune");

    const subnets = new neptune.CfnDBSubnetGroup(this, "Subnets", {
      dbSubnetGroupName: resourceName(stage, "cortex-graph"),
      dbSubnetGroupDescription: "Cortex Neptune, isolated subnets",
      subnetIds: isolated.subnetIds,
    });
    this.cluster = new neptune.CfnDBCluster(this, "Graph", {
      dbClusterIdentifier: resourceName(stage, "cortex-graph"),
      dbSubnetGroupName: subnets.ref,
      vpcSecurityGroupIds: [neptuneSg.securityGroupId],
      iamAuthEnabled: true,
      storageEncrypted: true,
      kmsKeyId: props.keyArn,
      serverlessScalingConfiguration: {
        minCapacity: cfg.cortex.graphMinNcu,
        maxCapacity: cfg.cortex.graphMaxNcu,
      },
      backupRetentionPeriod: Math.min(cfg.backupDays, 35),
      deletionProtection: cfg.deletionProtection,
      copyTagsToSnapshot: true,
      enableCloudwatchLogsExports: ["audit"],
    });
    this.cluster.addDependency(subnets);
    this.cluster.applyRemovalPolicy(removal);
    const writer = new neptune.CfnDBInstance(this, "GraphWriter", {
      dbInstanceClass: "db.serverless",
      dbClusterIdentifier: this.cluster.ref,
      autoMinorVersionUpgrade: true,
    });
    writer.addDependency(this.cluster);
    writer.applyRemovalPolicy(cfg.deletionProtection ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY);

    this.traceFn = new lambda.Function(this, "Trace", {
      functionName: resourceName(stage, "cortex-tool-graph"),
      description: "MCP graph.trace: follow evidence links inside the caller's tenant",
      runtime: PYTHON,
      handler: "graph_tool.handler",
      code: lambda.Code.fromAsset(LAMBDA_DIR, { exclude: ["__pycache__", "*.pyc"] }),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [toolSg],
      logGroup: new logs.LogGroup(this, "TraceLogs", {
        logGroupName: logGroupName(stage, "cortex-graph"),
        retention: cfg.logRetentionDays >= 365 ? logs.RetentionDays.ONE_YEAR : logs.RetentionDays.ONE_MONTH,
        removalPolicy: cfg.deletionProtection ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      }),
      environment: { NEPTUNE_ENDPOINT: this.cluster.attrEndpoint },
    });
    this.traceFn.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        sid: "ReadGraphOnly",
        actions: ["neptune-db:connect", "neptune-db:ReadDataViaQuery"],
        resources: [`arn:aws:neptune-db:${this.region}:${this.account}:${this.cluster.attrClusterResourceId}/*`],
      }),
    );

    // Evidence links from journey changes: a document filed on a task SATISFIES it.
    this.writerFn = new lambda.Function(this, "Writer", {
      functionName: resourceName(stage, "cortex-graph-writer"),
      description: "Link documents filed on journey tasks to those tasks in the Cortex graph",
      runtime: PYTHON,
      handler: "graph_writer.handler",
      code: lambda.Code.fromAsset(LAMBDA_DIR, { exclude: ["__pycache__", "*.pyc"] }),
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [toolSg],
      logGroup: new logs.LogGroup(this, "WriterLogs", {
        logGroupName: logGroupName(stage, "cortex-graph-writer"),
        retention: cfg.logRetentionDays >= 365 ? logs.RetentionDays.ONE_YEAR : logs.RetentionDays.ONE_MONTH,
        removalPolicy: cfg.deletionProtection ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      }),
      environment: { NEPTUNE_ENDPOINT: this.cluster.attrEndpoint },
    });
    // MERGE and SET only: links are closed, never deleted, so no delete permission.
    this.writerFn.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        sid: "ReadAndWriteGraph",
        actions: ["neptune-db:connect", "neptune-db:ReadDataViaQuery", "neptune-db:WriteDataViaQuery"],
        resources: [`arn:aws:neptune-db:${this.region}:${this.account}:${this.cluster.attrClusterResourceId}/*`],
      }),
    );
    // Changes the writer could not apply after its retries wait here; the bus archive can also replay them.
    const unlinked = new sqs.Queue(this, "UnlinkedChanges", {
      queueName: resourceName(stage, "cortex-graph-unlinked"),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: cdk.Duration.days(14),
    });
    new events.Rule(this, "JourneyFilingsToGraph", {
      eventBus: props.eventBus,
      ruleName: resourceName(stage, "cortex-journey-filings-to-graph"),
      description: "Journey answers that file documents, to the graph writer",
      eventPattern: {
        source: ["minrv.cortex.journey"],
        detailType: ["JourneyChanged"],
        detail: { dynamodb: { NewImage: { action: { S: ["answer"] }, files: { S: [{ exists: true }] } } } },
      },
      targets: [
        new targets.LambdaFunction(this.writerFn, {
          retryAttempts: 8,
          maxEventAge: cdk.Duration.hours(6),
          deadLetterQueue: unlinked,
        }),
      ],
    });

    if (cfg.cortex.graphAnalytics) {
      const analyticsSg = new ec2.SecurityGroup(this, "AnalyticsSg", {
        vpc,
        description: "Cortex Neptune Analytics private endpoint",
        allowAllOutbound: false,
      });
      this.analytics = new neptunegraph.CfnGraph(this, "Analytics", {
        graphName: resourceName(stage, "cortex-analytics"),
        provisionedMemory: cfg.cortex.graphAnalyticsMemory,
        publicConnectivity: false,
        replicaCount: 0,
        deletionProtection: cfg.deletionProtection,
        kmsKeyIdentifier: props.keyArn,
        vectorSearchConfiguration: { vectorSearchDimension: CORTEX_EMBEDDING_DIMENSIONS },
      });
      this.analytics.applyRemovalPolicy(removal === cdk.RemovalPolicy.SNAPSHOT ? cdk.RemovalPolicy.DESTROY : removal);
      new neptunegraph.CfnPrivateGraphEndpoint(this, "AnalyticsEndpoint", {
        graphIdentifier: this.analytics.attrGraphId,
        vpcId: vpc.vpcId,
        subnetIds: isolated.subnetIds,
        securityGroupIds: [analyticsSg.securityGroupId],
      });
      new cdk.CfnOutput(this, "AnalyticsGraphId", { value: this.analytics.attrGraphId });
    }

    new cdk.CfnOutput(this, "GraphClusterId", { value: this.cluster.ref });
    new cdk.CfnOutput(this, "GraphEndpoint", { value: this.cluster.attrEndpoint });
    new cdk.CfnOutput(this, "TraceFunctionName", { value: this.traceFn.functionName });
    new cdk.CfnOutput(this, "WriterFunctionName", { value: this.writerFn.functionName });
    new cdk.CfnOutput(this, "UnlinkedChangesQueueUrl", { value: unlinked.queueUrl });
  }
}
