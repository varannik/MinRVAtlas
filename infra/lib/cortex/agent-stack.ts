import * as cdk from "aws-cdk-lib";
import * as agentcore from "aws-cdk-lib/aws-bedrockagentcore";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import {
  BEDROCK_INFERENCE_PROFILE,
  cfnStackName,
  ecrCortexAgentRepo,
  logGroupName,
  resourceName,
} from "../config";
import { Ew2Stack, type Ew2StackProps } from "../ew2-stack";
import { LAMBDA_DIR, PYTHON } from "./knowledge-stack";

export interface CortexAgentStackProps extends Ew2StackProps {
  userPool: cognito.IUserPool;
  /** App clients whose access tokens the gateway accepts. */
  clients: cognito.IUserPoolClient[];
  tenancyTable: dynamodb.ITable;
  checkpointsTable: dynamodb.ITable;
  eventBus: events.IEventBus;
  tenantSessionRole: iam.IRole;
  searchFn: lambda.IFunction;
  traceFn?: lambda.IFunction;
}

/** One gateway target: a Lambda and the tools it serves. Tool names become `<target>___<tool>`. */
interface ToolTarget {
  name: string;
  description: string;
  fn: lambda.IFunction;
  tools: agentcore.CfnGatewayTarget.ToolDefinitionProperty[];
}

/** Every tool declares the caller block so clients see it is set for them. */
const CALLER_PROPERTY: agentcore.CfnGatewayTarget.SchemaDefinitionProperty = {
  type: "object",
  description: "Set by the gateway from your sign-in. Anything sent here is replaced.",
};
const PROJECT_PROPERTY: agentcore.CfnGatewayTarget.SchemaDefinitionProperty = {
  type: "string",
  description: "Project id. Required to see that project's own documents; you must hold a grant on it.",
};

/**
 * Cortex agent: the MCP server over Cortex tools (AgentCore Gateway), the
 * access interceptor in front of every call, Cedar tool policies, conversation
 * memory, and the agent runtime once an image exists.
 */
export class CortexAgentStack extends Ew2Stack {
  public readonly gateway: agentcore.CfnGateway;
  public readonly interceptorFn: lambda.Function;
  public readonly policyEngine: agentcore.CfnPolicyEngine;
  public readonly memory: agentcore.CfnMemory;
  public readonly runtime?: agentcore.CfnRuntime;
  public readonly toolNames: string[];

