/** Shared by the Cortex operator scripts (seed-cortex-tenancy, cortex-whoami). */
import { ACCOUNT, REGION, cfnStackName, type StageName } from "../lib/config";
import { awsJson } from "./aws";

const HEALTHY = new Set(["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"]);

type CfnStack = {
  StackStatus?: string;
  Outputs?: Array<{ OutputKey?: string; OutputValue?: string }>;
};

export function stageFromApp(): StageName {
  const app = process.env.APP ?? "minrv-ew2-sandbox";
  return app.endsWith("-prod") || app === "prod" ? "prod" : "sandbox";
}

export async function assertAccount(): Promise<void> {
  const identity = await awsJson<{ Account?: string }>(["sts", "get-caller-identity"]);
  if (identity?.Account && identity.Account !== ACCOUNT) {
    throw new Error(`Caller account ${identity.Account} is not ${ACCOUNT}`);
  }
}

/** Outputs of minrv-ew2-{stage}-{suffix}, refusing a stack that is not complete. */
export async function stackOutputs(stage: StageName, suffix: string): Promise<Record<string, string>> {
  const stackName = cfnStackName(stage, suffix);
  const result = await awsJson<{ Stacks?: CfnStack[] }>(
    ["cloudformation", "describe-stacks", "--region", REGION, "--stack-name", stackName],
    { allowNotFound: true },
  );
  const stack = result?.Stacks?.[0];
  if (!stack?.StackStatus || !HEALTHY.has(stack.StackStatus)) {
    throw new Error(`${stackName} is not deployed (status=${stack?.StackStatus ?? "missing"}). Run make deploy first.`);
  }
  const outputs: Record<string, string> = {};
  for (const output of stack.Outputs ?? []) {
    if (output.OutputKey && output.OutputValue) outputs[output.OutputKey] = output.OutputValue;
  }
  return outputs;
}

export function requireOutput(outputs: Record<string, string>, key: string, stack: string): string {
  const value = outputs[key];
  if (!value) throw new Error(`${stack} has no ${key} output.`);
  return value;
}
