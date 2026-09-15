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

  const login = new URL("/login", requestOrigin(request));
  const hosted =
    cfg && session?.auth === "cognito"
      ? hostedLogoutUrl(cfg, login.toString())
      : login.toString();
  const response = NextResponse.redirect(hosted);
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(0), maxAge: 0 });
  response.cookies.set(OAUTH_COOKIE, "", { ...sessionCookieOptions(0), maxAge: 0 });
  return response;
}
