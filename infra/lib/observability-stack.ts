import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cw_actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import { Construct } from "constructs";
import { cfnStackName, logGroupName, resourceName } from "./config";
import { Ew2Stack, type Ew2StackProps } from "./ew2-stack";

export interface ObservabilityStackProps extends Ew2StackProps {
  publicAlb: elbv2.ApplicationLoadBalancer;
  internalAlb: elbv2.ApplicationLoadBalancer;
  webService: ecs.FargateService;
  apiService: ecs.FargateService;
  workerService: ecs.FargateService;
  beatService: ecs.FargateService;
  aurora: rds.IDatabaseCluster;
  valkey: elasticache.CfnServerlessCache;
}

export class ObservabilityStack extends Ew2Stack {
  public readonly opsTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, {
      ...props,
      stackName: cfnStackName(props.cfg.stageName, "observability"),
      description: `minrv-ew2 ${props.cfg.stageName} logs, alarms, SNS`,
    });

    const { cfg } = props;
    const retention =
      cfg.logRetentionDays >= 365
        ? logs.RetentionDays.ONE_YEAR
        : logs.RetentionDays.ONE_MONTH;
    const removal = cfg.deletionProtection
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    new logs.LogGroup(this, "AlbLogs", {
      logGroupName: logGroupName(cfg.stageName, "alb"),
      retention,
      removalPolicy: removal,
    });

    this.opsTopic = new sns.Topic(this, "Ops", {
      topicName: resourceName(cfg.stageName, "ops"),
      displayName: `minrv-ew2 ${cfg.stageName} ops`,
    });
    if (cfg.opsEmail) {
      this.opsTopic.addSubscription(
        new subscriptions.EmailSubscription(cfg.opsEmail),
      );
    }

    const alarmAction = new cw_actions.SnsAction(this.opsTopic);

    const alb5xx = new cloudwatch.Alarm(this, "PublicAlb5xx", {
      alarmName: resourceName(cfg.stageName, "alb-5xx"),
      metric: props.publicAlb.metrics.httpCodeTarget(
        elbv2.HttpCodeTarget.TARGET_5XX_COUNT,
        { period: cdk.Duration.minutes(5), statistic: "Sum" },
      ),
      threshold: 5,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    alb5xx.addAlarmAction(alarmAction);

    const unhealthy = new cloudwatch.Alarm(this, "PublicUnhealthy", {
      alarmName: resourceName(cfg.stageName, "alb-unhealthy"),
      metric: new cloudwatch.Metric({
        namespace: "AWS/ApplicationELB",
        metricName: "UnHealthyHostCount",
        dimensionsMap: {
          LoadBalancer: props.publicAlb.loadBalancerFullName,
        },
        statistic: "Average",
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    unhealthy.addAlarmAction(alarmAction);

    const auroraCpu = new cloudwatch.Alarm(this, "AuroraCpu", {
      alarmName: resourceName(cfg.stageName, "aurora-cpu"),
      metric: props.aurora.metricCPUUtilization({
        period: cdk.Duration.minutes(5),
      }),
      threshold: 80,
      evaluationPeriods: 3,
    });
    auroraCpu.addAlarmAction(alarmAction);

    this.serviceCpuAlarm("WebCpu", props.webService, alarmAction);
    this.serviceCpuAlarm("ApiCpu", props.apiService, alarmAction);
    this.serviceCpuAlarm("WorkerCpu", props.workerService, alarmAction);

    new cloudwatch.Alarm(this, "InternalAlb5xx", {
      alarmName: resourceName(cfg.stageName, "int-alb-5xx"),
      metric: props.internalAlb.metrics.httpCodeTarget(
        elbv2.HttpCodeTarget.TARGET_5XX_COUNT,
        { period: cdk.Duration.minutes(5), statistic: "Sum" },
      ),
      threshold: 5,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alarmAction);

    new cloudwatch.Alarm(this, "ValkeyEcu", {
      alarmName: resourceName(cfg.stageName, "valkey-bytes"),
      metric: new cloudwatch.Metric({
        namespace: "AWS/ElastiCache",
        metricName: "BytesUsedForCache",
        dimensionsMap: {
          clusterId: props.valkey.ref,
        },
        statistic: "Average",
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1_000_000_000,
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alarmAction);

    new cdk.CfnOutput(this, "OpsTopicArn", { value: this.opsTopic.topicArn });
  }

  private serviceCpuAlarm(
    id: string,
    service: ecs.FargateService,
    action: cw_actions.SnsAction,
  ): void {
    const alarm = new cloudwatch.Alarm(this, id, {
      alarmName: resourceName(this.cfg.stageName, `${id.toLowerCase()}`),
      metric: service.metricCpuUtilization({ period: cdk.Duration.minutes(5) }),
      threshold: 80,
      evaluationPeriods: 3,
    });
    alarm.addAlarmAction(action);
  }
}
