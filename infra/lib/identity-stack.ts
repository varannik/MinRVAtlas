import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import {
  ACCOUNT,
  REGION,
  cfnStackName,
  cognitoClientSecretName,
  cognitoDomainPrefix,
  logGroupName,
  resourceName,
  type StageConfig,
} from "./config";
import { Ew2Stack, type Ew2StackProps } from "./ew2-stack";

export const COGNITO_GROUPS = [
  "platform_admin",
  "tenant_admin",
  "quality_engineer",
  "operator",
  "viewer",
] as const;

export type CognitoGroupName = (typeof COGNITO_GROUPS)[number];

const GROUP_DESCRIPTIONS: Record<CognitoGroupName, string> = {
  platform_admin: "44.01 platform operators; all tenants",
  tenant_admin: "Invite users and set grants for one tenant",
  quality_engineer: "Quality Console configuration and runs",
  operator: "Control room and pipeline for granted registries",
  viewer: "Read-only on granted projects and registries",
};

export interface IdentityStackProps extends Ew2StackProps {
  keyArn: string;
}

export class IdentityStack extends Ew2Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly clientSecret: secretsmanager.Secret;
  /** Host only, e.g. minrv-ew2-sandbox.auth.eu-west-2.amazoncognito.com */
  public readonly hostedUiHost: string;

  constructor(scope: Construct, id: string, props: IdentityStackProps) {
    super(scope, id, {
      ...props,
      stackName: cfnStackName(props.cfg.stageName, "identity"),
      description: `minrv-ew2 ${props.cfg.stageName} Cognito user pool (create, do not import)`,
    });

    const { cfg } = props;
    const key = kms.Key.fromKeyArn(this, "Key", props.keyArn);
    const removal = cfg.deletionProtection
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;
    const retention =
      cfg.logRetentionDays >= 365
        ? logs.RetentionDays.ONE_YEAR
        : logs.RetentionDays.ONE_MONTH;

    const preTokenLog = new logs.LogGroup(this, "PreTokenLogs", {
      logGroupName: logGroupName(cfg.stageName, "cognito-pre-token"),
      retention,
      removalPolicy: removal,
    });

    const preTokenFn = new lambda.Function(this, "PreToken", {
      functionName: resourceName(cfg.stageName, "cognito-pre-token"),
      description: "Copy custom:tenant_id and Cognito group onto access/id tokens (V2_0)",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      timeout: cdk.Duration.seconds(5),
      memorySize: 128,
      logGroup: preTokenLog,
      code: lambda.Code.fromAsset(path.join(__dirname, "cognito-pre-token")),
    });

    this.userPool = new cognito.UserPool(this, "Users", {
      userPoolName: resourceName(cfg.stageName, "users"),
      signInAliases: { email: true },
      signInCaseSensitive: false,
      selfSignUpEnabled: false,
      autoVerify: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
      },
      customAttributes: {
        tenant_id: new cognito.StringAttribute({
          minLen: 1,
          maxLen: 64,
          mutable: false,
        }),
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(7),
      },
      deletionProtection: cfg.deletionProtection,
      removalPolicy: removal,
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
    });

    const cfnPool = this.userPool.node.defaultChild as cognito.CfnUserPool;
    cfnPool.adminCreateUserConfig = {
      allowAdminCreateUserOnly: true,
    };

    this.userPool.addTrigger(
      cognito.UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG,
      preTokenFn,
      cognito.LambdaVersion.V2_0,
    );

    for (const groupName of COGNITO_GROUPS) {
      new cognito.UserPoolGroup(this, groupId(groupName), {
        userPool: this.userPool,
        groupName,
        description: GROUP_DESCRIPTIONS[groupName],
      });
    }

    const domainPrefix = cognitoDomainPrefix(cfg.stageName);
    this.userPool.addDomain("HostedUi", {
      cognitoDomain: { domainPrefix },
    });
    this.hostedUiHost = `${domainPrefix}.auth.${REGION}.amazoncognito.com`;

    this.userPoolClient = this.userPool.addClient("Web", {
      userPoolClientName: resourceName(cfg.stageName, "web-client"),
      generateSecret: true,
      authFlows: {
        userSrp: true,
        userPassword: false,
        adminUserPassword: false,
        custom: false,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true, implicitCodeGrant: false },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: cognitoCallbackUrls(cfg),
        logoutUrls: cognitoLogoutUrls(cfg),
      },
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: cdk.Duration.minutes(60),
      idTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(cfg.stageName === "prod" ? 1 : 7),
      refreshTokenRotationGracePeriod: cdk.Duration.seconds(10),
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
    });

    this.clientSecret = new secretsmanager.Secret(this, "ClientSecret", {
      secretName: cognitoClientSecretName(cfg.stageName),
      description: "Cognito confidential app client secret (web task only)",
      encryptionKey: key,
      removalPolicy: removal,
      secretStringValue: this.userPoolClient.userPoolClientSecret,
    });

    preTokenFn.addPermission("CognitoInvoke", {
      principal: new iam.ServicePrincipal("cognito-idp.amazonaws.com"),
      sourceAccount: ACCOUNT,
      sourceArn: this.userPool.userPoolArn,
    });

    new cdk.CfnOutput(this, "UserPoolId", {
      value: this.userPool.userPoolId,
      exportName: `${cfnStackName(cfg.stageName, "identity")}-UserPoolId`,
    });
    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: this.userPoolClient.userPoolClientId,
      exportName: `${cfnStackName(cfg.stageName, "identity")}-UserPoolClientId`,
    });
    new cdk.CfnOutput(this, "HostedUiDomain", {
      value: this.hostedUiHost,
      exportName: `${cfnStackName(cfg.stageName, "identity")}-HostedUiDomain`,
    });
    new cdk.CfnOutput(this, "ClientSecretArn", {
      value: this.clientSecret.secretArn,
      exportName: `${cfnStackName(cfg.stageName, "identity")}-ClientSecretArn`,
    });
  }
}

function groupId(name: CognitoGroupName): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function cognitoCallbackUrls(cfg: StageConfig): string[] {
  const urls = ["http://localhost:3000/auth/callback"];
  if (cfg.domainName) {
    urls.push(`https://${cfg.domainName}/auth/callback`);
  }
  if (cfg.cognitoCallbackUrl && !urls.includes(cfg.cognitoCallbackUrl)) {
    assertCognitoHttpsUrl(cfg.cognitoCallbackUrl, "COGNITO_CALLBACK_URL");
    urls.push(cfg.cognitoCallbackUrl);
  }
  return urls;
}

export function cognitoLogoutUrls(cfg: StageConfig): string[] {
  const urls = ["http://localhost:3000/login"];
  if (cfg.domainName) {
    urls.push(`https://${cfg.domainName}/login`);
  }
  if (cfg.cognitoLogoutUrl && !urls.includes(cfg.cognitoLogoutUrl)) {
    assertCognitoHttpsUrl(cfg.cognitoLogoutUrl, "COGNITO_LOGOUT_URL");
    urls.push(cfg.cognitoLogoutUrl);
  }
  return urls;
}

function assertCognitoHttpsUrl(url: string, name: string): void {
  if (url.startsWith("http://localhost") || url.startsWith("https://")) {
    return;
  }
  throw new Error(
    `${name} must be https://… (Cognito allows http only for localhost). Got ${url}`,
  );
}
