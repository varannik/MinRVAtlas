import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { ENV_EDGE, type StageConfig } from "./config";
import { CloudFrontStack } from "./cloudfront-stack";
import { ComplianceStack } from "./compliance-stack";
import { ComputeStack } from "./compute-stack";
import { DataStack } from "./data-stack";
import { EdgeStack } from "./edge-stack";
import { NetworkStack } from "./network-stack";
import { ObservabilityStack } from "./observability-stack";
import { SecurityStack } from "./security-stack";

export interface MinrvStageProps extends cdk.StageProps {
  cfg: StageConfig;
}

export class MinrvStage extends cdk.Stage {
  public readonly network: NetworkStack;
  public readonly security: SecurityStack;
  public readonly data: DataStack;
  public readonly compute: ComputeStack;
  public readonly edge: EdgeStack;
  public readonly observability: ObservabilityStack;
  public readonly compliance: ComplianceStack;

  constructor(scope: Construct, id: string, props: MinrvStageProps) {
    super(scope, id, props);
    const { cfg } = props;

    this.network = new NetworkStack(this, "network", { env: props.env, cfg });
    this.security = new SecurityStack(this, "security", { env: props.env, cfg });
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
    this.compute.addStackDependency(this.network);
    this.compute.addStackDependency(this.security);
    this.compute.addStackDependency(this.data);
    this.edge.addStackDependency(this.compute);
    this.observability.addStackDependency(this.edge);
    this.observability.addStackDependency(this.compute);
    this.compliance.addStackDependency(this.data);

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
}
