/**
 * Create one Cognito user and print the password.
 *
 * This pool uses email as the username. Sign in with that email and the printed password.
 *
 *   make create-cognito-user
 */
import * as crypto from "node:crypto";
import * as readline from "node:readline/promises";
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
  if (app.endsWith("-prod") || app === "prod") return "prod";
  return "sandbox";
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function parseEmailUsername(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 128 || /\s/.test(email)) {
    throw new Error("Username must be an email address with no spaces.");
  }
  if (!email.includes("@") || email.startsWith("@") || email.endsWith("@")) {
    throw new Error(
      "Username should be an email. This Cognito pool uses the email address as the username.",
    );
  }
  return email;
}

function parseRole(raw: string): CognitoGroupName {
  const role = raw.trim();
  if (!(COGNITO_GROUPS as readonly string[]).includes(role)) {
    throw new Error(`Role must be one of: ${COGNITO_GROUPS.join(", ")}`);
  }
  return role as CognitoGroupName;
}

function generatePassword(): string {
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = "!@#$%*_";
  const all = lower + upper + digits + symbols;
  const pick = (alphabet: string) => alphabet[crypto.randomInt(alphabet.length)];
  const chars = [pick(lower), pick(upper), pick(digits), pick(symbols)];
  while (chars.length < 16) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
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
      `${stackName} is not complete (status=${stack?.StackStatus ?? "missing"}). Deploy identity first.`,
    );
  }
  const poolId = stack.Outputs?.find((o) => o.OutputKey === "UserPoolId")?.OutputValue;
  if (!poolId) throw new Error(`${stackName} has no UserPoolId output.`);
  return poolId;
}

async function main(): Promise<void> {
  const identity = await awsJson<{ Account?: string }>(["sts", "get-caller-identity"]);
  if (identity?.Account && identity.Account !== ACCOUNT) {
    throw new Error(`Caller account ${identity.Account} is not ${ACCOUNT}`);
  }

  const stage = stageFromApp();
  let username = (process.env.COGNITO_USERNAME || process.env.COGNITO_EMAIL || "").trim();
  let roleRaw = (process.env.COGNITO_ROLE ?? "").trim();
  const tenant = (process.env.COGNITO_TENANT ?? "fourfourone").trim() || "fourfourone";

  if (process.stdin.isTTY) {
    console.log("Roles:");
    for (const role of COGNITO_GROUPS) console.log(`  ${role}`);
    if (!username) username = await prompt("Email (this is the username): ");
    if (!roleRaw) roleRaw = await prompt("Role: ");
  }

  if (!username || !roleRaw) {
    throw new Error("Set COGNITO_USERNAME to an email address and COGNITO_ROLE.");
  }

  username = parseEmailUsername(username);
  const email = username;
  const role = parseRole(roleRaw);
  const password = generatePassword();
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
      username,
      "--message-action",
      "SUPPRESS",
      "--user-attributes",
      `Name=email,Value=${email}`,
      "Name=email_verified,Value=true",
      `Name=custom:tenant_id,Value=${tenant}`,
    ],
    { label: "admin-create-user", attempts: 3 },
  );
  const blob = `${created.stdout}\n${created.stderr}`;
  if (created.code !== 0) {
    if (!/UsernameExistsException/i.test(blob)) {
      throw new Error(`admin-create-user failed (${created.code}): ${blob.slice(0, 2000)}`);
    }
    console.log(`User ${username} already exists. Setting a new password.`);
  }

  const passwordSet = await runWithRetry(
    "aws",
    [
      "cognito-idp",
      "admin-set-user-password",
      "--region",
      REGION,
      "--user-pool-id",
      userPoolId,
      "--username",
      username,
      `--password=${password}`,
      "--permanent",
    ],
    { label: "admin-set-user-password", attempts: 3 },
  );
  if (passwordSet.code !== 0) {
    throw new Error(
      `User ${username} was created but the password was not set: ${passwordSet.stderr.slice(0, 2000)}`,
    );
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
      username,
      "--group-name",
      role,
    ],
    { label: "admin-add-user-to-group", attempts: 3 },
  );
  if (grouped.code !== 0) {
    throw new Error(
      `User ${username} was created but was not added to ${role}: ${grouped.stderr.slice(0, 2000)}`,
    );
  }

  console.log("");
  console.log(`pool=${userPoolId}`);
  console.log(`username=${username}`);
  console.log(`email=${email}`);
  console.log(`tenant=${tenant}`);
  console.log(`role=${role}`);
  console.log(`password=${password}`);
  console.log("Sign in with the email and this password.");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
