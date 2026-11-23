import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";

/**
 * The Atlas table and its assets bucket. On AWS both come from the stack
 * (ATLAS_TABLE, ATLAS_BUCKET) and the task role's credentials. On a laptop
 * ATLAS_DYNAMODB_ENDPOINT and ATLAS_S3_ENDPOINT point them at the local
 * containers (apps/web/local), which take any credentials; only these two
 * clients go there, so Cortex and Cognito keep talking to the sandbox.
 */

export interface AtlasConfig {
  table: string;
  bucket: string;
  region: string;
  dynamoEndpoint?: string;
  s3Endpoint?: string;
}

const LOCAL_CREDENTIALS = { accessKeyId: "test", secretAccessKey: "test" };

export function atlasConfig(): AtlasConfig | null {
  const table = process.env.ATLAS_TABLE?.trim();
  const bucket = process.env.ATLAS_BUCKET?.trim();
  if (!table || !bucket) return null;
  return {
    table,
    bucket,
    region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "eu-west-2",
    dynamoEndpoint: process.env.ATLAS_DYNAMODB_ENDPOINT?.trim() || undefined,
    s3Endpoint: process.env.ATLAS_S3_ENDPOINT?.trim() || undefined,
  };
}

export function dynamoFor(config: AtlasConfig): DynamoDBClient {
  return new DynamoDBClient({
    region: config.region,
    ...(config.dynamoEndpoint ? { endpoint: config.dynamoEndpoint, credentials: LOCAL_CREDENTIALS } : {}),
  });
}

export function s3For(config: AtlasConfig): S3Client {
  return new S3Client({
    region: config.region,
    ...(config.s3Endpoint ? { endpoint: config.s3Endpoint, forcePathStyle: true, credentials: LOCAL_CREDENTIALS } : {}),
  });
}
