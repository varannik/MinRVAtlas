import "server-only";

import { CognitoJwtVerifier } from "aws-jwt-verify";

import { type CognitoConfig } from "./cognito-config";
import { isOperatorRole, roleFromGroups, type OperatorRole } from "./roles";

export {
  getCognitoConfig,
  hostedAuthorizeUrl,
  hostedLogoutUrl,
  type CognitoConfig,
} from "./cognito-config";

export type CognitoClaims = {
  sub: string;
  email: string;
  name?: string;
  tenantId: string;
  role: OperatorRole;
  groups: string[];
};

type TokenResponse = {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;
let verifierPoolId: string | null = null;

export async function exchangeAuthorizationCode(
  cfg: CognitoConfig,
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  return postForm(cfg, {
    grant_type: "authorization_code",
    client_id: cfg.clientId,
    code,
    redirect_uri: cfg.redirectUri,
    code_verifier: codeVerifier,
  });
}

export async function revokeRefreshToken(
  cfg: CognitoConfig,
  refreshToken: string,
): Promise<void> {
  await postForm(cfg, {
    token: refreshToken,
    client_id: cfg.clientId,
    token_type_hint: "refresh_token",
  }, "/oauth2/revoke");
}

export async function claimsFromIdToken(
  cfg: CognitoConfig,
  idToken: string,
): Promise<CognitoClaims> {
  const payload = (await getVerifier(cfg).verify(idToken)) as Record<string, unknown>;
  const groups = asStringArray(payload["cognito:groups"]);
  const tenantRaw =
    (typeof payload.tenant_id === "string" && payload.tenant_id) ||
    (typeof payload["custom:tenant_id"] === "string" && payload["custom:tenant_id"]) ||
    "";
  if (!tenantRaw) {
    throw new Error("Cognito token is missing tenant_id");
  }
  const roleClaim = typeof payload.role === "string" ? payload.role : "";
  const email = typeof payload.email === "string" ? payload.email : "";
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!email || !sub) {
    throw new Error("Cognito token is missing email or sub");
  }
  return {
    sub,
    email,
    name: typeof payload.name === "string" ? payload.name : undefined,
    tenantId: tenantRaw,
    role: isOperatorRole(roleClaim) ? roleClaim : roleFromGroups(groups),
    groups,
  };
}

function getVerifier(cfg: CognitoConfig) {
  if (!verifier || verifierPoolId !== cfg.userPoolId) {
    verifier = CognitoJwtVerifier.create({
      userPoolId: cfg.userPoolId,
      tokenUse: "id",
      clientId: cfg.clientId,
    });
    verifierPoolId = cfg.userPoolId;
  }
  return verifier;
}

async function postForm(
  cfg: CognitoConfig,
  body: Record<string, string>,
  path = "/oauth2/token",
): Promise<TokenResponse> {
  const credentials = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString(
    "base64",
  );
  const response = await fetch(`https://${cfg.domain}${path}`, {
    method: "POST",
    headers: {
      authorization: `Basic ${credentials}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
    cache: "no-store",
  });
  if (path === "/oauth2/revoke") {
    if (!response.ok) {
      throw new Error(`Cognito revoke failed (${response.status})`);
    }
    return {};
  }
  const json = (await response.json()) as TokenResponse;
  if (!response.ok) {
    throw new Error(json.error_description || json.error || "Cognito token exchange failed");
  }
  return json;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string" && value.length > 0) return [value];
  return [];
}
