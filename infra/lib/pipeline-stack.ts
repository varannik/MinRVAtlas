import * as cdk from "aws-cdk-lib";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as cpactions from "aws-cdk-lib/aws-codepipeline-actions";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import {
  cfnStackName,
  ecrSentinelRepo,
  ecrWebRepo,
  logGroupName,
  resourceName,
} from "./config";
import { Ew2Stack, type Ew2StackProps } from "./ew2-stack";

/**
 * AWS-native CI/CD for the existing Fargate services.
 * Lives at the CDK App (not inside MinrvStage) so it can use the shared
 * CodeConnections ARN from minrv-ew2-ecr. ECS services are imported by name
 * so this stack does not export or replace compute resources.
 */
export class PipelineStack extends Ew2Stack {
  public readonly pipeline: codepipeline.Pipeline;

  constructor(scope: Construct, id: string, props: Ew2StackProps) {
    super(scope, id, {
      ...props,
      stackName: cfnStackName(props.cfg.stageName, "pipeline"),
      description: `minrv-ew2 ${props.cfg.stageName} CodePipeline V2 (GitHub → CodeBuild → ECR → ECS)`,
    });

    const { cfg } = props;
    const connectionArn = cfg.githubConnectionArn;
    if (!connectionArn) {
      throw new Error(
        "githubConnectionArn is required (set GITHUB_CONNECTION_ARN or deploy minrv-ew2-ecr)",
      );
    }

    const cluster = ecs.Cluster.fromClusterArn(
      this,
      "EcsCluster",
      cdk.Stack.of(this).formatArn({
        service: "ecs",
        resource: "cluster",
        resourceName: resourceName(cfg.stageName, "ecs"),
      }),
    );
    const webService = ecs.FargateService.fromFargateServiceAttributes(this, "WebService", {
      cluster,
      serviceName: resourceName(cfg.stageName, "web"),
    });
    const apiService = ecs.FargateService.fromFargateServiceAttributes(this, "ApiService", {
      cluster,
      serviceName: resourceName(cfg.stageName, "api"),
    });
    const workerService = ecs.FargateService.fromFargateServiceAttributes(
      this,
      "WorkerService",
      { cluster, serviceName: resourceName(cfg.stageName, "worker") },
    );
    const beatService = ecs.FargateService.fromFargateServiceAttributes(this, "BeatService", {
      cluster,
      serviceName: resourceName(cfg.stageName, "beat"),
    });

    const org = cfg.githubOrg ?? "varannik";
    const repo = cfg.githubRepo ?? "MinRVAtlas";
    const branch = cfg.githubBranch ?? "main";
    const retention =
      cfg.logRetentionDays >= 365
        ? logs.RetentionDays.ONE_YEAR
        : logs.RetentionDays.ONE_MONTH;
    const removal = cfg.deletionProtection
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    const webRepo = ecr.Repository.fromRepositoryName(this, "WebRepo", ecrWebRepo());
    const sentinelRepo = ecr.Repository.fromRepositoryName(
      this,
      "SentinelRepo",
      ecrSentinelRepo(),
    );

    const artifacts = new s3.Bucket(this, "Artifacts", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      autoDeleteObjects: !cfg.deletionProtection,
      removalPolicy: removal,
      lifecycleRules: [{ expiration: cdk.Duration.days(30) }],
    });

    const webProject = this.buildProject({
      id: "BuildWeb",
      projectName: resourceName(cfg.stageName, "build-web"),
      buildspec: "infra/buildspec/web.yml",
      logSuffix: "codebuild-web",
      retention,
      removal,
      repos: [webRepo],
      env: {
        ECR_REPOSITORY: ecrWebRepo(),
        CONTAINER_NAMES: "web",
        DOCKERFILE: "apps/web/Dockerfile",
        DOCKER_CONTEXT: "apps/web",
        APP_KIND: "web",
      },
    });

    const sentinelProject = this.buildProject({
      id: "BuildSentinel",
      projectName: resourceName(cfg.stageName, "build-sentinel"),
      buildspec: "infra/buildspec/sentinel.yml",
      logSuffix: "codebuild-sentinel",
      retention,
      removal,
      repos: [sentinelRepo],
      env: {
        ECR_REPOSITORY: ecrSentinelRepo(),
        CONTAINER_NAMES: "api,worker,beat",
        DOCKERFILE: "apps/sentinel/backend/Dockerfile",
        DOCKER_CONTEXT: "apps/sentinel/backend",
        APP_KIND: "sentinel",
      },
    });

    const sourceOutput = new codepipeline.Artifact("Source");
    const webOutput = new codepipeline.Artifact("WebBuild");
    const sentinelOutput = new codepipeline.Artifact("SentinelBuild");

    this.pipeline = new codepipeline.Pipeline(this, "Pipeline", {
      pipelineName: resourceName(cfg.stageName, "app"),
      pipelineType: codepipeline.PipelineType.V2,
      executionMode: codepipeline.ExecutionMode.QUEUED,
      restartExecutionOnUpdate: false,
      crossAccountKeys: false,
      artifactBucket: artifacts,
    });

