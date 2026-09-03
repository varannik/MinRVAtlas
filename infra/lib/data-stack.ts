import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import {
  ACCOUNT,
  cfnStackName,
  evidenceBucketName,
  logsBucketName,
  resourceName,
} from "./config";
import { Ew2Stack, type Ew2StackProps } from "./ew2-stack";
import type { MinrvSecurityGroups } from "./network-stack";

export interface DataStackProps extends Ew2StackProps {
  vpc: ec2.IVpc;
  sgs: MinrvSecurityGroups;
  keyArn: string;
}

export class DataStack extends Ew2Stack {
  public readonly evidenceBucket: s3.Bucket;
  public readonly logsBucket: s3.Bucket;
  public readonly cluster: rds.DatabaseCluster;
  public readonly proxy: rds.DatabaseProxy;
  public readonly valkey: elasticache.CfnServerlessCache;
  public readonly auroraSecret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, {
      ...props,
      stackName: cfnStackName(props.cfg.stageName, "data"),
      description: `minrv-ew2 ${props.cfg.stageName} S3, Aurora, RDS Proxy, Valkey`,
    });

    const { cfg, vpc, sgs } = props;
    const key = kms.Key.fromKeyArn(this, "Cmk", props.keyArn);
    const removal = cfg.deletionProtection
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    this.evidenceBucket = new s3.Bucket(this, "Evidence", {
      bucketName: evidenceBucketName(cfg.stageName),
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: key,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      objectLockEnabled: cfg.objectLock,
      objectLockDefaultRetention: cfg.objectLock
        ? s3.ObjectLockRetention.governance(cdk.Duration.days(365))
        : undefined,
      lifecycleRules: [
        {
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
          noncurrentVersionExpiration: cdk.Duration.days(cfg.deletionProtection ? 365 : 90),
        },
      ],
      removalPolicy: removal,
    });

    this.logsBucket = new s3.Bucket(this, "Logs", {
      bucketName: logsBucketName(cfg.stageName),
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(cfg.logRetentionDays >= 365 ? 365 : 90),
        },
      ],
      removalPolicy: removal,
    });

    this.exportValue(this.evidenceBucket.bucketArn);
    this.exportValue(this.evidenceBucket.bucketName);
    this.exportValue(this.logsBucket.bucketArn);
    this.exportValue(this.logsBucket.bucketName);

    const proxySg = new ec2.SecurityGroup(this, "ProxySg", {
      vpc,
      description: "RDS Proxy :5432 from Sentinel only",
      allowAllOutbound: true,
    });
    const auroraSg = new ec2.SecurityGroup(this, "AuroraSg", {
      vpc,
      description: "Aurora PostgreSQL from RDS Proxy only",
      allowAllOutbound: true,
    });
    const valkeySg = new ec2.SecurityGroup(this, "ValkeySg", {
      vpc,
      description: "ElastiCache Valkey :6379 from Sentinel only",
      allowAllOutbound: true,
    });
    proxySg.addIngressRule(sgs.sentinel, ec2.Port.tcp(5432), "Sentinel to RDS Proxy");
    auroraSg.addIngressRule(proxySg, ec2.Port.tcp(5432), "Proxy to Aurora");
    valkeySg.addIngressRule(sgs.sentinel, ec2.Port.tcp(6379), "Sentinel to Valkey TLS");

    this.cluster = new rds.DatabaseCluster(this, "Aurora", {
      clusterIdentifier: resourceName(cfg.stageName, "aurora"),
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_13,
      }),
      credentials: rds.Credentials.fromGeneratedSecret("dmrv_app", {
        secretName: `minrv/ew2/${cfg.stageName}/aurora`,
        encryptionKey: key,
      }),
      defaultDatabaseName: "dmrv",
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [auroraSg],
      serverlessV2MinCapacity: cfg.auroraMinAcu,
      serverlessV2MaxCapacity: cfg.auroraMaxAcu,
      writer: rds.ClusterInstance.serverlessV2("writer", {
        enablePerformanceInsights: cfg.deletionProtection,
      }),
      storageEncrypted: true,
      storageEncryptionKey: key,
      iamAuthentication: true,
      deletionProtection: cfg.deletionProtection,
      backup: { retention: cdk.Duration.days(cfg.backupDays) },
      cloudwatchLogsExports: ["postgresql"],
      parameters: { "rds.force_ssl": "1" },
      removalPolicy: cfg.deletionProtection
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.SNAPSHOT,
    });

    this.auroraSecret = this.cluster.secret!;

    this.proxy = this.cluster.addProxy("Proxy", {
      dbProxyName: resourceName(cfg.stageName, "rds-proxy"),
      secrets: [this.auroraSecret],
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [proxySg],
      iamAuth: false,
      requireTLS: true,
      debugLogging: !cfg.deletionProtection,
      maxConnectionsPercent: 100,
      maxIdleConnectionsPercent: 50,
      idleClientTimeout: cdk.Duration.minutes(30),
    });

    new secretsmanager.SecretRotation(this, "AuroraRotation", {
      application: secretsmanager.SecretRotationApplication.POSTGRES_ROTATION_SINGLE_USER,
      secret: this.auroraSecret,
      target: this.cluster,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      automaticallyAfter: cdk.Duration.days(30),
    });

    this.valkey = new elasticache.CfnServerlessCache(this, "Valkey", {
      engine: "valkey",
      serverlessCacheName: resourceName(cfg.stageName, "valkey"),
      majorEngineVersion: "8",
      securityGroupIds: [valkeySg.securityGroupId],
      subnetIds: vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      }).subnetIds,
      kmsKeyId: key.keyId,
      dailySnapshotTime: "03:00",
      snapshotRetentionLimit: cfg.deletionProtection ? 7 : 1,
    });
    this.valkey.applyRemovalPolicy(removal);

    this.logsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowElbLogDelivery",
        principals: [new iam.ServicePrincipal("logdelivery.elasticloadbalancing.amazonaws.com")],
        actions: ["s3:PutObject"],
        resources: [this.logsBucket.arnForObjects(`alb/${cfg.stageName}/*`)],
        conditions: { StringEquals: { "s3:x-amz-acl": "bucket-owner-full-control" } },
      }),
    );
    this.logsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowElbAclCheck",
        principals: [new iam.ServicePrincipal("logdelivery.elasticloadbalancing.amazonaws.com")],
        actions: ["s3:GetBucketAcl"],
        resources: [this.logsBucket.bucketArn],
      }),
    );
    this.logsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowElbAccountEuWest2",
        principals: [new iam.AccountPrincipal("652711504416")],
        actions: ["s3:PutObject"],
        resources: [this.logsBucket.arnForObjects(`alb/${cfg.stageName}/*`)],
      }),
    );

    new cdk.CfnOutput(this, "EvidenceBucket", {
      value: this.evidenceBucket.bucketName,
    });
    new cdk.CfnOutput(this, "LogsBucket", { value: this.logsBucket.bucketName });
    new cdk.CfnOutput(this, "AuroraClusterArn", {
      value: this.cluster.clusterArn,
    });
    new cdk.CfnOutput(this, "RdsProxyEndpoint", {
      value: this.proxy.endpoint,
    });
    new cdk.CfnOutput(this, "ValkeyEndpoint", {
      value: this.valkey.attrEndpointAddress,
    });
    new cdk.CfnOutput(this, "AccountIdUsed", { value: ACCOUNT });
  }
}
