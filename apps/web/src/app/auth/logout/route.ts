import { NextResponse, type NextRequest } from "next/server";

import { getCognitoConfig, hostedLogoutUrl, revokeRefreshToken } from "@/lib/auth/cognito";
import {
  OAUTH_COOKIE,
  SESSION_COOKIE,
  requestOrigin,
  sessionCookieOptions,
  sessionSecret,
  unsealSession,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";

function logoutLanding(request: NextRequest): URL {
  const local = new URL("/login", requestOrigin(request));
  if (process.env.NODE_ENV !== "production") return local;
  const fromEnv = process.env.COGNITO_LOGOUT_URL?.trim();
  if (fromEnv) {
    try {
      return new URL(fromEnv);
    } catch {
      // Fall through.
    }
  }
  const fromRedirect = process.env.COGNITO_REDIRECT_URI?.trim();
  if (fromRedirect) {
    try {
      return new URL("/login", fromRedirect);
    } catch {
      // Fall through.
    }
  }
  return local;
}

export async function GET(request: NextRequest) {
  const session = await unsealSession(
    request.cookies.get(SESSION_COOKIE)?.value,
    sessionSecret(),
  );
  const cfg = getCognitoConfig();
  if (cfg && session?.refreshToken) {
    try {
      await revokeRefreshToken(cfg, session.refreshToken);
    } catch {
      // Cookie is still cleared below.
    }
  }

  const login = logoutLanding(request);
  const hosted =
    cfg && session?.auth === "cognito"
      ? hostedLogoutUrl(cfg, login.toString())
      : login.toString();
  const response = NextResponse.redirect(hosted);
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(0), maxAge: 0 });
  response.cookies.set(OAUTH_COOKIE, "", { ...sessionCookieOptions(0), maxAge: 0 });
  return response;
}