    const githubSourceRole = new iam.Role(this, "GithubSourceRole", {
      assumedBy: new iam.ArnPrincipal(this.pipeline.role.roleArn),
      description: `CodePipeline GitHub source for minrv-ew2-${cfg.stageName}`,
    });
    githubSourceRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "UseGithubConnection",
        actions: [
          "codeconnections:UseConnection",
          "codestar-connections:UseConnection",
        ],
        resources: [connectionArn],
      }),
    );

    this.pipeline.addStage({
      stageName: "Source",
      actions: [
        new cpactions.CodeStarConnectionsSourceAction({
          actionName: "GitHub",
          owner: org,
          repo,
          branch,
          connectionArn,
          output: sourceOutput,
          triggerOnPush: true,
          role: githubSourceRole,
        }),
      ],
    });

    this.pipeline.addStage({
      stageName: "Build",
      actions: [
        new cpactions.CodeBuildAction({
          actionName: "Web",
          project: webProject,
          input: sourceOutput,
          outputs: [webOutput],
          runOrder: 1,
        }),
        new cpactions.CodeBuildAction({
          actionName: "Sentinel",
          project: sentinelProject,
          input: sourceOutput,
          outputs: [sentinelOutput],
          runOrder: 1,
        }),
      ],
    });

    if (cfg.stageName === "prod") {
      this.pipeline.addStage({
        stageName: "Approve",
        actions: [
          new cpactions.ManualApprovalAction({
            actionName: "ApproveProd",
            additionalInformation:
              "Deploys the Git-SHA images just built to prod ECS (web, api, worker, beat). CloudFront is not invalidated.",
          }),
        ],
      });
    }

    this.pipeline.addStage({
      stageName: "Deploy",
      actions: [
        new cpactions.EcsDeployAction({
          actionName: "Web",
          service: webService,
          imageFile: new codepipeline.ArtifactPath(
            webOutput,
            "imagedefinitions-web.json",
          ),
          deploymentTimeout: cdk.Duration.minutes(60),
          runOrder: 1,
        }),
        new cpactions.EcsDeployAction({
          actionName: "Api",
          service: apiService,
          imageFile: new codepipeline.ArtifactPath(
            sentinelOutput,
            "imagedefinitions-api.json",
          ),
          deploymentTimeout: cdk.Duration.minutes(60),
          runOrder: 1,
        }),
        new cpactions.EcsDeployAction({
          actionName: "Worker",
          service: workerService,
          imageFile: new codepipeline.ArtifactPath(
            sentinelOutput,
            "imagedefinitions-worker.json",
          ),
          deploymentTimeout: cdk.Duration.minutes(30),
          runOrder: 1,
        }),
        new cpactions.EcsDeployAction({
          actionName: "Beat",
          service: beatService,
          imageFile: new codepipeline.ArtifactPath(
            sentinelOutput,
            "imagedefinitions-beat.json",
          ),
          deploymentTimeout: cdk.Duration.minutes(20),
          runOrder: 1,
        }),
      ],
    });

    new cdk.CfnOutput(this, "PipelineName", { value: this.pipeline.pipelineName });
    new cdk.CfnOutput(this, "PipelineArn", { value: this.pipeline.pipelineArn });
    new cdk.CfnOutput(this, "GithubConnectionArn", { value: connectionArn });
    new cdk.CfnOutput(this, "GithubSource", {
      value: `${org}/${repo}@${branch}`,
    });
    new cdk.CfnOutput(this, "CompleteConnection", {
      value: `https://${this.region}.console.aws.amazon.com/codesuite/settings/${this.account}/${this.region}/connections`,
    });
  }

  private buildProject(opts: {
    id: string;
    projectName: string;
    buildspec: string;
    logSuffix: string;
    retention: logs.RetentionDays;
    removal: cdk.RemovalPolicy;
    repos: ecr.IRepository[];
    env: Record<string, string>;
  }): codebuild.PipelineProject {
    const { cfg } = this;
    const logGroup = new logs.LogGroup(this, `${opts.id}Logs`, {
      logGroupName: logGroupName(cfg.stageName, opts.logSuffix),
      retention: opts.retention,
      removalPolicy: opts.removal,
    });

    const project = new codebuild.PipelineProject(this, opts.id, {
      projectName: opts.projectName,
      description: `minrv-ew2 ${cfg.stageName} ${opts.id}`,
      grantReportGroupPermissions: false,
      timeout: cdk.Duration.minutes(60),
      queuedTimeout: cdk.Duration.hours(8),
      cache: codebuild.Cache.local(
        codebuild.LocalCacheMode.DOCKER_LAYER,
        codebuild.LocalCacheMode.CUSTOM,
        codebuild.LocalCacheMode.SOURCE,
      ),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.LARGE,
        privileged: true,
      },
      logging: { cloudWatch: { logGroup } },
      buildSpec: codebuild.BuildSpec.fromSourceFilename(opts.buildspec),
      environmentVariables: {
        AWS_ACCOUNT_ID: { value: this.account },
        STAGE: { value: cfg.stageName },
        ECS_CLUSTER: { value: resourceName(cfg.stageName, "ecs") },
        ...Object.fromEntries(
          Object.entries(opts.env).map(([key, value]) => [key, { value }]),
        ),
      },
    });

    for (const repository of opts.repos) {
      repository.grantPullPush(project);
      project.addToRolePolicy(
        new iam.PolicyStatement({
          sid: "EcrDescribeForDigest",
          actions: ["ecr:DescribeImages", "ecr:ListImages"],
          resources: [repository.repositoryArn],
        }),
      );
    }

    return project;
  }
}
