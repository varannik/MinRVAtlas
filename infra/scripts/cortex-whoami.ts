/**
 * End-to-end check of the Cortex tool path (blueprint phase 1 exit test):
 *
 *   Cognito sign-in  ->  AgentCore Gateway (JWT check)  ->  access interceptor
 *   ->  tenancy.whoami Lambda  ->  tenancy table  ->  back to the caller
 *
 *   CORTEX_TEST_EMAIL=you@4401.earth make cortex-whoami     # asks for the password
 *
 * Signs in with the web app client (USER_PASSWORD_AUTH), then talks MCP to the
 * gateway: initialize, tools/list, tools/call tenancy___whoami. Two refusals are
 * checked too: a forged `caller` argument must be replaced by the interceptor,
 * and a project the user has no grant for must be denied. Finally it prints the
 * interceptor's audit lines for this user.
 *
 * Needs a Cognito user with custom:tenant_id set (make create-cognito-user)
 * and a seeded tenancy table (make seed-cortex). The password can also come
 * from CORTEX_TEST_PASSWORD; it is never passed on a command line.
 */
import { REGION, logGroupName, type StageName } from "../lib/config";
import { awsJson } from "./aws";
import { assertAccount, stageFromApp } from "./cortex-common";
import {
  DENIED_CODE,
  Gateway,
  PROTOCOL_VERSION,
  claimsOf,
  credentials,
  describe,
  record,
  runChecks,
  signIn,
  toolPayload,
} from "./cortex-mcp";

/** The interceptor's audit lines for one user since a time. */
async function auditLines(stage: StageName, sub: string, since: number): Promise<string[]> {
  const group = logGroupName(stage, "cortex-gateway-access");
  // Lambda logs reach CloudWatch a few seconds after the call.
  for (let attempt = 0; attempt < 6; attempt++) {
    const result = await awsJson<{ events?: Array<{ message?: string }> }>(
      [
        "logs",
        "filter-log-events",
        "--region",
        REGION,
        "--log-group-name",
        group,
        "--start-time",
        String(since),
        "--filter-pattern",
        `"${sub}"`,
      ],
      { allowNotFound: true },
    );
    const lines = (result?.events ?? [])
      .map((event) => event.message ?? "")
      .filter((message) => message.includes("cortex_access"));
    if (lines.length >= 3 || attempt === 5) return lines;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  return [];
}

async function main(): Promise<void> {
  await assertAccount();
  const stage = stageFromApp();
  const { email, password } = await credentials();
  const started = Date.now() - 5_000;

  // 1. Sign in and read the claims the pre-token trigger added.
  const token = await signIn(stage, email, password);
  const claims = claimsOf(token);
  const tenant = String(claims.tenant_id ?? "");
  const role = String(claims.role ?? "");
  const sub = String(claims.sub ?? "");
  record(
    "Sign-in carries a tenant",
    Boolean(tenant),
    tenant
      ? `tenant_id=${tenant} role=${role} token_use=${claims.token_use} client_id=${claims.client_id}`
      : "no tenant_id on the access token: set custom:tenant_id on the user (make create-cognito-user)",
  );
  if (!tenant) return;

  const gateway = await Gateway.forStage(stage, token);
  console.log(`Gateway: ${gateway.endpoint}`);

  // 2. The gateway checks the JWT; the interceptor checks the tenant claim.
  const init = await gateway.initialize();
  const initOk = init.status < 400 && !init.error;
  record(
    "Gateway accepts the token",
    initOk,
    initOk
      ? `HTTP ${init.status}, MCP ${gateway.protocolVersion ?? "version not stated"} (asked for ${PROTOCOL_VERSION})`
      : describe(init),
  );
  if (!initOk) return;

  // 3. The tool catalogue.
  const list = await gateway.call("tools/list");
  const names = ((list.result?.tools as Array<{ name?: string }> | undefined) ?? []).map((tool) => tool.name ?? "");
  record("Tool catalogue lists tenancy___whoami", names.includes("tenancy___whoami"), names.join(", ") || describe(list));

  // 4. whoami through the interceptor, the Lambda and the tenancy table.
  const who = await gateway.call("tools/call", { name: "tenancy___whoami", arguments: {} });
  const me = toolPayload(who);
  const projects = (me?.projects as Array<{ project_id?: string }> | undefined) ?? [];
  if (who.error || !me || me.error) {
    const reason = who.error ? describe(who) : String(me?.error ?? describe(who));
    const hint = /not active/i.test(reason) ? " (run make seed-cortex)" : "";
    record("whoami answers for the token's tenant", false, reason + hint);
  } else {
    record(
      "whoami answers for the token's tenant",
      me.tenant_id === tenant,
      `tenant=${me.tenant_id} (${me.tenant_name ?? "unnamed"}) role=${me.role} projects=[${projects
        .map((p) => p.project_id)
        .join(", ")}]`,
    );
    if (projects.length === 0) {
      console.log(
        "       No projects: seed them (make seed-cortex), or grant this user one (MEMBER_EMAIL=… make seed-cortex) unless they are a tenant_admin or platform_admin.",
      );
    }
  }

  // 5. A client cannot choose its own tenant: the interceptor replaces `caller`.
  const forged = await gateway.call("tools/call", {
    name: "tenancy___whoami",
    arguments: { caller: { tenant_id: "someone-else", role: "platform_admin", project_ids: ["not-yours"] } },
  });
  const forgedMe = toolPayload(forged);
  record(
    "A forged caller argument is ignored",
    !forged.error && forgedMe?.tenant_id === tenant && forgedMe?.role === role,
    forged.error ? describe(forged) : `tool saw tenant=${forgedMe?.tenant_id} role=${forgedMe?.role}`,
  );

  // 6. A project without a grant is refused before any tool runs.
  const denied = await gateway.call("tools/call", {
    name: "knowledge___search",
    arguments: { query: "access check", project_id: "no-such-project" },
  });
  record(
    "An ungranted project is refused",
    denied.error?.code === DENIED_CODE,
    denied.error ? `${denied.error.code}: ${denied.error.message}` : `not refused: ${describe(denied)}`,
  );

  // 7. The interceptor's audit trail for this user.
  const lines = await auditLines(stage, sub, started);
  if (lines.length === 0) {
    record(
      "Interceptor logged the decisions",
      null,
      `no lines yet in ${logGroupName(stage, "cortex-gateway-access")} (logs can lag, or your user lacks logs:FilterLogEvents)`,
    );
    return;
  }
  record("Interceptor logged the decisions", true, `${lines.length} line(s)`);
  for (const line of lines) {
    const json = line.slice(line.indexOf("{"));
    try {
      const decision = (JSON.parse(json) as { cortex_access?: Record<string, unknown> }).cortex_access ?? {};
      console.log(
        `       ${decision.allowed ? "allow" : "deny "}  ${decision.method}${decision.tool ? ` ${decision.tool}` : ""}` +
          `${decision.project_id ? ` project=${decision.project_id}` : ""}${decision.reason ? `  (${decision.reason})` : ""}`,
      );
    } catch {
      console.log(`       ${line.trim().slice(0, 200)}`);
    }
  }
}

runChecks(main);
