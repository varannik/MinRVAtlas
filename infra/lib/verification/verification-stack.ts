import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { cfnStackName, cortexTenantSessionRoleName, resourceName, verificationBucketName, verificationTableName, webOrigins } from "../config";
import { PROJECT_TAG, TENANT_TAG } from "../cortex/knowledge-stack";
import { Ew2Stack, type Ew2StackProps } from "../ew2-stack";

export interface VerificationStackProps extends Ew2StackProps {
  keyArn: string;
}

/**
 * The mock verifier (VVB), on Cortex's rails. Per project: the Audit Document Index it
 * imported, the submission as received (every file, as delivered) and which file is filed
 * under which evidence piece. Documents Claude reads and cites stay in Cortex; this keeps
 * the submission itself, spreadsheets included.
 *
 * The web reads and writes it through the Cortex tenant session (one project's keys only),
 * and the browser sends each file straight to the bucket with a signed form.
 */
export class VerificationStack extends Ew2Stack {
  public readonly table: dynamodb.Table;
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: VerificationStackProps) {
    super(scope, id, {
      ...props,
      stackName: cfnStackName(props.cfg.stageName, "verification"),
      description: `minrv-ew2 ${props.cfg.stageName} mock verifier: Audit Document Index, submission files, filings`,
    });
    const { cfg } = props;
    const stage = cfg.stageName;
    const key = kms.Key.fromKeyArn(this, "Cmk", props.keyArn);
    const removal = cfg.deletionProtection ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    // pk TENANT#<t>#PROJECT#<p>; sk INDEX, FILE#<file>, FILINGS#<audit>.
    this.table = new dynamodb.Table(this, "Verification", {
      tableName: verificationTableName(stage),
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: key,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: cfg.deletionProtection,
      removalPolicy: removal,
    });

    // <tenant>/<project>/submission/<file id>/<name>: the submission as received. Versioned,
    // so a file sent again keeps the earlier one.
    this.bucket = new s3.Bucket(this, "Submissions", {
      bucketName: verificationBucketName(stage),
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: key,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      // The web signs a POST form with the tenant session; the browser sends the file here.
      cors: [{ allowedMethods: [s3.HttpMethods.POST], allowedOrigins: webOrigins(cfg), allowedHeaders: ["*"], exposedHeaders: ["ETag"], maxAge: 3000 }],
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: cdk.Duration.days(1) },
        { noncurrentVersionExpiration: cdk.Duration.days(cfg.deletionProtection ? 365 : 90) },
      ],
      removalPolicy: removal,
    });

    const tenantSession = iam.Role.fromRoleName(this, "TenantSession", cortexTenantSessionRoleName(stage));
    new iam.Policy(this, "TenantSessionVerification", {
      policyName: resourceName(stage, "tenant-session-verification"),
      roles: [tenantSession],
      statements: [
        new iam.PolicyStatement({
          sid: "OwnProjectVerificationRecord",
          // The Index, files and filings. No delete: the record is kept.
          actions: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem"],
          resources: [this.table.tableArn],
          conditions: { "ForAllValues:StringEquals": { "dynamodb:LeadingKeys": [`TENANT#${TENANT_TAG}#PROJECT#${PROJECT_TAG}`] } },
        }),
        new iam.PolicyStatement({
          sid: "OwnProjectSubmissionFiles",
          actions: ["s3:PutObject", "s3:GetObject"],
          resources: [this.bucket.arnForObjects(`${TENANT_TAG}/${PROJECT_TAG}/*`)],
        }),
        new iam.PolicyStatement({
          sid: "ListOwnProjectSubmission",
          actions: ["s3:ListBucket"],
          resources: [this.bucket.bucketArn],
          conditions: { StringLike: { "s3:prefix": [`${TENANT_TAG}/${PROJECT_TAG}/*`] } },
        }),
      ],
    });

    new cdk.CfnOutput(this, "VerificationTableName", { value: this.table.tableName });
    new cdk.CfnOutput(this, "VerificationBucketName", { value: this.bucket.bucketName });
  }
}
