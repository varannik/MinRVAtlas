import "server-only";

import { cognitoRegion, type CognitoConfig } from "./cognito-config";
import { createSrpSession, secretHash } from "./cognito-srp";

export class CognitoIdpError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CognitoIdpError";
    this.code = code;
  }
}

export type CognitoAuthResult = {
  idToken?: string;
  accessToken?: string;
  refreshToken?: string;
};

export type CognitoAuthOutcome =
  | { kind: "tokens"; tokens: CognitoAuthResult }
  | { kind: "challenge"; challenge: string; session: string };

type CognitoErrorBody = {
  __type?: string;
  message?: string;
};

type InitiateAuthBody = {
  ChallengeName?: string;
  Session?: string;
  ChallengeParameters?: Record<string, string>;
  AuthenticationResult?: {
    IdToken?: string;
    AccessToken?: string;
    RefreshToken?: string;
  };
};

async function cognitoCall<T>(
  cfg: CognitoConfig,
  target: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(
    `https://cognito-idp.${cognitoRegion(cfg)}.amazonaws.com/`,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": `AWSCognitoIdentityProviderService.${target}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );
  let json: T & CognitoErrorBody;
  try {
    json = (await response.json()) as T & CognitoErrorBody;
  } catch {
    throw new CognitoIdpError("UnknownError", `Cognito ${target} failed`);
  }
  if (!response.ok) {
    const code = (json.__type || "UnknownError").split("#").pop() || "UnknownError";
    throw new CognitoIdpError(code, json.message || code);
  }
  return json;
}

function outcomeFromAuth(body: InitiateAuthBody): CognitoAuthOutcome {
  if (body.AuthenticationResult?.IdToken) {
    return {
      kind: "tokens",
      tokens: {
        idToken: body.AuthenticationResult.IdToken,
        accessToken: body.AuthenticationResult.AccessToken,
        refreshToken: body.AuthenticationResult.RefreshToken,
      },
    };
  }
  if (body.ChallengeName && body.Session) {
    return {
      kind: "challenge",
      challenge: body.ChallengeName,
      session: body.Session,
    };
  }
  throw new CognitoIdpError("UnknownError", "Cognito did not return tokens");
}

export async function initiateSrpAuth(
  cfg: CognitoConfig,
  username: string,
  password: string,
): Promise<CognitoAuthOutcome> {
  const srp = createSrpSession(cfg, username, password);
  const first = await cognitoCall<InitiateAuthBody>(cfg, "InitiateAuth", {
    AuthFlow: "USER_SRP_AUTH",
    ClientId: cfg.clientId,
    AuthParameters: srp.authParameters(),
  });
  if (first.ChallengeName !== "PASSWORD_VERIFIER" || !first.ChallengeParameters) {
    return outcomeFromAuth(first);
  }
  const second = await cognitoCall<InitiateAuthBody>(cfg, "RespondToAuthChallenge", {
    ClientId: cfg.clientId,
    ChallengeName: "PASSWORD_VERIFIER",
    ...(first.Session ? { Session: first.Session } : {}),
    ChallengeResponses: srp.passwordVerifier(first.ChallengeParameters),
  });
  return outcomeFromAuth(second);
}

export async function initiatePasswordAuth(
  cfg: CognitoConfig,
  username: string,
  password: string,
): Promise<CognitoAuthOutcome> {
  const body = await cognitoCall<InitiateAuthBody>(cfg, "InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: cfg.clientId,
    AuthParameters: {
      USERNAME: username,
      PASSWORD: password,
      SECRET_HASH: secretHash(cfg, username),
    },
  });
  return outcomeFromAuth(body);
}

export async function respondToAuthChallenge(
  cfg: CognitoConfig,
  input: {
    username: string;
    session: string;
    challenge: string;
    newPassword?: string;
    mfaCode?: string;
  },
): Promise<CognitoAuthOutcome> {
  const responses: Record<string, string> = {
    USERNAME: input.username,
    SECRET_HASH: secretHash(cfg, input.username),
  };
  if (input.challenge === "NEW_PASSWORD_REQUIRED" && input.newPassword) {
    responses.NEW_PASSWORD = input.newPassword;
  }
  if (input.challenge === "SOFTWARE_TOKEN_MFA" && input.mfaCode) {
    responses.SOFTWARE_TOKEN_MFA_CODE = input.mfaCode;
  }
  const body = await cognitoCall<InitiateAuthBody>(cfg, "RespondToAuthChallenge", {
    ClientId: cfg.clientId,
    ChallengeName: input.challenge,
    Session: input.session,
    ChallengeResponses: responses,
  });
  return outcomeFromAuth(body);
}

export async function forgotPassword(
  cfg: CognitoConfig,
  username: string,
): Promise<void> {
  await cognitoCall(cfg, "ForgotPassword", {
    ClientId: cfg.clientId,
    Username: username,
    SecretHash: secretHash(cfg, username),
  });
}

export async function confirmForgotPassword(
  cfg: CognitoConfig,
  username: string,
  code: string,
  password: string,
): Promise<void> {
  await cognitoCall(cfg, "ConfirmForgotPassword", {
    ClientId: cfg.clientId,
    Username: username,
    ConfirmationCode: code,
    Password: password,
    SecretHash: secretHash(cfg, username),
  });
}

export function publicCognitoError(error: unknown, fallback: string): string {
  if (!(error instanceof CognitoIdpError)) {
    return error instanceof Error ? error.message : fallback;
  }
  switch (error.code) {
    case "NotAuthorizedException":
      return "Could not sign in with those details";
    case "PasswordResetRequiredException":
      return "Reset your password to continue";
    case "UserNotConfirmedException":
      return "This account is not confirmed yet";
    case "CodeMismatchException":
      return "That code is not valid";
    case "ExpiredCodeException":
      return "That code has expired. Request a new one";
    case "InvalidPasswordException":
      return "Use 12+ characters with upper, lower, number, and symbol";
    case "LimitExceededException":
    case "TooManyRequestsException":
      return "Too many attempts. Try again later";
    case "InvalidParameterException":
      return "Check the details and try again";
    default:
      return fallback;
  }
}
