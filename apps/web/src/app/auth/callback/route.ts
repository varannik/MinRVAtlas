import { NextResponse, type NextRequest } from "next/server";

import {
  claimsFromIdToken,
  exchangeAuthorizationCode,
  getCognitoConfig,
} from "@/lib/auth/cognito";
import {
  OAUTH_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  requestOrigin,
  safeReturnPath,
  sealSession,
  sessionCookieOptions,
  sessionSecret,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";

type OauthCookie = { state?: string; verifier?: string; from?: string };

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const error = url.searchParams.get("error");
  if (error) {
    return redirectLogin(request, url.searchParams.get("error_description") || error);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return redirectLogin(request, "Missing authorization code");
  }

  let oauth: OauthCookie = {};
  try {
    oauth = JSON.parse(request.cookies.get(OAUTH_COOKIE)?.value ?? "{}") as OauthCookie;
  } catch {
    oauth = {};
  }
  if (!oauth.state || oauth.state !== state || !oauth.verifier) {
    return redirectLogin(request, "Invalid OAuth state");
  }

  const cfg = getCognitoConfig();
  const secret = sessionSecret();
  if (!cfg || !secret) {
    return redirectLogin(request, "Cognito is not configured");
  }

  try {
    const tokens = await exchangeAuthorizationCode(cfg, code, oauth.verifier);
    if (!tokens.id_token) {
      return redirectLogin(request, "Cognito did not return an id token");
    }
    const claims = await claimsFromIdToken(cfg, tokens.id_token);
    const sealed = await sealSession(
      {
        sub: claims.sub,
        email: claims.email,
        name: claims.name,
        tenantId: claims.tenantId,
        role: claims.role,
        groups: claims.groups,
        refreshToken: tokens.refresh_token,
        exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
        auth: "cognito",
      },
      secret,
    );
    const response = NextResponse.redirect(
      new URL(safeReturnPath(oauth.from), requestOrigin(request)),
    );
    response.cookies.set(SESSION_COOKIE, sealed, sessionCookieOptions());
    response.cookies.set(OAUTH_COOKIE, "", { ...sessionCookieOptions(0), maxAge: 0 });
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sign-in failed";
    return redirectLogin(request, message);
  }
}

function redirectLogin(request: NextRequest, message: string): NextResponse {
  const url = new URL("/login", requestOrigin(request));
  url.searchParams.set("error", message);
  const response = NextResponse.redirect(url);
  response.cookies.set(OAUTH_COOKIE, "", { ...sessionCookieOptions(0), maxAge: 0 });
  return response;
}
