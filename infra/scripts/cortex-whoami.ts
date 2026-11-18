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
import * as crypto from "node:crypto";
import * as readline from "node:readline/promises";
import { Writable } from "node:stream";
import { REGION, logGroupName } from "../lib/config";
import { awsJson, run } from "./aws";
import { assertAccount, requireOutput, stackOutputs, stageFromApp } from "./cortex-common";

const PROTOCOL_VERSION = "2025-06-18";
const DENIED_CODE = -32003; // access.DENIED_CODE in lib/cortex/lambda/access.py

type Check = { name: string; ok: boolean | null; detail: string };
const checks: Check[] = [];

function record(name: string, ok: boolean | null, detail: string): void {
  checks.push({ name, ok, detail });
  const mark = ok === null ? "SKIP" : ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}: ${detail}`);
}

// ── Input ───────────────────────────────────────────────────────────────────

async function ask(question: string, hidden = false): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding as BufferEncoding);
      callback();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  try {
    const answer = rl.question(question);
    muted = hidden;
    const value = (await answer).trim();
    if (hidden) process.stdout.write("\n");
    return value;
  } finally {
    rl.close();
  }
}

// ── Cognito ─────────────────────────────────────────────────────────────────

function clientSecret(secretArn: string): string {
  const result = run("aws", [
    "secretsmanager",
    "get-secret-value",
    "--region",
    REGION,
    "--secret-id",
    secretArn,
    "--query",
    "SecretString",
    "--output",
    "text",
  ]);
  if (result.code !== 0) {
    throw new Error(
      `Could not read the web client secret (${secretArn}). Your AWS user needs ` +
        `secretsmanager:GetSecretValue on it and kms:Decrypt on the stage key.\n${result.stderr.slice(0, 400)}`,
    );
  }
  return result.stdout.trim();
}

async function signIn(clientId: string, secret: string, email: string, password: string): Promise<string> {
  const secretHash = crypto.createHmac("sha256", secret).update(email + clientId).digest("base64");
  const response = await fetch(`https://cognito-idp.${REGION}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
    },
    body: JSON.stringify({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: clientId,
      AuthParameters: { USERNAME: email, PASSWORD: password, SECRET_HASH: secretHash },
    }),
  });
  const body = (await response.json()) as {
    AuthenticationResult?: { AccessToken?: string };
    ChallengeName?: string;
    __type?: string;
    message?: string;
  };
  if (body.ChallengeName) {
    throw new Error(
      `Cognito asked for ${body.ChallengeName}. Sign in to the web app once to finish setting up this user, then rerun.`,
    );
  }
  const token = body.AuthenticationResult?.AccessToken;
  if (!response.ok || !token) {
    throw new Error(`Sign-in failed: ${body.__type ?? response.status} ${body.message ?? ""}`.trim());
  }
  return token;
}

function claimsOf(token: string): Record<string, unknown> {
  const payload = token.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

// ── MCP over HTTP ───────────────────────────────────────────────────────────

type RpcReply = {
  status: number;
  session?: string;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
  raw: string;
};

class Gateway {
  private session?: string;
  private nextId = 1;
  /** The version the server agreed to in its initialize result; later requests must send this one. */
  protocolVersion?: string;

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  async call(method: string, params?: Record<string, unknown>): Promise<RpcReply> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (method !== "initialize" && this.protocolVersion) headers["MCP-Protocol-Version"] = this.protocolVersion;
    if (this.session) headers["Mcp-Session-Id"] = this.session;
    const response = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, ...(params ? { params } : {}) }),
    });
    const raw = await response.text();
    const session = response.headers.get("mcp-session-id") ?? undefined;
    if (session) this.session = session;
    // Streamable HTTP answers with JSON or a short event stream; take the last data line.
    const json = (response.headers.get("content-type") ?? "").includes("text/event-stream")
      ? raw
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .filter(Boolean)
          .pop()
      : raw;
    let parsed: { result?: Record<string, unknown>; error?: { code?: number; message?: string } } = {};
    try {
      parsed = json ? JSON.parse(json) : {};
    } catch {
      // Leave parsed empty; the caller reports the raw body.
    }
    if (method === "initialize" && typeof parsed.result?.protocolVersion === "string") {
      this.protocolVersion = parsed.result.protocolVersion;
    }
    return { status: response.status, session, result: parsed.result, error: parsed.error, raw };
  }
}

/** The JSON a Lambda tool returned, from an MCP tools/call result. */
function toolPayload(reply: RpcReply): Record<string, unknown> | undefined {
  const content = (reply.result?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
  const text = content.find((part) => part.type === "text")?.text;
  if (!text) return undefined;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { text };
  }
}

function describe(reply: RpcReply): string {
  if (reply.error) return `JSON-RPC error ${reply.error.code}: ${reply.error.message}`;
  return `HTTP ${reply.status}: ${reply.raw.slice(0, 300)}`;
}

// ── Audit trail ─────────────────────────────────────────────────────────────

async function auditLines(stage: "sandbox" | "prod", sub: string, since: number): Promise<string[]> {
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
    if (lines.length >= 4 || attempt === 5) return lines;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  return [];
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await assertAccount();
  const stage = stageFromApp();
  const identity = await stackOutputs(stage, "identity");
  const agent = await stackOutputs(stage, "cortex-agent");
  const clientId = requireOutput(identity, "UserPoolClientId", "identity");
  const gatewayUrl = requireOutput(agent, "GatewayUrl", "cortex-agent");

  let email = (process.env.CORTEX_TEST_EMAIL ?? "").trim().toLowerCase();
  let password = process.env.CORTEX_TEST_PASSWORD ?? "";
  if (!email && process.stdin.isTTY) email = (await ask("Cognito email: ")).toLowerCase();
  if (!password && process.stdin.isTTY) password = await ask("Password (not shown): ", true);
  if (!email || !password) throw new Error("Set CORTEX_TEST_EMAIL and CORTEX_TEST_PASSWORD, or run in a terminal.");

  console.log(`Gateway: ${gatewayUrl}`);
  const started = Date.now() - 5_000;

  // 1. Sign in and read the claims the pre-token trigger added.
  const token = await signIn(
    clientId,
    clientSecret(requireOutput(identity, "ClientSecretArn", "identity")),
    email,
    password,
  );
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

  const gateway = new Gateway(gatewayUrl, token);

  // 2. The gateway checks the JWT; the interceptor checks the tenant claim.
  const init = await gateway.call("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "minrv-cortex-whoami", version: "1.0.0" },
  });
  record(
    "Gateway accepts the token",
    init.status < 400 && !init.error,
    init.error || init.status >= 400
      ? describe(init)
      : `HTTP ${init.status}, MCP ${gateway.protocolVersion ?? "version not stated"} (asked for ${PROTOCOL_VERSION})`,
  );
  if (init.status >= 400 || init.error) return;

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
    record("Interceptor logged the decisions", null, `no lines yet in ${logGroupName(stage, "cortex-gateway-access")} (logs can lag, or your user lacks logs:FilterLogEvents)`);
  } else {
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
}

main()
  .catch((error: unknown) => {
    record("Run", false, error instanceof Error ? error.message : String(error));
  })
  .finally(() => {
    const failed = checks.filter((check) => check.ok === false).length;
    const passed = checks.filter((check) => check.ok === true).length;
    console.log(`\n${passed} passed, ${failed} failed, ${checks.length - passed - failed} skipped`);
    process.exitCode = failed > 0 ? 1 : 0;
  });
