import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { VPC_CIDR, cfnStackName, logGroupName } from "./config";
import { Ew2Stack, type Ew2StackProps } from "./ew2-stack";

export interface MinrvSecurityGroups {
  publicAlb: ec2.SecurityGroup;
  web: ec2.SecurityGroup;
  internalAlb: ec2.SecurityGroup;
  sentinel: ec2.SecurityGroup;
  vpce: ec2.SecurityGroup;
}

export class NetworkStack extends Ew2Stack {
  public readonly vpc: ec2.Vpc;
  public readonly sgs: MinrvSecurityGroups;

  constructor(scope: Construct, id: string, props: Ew2StackProps) {
    super(scope, id, {
      ...props,
      stackName: cfnStackName(props.cfg.stageName, "network"),
      description: `minrv-ew2 ${props.cfg.stageName} VPC, endpoints, security groups (eu-west-2)`,
    });

    const { cfg } = props;
    const logRetention = logs.RetentionDays.ONE_MONTH;

    this.vpc = new ec2.Vpc(this, "Vpc", {
      ipAddresses: ec2.IpAddresses.cidr(VPC_CIDR),
      maxAzs: 3,
      natGateways: cfg.natGateways,
      enableDnsHostnames: true,
      enableDnsSupport: true,
      subnetConfiguration: [
        { name: "Public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        {
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: "Isolated",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
      gatewayEndpoints: {
        S3: { service: ec2.GatewayVpcEndpointAwsService.S3 },
      },
    });

    const flowLogGroup = new logs.LogGroup(this, "VpcFlowLogs", {
      logGroupName: logGroupName(cfg.stageName, "vpc-flow"),
      retention: cfg.logRetentionDays >= 365
        ? logs.RetentionDays.ONE_YEAR
        : logRetention,
      removalPolicy: cfg.deletionProtection
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    const flowRole = new iam.Role(this, "VpcFlowLogRole", {
      assumedBy: new iam.ServicePrincipal("vpc-flow-logs.amazonaws.com"),
    });
    flowLogGroup.grantWrite(flowRole);

    this.vpc.addFlowLog("FlowLogs", {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(flowLogGroup, flowRole),
      trafficType: ec2.FlowLogTrafficType.ALL,
    });

    this.sgs = this.createSecurityGroups();
    this.addInterfaceEndpoints();

    new cdk.CfnOutput(this, "VpcId", { value: this.vpc.vpcId });
    new cdk.CfnOutput(this, "VpcCidr", { value: VPC_CIDR });
  }

  private createSecurityGroups(): MinrvSecurityGroups {
    const vpc = this.vpc;

    const publicAlb = new ec2.SecurityGroup(this, "PublicAlbSg", {
      vpc,
      description: "Public ALB - HTTPS to dmrv-web only",
      allowAllOutbound: true,
    });
    publicAlb.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS operators");
    publicAlb.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "HTTP redirect");

    const web = new ec2.SecurityGroup(this, "WebSg", {
      vpc,
      description: "dmrv-web Fargate - Next.js :3000",
      allowAllOutbound: true,
    });
    web.addIngressRule(publicAlb, ec2.Port.tcp(3000), "ALB to Next");

    const internalAlb = new ec2.SecurityGroup(this, "InternalAlbSg", {
      vpc,
      description: "Internal ALB - sentinel-api :8000 from dmrv-web only",
      allowAllOutbound: true,
    });
    // Hard rule: no 0.0.0.0/0 on 8000
    internalAlb.addIngressRule(web, ec2.Port.tcp(8000), "Next to Sentinel");

    const sentinel = new ec2.SecurityGroup(this, "SentinelSg", {
      vpc,
      description: "sentinel-api / worker / beat",
      allowAllOutbound: true,
    });
    sentinel.addIngressRule(internalAlb, ec2.Port.tcp(8000), "Internal ALB to API");

    const vpce = new ec2.SecurityGroup(this, "VpceSg", {
      vpc,
      description: "Interface VPC endpoints :443 from VPC",
      allowAllOutbound: true,
    });
    vpce.addIngressRule(
      ec2.Peer.ipv4(VPC_CIDR),
      ec2.Port.tcp(443),
      "VPC to interface endpoints",
    );

    return { publicAlb, web, internalAlb, sentinel, vpce };
  }

  private addInterfaceEndpoints(): void {
    const subnets = { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };
    const sg = this.sgs.vpce;

    const services: Array<{ id: string; service: ec2.InterfaceVpcEndpointAwsService }> = [
      { id: "EcrApi", service: ec2.InterfaceVpcEndpointAwsService.ECR },
      { id: "EcrDkr", service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER },
      { id: "Logs", service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS },
      { id: "Secrets", service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER },
      { id: "Ssm", service: ec2.InterfaceVpcEndpointAwsService.SSM },
      { id: "Kms", service: ec2.InterfaceVpcEndpointAwsService.KMS },
      { id: "Sts", service: ec2.InterfaceVpcEndpointAwsService.STS },
      { id: "Ecs", service: ec2.InterfaceVpcEndpointAwsService.ECS },
    ];

    for (const { id, service } of services) {
      this.vpc.addInterfaceEndpoint(id, {
        service,
        subnets,
        securityGroups: [sg],
        privateDnsEnabled: true,
      });
    }

    this.vpc.addInterfaceEndpoint("BedrockRuntime", {
      service: new ec2.InterfaceVpcEndpointAwsService("bedrock-runtime"),
      subnets,
      securityGroups: [sg],
      privateDnsEnabled: true,
    });
  }
}
