import { NextResponse, type NextRequest } from "next/server";

import { getCognitoConfig, hostedAuthorizeUrl } from "@/lib/auth/cognito";
import { devUserSession } from "@/lib/auth/dev-user";
import { pkceChallenge, randomUrlToken } from "@/lib/auth/pkce";
import {
  OAUTH_COOKIE,
  SESSION_COOKIE,
  isDevAuthAllowed,
  requestOrigin,
  safeReturnPath,
  sealSession,
  sessionCookieOptions,
  sessionSecret,
  unsealSession,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const existing = await unsealSession(
    request.cookies.get(SESSION_COOKIE)?.value,
    sessionSecret(),
  );
  const origin = requestOrigin(request);
  const nextPath = safeReturnPath(request.nextUrl.searchParams.get("from"));
  if (existing) {
    return NextResponse.redirect(new URL(nextPath, origin));
  }

  const secret = sessionSecret();
  if (!secret) {
    return NextResponse.redirect(loginError(request, "Session key is not configured"));
  }

  const hostname = request.nextUrl.hostname;
  const wantDev = request.nextUrl.searchParams.get("dev") === "1";
  if (wantDev || (!getCognitoConfig() && isDevAuthAllowed(hostname))) {
    const dev = devUserSession(hostname);
    if (!dev) {
      return NextResponse.redirect(
        loginError(request, "Set AUTH_DEV_USER on localhost, or deploy the identity stack"),
      );
    }
    const sealed = await sealSession(dev, secret);
    const response = NextResponse.redirect(new URL(nextPath, origin));
    response.cookies.set(SESSION_COOKIE, sealed, sessionCookieOptions());
    return response;
  }

  const cfg = getCognitoConfig();
  if (!cfg) {
    return NextResponse.redirect(
      loginError(request, "Cognito is not configured. Use AUTH_DEV_USER on localhost."),
    );
  }

  const state = randomUrlToken(24);
  const verifier = randomUrlToken(32);
  const challenge = await pkceChallenge(verifier);
  const response = NextResponse.redirect(hostedAuthorizeUrl(cfg, state, challenge));
  response.cookies.set(
    OAUTH_COOKIE,
    JSON.stringify({ state, verifier, from: nextPath }),
    sessionCookieOptions(10 * 60),
  );
  return response;
}

function loginError(request: NextRequest, message: string): URL {
  const url = new URL("/login", requestOrigin(request));
  url.searchParams.set("error", message);
  return url;
}
