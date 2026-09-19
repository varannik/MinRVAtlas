import { NextResponse, type NextRequest } from "next/server";

import {
  claimsFromIdToken,
  exchangePassword,
  getCognitoConfig,
  type CognitoConfig,
} from "@/lib/auth/cognito";
import {
  CognitoIdpError,
  initiatePasswordAuth,
  initiateSrpAuth,
  publicCognitoError,
  respondToAuthChallenge,
  type CognitoAuthOutcome,
} from "@/lib/auth/cognito-idp";
import { devUserSession } from "@/lib/auth/dev-user";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  isBrowserSameOrigin,
  isDevAuthAllowed,
  safeReturnPath,
  sealSession,
  sessionCookieOptions,
  sessionSecret,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };

type SignInBody = {
  email?: string;
  password?: string;
  from?: string;
  session?: string;
  challenge?: string;
  newPassword?: string;
  code?: string;
};

export async function POST(request: NextRequest) {
  if (!isBrowserSameOrigin(request)) {
    return NextResponse.json(
      { error: "Could not sign in from this origin" },
      { status: 403, headers: NO_STORE },
    );
  }

  const secret = sessionSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "Session key is not configured" },
      { status: 503, headers: NO_STORE },
    );
  }

  let body: SignInBody = {};
  try {
    body = (await request.json()) as SignInBody;
  } catch {
    body = {};
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  const nextPath = safeReturnPath(body.from);
  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { error: "Enter a valid email" },
      { status: 400, headers: NO_STORE },
    );
  }

  const hostname = request.nextUrl.hostname;

  if (isDevAuthAllowed(hostname) && !body.challenge) {
    const dev = devUserSession(hostname);
    if (dev && dev.email === email) {
      const sealed = await sealSession(dev, secret);
      const response = NextResponse.json(
        { ok: true, redirect: nextPath },
        { headers: NO_STORE },
      );
      response.cookies.set(SESSION_COOKIE, sealed, sessionCookieOptions());
      return response;
    }
  }

  if (!body.challenge && !password) {
    return NextResponse.json(
      { error: "Enter your password" },
      { status: 400, headers: NO_STORE },
    );
  }

  const cfg = getCognitoConfig();
  if (!cfg) {
    return NextResponse.json(
      { error: "Cognito is not configured" },
      { status: 503, headers: NO_STORE },
    );
  }

  try {
    const outcome = body.challenge
      ? await completeChallenge(cfg, email, body)
      : await passwordSignIn(cfg, email, password);
    if (outcome.kind === "challenge") {
      return NextResponse.json(
        { challenge: outcome.challenge, session: outcome.session },
        { headers: NO_STORE },
      );
    }
    if (!outcome.tokens.idToken) {
      return NextResponse.json(
        { error: "Cognito did not return an id token" },
        { status: 401, headers: NO_STORE },
      );
    }
    const claims = await claimsFromIdToken(cfg, outcome.tokens.idToken);
    const sealed = await sealSession(
      {
        sub: claims.sub,
        email: claims.email,
        name: claims.name,
        tenantId: claims.tenantId,
        role: claims.role,
        groups: claims.groups,
        refreshToken: outcome.tokens.refreshToken,
        exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
        auth: "cognito",
      },
      secret,
    );
    const response = NextResponse.json(
      { ok: true, redirect: nextPath },
      { headers: NO_STORE },
    );
    response.cookies.set(SESSION_COOKIE, sealed, sessionCookieOptions());
    return response;
  } catch (error) {
    if (
      error instanceof CognitoIdpError &&
      error.code === "PasswordResetRequiredException"
    ) {
      return NextResponse.json(
        {
          error: "Reset your password to continue",
          passwordReset: true,
        },
        { status: 401, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      { error: publicCognitoError(error, "Could not sign in with those details") },
      { status: 401, headers: NO_STORE },
    );
  }
}

async function passwordSignIn(
  cfg: CognitoConfig,
  email: string,
  password: string,
): Promise<CognitoAuthOutcome> {
  if (!password) {
    throw new CognitoIdpError("InvalidParameterException", "Enter your password");
  }
  try {
    return await initiateSrpAuth(cfg, email, password);
  } catch (error) {
    if (isCredentialFailure(error)) throw error;
  }
  try {
    return await initiatePasswordAuth(cfg, email, password);
  } catch (error) {
    if (isCredentialFailure(error) || !shouldFallbackToPasswordGrant(error)) {
      throw error;
    }
    const tokens = await exchangePassword(cfg, email, password);
    if (!tokens.id_token) {
      throw error instanceof Error ? error : new Error("Sign-in failed");
    }
    return {
      kind: "tokens",
      tokens: {
        idToken: tokens.id_token,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      },
    };
  }
}

function isCredentialFailure(error: unknown): boolean {
  return (
    error instanceof CognitoIdpError &&
    (error.code === "NotAuthorizedException" ||
      error.code === "PasswordResetRequiredException" ||
      error.code === "UserNotConfirmedException")
  );
}

async function completeChallenge(
  cfg: CognitoConfig,
  email: string,
  body: SignInBody,
): Promise<CognitoAuthOutcome> {
  const challenge = body.challenge?.trim() ?? "";
  const session = body.session?.trim() ?? "";
  if (!challenge || !session) {
    throw new CognitoIdpError("InvalidParameterException", "Sign-in expired. Try again");
  }
  if (challenge === "NEW_PASSWORD_REQUIRED" && !body.newPassword) {
    throw new CognitoIdpError("InvalidPasswordException", "Enter a new password");
  }
  if (challenge === "SOFTWARE_TOKEN_MFA" && !body.code?.trim()) {
    throw new CognitoIdpError("CodeMismatchException", "Enter the authenticator code");
  }
  return respondToAuthChallenge(cfg, {
    username: email,
    session,
    challenge,
    newPassword: body.newPassword,
    mfaCode: body.code?.trim(),
  });
}

function shouldFallbackToPasswordGrant(error: unknown): boolean {
  if (!(error instanceof CognitoIdpError)) return false;
  return (
    error.code === "InvalidParameterException" ||
    /USER_PASSWORD_AUTH/i.test(error.message)
  );
}
