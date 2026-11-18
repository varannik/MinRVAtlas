/**
 * Sign-in and MCP client shared by the Cortex end-to-end checks
 * (cortex-whoami, cortex-search). Talks to the deployed stage only.
 */
import * as crypto from "node:crypto";
import * as readline from "node:readline/promises";
import { Writable } from "node:stream";
import { REGION, type StageName } from "../lib/config";
import { run } from "./aws";
import { requireOutput, stackOutputs } from "./cortex-common";

export const PROTOCOL_VERSION = "2025-06-18";
export const DENIED_CODE = -32003; // access.DENIED_CODE in lib/cortex/lambda/access.py

// ── Results ─────────────────────────────────────────────────────────────────

export type Check = { name: string; ok: boolean | null; detail: string };
export const checks: Check[] = [];

export function record(name: string, ok: boolean | null, detail: string): void {
  checks.push({ name, ok, detail });
  const mark = ok === null ? "SKIP" : ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}: ${detail}`);
}

/** Run a check script: report a thrown error as a failure, print the tally, set the exit code. */
export function runChecks(main: () => Promise<void>): void {
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
}

// ── Input ───────────────────────────────────────────────────────────────────

export async function ask(question: string, hidden = false): Promise<string> {
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

/** Email and password from CORTEX_TEST_EMAIL / CORTEX_TEST_PASSWORD, or asked for in a terminal. */
export async function credentials(): Promise<{ email: string; password: string }> {
  let email = (process.env.CORTEX_TEST_EMAIL ?? "").trim().toLowerCase();
  let password = process.env.CORTEX_TEST_PASSWORD ?? "";
  if (!email && process.stdin.isTTY) email = (await ask("Cognito email: ")).toLowerCase();
  if (!password && process.stdin.isTTY) password = await ask("Password (not shown): ", true);
  if (!email || !password) throw new Error("Set CORTEX_TEST_EMAIL and CORTEX_TEST_PASSWORD, or run in a terminal.");
  return { email, password };
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

/** Access token from the web app client (USER_PASSWORD_AUTH). The password never goes on a command line. */
export async function signIn(stage: StageName, email: string, password: string): Promise<string> {
  const identity = await stackOutputs(stage, "identity");
  const clientId = requireOutput(identity, "UserPoolClientId", "identity");
  const secret = clientSecret(requireOutput(identity, "ClientSecretArn", "identity"));
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

export function claimsOf(token: string): Record<string, unknown> {
  const payload = token.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

// ── MCP over HTTP ───────────────────────────────────────────────────────────

export type RpcReply = {
  status: number;
  session?: string;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
  raw: string;
};

export class Gateway {
  private session?: string;
  private nextId = 1;
  /** The version the server agreed to in its initialize result; later requests must send this one. */
  protocolVersion?: string;

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  static async forStage(stage: StageName, token: string): Promise<Gateway> {
    const agent = await stackOutputs(stage, "cortex-agent");
    return new Gateway(requireOutput(agent, "GatewayUrl", "cortex-agent"), token);
  }

  get endpoint(): string {
    return this.url;
  }

  initialize(): Promise<RpcReply> {
    return this.call("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "minrv-cortex-check", version: "1.0.0" },
    });
  }

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
export function toolPayload(reply: RpcReply): Record<string, unknown> | undefined {
  const content = (reply.result?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
  const text = content.find((part) => part.type === "text")?.text;
  if (!text) return undefined;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { text };
  }
}

export function describe(reply: RpcReply): string {
  if (reply.error) return `JSON-RPC error ${reply.error.code}: ${reply.error.message}`;
  return `HTTP ${reply.status}: ${reply.raw.slice(0, 300)}`;
}