  constructor(scope: Construct, id: string, props: CortexAgentStackProps) {
    super(scope, id, {
      ...props,
      stackName: cfnStackName(props.cfg.stageName, "cortex-agent"),
      description: `minrv-ew2 ${props.cfg.stageName} Cortex MCP gateway, tool policies, memory and agent runtime`,
    });
    const { cfg } = props;
    const stage = cfg.stageName;
    const removal = cfg.deletionProtection ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;
    const retention = cfg.logRetentionDays >= 365 ? logs.RetentionDays.ONE_YEAR : logs.RetentionDays.ONE_MONTH;
    const code = lambda.Code.fromAsset(LAMBDA_DIR, { exclude: ["__pycache__", "*.pyc"] });
    const discoveryUrl = `https://cognito-idp.${this.region}.amazonaws.com/${props.userPool.userPoolId}/.well-known/openid-configuration`;
    const allowedClients = props.clients.map((client) => client.userPoolClientId);
    const underscored = `minrv_ew2_${stage}`;

    // ── Interceptor: tenant and project access on every MCP request ──────
    this.interceptorFn = new lambda.Function(this, "Interceptor", {
      functionName: resourceName(stage, "cortex-gateway-access"),
      description: "Gateway REQUEST interceptor: tenant from the token, project grants from the tenancy table",
      runtime: PYTHON,
      handler: "interceptor.handler",
      code,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      logGroup: new logs.LogGroup(this, "InterceptorLogs", {
        logGroupName: logGroupName(stage, "cortex-gateway-access"),
        retention,
        removalPolicy: removal,
      }),
      environment: { TENANCY_TABLE: props.tenancyTable.tableName },
    });
    props.tenancyTable.grantReadData(this.interceptorFn);

    const whoamiFn = new lambda.Function(this, "Whoami", {
      functionName: resourceName(stage, "cortex-tool-tenancy"),
      description: "MCP tenancy.whoami: the caller's tenant, role and projects",
      runtime: PYTHON,
      handler: "tenancy_tool.handler",
      code,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      logGroup: new logs.LogGroup(this, "WhoamiLogs", {
        logGroupName: logGroupName(stage, "cortex-tool-tenancy"),
        retention,
        removalPolicy: removal,
      }),
      environment: { TENANCY_TABLE: props.tenancyTable.tableName },
    });
    props.tenancyTable.grantReadData(whoamiFn);

    const targets: ToolTarget[] = [
      {
        name: "tenancy",
        description: "Who you are in Cortex",
        fn: whoamiFn,
        tools: [
          {
            name: "whoami",
            description: "Your tenant, your role and the projects you may work on.",
            inputSchema: { type: "object", properties: { caller: CALLER_PROPERTY } },
          },
        ],
      },
      {
        name: "knowledge",
        description: "Registry, tenant and project knowledge",
        fn: props.searchFn,
        tools: [
          {
            name: "search",
            description:
              "Search registry methodology documents, your tenant's documents and, with project_id, that project's documents. Results cite their source.",
            inputSchema: {
              type: "object",
              required: ["query"],
              properties: {
                query: { type: "string", description: "What to look for." },
                project_id: PROJECT_PROPERTY,
                top_k: { type: "integer", description: "How many passages to return (1 to 10, default 5)." },
                caller: CALLER_PROPERTY,
              },
            },
          },
        ],
      },
    ];
    if (props.traceFn) {
      targets.push({
        name: "graph",
        description: "Evidence links between claims, measurements, documents and requirements",
        fn: props.traceFn,
        tools: [
          {
            name: "trace",
            description: "Follow evidence links out from one node, inside your tenant and granted projects.",
            inputSchema: {
              type: "object",
              required: ["uid"],
              properties: {
                uid: { type: "string", description: "Id of the claim, term, stream or document to start from." },
                project_id: PROJECT_PROPERTY,
                caller: CALLER_PROPERTY,
              },
            },
          },
        ],
      });
    }
    this.toolNames = targets.flatMap((target) => target.tools.map((tool) => `${target.name}___${tool.name}`));

    // ── Gateway (MCP server) ─────────────────────────────────────────────
    const gatewayRole = new iam.Role(this, "GatewayRole", {
      roleName: resourceName(stage, "cortex-gateway"),
      assumedBy: new iam.ServicePrincipal("bedrock-agentcore.amazonaws.com", {
        conditions: {
          StringEquals: { "aws:SourceAccount": this.account },
          ArnLike: { "aws:SourceArn": `arn:aws:bedrock-agentcore:${this.region}:${this.account}:*` },
        },
      }),
    });
    this.policyEngine = new agentcore.CfnPolicyEngine(this, "ToolPolicies", {
      name: `${underscored}_cortex_tools`,
      description: "Cedar rules for every Cortex tool call (default deny)",
    });
    const gatewayPolicy = new iam.Policy(this, "GatewayPolicy", {
      roles: [gatewayRole],
      statements: [
        new iam.PolicyStatement({
          sid: "InvokeInterceptorAndTools",
          actions: ["lambda:InvokeFunction"],
          resources: [this.interceptorFn.functionArn, ...targets.map((target) => target.fn.functionArn)],
        }),
        new iam.PolicyStatement({
          sid: "EvaluateToolPolicies",
          actions: [
            "bedrock-agentcore:AuthorizeAction",
            "bedrock-agentcore:PartiallyAuthorizeActions",
            "bedrock-agentcore:GetPolicyEngine",
          ],
          resources: [
            this.policyEngine.attrPolicyEngineArn,
            `arn:aws:bedrock-agentcore:${this.region}:${this.account}:gateway/*`,
          ],
        }),
      ],
    });
    this.gateway = new agentcore.CfnGateway(this, "Gateway", {
      name: resourceName(stage, "cortex-tools"),
      description: "Cortex MCP server: every tool, one catalogue, tenant-checked on each call",
      protocolType: "MCP",
      protocolConfiguration: {
        mcp: {
          searchType: "SEMANTIC",
          instructions:
            "Cortex tools for carbon removal MRV. Your tenant comes from your sign-in. Pass project_id to work on one of your projects.",
        },
      },
      authorizerType: "CUSTOM_JWT",
      authorizerConfiguration: { customJwtAuthorizer: { discoveryUrl, allowedClients } },
      roleArn: gatewayRole.roleArn,
      interceptorConfigurations: [
        {
          interceptor: { lambda: { arn: this.interceptorFn.functionArn } },
          interceptionPoints: ["REQUEST"],
          inputConfiguration: { passRequestHeaders: true },
        },
      ],
      policyEngineConfiguration: { arn: this.policyEngine.attrPolicyEngineArn, mode: cfg.cortex.policyMode },
      ...(stage === "sandbox" ? { exceptionLevel: "DEBUG" } : {}),
    });
    this.gateway.node.addDependency(gatewayPolicy);

    const targetResources = targets.map((target) => {
      const resource = new agentcore.CfnGatewayTarget(this, `Target${target.name[0].toUpperCase()}${target.name.slice(1)}`, {
        gatewayIdentifier: this.gateway.attrGatewayIdentifier,
        name: target.name,
        description: target.description,
        credentialProviderConfigurations: [{ credentialProviderType: "GATEWAY_IAM_ROLE" }],
        targetConfiguration: {
          mcp: { lambda: { lambdaArn: target.fn.functionArn, toolSchema: { inlinePayload: target.tools } } },
        },
      });
      return resource;
    });

    // Cedar: default deny. A call is allowed only for a signed-in user whose token carries a tenant.
    // The interceptor then checks the tenant and the project grant against the tenancy table.
    const toolPolicy = new agentcore.CfnPolicy(this, "TenantUsersCallTools", {
      policyEngineId: this.policyEngine.attrPolicyEngineId,
      name: "tenant_users_call_cortex_tools",
      description: "Signed-in users with a tenant may call the Cortex tools",
      definition: {
        cedar: {
          statement: cdk.Fn.join("", [
            "permit (principal, action in [",
            this.toolNames.map((name) => `AgentCore::Action::"${name}"`).join(", "),
            '], resource == AgentCore::Gateway::"',
            this.gateway.attrGatewayArn,
            '") when { principal.hasTag("tenant_id") && principal.getTag("tenant_id") != "" };',
          ]),
        },
      },
    });
    for (const target of targetResources) {
      toolPolicy.node.addDependency(target);
    }

    // ── Memory: conversation only. Facts reach the knowledge base through ingestion and approval. ──
    // actorId convention: "<tenant_id>.<sub>", so summaries are namespaced per tenant and user.
    this.memory = new agentcore.CfnMemory(this, "Memory", {
      name: `${underscored}_cortex`,
      description: "Cortex conversation memory (summaries per tenant user and session)",
      eventExpiryDuration: cfg.cortex.memoryExpiryDays,
      memoryStrategies: [
        {
          summaryMemoryStrategy: {
            name: "conversation_summaries",
            namespaces: ["/summaries/{actorId}/{sessionId}"],
          },
        },
      ],
    });
    this.memory.applyRemovalPolicy(removal);

    // ── Runtime: only once a Cortex agent image has been pushed ─────────
    if (cfg.cortex.agentImageTag) {
      const runtimeRole = new iam.Role(this, "RuntimeRole", {
        roleName: resourceName(stage, "cortex-runtime"),
        assumedBy: new iam.ServicePrincipal("bedrock-agentcore.amazonaws.com", {
          conditions: {
            StringEquals: { "aws:SourceAccount": this.account },
            ArnLike: { "aws:SourceArn": `arn:aws:bedrock-agentcore:${this.region}:${this.account}:*` },
          },
        }),
      });
      const repoArn = `arn:aws:ecr:${this.region}:${this.account}:repository/${ecrCortexAgentRepo()}`;
      runtimeRole.addToPolicy(new iam.PolicyStatement({ actions: ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"], resources: [repoArn] }));
      runtimeRole.addToPolicy(new iam.PolicyStatement({ actions: ["ecr:GetAuthorizationToken"], resources: ["*"] }));
      runtimeRole.addToPolicy(
        new iam.PolicyStatement({
          actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"],
          resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*`],
        }),
      );
      runtimeRole.addToPolicy(
        new iam.PolicyStatement({
          actions: ["xray:PutTraceSegments", "xray:PutTelemetryRecords", "cloudwatch:PutMetricData"],
          resources: ["*"],
        }),
      );
      runtimeRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "Models",
          actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
          resources: [
            `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${BEDROCK_INFERENCE_PROFILE}`,
            "arn:aws:bedrock:*::foundation-model/anthropic.*",
          ],
        }),
      );
      runtimeRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "ConversationMemory",
          actions: [
            "bedrock-agentcore:CreateEvent",
            "bedrock-agentcore:GetEvent",
            "bedrock-agentcore:ListEvents",
            "bedrock-agentcore:ListSessions",
            "bedrock-agentcore:RetrieveMemoryRecords",
            "bedrock-agentcore:ListMemoryRecords",
            "bedrock-agentcore:GetMemoryRecord",
          ],
          resources: [this.memory.attrMemoryArn],
        }),
      );
      runtimeRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "WorkloadIdentity",
          actions: [
            "bedrock-agentcore:GetWorkloadAccessToken",
            "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
            "bedrock-agentcore:GetWorkloadAccessTokenForUserId",
          ],
          resources: [
            `arn:aws:bedrock-agentcore:${this.region}:${this.account}:workload-identity-directory/default`,
            `arn:aws:bedrock-agentcore:${this.region}:${this.account}:workload-identity-directory/default/workload-identity/*`,
          ],
        }),
      );
      // Checkpoints, uploads and project files only through a tenant-tagged session.
      runtimeRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "TenantScopedSessionsOnly",
          actions: ["sts:AssumeRole", "sts:TagSession"],
          resources: [props.tenantSessionRole.roleArn],
        }),
      );
      props.eventBus.grantPutEventsTo(runtimeRole);

      this.runtime = new agentcore.CfnRuntime(this, "Runtime", {
        agentRuntimeName: `${underscored}_cortex`,
        description: "Cortex agent (LangGraph): chat, drafting and approval graphs",
        roleArn: runtimeRole.roleArn,
        agentRuntimeArtifact: {
          containerConfiguration: {
            containerUri: `${this.account}.dkr.ecr.${this.region}.amazonaws.com/${ecrCortexAgentRepo()}:${cfg.cortex.agentImageTag}`,
          },
        },
        networkConfiguration: { networkMode: "PUBLIC" },
        protocolConfiguration: "HTTP",
        authorizerConfiguration: { customJwtAuthorizer: { discoveryUrl, allowedClients } },
        // The agent forwards the user's token to the gateway, so tool calls carry the user's tenant.
        requestHeaderConfiguration: { requestHeaderAllowlist: ["Authorization"] },
        environmentVariables: {
          GATEWAY_URL: this.gateway.attrGatewayUrl,
          MEMORY_ID: this.memory.attrMemoryId,
          CHECKPOINT_TABLE: props.checkpointsTable.tableName,
          TENANT_SESSION_ROLE_ARN: props.tenantSessionRole.roleArn,
          EVENT_BUS: props.eventBus.eventBusName,
          MODEL_ID: BEDROCK_INFERENCE_PROFILE,
        },
      });
      new cdk.CfnOutput(this, "RuntimeArn", { value: this.runtime.attrAgentRuntimeArn });
    }

    new cdk.CfnOutput(this, "GatewayId", { value: this.gateway.attrGatewayIdentifier });
    new cdk.CfnOutput(this, "GatewayUrl", { value: this.gateway.attrGatewayUrl });
    new cdk.CfnOutput(this, "PolicyEngineId", { value: this.policyEngine.attrPolicyEngineId });
    new cdk.CfnOutput(this, "MemoryId", { value: this.memory.attrMemoryId });
    new cdk.CfnOutput(this, "InterceptorFunctionName", { value: this.interceptorFn.functionName });
    new cdk.CfnOutput(this, "ToolNames", { value: this.toolNames.join(",") });
  }
}
