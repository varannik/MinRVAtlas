import * as cdk from "aws-cdk-lib";
import * as codeconnections from "aws-cdk-lib/aws-codeconnections";
import * as ecr from "aws-cdk-lib/aws-ecr";
import { Construct } from "constructs";
import { ENV_EW2, PROJECT, ecrSentinelRepo, ecrWebRepo } from "./config";

/** Account-level ECR repos — shared by sandbox and prod (images tagged per digest). */
export class RegistryStack extends cdk.Stack {
  public readonly webRepo: ecr.Repository;
  public readonly sentinelRepo: ecr.Repository;
  public readonly githubConnectionArn: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: props?.env ?? ENV_EW2,
      stackName: "minrv-ew2-ecr",
      description: "minrv-ew2 shared ECR (web + sentinel), eu-west-2",
    });

    cdk.Tags.of(this).add("Project", PROJECT);
    cdk.Tags.of(this).add("ManagedBy", "cdk");

    const lifecycle: ecr.LifecycleRule[] = [
      {
        description: "Expire untagged images after 14 days",
        tagStatus: ecr.TagStatus.UNTAGGED,
        maxImageAge: cdk.Duration.days(14),
      },
      {
        description: "Keep the newest 80 images (SHA tags are immutable)",
        maxImageCount: 80,
      },
    ];

    this.webRepo = new ecr.Repository(this, "WebRepo", {
      repositoryName: ecrWebRepo(),
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      encryption: ecr.RepositoryEncryption.AES_256,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: lifecycle,
    });

    this.sentinelRepo = new ecr.Repository(this, "SentinelRepo", {
      repositoryName: ecrSentinelRepo(),
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      encryption: ecr.RepositoryEncryption.AES_256,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: lifecycle,
    });

    const github = new codeconnections.CfnConnection(this, "GithubConnection", {
      connectionName: "minrv-ew2-github",
      providerType: "GitHub",
    });
    this.githubConnectionArn = github.attrConnectionArn;

    new cdk.CfnOutput(this, "WebRepoUri", { value: this.webRepo.repositoryUri });
    new cdk.CfnOutput(this, "SentinelRepoUri", {
      value: this.sentinelRepo.repositoryUri,
    });
    new cdk.CfnOutput(this, "GithubConnectionArn", {
      value: this.githubConnectionArn,
      exportName: "minrv-ew2-github-connection-arn",
    });
    new cdk.CfnOutput(this, "GithubConnectionStatus", {
      value: github.attrConnectionStatus,
    });
  }

  public get availabilityZones(): string[] {
    return ["eu-west-2a", "eu-west-2b", "eu-west-2c"];
  }
}
