import { NextResponse, type NextRequest } from "next/server";

import { getCognitoConfig } from "@/lib/auth/cognito";
import {
  CognitoIdpError,
  confirmForgotPassword,
  forgotPassword,
  publicCognitoError,
} from "@/lib/auth/cognito-idp";
import { isBrowserSameOrigin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };
const SENT_MESSAGE =
  "If an account exists for that email, a reset code has been sent.";

type PasswordBody = {
  action?: string;
  email?: string;
  code?: string;
  password?: string;
};

export async function POST(request: NextRequest) {
  if (!isBrowserSameOrigin(request)) {
    return NextResponse.json(
      { error: "Could not complete that request" },
      { status: 403, headers: NO_STORE },
    );
  }

  const cfg = getCognitoConfig();
  if (!cfg) {
    return NextResponse.json(
      { error: "Cognito is not configured" },
      { status: 503, headers: NO_STORE },
    );
  }

  let body: PasswordBody = {};
  try {
    body = (await request.json()) as PasswordBody;
  } catch {
    body = {};
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { error: "Enter a valid email" },
      { status: 400, headers: NO_STORE },
    );
  }

  if (body.action === "confirm") {
    const code = body.code?.trim() ?? "";
    const password = body.password ?? "";
    if (!code || !password) {
      return NextResponse.json(
        { error: "Enter the code and a new password" },
        { status: 400, headers: NO_STORE },
      );
    }
    try {
      await confirmForgotPassword(cfg, email, code, password);
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    } catch (error) {
      return NextResponse.json(
        {
          error: publicCognitoError(
            error,
            "Could not update the password. Check the code and try again",
          ),
        },
        { status: 400, headers: NO_STORE },
      );
    }
  }

  try {
    await forgotPassword(cfg, email);
  } catch (error) {
    if (
      error instanceof CognitoIdpError &&
      (error.code === "LimitExceededException" ||
        error.code === "TooManyRequestsException")
    ) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later" },
        { status: 429, headers: NO_STORE },
      );
    }
  }

  return NextResponse.json(
    { ok: true, message: SENT_MESSAGE },
    { headers: NO_STORE },
  );
}
