/**
 * Invite the first platform_admin after minrv-ew2-{stage}-identity is CREATE_COMPLETE.
 * Talks to real eu-west-2 Cognito. Does not create the pool.
 *
 *   SEED_EMAIL=you@4401.earth make -C infra seed-cognito
 */
import {
  ACCOUNT,
  REGION,
  cfnStackName,
  type StageName,
} from "../lib/config";
import { COGNITO_GROUPS, type CognitoGroupName } from "../lib/identity-stack";
import { awsJson, runWithRetry } from "./aws";

const HEALTHY = new Set(["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"]);

type CfnStack = {
  StackStatus?: string;
  Outputs?: Array<{ OutputKey?: string; OutputValue?: string }>;
};

function stageFromApp(): StageName {
  const app = process.env.APP ?? "minrv-ew2-sandbox";
  if (app.endsWith("-prod") || app === "prod") {
    return "prod";
  }
  return "sandbox";
}

function requireEmail(): string {
  const email = (process.env.SEED_EMAIL ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new Error("Set SEED_EMAIL to the platform_admin address to invite.");
  }
  return email;
}

function groupName(): CognitoGroupName {
  const raw = (process.env.SEED_GROUP ?? "platform_admin").trim();
  if (!(COGNITO_GROUPS as readonly string[]).includes(raw)) {
    throw new Error(`SEED_GROUP must be one of: ${COGNITO_GROUPS.join(", ")}`);
  }
  return raw as CognitoGroupName;
}

async function loadPoolId(stage: StageName): Promise<string> {
  const stackName = cfnStackName(stage, "identity");
  const result = await awsJson<{ Stacks?: CfnStack[] }>([
    "cloudformation",
    "describe-stacks",
    "--region",
    REGION,
    "--stack-name",
    stackName,
  ]);
  const stack = result?.Stacks?.[0];
  if (!stack?.StackStatus || !HEALTHY.has(stack.StackStatus)) {
    throw new Error(
      `${stackName} is not complete (status=${stack?.StackStatus ?? "missing"}). Run make deploy first.`,
    );
  }
  const poolId = stack.Outputs?.find((o) => o.OutputKey === "UserPoolId")?.OutputValue;
  if (!poolId) {
    throw new Error(`${stackName} has no UserPoolId output.`);
  }
  return poolId;
}

async function main(): Promise<void> {
  const identity = await awsJson<{ Account?: string }>(["sts", "get-caller-identity"]);
  if (identity?.Account && identity.Account !== ACCOUNT) {
    throw new Error(`Caller account ${identity.Account} is not ${ACCOUNT}`);
  }

  const stage = stageFromApp();
  const email = requireEmail();
  const tenant = (process.env.SEED_TENANT ?? "fourfourone").trim();
  const group = groupName();
  const userPoolId = await loadPoolId(stage);

  const created = await runWithRetry(
    "aws",
    [
      "cognito-idp",
      "admin-create-user",
      "--region",
      REGION,
      "--user-pool-id",
      userPoolId,
      "--username",
      email,
      "--user-attributes",
      `Name=email,Value=${email}`,
      "Name=email_verified,Value=true",
      `Name=custom:tenant_id,Value=${tenant}`,
      "--desired-delivery-mediums",
      "EMAIL",
    ],
    { label: "admin-create-user", attempts: 3 },
  );

  const blob = `${created.stdout}\n${created.stderr}`;
  if (created.code !== 0 && !/UsernameExistsException/i.test(blob)) {
    throw new Error(`admin-create-user failed (${created.code}): ${blob.slice(0, 2000)}`);
  }
  if (/UsernameExistsException/i.test(blob)) {
    console.log(`User ${email} already exists; ensuring group ${group}.`);
  } else {
    console.log(`Invited ${email} in tenant ${tenant}.`);
  }

  const grouped = await runWithRetry(
    "aws",
    [
      "cognito-idp",
      "admin-add-user-to-group",
      "--region",
      REGION,
      "--user-pool-id",
      userPoolId,
      "--username",
      email,
      "--group-name",
      group,
    ],
    { label: "admin-add-user-to-group", attempts: 3 },
  );
  if (grouped.code !== 0) {
    throw new Error(
      `admin-add-user-to-group failed (${grouped.code}): ${grouped.stderr.slice(0, 2000)}`,
    );
  }
  console.log(`Added ${email} to ${group} on ${userPoolId}.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
