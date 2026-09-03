import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import {
  ACCOUNT,
  BEDROCK_INFERENCE_PROFILE,
  PLACEHOLDER_IMAGE,
  REGION,
  appSecretName,
  cfnStackName,
  ecrSentinelRepo,
  ecrWebRepo,
  entraSecretName,
  evidenceBucketName,
  isometricHost,
  isometricSecretName,
  logGroupName,
  projectLocationsParamName,
  resourceName,
} from "./config";
import { Ew2Stack, type Ew2StackProps } from "./ew2-stack";
import type { MinrvSecurityGroups } from "./network-stack";

export interface ComputeStackProps extends Ew2StackProps {
  vpc: ec2.IVpc;
  sgs: MinrvSecurityGroups;
  keyArn: string;
  cluster: rds.IDatabaseCluster;
  proxy: rds.IDatabaseProxy;
  valkey: elasticache.CfnServerlessCache;
  logsBucket: s3.IBucket;
}

export class ComputeStack extends Ew2Stack {
  public readonly ecsCluster: ecs.Cluster;
  public readonly webService: ecs.FargateService;
  public readonly apiService: ecs.FargateService;
  public readonly workerService: ecs.FargateService;
  public readonly beatService: ecs.FargateService;
  public readonly execRole: iam.Role;
  public readonly webTaskRole: iam.Role;
  public readonly sentinelTaskRole: iam.Role;
  public readonly internalAlb: elbv2.ApplicationLoadBalancer;
  public readonly publicAlb: elbv2.ApplicationLoadBalancer;
  public readonly webTargetGroup: elbv2.ApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, {
      ...props,
      stackName: cfnStackName(props.cfg.stageName, "compute"),
      description: `minrv-ew2 ${props.cfg.stageName} ECR + ECS Fargate (web, api, worker, beat)`,
      crossRegionReferences: props.cfg.enableCloudFront,
    });

    const { cfg, vpc, sgs } = props;
    const appSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "AppSecretRef",
      appSecretName(cfg.stageName),
    );
    const jwtSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "JwtSecretRef",
      `${appSecretName(cfg.stageName)}/secret-key`,
    );
    const isometricSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "IsometricSecretRef",
      isometricSecretName(cfg.stageName),
    );
    const entraSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "EntraSecretRef",
      entraSecretName(cfg.stageName),
    );
    const auroraSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "AuroraSecretRef",
      `minrv/ew2/${cfg.stageName}/aurora`,
    );

    this.ecsCluster = new ecs.Cluster(this, "Cluster", {
      clusterName: resourceName(cfg.stageName, "ecs"),
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENHANCED,
    });

    this.internalAlb = new elbv2.ApplicationLoadBalancer(this, "InternalAlb", {
      loadBalancerName: resourceName(cfg.stageName, "int"),
      vpc,
      internetFacing: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroup: sgs.internalAlb,
      dropInvalidHeaderFields: true,
      deletionProtection: cfg.deletionProtection,
    });
    this.internalAlb.logAccessLogs(props.logsBucket, `alb/${cfg.stageName}/internal`);

    this.publicAlb = new elbv2.ApplicationLoadBalancer(this, "PublicAlb", {
      loadBalancerName: resourceName(cfg.stageName, "pub"),
      vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: sgs.publicAlb,
      dropInvalidHeaderFields: true,
      deletionProtection: cfg.deletionProtection,
    });
    this.publicAlb.logAccessLogs(props.logsBucket, `alb/${cfg.stageName}/public`);

    this.execRole = this.createExecRole(props);
    this.webTaskRole = this.createWebTaskRole(props);
    this.sentinelTaskRole = this.createSentinelTaskRole(props);

    const webLog = this.logGroup("web");
    const apiLog = this.logGroup("api");
    const workerLog = this.logGroup("worker");
    const beatLog = this.logGroup("beat");

    const webRepo = ecr.Repository.fromRepositoryName(this, "WebRepo", ecrWebRepo());
    const sentinelRepo = ecr.Repository.fromRepositoryName(
      this,
      "SentinelRepo",
      ecrSentinelRepo(),
    );
    const webImage = this.containerImage(webRepo, cfg.webImageTag);
    const sentinelImage = this.containerImage(sentinelRepo, cfg.sentinelImageTag);
    const webReady = Boolean(cfg.webImageTag);
    const sentinelReady = Boolean(cfg.sentinelImageTag);

    const webTask = new ecs.FargateTaskDefinition(this, "WebTask", {
      family: resourceName(cfg.stageName, "web"),
      cpu: 1024,
      memoryLimitMiB: 2048,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      executionRole: this.execRole,
      taskRole: this.webTaskRole,
    });

    webTask.addContainer("web", {
      image: webImage,
      logging: ecs.LogDrivers.awsLogs({ logGroup: webLog, streamPrefix: "web" }),
      portMappings: [{ containerPort: 3000, name: "http" }],
      environment: {
        NODE_ENV: "production",
        PORT: "3000",
        HOSTNAME: "0.0.0.0",
        AWS_REGION: REGION,
        AWS_DEFAULT_REGION: REGION,
        MINRV_STAGE: cfg.stageName,
        PROJECT_LOCATIONS_PARAM: projectLocationsParamName(cfg.stageName),
        SENTINEL_BASE_URL: `http://${this.internalAlb.loadBalancerDnsName}:8000`,
        SENTINEL_TENANT_ID: "fourfourone",
        ISOMETRIC_API_HOST: isometricHost(cfg.isometricApi),
      },
      secrets: {
        ISOMETRIC_CLIENT_SECRET: ecs.Secret.fromSecretsManager(
          isometricSecret,
          "ISOMETRIC_CLIENT_SECRET",
        ),
        ISOMETRIC_ACCESS_TOKEN: ecs.Secret.fromSecretsManager(
          isometricSecret,
          "ISOMETRIC_ACCESS_TOKEN",
        ),
        ISOMETRIC_PROJECT_ID: ecs.Secret.fromSecretsManager(
          isometricSecret,
          "ISOMETRIC_PROJECT_ID",
        ),
        SENTINEL_SERVICE_TOKEN: ecs.Secret.fromSecretsManager(
          appSecret,
          "SENTINEL_SERVICE_TOKEN",
        ),
        SENTINEL_PROJECT_ID: ecs.Secret.fromSecretsManager(
          appSecret,
          "SENTINEL_PROJECT_ID",
        ),
      },
      essential: true,
    });

    const sentinelEnv = this.sentinelEnvironment(props);
    const sentinelSecrets = this.sentinelSecrets({
      appSecret,
      jwtSecret,
      entraSecret,
      auroraSecret,
    });

    const apiTask = this.sentinelTask("ApiTask", "api", 1024, 2048);
    apiTask.addContainer("api", {
      image: sentinelImage,
      logging: ecs.LogDrivers.awsLogs({ logGroup: apiLog, streamPrefix: "api" }),
      portMappings: [{ containerPort: 8000, name: "http" }],
      environment: sentinelEnv,
      secrets: sentinelSecrets,
      command: [
        "sh",
        "-c",
        composeDbUrl() +
          " alembic upgrade head || echo 'WARNING: alembic upgrade failed'; exec uvicorn app.main:app --host 0.0.0.0 --port 8000",
      ],
      essential: true,
    });

    const workerTask = this.sentinelTask("WorkerTask", "worker", 1024, 2048);
    workerTask.addContainer("worker", {
      image: sentinelImage,
      logging: ecs.LogDrivers.awsLogs({ logGroup: workerLog, streamPrefix: "worker" }),
      environment: sentinelEnv,
      secrets: sentinelSecrets,
      command: [
        "sh",
        "-c",
        composeDbUrl() +
          " exec celery -A app.tasks.celery_app worker --loglevel=info --concurrency=2",
      ],
      essential: true,
    });

    const beatTask = this.sentinelTask("BeatTask", "beat", 256, 512);
    beatTask.addContainer("beat", {
      image: sentinelImage,
      logging: ecs.LogDrivers.awsLogs({ logGroup: beatLog, streamPrefix: "beat" }),
      environment: sentinelEnv,
      secrets: sentinelSecrets,
      command: [
        "sh",
        "-c",
        composeDbUrl() +
          " exec celery -A app.tasks.celery_app beat --loglevel=info",
      ],
      essential: true,
    });

    const privateSubnets = {
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    };

    this.webService = new ecs.FargateService(this, "WebService", {
      serviceName: resourceName(cfg.stageName, "web"),
      cluster: this.ecsCluster,
      taskDefinition: webTask,
      desiredCount: webReady ? cfg.webCount : 0,
      assignPublicIp: false,
      vpcSubnets: privateSubnets,
      securityGroups: [sgs.web],
      circuitBreaker: { rollback: true },
      capacityProviderStrategies: [
        { capacityProvider: "FARGATE", weight: 1 },
      ],
      enableExecuteCommand: !cfg.deletionProtection,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    });

    this.apiService = new ecs.FargateService(this, "ApiService", {
      // Sentinel is API + worker + beat only. Do not add a Vite/frontend task.
      serviceName: resourceName(cfg.stageName, "api"),
      cluster: this.ecsCluster,
      taskDefinition: apiTask,
      desiredCount: sentinelReady ? cfg.apiCount : 0,
      assignPublicIp: false,
      vpcSubnets: privateSubnets,
      securityGroups: [sgs.sentinel],
      circuitBreaker: { rollback: true },
      capacityProviderStrategies: [{ capacityProvider: "FARGATE", weight: 1 }],
      enableExecuteCommand: !cfg.deletionProtection,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    });

    this.workerService = new ecs.FargateService(this, "WorkerService", {
      serviceName: resourceName(cfg.stageName, "worker"),
      cluster: this.ecsCluster,
      taskDefinition: workerTask,
      desiredCount: sentinelReady ? cfg.workerCount : 0,
      assignPublicIp: false,
      vpcSubnets: privateSubnets,
      securityGroups: [sgs.sentinel],
      circuitBreaker: { rollback: true },
      capacityProviderStrategies: [{ capacityProvider: "FARGATE", weight: 1 }],
      enableExecuteCommand: !cfg.deletionProtection,
      minHealthyPercent: 50,
      maxHealthyPercent: 200,
    });

    this.beatService = new ecs.FargateService(this, "BeatService", {
      serviceName: resourceName(cfg.stageName, "beat"),
      cluster: this.ecsCluster,
      taskDefinition: beatTask,
      desiredCount: sentinelReady ? cfg.beatCount : 0,
      assignPublicIp: false,
      vpcSubnets: privateSubnets,
      securityGroups: [sgs.sentinel],
      circuitBreaker: { rollback: true },
      capacityProviderStrategies: [{ capacityProvider: "FARGATE", weight: 1 }],
      enableExecuteCommand: !cfg.deletionProtection,
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
    });

    this.webTargetGroup = new elbv2.ApplicationTargetGroup(this, "WebTg", {
      vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: "/",
        healthyHttpCodes: "200-399",
        interval: cdk.Duration.seconds(30),
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });
    const publicHttp = this.publicAlb.addListener("Http", {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: false,
      defaultAction: elbv2.ListenerAction.forward([this.webTargetGroup]),
    });
    this.webService.attachToApplicationTargetGroup(this.webTargetGroup);
    this.webService.node.addDependency(publicHttp);

    const apiTg = new elbv2.ApplicationTargetGroup(this, "ApiTg", {
      vpc,
      port: 8000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: "/api/health",
        healthyHttpCodes: "200",
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });
    const sentinelListener = this.internalAlb.addListener("Sentinel", {
      port: 8000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: false,
      defaultAction: elbv2.ListenerAction.forward([apiTg]),
    });
    this.apiService.attachToApplicationTargetGroup(apiTg);
    this.apiService.node.addDependency(sentinelListener);

    new cdk.CfnOutput(this, "ClusterName", { value: this.ecsCluster.clusterName });
    new cdk.CfnOutput(this, "InternalAlbDns", {
      value: this.internalAlb.loadBalancerDnsName,
    });
    new cdk.CfnOutput(this, "PublicAlbDns", {
      value: this.publicAlb.loadBalancerDnsName,
    });
    new cdk.CfnOutput(this, "WebRepoUri", { value: webRepo.repositoryUri });
    new cdk.CfnOutput(this, "SentinelRepoUri", {
      value: sentinelRepo.repositoryUri,
    });
  }

  private logGroup(service: string): logs.LogGroup {
    return new logs.LogGroup(this, `Log${service}`, {
      logGroupName: logGroupName(this.cfg.stageName, service),
      retention:
        this.cfg.logRetentionDays >= 365
          ? logs.RetentionDays.ONE_YEAR
          : logs.RetentionDays.ONE_MONTH,
      removalPolicy: this.cfg.deletionProtection
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });
  }

  private containerImage(repo: ecr.IRepository, tag?: string): ecs.ContainerImage {
    if (tag) {
      return ecs.ContainerImage.fromEcrRepository(repo, tag);
    }
    return ecs.ContainerImage.fromRegistry(PLACEHOLDER_IMAGE);
  }

  private sentinelTask(
    id: string,
    family: string,
    cpu: number,
    memoryLimitMiB: number,
  ): ecs.FargateTaskDefinition {
    return new ecs.FargateTaskDefinition(this, id, {
      family: resourceName(this.cfg.stageName, family),
      cpu,
      memoryLimitMiB,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      executionRole: this.execRole,
      taskRole: this.sentinelTaskRole,
    });
  }

  private sentinelEnvironment(props: ComputeStackProps): Record<string, string> {
    const { cfg } = props;
    return {
      ENVIRONMENT: cfg.stageName === "prod" ? "production" : "sandbox",
      AWS_REGION: REGION,
      AWS_DEFAULT_REGION: REGION,
      AWS_S3_BUCKET: evidenceBucketName(cfg.stageName),
      DB_HOST: props.proxy.endpoint,
      DB_PORT: "5432",
      DB_NAME: "dmrv",
      VALKEY_HOST: props.valkey.attrEndpointAddress,
      VALKEY_PORT: props.valkey.attrEndpointPort,
      LLM_PROVIDER: "bedrock",
      BEDROCK_INFERENCE_PROFILE,
      ANTHROPIC_API_KEY: "",
      TENANT_ID: "fourfourone",
      UPLOAD_DIR: "/app/uploads",
    };
  }

  private sentinelSecrets(secrets: {
    appSecret: secretsmanager.ISecret;
    jwtSecret: secretsmanager.ISecret;
    entraSecret: secretsmanager.ISecret;
    auroraSecret: secretsmanager.ISecret;
  }): Record<string, ecs.Secret> {
    return {
      DB_USER: ecs.Secret.fromSecretsManager(secrets.auroraSecret, "username"),
      DB_PASSWORD: ecs.Secret.fromSecretsManager(secrets.auroraSecret, "password"),
      SECRET_KEY: ecs.Secret.fromSecretsManager(secrets.jwtSecret),
      SENTINEL_SERVICE_TOKEN: ecs.Secret.fromSecretsManager(
        secrets.appSecret,
        "SENTINEL_SERVICE_TOKEN",
      ),
      ALLOWED_ORIGINS: ecs.Secret.fromSecretsManager(secrets.appSecret, "ALLOWED_ORIGINS"),
      SENTINEL_PROJECT_ID: ecs.Secret.fromSecretsManager(
        secrets.appSecret,
        "SENTINEL_PROJECT_ID",
      ),
      MICROSOFT_CLIENT_ID: ecs.Secret.fromSecretsManager(
        secrets.entraSecret,
        "MICROSOFT_CLIENT_ID",
      ),
      MICROSOFT_CLIENT_SECRET: ecs.Secret.fromSecretsManager(
        secrets.entraSecret,
        "MICROSOFT_CLIENT_SECRET",
      ),
      MICROSOFT_TENANT_ID: ecs.Secret.fromSecretsManager(
        secrets.entraSecret,
        "MICROSOFT_TENANT_ID",
      ),
    };
  }

  private createExecRole(props: ComputeStackProps): iam.Role {
    const { cfg, keyArn } = props;
    const role = new iam.Role(this, "ExecRole", {
      roleName: resourceName(cfg.stageName, "ecs-exec"),
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AmazonECSTaskExecutionRolePolicy",
      ),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "Secrets",
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:minrv/ew2/${cfg.stageName}/*`,
        ],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "KmsDecrypt",
        actions: ["kms:Decrypt", "kms:DescribeKey"],
        resources: [keyArn],
      }),
    );
    return role;
  }

  private createWebTaskRole(props: ComputeStackProps): iam.Role {
    const { cfg, keyArn } = props;
    const role = new iam.Role(this, "WebTaskRole", {
      roleName: resourceName(cfg.stageName, "web-task"),
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "ReadIsometricAndApp",
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:${isometricSecretName(cfg.stageName)}*`,
          `arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:${appSecretName(cfg.stageName)}*`,
        ],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "KmsDecrypt",
        actions: ["kms:Decrypt"],
        resources: [keyArn],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "ProjectLocations",
        actions: ["ssm:GetParameter", "ssm:PutParameter"],
        resources: [
          `arn:aws:ssm:${REGION}:${ACCOUNT}:parameter${projectLocationsParamName(cfg.stageName)}`,
        ],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "DenyBedrock",
        effect: iam.Effect.DENY,
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: ["*"],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "DenyEvidenceWrites",
        effect: iam.Effect.DENY,
        actions: ["s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"],
        resources: [
          `arn:aws:s3:::${evidenceBucketName(cfg.stageName)}`,
          `arn:aws:s3:::${evidenceBucketName(cfg.stageName)}/*`,
        ],
      }),
    );
    return role;
  }

  private createSentinelTaskRole(props: ComputeStackProps): iam.Role {
    const { cfg, keyArn, cluster } = props;
    const role = new iam.Role(this, "SentinelTaskRole", {
      roleName: resourceName(cfg.stageName, "sentinel-task"),
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "Evidence",
        actions: [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:AbortMultipartUpload",
          "s3:ListBucket",
        ],
        resources: [
          `arn:aws:s3:::${evidenceBucketName(cfg.stageName)}`,
          `arn:aws:s3:::${evidenceBucketName(cfg.stageName)}/*`,
        ],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "BedrockEu",
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: [
          `arn:aws:bedrock:${REGION}:${ACCOUNT}:inference-profile/eu.anthropic.*`,
          "arn:aws:bedrock:*::foundation-model/anthropic.*",
        ],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "RdsIam",
        actions: ["rds-db:connect"],
        resources: [
          `arn:aws:rds-db:${REGION}:${ACCOUNT}:dbuser:${cluster.clusterResourceIdentifier}/dmrv_app`,
        ],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "AppSecretOnly",
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:minrv/ew2/${cfg.stageName}/app*`,
          `arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:minrv/ew2/${cfg.stageName}/aurora*`,
          `arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:minrv/ew2/${cfg.stageName}/entra*`,
        ],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "DenyIsometricSecret",
        effect: iam.Effect.DENY,
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:${isometricSecretName(cfg.stageName)}*`,
        ],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "KmsDecrypt",
        actions: ["kms:Decrypt", "kms:GenerateDataKey"],
        resources: [keyArn],
      }),
    );
    return role;
  }
}

function composeDbUrl(): string {
  return [
    'export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=require";',
    'export REDIS_URL="rediss://${VALKEY_HOST}:${VALKEY_PORT}/0";',
  ].join(" ");
}
