import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import {
  ACCOUNT,
  REGION,
  appSecretName,
  cfnStackName,
  entraSecretName,
  isometricSecretName,
  kmsAlias,
} from "./config";
import { Ew2Stack, type Ew2StackProps } from "./ew2-stack";

export class SecurityStack extends Ew2Stack {
  public readonly key: kms.Key;
  public readonly appSecret: secretsmanager.Secret;
  public readonly jwtSecret: secretsmanager.Secret;
  public readonly isometricSecret: secretsmanager.Secret;
  public readonly entraSecret: secretsmanager.Secret;
  public readonly deployRole: iam.Role;

  constructor(scope: Construct, id: string, props: Ew2StackProps) {
    super(scope, id, {
      ...props,
      stackName: cfnStackName(props.cfg.stageName, "security"),
      description: `minrv-ew2 ${props.cfg.stageName} KMS, secrets, deploy role`,
    });

    const { cfg } = props;
    const removal = cfg.deletionProtection
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    this.key = new kms.Key(this, "AppKey", {
      alias: kmsAlias(cfg.stageName),
      description: `minrv-ew2 ${cfg.stageName} CMK (S3, secrets, Aurora, logs)`,
      enableKeyRotation: true,
      removalPolicy: removal,
    });

    this.key.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowCloudWatchLogs",
        principals: [new iam.ServicePrincipal(`logs.${REGION}.amazonaws.com`)],
        actions: [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:CreateGrant",
          "kms:DescribeKey",
        ],
        resources: ["*"],
        conditions: {
          ArnLike: {
            "kms:EncryptionContext:aws:logs:arn": `arn:aws:logs:${REGION}:${ACCOUNT}:*`,
          },
        },
      }),
    );

    this.appSecret = new secretsmanager.Secret(this, "AppSecret", {
      secretName: appSecretName(cfg.stageName),
      description: "Sentinel JWT, service token, ALLOWED_ORIGINS (DB/Valkey URLs filled at task start)",
      encryptionKey: this.key,
      removalPolicy: removal,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          ALLOWED_ORIGINS: cfg.domainName ? `https://${cfg.domainName}` : "*",
          SENTINEL_PROJECT_ID: "REPLACE_ME",
        }),
        generateStringKey: "SENTINEL_SERVICE_TOKEN",
        excludePunctuation: true,
        passwordLength: 48,
      },
    });

    this.jwtSecret = new secretsmanager.Secret(this, "AppJwtSecret", {
      secretName: `${appSecretName(cfg.stageName)}/secret-key`,
      description: "Sentinel SECRET_KEY (JWT signing)",
      encryptionKey: this.key,
      removalPolicy: removal,
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 64,
      },
    });

    this.isometricSecret = new secretsmanager.Secret(this, "IsometricSecret", {
      secretName: isometricSecretName(cfg.stageName),
      description: `${cfg.isometricApi} Isometric M2M - web task only. Replace REPLACE_ME values.`,
      encryptionKey: this.key,
      removalPolicy: removal,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          ISOMETRIC_CLIENT_SECRET: "REPLACE_ME",
          ISOMETRIC_ACCESS_TOKEN: "REPLACE_ME",
          ISOMETRIC_PROJECT_ID: "REPLACE_ME",
        }),
        generateStringKey: "_init",
        excludePunctuation: true,
        passwordLength: 8,
      },
    });

    this.entraSecret = new secretsmanager.Secret(this, "EntraSecret", {
      secretName: entraSecretName(cfg.stageName),
      description: "Optional Entra SSO (MICROSOFT_CLIENT_ID/SECRET/TENANT_ID)",
      encryptionKey: this.key,
      removalPolicy: removal,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          MICROSOFT_CLIENT_ID: "",
          MICROSOFT_CLIENT_SECRET: "",
          MICROSOFT_TENANT_ID: "",
        }),
        generateStringKey: "_init",
        excludePunctuation: true,
        passwordLength: 8,
      },
    });

    this.deployRole = this.createDeployRole();

    new cdk.CfnOutput(this, "KeyArn", { value: this.key.keyArn });
    new cdk.CfnOutput(this, "AppSecretArn", { value: this.appSecret.secretArn });
    new cdk.CfnOutput(this, "IsometricSecretArn", {
      value: this.isometricSecret.secretArn,
    });
    new cdk.CfnOutput(this, "DeployRoleArn", { value: this.deployRole.roleArn });
  }

  private createDeployRole(): iam.Role {
    const { cfg } = this;
    const org = cfg.githubOrg ?? "4401";
    const repo = cfg.githubRepo ?? "3DMinRV";
    const providerArn = `arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com`;
    const provider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      "GithubOidc",
      providerArn,
    );

    const role = new iam.Role(this, "GithubDeployRole", {
      roleName: `minrv-ew2-${cfg.stageName}-github-deploy`,
      description: `GitHub OIDC deploy for minrv-ew2-${cfg.stageName}`,
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        },
        StringLike: {
          "token.actions.githubusercontent.com:sub": `repo:${org}/${repo}:environment:${cfg.stageName}`,
        },
      }),
      maxSessionDuration: cdk.Duration.hours(1),
    });

    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "CfnAppAndToolkit",
        actions: ["cloudformation:*"],
        resources: [
          `arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/minrv-ew2-*`,
          `arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/CDKToolkit/*`,
          `arn:aws:cloudformation:us-east-1:${ACCOUNT}:stack/minrv-ew2-*`,
          `arn:aws:cloudformation:us-east-1:${ACCOUNT}:stack/CDKToolkit/*`,
        ],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "PassCdkAndEcsRoles",
        actions: ["iam:PassRole"],
        resources: [
          `arn:aws:iam::${ACCOUNT}:role/cdk-hnb659fds-*`,
          `arn:aws:iam::${ACCOUNT}:role/minrv-ew2-${cfg.stageName}-*`,
        ],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "EcrPush",
        actions: [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:DescribeRepositories",
          "ecr:DescribeImages",
        ],
        resources: ["*"],
      }),
    );

    return role;
  }
}
