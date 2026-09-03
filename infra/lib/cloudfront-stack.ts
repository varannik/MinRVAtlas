import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";
import { ENV_EDGE, PROJECT, type StageName } from "./config";
import { managedRule } from "./waf-rules";

export interface CloudFrontStackProps extends cdk.StackProps {
  stageName: StageName;
  albDnsName: string;
  domainName?: string;
  hostedZoneId?: string;
  hostedZoneName?: string;
}

/**
 * Optional us-east-1 edge. Only instantiated when ENABLE_CLOUDFRONT=1 (prod).
 * Requires CDKToolkit in us-east-1.
 */
export class CloudFrontStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CloudFrontStackProps) {
    super(scope, id, {
      ...props,
      env: ENV_EDGE,
      stackName: `minrv-ew2-${props.stageName}-cloudfront`,
      description: `minrv-ew2 ${props.stageName} CloudFront + ACM + WAF (us-east-1)`,
      crossRegionReferences: true,
    });

    cdk.Tags.of(this).add("Project", PROJECT);
    cdk.Tags.of(this).add("Stage", props.stageName);
    cdk.Tags.of(this).add("ManagedBy", "cdk");

    const origin = new origins.HttpOrigin(props.albDnsName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      readTimeout: cdk.Duration.seconds(120),
    });

    const waf = new wafv2.CfnWebACL(this, "CfWaf", {
      name: `minrv-ew2-${props.stageName}-cf`,
      scope: "CLOUDFRONT",
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `minrv-ew2-${props.stageName}-cf`,
        sampledRequestsEnabled: true,
      },
      rules: [
        managedRule("AWSManagedRulesAmazonIpReputationList", 1),
        managedRule("AWSManagedRulesCommonRuleSet", 10, { bodyOverrides: true }),
      ],
    });

    const zone =
      props.domainName && props.hostedZoneId && props.hostedZoneName
        ? route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
            hostedZoneId: props.hostedZoneId,
            zoneName: props.hostedZoneName,
          })
        : undefined;

    const certificate = zone && props.domainName
      ? new acm.Certificate(this, "CfCert", {
          domainName: props.domainName,
          validation: acm.CertificateValidation.fromDns(zone),
        })
      : undefined;

    const distribution = new cloudfront.Distribution(this, "Dist", {
      comment: `minrv-ew2 ${props.stageName}`,
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      },
      additionalBehaviors: {
        "/_next/static/*": {
          origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        "/api/*": {
          origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        },
      },
      webAclId: waf.attrArn,
      domainNames: props.domainName ? [props.domainName] : undefined,
      certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    if (zone && props.domainName && props.hostedZoneName) {
      const recordName = dnsRecordName(props.domainName, props.hostedZoneName);
      new route53.ARecord(this, "AliasA", {
        zone,
        recordName,
        target: route53.RecordTarget.fromAlias(
          new targets.CloudFrontTarget(distribution),
        ),
      });
      new route53.AaaaRecord(this, "AliasAaaa", {
        zone,
        recordName,
        target: route53.RecordTarget.fromAlias(
          new targets.CloudFrontTarget(distribution),
        ),
      });
    }

    new cdk.CfnOutput(this, "DistributionDomain", {
      value: distribution.distributionDomainName,
    });
    if (props.domainName) {
      new cdk.CfnOutput(this, "AliasDomain", {
        value: props.domainName,
      });
    }
  }
}

export function dnsRecordName(domainName: string, zoneName: string): string | undefined {
  const domain = domainName.replace(/\.$/, "").toLowerCase();
  const zone = zoneName.replace(/\.$/, "").toLowerCase();
  if (domain === zone) {
    return undefined;
  }
  const suffix = `.${zone}`;
  if (!domain.endsWith(suffix)) {
    throw new Error(`DOMAIN_NAME ${domainName} is not in zone ${zoneName}`);
  }
  return domain.slice(0, -suffix.length);
}
