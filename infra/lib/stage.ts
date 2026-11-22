import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { ENV_EDGE, type StageConfig } from "./config";
import { CloudFrontStack } from "./cloudfront-stack";
import { ComplianceStack } from "./compliance-stack";
import { ComputeStack } from "./compute-stack";
import { CortexAgentStack } from "./cortex/agent-stack";
import { CortexCoreStack } from "./cortex/core-stack";
import { CortexGraphStack } from "./cortex/graph-stack";
import { CortexKnowledgeStack } from "./cortex/knowledge-stack";
import { DataStack } from "./data-stack";
import { EdgeStack } from "./edge-stack";
import { IdentityStack } from "./identity-stack";
import { NetworkStack } from "./network-stack";
import { ObservabilityStack } from "./observability-stack";
import { SecurityStack } from "./security-stack";

export interface MinrvStageProps extends cdk.StageProps {
  cfg: StageConfig;
}

export class MinrvStage extends cdk.Stage {
  public readonly network: NetworkStack;
  public readonly security: SecurityStack;
  public readonly identity: IdentityStack;
  public readonly data: DataStack;
  public readonly compute: ComputeStack;
  public readonly edge: EdgeStack;
  public readonly observability: ObservabilityStack;
  public readonly compliance: ComplianceStack;
  public readonly cortex?: {
    core: CortexCoreStack;
    knowledge: CortexKnowledgeStack;
    graph?: CortexGraphStack;
    agent: CortexAgentStack;
  };

  constructor(scope: Construct, id: string, props: MinrvStageProps) {
    super(scope, id, props);
    const { cfg } = props;

    this.network = new NetworkStack(this, "network", { env: props.env, cfg });
    this.security = new SecurityStack(this, "security", { env: props.env, cfg });
    this.identity = new IdentityStack(this, "identity", {
      env: props.env,
      cfg,
      keyArn: this.security.key.keyArn,
    });
    this.data = new DataStack(this, "data", {
      env: props.env,
      cfg,
      vpc: this.network.vpc,
      sgs: this.network.sgs,
      keyArn: this.security.key.keyArn,
    });
    this.compute = new ComputeStack(this, "compute", {
      env: props.env,
      cfg,
      vpc: this.network.vpc,
      sgs: this.network.sgs,
      keyArn: this.security.key.keyArn,
      cluster: this.data.cluster,
      proxy: this.data.proxy,
      valkey: this.data.valkey,
      logsBucket: this.data.logsBucket,
      streamBucket: this.data.streamBucket,
      userPoolId: this.identity.userPool.userPoolId,
      userPoolArn: this.identity.userPool.userPoolArn,
      userPoolClientId: this.identity.userPoolClient.userPoolClientId,
      cognitoHostedUiHost: this.identity.hostedUiHost,
    });
    this.edge = new EdgeStack(this, "edge", {
      env: props.env,
      cfg,
      vpc: this.network.vpc,
      sgs: this.network.sgs,
      logsBucket: this.data.logsBucket,
      publicAlb: this.compute.publicAlb,
      webTargetGroupArn: this.compute.webTargetGroup.targetGroupArn,
    });
    this.observability = new ObservabilityStack(this, "observability", {
      env: props.env,
      cfg,
      publicAlb: this.edge.publicAlb,
      internalAlb: this.compute.internalAlb,
      webService: this.compute.webService,
      apiService: this.compute.apiService,
      workerService: this.compute.workerService,
      beatService: this.compute.beatService,
      aurora: this.data.cluster,
      valkey: this.data.valkey,
    });
    this.compliance = new ComplianceStack(this, "compliance", {
      env: props.env,
      cfg,
      evidenceBucket: this.data.evidenceBucket,
      logsBucket: this.data.logsBucket,
    });

    this.data.addStackDependency(this.network);
    this.data.addStackDependency(this.security);
    this.identity.addStackDependency(this.security);
    this.compute.addStackDependency(this.network);
    this.compute.addStackDependency(this.security);
    this.compute.addStackDependency(this.identity);
    this.compute.addStackDependency(this.data);
    this.edge.addStackDependency(this.compute);
    this.observability.addStackDependency(this.edge);
    this.observability.addStackDependency(this.compute);
    this.compliance.addStackDependency(this.data);

    if (cfg.cortex.enabled) {
      this.cortex = this.createCortex(props);
    }

    if (cfg.enableCloudFront) {
      const cloudfront = new CloudFrontStack(this, "cloudfront", {
        env: ENV_EDGE,
        stageName: cfg.stageName,
        albDnsName: this.compute.publicAlb.loadBalancerDnsName,
        domainName: cfg.domainName,
        hostedZoneId: cfg.hostedZoneId,
        hostedZoneName: cfg.hostedZoneName,
      });
      cloudfront.addStackDependency(this.edge);
      cloudfront.addStackDependency(this.compute);
    }
  }

  /** Cortex stacks (see the Cortex AWS Blueprint): core, knowledge, graph, agent. */
  private createCortex(props: MinrvStageProps): NonNullable<MinrvStage["cortex"]> {
    const { cfg, env } = props;
    const keyArn = this.security.key.keyArn;
    const vpc = this.network.vpc;

    const core = new CortexCoreStack(this, "cortex-core", { env, cfg, keyArn });
    core.addStackDependency(this.security);

    const knowledge = new CortexKnowledgeStack(this, "cortex-knowledge", {
      env,
      cfg,
      vpc,
      keyArn,
      tenancyTable: core.tenancyTable,
      checkpointsTable: core.checkpointsTable,
      journeysTable: core.journeysTable,
      requirementsTable: core.requirementsTable,
      eventBus: core.eventBus,
    });
    knowledge.addStackDependency(this.network);
    knowledge.addStackDependency(core);

    const graph = cfg.cortex.graph
      ? new CortexGraphStack(this, "cortex-graph", { env, cfg, vpc, keyArn, eventBus: core.eventBus })
      : undefined;
    graph?.addStackDependency(this.network);
    graph?.addStackDependency(this.security);
    graph?.addStackDependency(core);

    const agent = new CortexAgentStack(this, "cortex-agent", {
      env,
      cfg,
      userPool: this.identity.userPool,
      clients: [this.identity.userPoolClient, this.identity.mcpClient],
      tenancyTable: core.tenancyTable,
      checkpointsTable: core.checkpointsTable,
      journeysTable: core.journeysTable,
      eventBus: core.eventBus,
      tenantSessionRole: knowledge.tenantSessionRole,
      searchFn: knowledge.searchFn,
      traceFn: graph?.traceFn,
    });
    agent.addStackDependency(this.identity);
    agent.addStackDependency(knowledge);
    if (graph) {
      agent.addStackDependency(graph);
    }

    return { core, knowledge, graph, agent };
  }
}
