import "server-only";

import { createHash } from "node:crypto";

import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

import { getCognitoConfig } from "@/lib/auth/cognito";
import { CognitoIdpError, getTokensFromRefreshToken } from "@/lib/auth/cognito-idp";
import type { SessionPayload } from "@/lib/auth/session";
import { runtimeInvocationUrl } from "./ask";
import { CortexRefusal } from "./intake.server";

/**
 * Calling the Cortex agent as the signed-in user.
 *
 * The agent runtime accepts only Cognito access tokens, and passes the token
 * on to the tool gateway, so every tool call is checked against the user's own
 * tenant and project grants. The web keeps no access token: it gets a fresh one
 * from the refresh token in the session cookie and holds it in memory until
 * shortly before it expires.
 */

const REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "eu-west-2";
const ARN_CACHE_MS = 5 * 60 * 1000;
const EXPIRY_MARGIN_MS = 60 * 1000;

// ── Where the agent is ──────────────────────────────────────────────────────

let ssm: SSMClient | null = null;
let runtimeArn: { value: string | null; until: number } | null = null;

/**
 * The agent's invocation URL, or null when this deployment has no agent yet.
 * CORTEX_AGENT_URL points at an agent running locally (apps/cortex-agent/README.md).
 */
export async function agentUrl(): Promise<string | null> {
  const local = process.env.CORTEX_AGENT_URL?.trim();
  if (local) return local;
  const arn = process.env.CORTEX_AGENT_RUNTIME_ARN?.trim() || (await publishedRuntimeArn());
  return arn ? runtimeInvocationUrl(arn) : null;
}

/** The ARN the cortex-agent stack publishes (AgentCore generates the runtime id). */
async function publishedRuntimeArn(): Promise<string | null> {
  const name = process.env.CORTEX_AGENT_RUNTIME_PARAM?.trim();
  if (!name) return null;
  if (runtimeArn && runtimeArn.until > Date.now()) return runtimeArn.value;
  ssm ??= new SSMClient({ region: REGION });
  let value: string | null = null;
  try {
    value = (await ssm.send(new GetParameterCommand({ Name: name }))).Parameter?.Value ?? null;
  } catch (error) {
    if ((error as { name?: string })?.name !== "ParameterNotFound") throw error;
  }
  runtimeArn = { value, until: Date.now() + ARN_CACHE_MS };
  return value;
}

// ── The user's access token ─────────────────────────────────────────────────

interface HeldToken {
  token: string;
  /** The refresh token Cognito issued in place of the one in the cookie, if it rotated it. */
  rotated?: string;
  until: number;
}

/** Keyed by a hash of the refresh token, so the cache never holds the cookie's secret in the clear. */
const held = new Map<string, HeldToken>();

function keyOf(refreshToken: string): string {
  return createHash("sha256").update(refreshToken).digest("hex");
}

function expiresAt(accessToken: string): number {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8")) as {
      exp?: number;
    };
    if (typeof payload.exp === "number") return payload.exp * 1000 - EXPIRY_MARGIN_MS;
  } catch {
    // Fall through to a short life.
  }
  return Date.now() + 5 * 60 * 1000;
}

/**
 * An access token for the signed-in user, and the rotated refresh token to put
 * back in their session cookie when Cognito issued a new one.
 */
export async function accessTokenFor(session: SessionPayload): Promise<{ token: string; rotated?: string }> {
  if (session.auth !== "cognito" || !session.refreshToken) {
    throw new CortexRefusal(
      "Sign in with your MinRV account to ask Cortex. The local developer sign-in has no Cognito token.",
      401,
    );
  }
  const cfg = getCognitoConfig();
  if (!cfg) throw new CortexRefusal("Sign-in is not configured on this deployment.", 503);

  const key = keyOf(session.refreshToken);
  const cached = held.get(key);
  if (cached && cached.until > Date.now()) return { token: cached.token, rotated: cached.rotated };

  let tokens: { accessToken: string; refreshToken?: string };
  try {
    tokens = await getTokensFromRefreshToken(cfg, session.refreshToken);
  } catch (error) {
    if (error instanceof CognitoIdpError && error.code === "NotAuthorizedException") {
      throw new CortexRefusal("Your sign-in has expired. Sign in again to ask Cortex.", 401);
    }
    throw error;
  }
  const rotated = tokens.refreshToken && tokens.refreshToken !== session.refreshToken ? tokens.refreshToken : undefined;
  const entry: HeldToken = { token: tokens.accessToken, rotated, until: expiresAt(tokens.accessToken) };
  for (const [k, v] of held) if (v.until <= Date.now()) held.delete(k);
  held.set(key, entry);
  // A request that already carries the new cookie finds the same token.
  if (rotated) held.set(keyOf(rotated), { token: entry.token, until: entry.until });
  return { token: entry.token, rotated };
}

/**
 * The runtime session for one conversation. AgentCore keeps a session on its own
 * micro-VM; deriving it from the user and conversation keeps users apart.
 */
export function runtimeSessionId(sub: string, conversationId: string): string {
  return createHash("sha256").update(`${sub}\n${conversationId}`).digest("hex");
}
