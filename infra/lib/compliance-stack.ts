import * as cdk from "aws-cdk-lib";
import * as accessanalyzer from "aws-cdk-lib/aws-accessanalyzer";
import * as cloudtrail from "aws-cdk-lib/aws-cloudtrail";
import * as cr from "aws-cdk-lib/custom-resources";
import * as guardduty from "aws-cdk-lib/aws-guardduty";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as securityhub from "aws-cdk-lib/aws-securityhub";
import { Construct } from "constructs";
import { cfnStackName, resourceName } from "./config";
import { Ew2Stack, type Ew2StackProps } from "./ew2-stack";

export interface ComplianceStackProps extends Ew2StackProps {
  evidenceBucket: s3.IBucket;
  logsBucket: s3.IBucket;
}

export class ComplianceStack extends Ew2Stack {
  constructor(scope: Construct, id: string, props: ComplianceStackProps) {
    super(scope, id, {
      ...props,
      stackName: cfnStackName(props.cfg.stageName, "compliance"),
      description: `minrv-ew2 ${props.cfg.stageName} CloudTrail / GuardDuty / Security Hub / Config`,
    });

    const { cfg, evidenceBucket, logsBucket } = props;

    if (cfg.cloudTrailDataEvents) {
      const trail = new cloudtrail.Trail(this, "Trail", {
        trailName: resourceName(cfg.stageName, "trail"),
        bucket: logsBucket,
        s3KeyPrefix: `cloudtrail/${cfg.stageName}`,
        isMultiRegionTrail: false,
        includeGlobalServiceEvents: false,
        sendToCloudWatchLogs: true,
      });
      trail.addS3EventSelector(
        [
          {
            bucket: evidenceBucket,
            objectPrefix: "",
          },
        ],
        {
          readWriteType: cloudtrail.ReadWriteType.ALL,
          includeManagementEvents: false,
        },
      );
    }

    if (!cfg.enableRegionalSecurityServices) {
      return;
    }

    new guardduty.CfnDetector(this, "GuardDuty", {
      enable: true,
    });

    new securityhub.CfnHub(this, "SecurityHub");

    new accessanalyzer.CfnAnalyzer(this, "Analyzer", {
      type: "ACCOUNT",
      analyzerName: resourceName(cfg.stageName, "analyzer"),
    });

    const configRole = new iam.Role(this, "ConfigRole", {
      assumedBy: new iam.ServicePrincipal("config.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWS_ConfigRole"),
      ],
    });
    logsBucket.grantReadWrite(configRole);
    logsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "ConfigBucketAcl",
        principals: [new iam.ServicePrincipal("config.amazonaws.com")],
        actions: ["s3:GetBucketAcl", "s3:ListBucket"],
        resources: [logsBucket.bucketArn],
      }),
    );
    logsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "ConfigBucketWrite",
        principals: [new iam.ServicePrincipal("config.amazonaws.com")],
        actions: ["s3:PutObject"],
        resources: [logsBucket.arnForObjects(`config/${cfg.stageName}/*`)],
        conditions: {
          StringEquals: { "s3:x-amz-acl": "bucket-owner-full-control" },
        },
      }),
    );

    // Native AWS::Config::ConfigurationRecorder starts recording in the same
    // call, which requires a delivery channel; PutDeliveryChannel requires a
    // recorder. Sequence the SDK calls instead.
    const recorderName = resourceName(cfg.stageName, "config");
    const configApi = cr.AwsCustomResourcePolicy.fromStatements([
      new iam.PolicyStatement({
        actions: [
          "config:PutConfigurationRecorder",
          "config:DeleteConfigurationRecorder",
          "config:DescribeConfigurationRecorders",
          "config:PutDeliveryChannel",
          "config:DeleteDeliveryChannel",
          "config:DescribeDeliveryChannels",
          "config:StartConfigurationRecorder",
          "config:StopConfigurationRecorder",
          "iam:PassRole",
        ],
        resources: ["*"],
      }),
    ]);
    const sdk = { service: "ConfigService" };
    const ignoreGone =
      "NoSuchConfigurationRecorderException|NoSuchDeliveryChannelException|NoAvailableDeliveryChannelException|LastDeliveryChannelDeleteFailedException";

    const putRecorder = new cr.AwsCustomResource(this, "PutConfigRecorder", {
      timeout: cdk.Duration.minutes(5),
      installLatestAwsSdk: false,
      policy: configApi,
      onCreate: {
        ...sdk,
        action: "putConfigurationRecorder",
        parameters: {
          ConfigurationRecorder: {
            name: recorderName,
            roleARN: configRole.roleArn,
            recordingGroup: {
              allSupported: true,
              includeGlobalResourceTypes: false,
            },
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of(recorderName),
      },
      onDelete: {
        ...sdk,
        action: "deleteConfigurationRecorder",
        parameters: { ConfigurationRecorderName: recorderName },
        ignoreErrorCodesMatching: ignoreGone,
      },
    });
    putRecorder.node.addDependency(configRole);

    const putChannel = new cr.AwsCustomResource(this, "PutConfigChannel", {
      timeout: cdk.Duration.minutes(5),
      installLatestAwsSdk: false,
      policy: configApi,
      onCreate: {
        ...sdk,
        action: "putDeliveryChannel",
        parameters: {
          DeliveryChannel: {
            name: recorderName,
            s3BucketName: logsBucket.bucketName,
            s3KeyPrefix: `config/${cfg.stageName}`,
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${recorderName}-channel`),
      },
      onDelete: {
        ...sdk,
        action: "deleteDeliveryChannel",
        parameters: { DeliveryChannelName: recorderName },
        ignoreErrorCodesMatching: ignoreGone,
      },
    });
    putChannel.node.addDependency(putRecorder);

    const startRecorder = new cr.AwsCustomResource(this, "StartConfigRecorder", {
      timeout: cdk.Duration.minutes(5),
      installLatestAwsSdk: false,
      policy: configApi,
      onCreate: {
        ...sdk,
        action: "startConfigurationRecorder",
        parameters: { ConfigurationRecorderName: recorderName },
        physicalResourceId: cr.PhysicalResourceId.of(`${recorderName}-start`),
      },
      onDelete: {
        ...sdk,
        action: "stopConfigurationRecorder",
        parameters: { ConfigurationRecorderName: recorderName },
        ignoreErrorCodesMatching: ignoreGone,
      },
    });
    startRecorder.node.addDependency(putChannel);
  }
}
