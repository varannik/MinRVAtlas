import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";
import { cfnStackName, resourceName } from "./config";
import { Ew2Stack, type Ew2StackProps } from "./ew2-stack";
import type { MinrvSecurityGroups } from "./network-stack";
import { managedRule } from "./waf-rules";

export interface EdgeStackProps extends Ew2StackProps {
  vpc: ec2.IVpc;
  sgs: MinrvSecurityGroups;
  logsBucket: s3.IBucket;
  publicAlb: elbv2.ApplicationLoadBalancer;
  webTargetGroupArn: string;
}

export class EdgeStack extends Ew2Stack {
  public readonly publicAlb: elbv2.ApplicationLoadBalancer;
  public readonly certificate?: acm.ICertificate;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, {
      ...props,
      stackName: cfnStackName(props.cfg.stageName, "edge"),
      description: `minrv-ew2 ${props.cfg.stageName} public ALB + WAF`,
      crossRegionReferences: props.cfg.enableCloudFront,
    });

    this.publicAlb = props.publicAlb;
    this.certificate = this.maybeCertificate();

    if (this.certificate) {
      new elbv2.CfnListener(this, "Https", {
        loadBalancerArn: this.publicAlb.loadBalancerArn,
        port: 443,
        protocol: "HTTPS",
        certificates: [{ certificateArn: this.certificate.certificateArn }],
        defaultActions: [
          { type: "forward", targetGroupArn: props.webTargetGroupArn },
        ],
      });
    }

    this.attachWaf();

    new cdk.CfnOutput(this, "PublicAlbDns", {
      value: this.publicAlb.loadBalancerDnsName,
    });
    new cdk.CfnOutput(this, "PublicProtocol", {
      value: this.certificate ? "https" : "http",
    });
  }

  private maybeCertificate(): acm.ICertificate | undefined {
    const { cfg } = this;
    if (!cfg.domainName) {
      return undefined;
    }
    if (cfg.hostedZoneId && cfg.hostedZoneName) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
        hostedZoneId: cfg.hostedZoneId,
        zoneName: cfg.hostedZoneName,
      });
      return new acm.Certificate(this, "AlbCert", {
        domainName: cfg.domainName,
        validation: acm.CertificateValidation.fromDns(zone),
      });
    }
    return new acm.Certificate(this, "AlbCertDnsManual", {
      domainName: cfg.domainName,
      validation: acm.CertificateValidation.fromDns(),
    });
  }

  private attachWaf(): void {
    const name = resourceName(this.cfg.stageName, "alb-waf");
    const sampled = {
      cloudWatchMetricsEnabled: true,
      sampledRequestsEnabled: true,
    };

    const acl = new wafv2.CfnWebACL(this, "PublicWaf", {
      name,
      scope: "REGIONAL",
      defaultAction: { allow: {} },
      visibilityConfig: {
        ...sampled,
        metricName: name,
      },
      rules: [
        managedRule("AWSManagedRulesAmazonIpReputationList", 1),
        managedRule("AWSManagedRulesCommonRuleSet", 10, { bodyOverrides: true }),
        managedRule("AWSManagedRulesKnownBadInputsRuleSet", 20),
      ],
    });

    new wafv2.CfnWebACLAssociation(this, "PublicWafAssoc", {
      resourceArn: this.publicAlb.loadBalancerArn,
      webAclArn: acl.attrArn,
    });
  }
}

