import { roleFromGroups, type OperatorRole } from "./roles";

export const SESSION_COOKIE = "minrv_session";
export const OAUTH_COOKIE = "minrv_oauth";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export type SessionAuth = "cognito" | "dev";

export type SessionPayload = {
  sub: string;
  email: string;
  name?: string;
  tenantId: string;
  role: OperatorRole;
  groups: string[];
  refreshToken?: string;
  exp: number;
  auth: SessionAuth;
};

export type PublicSession = Omit<SessionPayload, "refreshToken">;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function isDevHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function isDevAuthAllowed(hostname: string): boolean {
  return process.env.NODE_ENV !== "production" && isDevHost(hostname);
}

export function sessionSecret(): string | null {
  const fromEnv = process.env.SESSION_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV !== "production") {
    return "local-dev-session-key-not-for-aws";
  }
  return null;
}

export function publicSession(session: SessionPayload): PublicSession {
  return {
    sub: session.sub,
    email: session.email,
    name: session.name,
    tenantId: session.tenantId,
    role: session.role,
    groups: session.groups,
    exp: session.exp,
    auth: session.auth,
  };
}

export function sessionCookieOptions(maxAge = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export async function sealSession(
  payload: SessionPayload,
  secret: string,
): Promise<string> {
  const key = await importAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoder.encode(JSON.stringify(payload)),
    ),
  );
  return `${toBase64Url(iv)}.${toBase64Url(ciphertext)}`;
}

export async function unsealSession(
  token: string | undefined,
  secret: string | null,
): Promise<SessionPayload | null> {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const key = await importAesKey(secret);
    const iv = fromBase64Url(parts[0]);
    const ciphertext = fromBase64Url(parts[1]);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext,
    );
    const parsed = JSON.parse(decoder.decode(plaintext)) as SessionPayload;
    if (!parsed?.sub || !parsed.email || !parsed.tenantId || !parsed.exp) {
      return null;
    }
    if (parsed.exp * 1000 < Date.now()) return null;
    return {
      ...parsed,
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      role: parsed.role ?? roleFromGroups(parsed.groups),
    };
  } catch {
    return null;
  }
}

export function isPublicAuthPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/auth/login" ||
    pathname === "/auth/session" ||
    pathname === "/auth/password" ||
    pathname === "/auth/callback" ||
    pathname === "/auth/logout"
  );
}

function originFromUrl(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** Browser POSTs from the landing dialog. CloudFront Origin may differ from ALB Host. */
export function isBrowserSameOrigin(request: {
  headers: Headers;
  nextUrl: URL;
}): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site === "same-origin") return true;
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  const allowed = new Set<string>([requestOrigin(request).origin]);
  const redirectOrigin = originFromUrl(process.env.COGNITO_REDIRECT_URI);
  if (redirectOrigin) allowed.add(redirectOrigin);
  const logoutOrigin = originFromUrl(process.env.COGNITO_LOGOUT_URL);
  if (logoutOrigin) allowed.add(logoutOrigin);
  return allowed.has(origin);
}

export function requestOrigin(request: { headers: Headers; nextUrl: URL }): URL {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || request.nextUrl.host;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto =
    forwardedProto || request.nextUrl.protocol.replace(/:$/, "") || "http";
  return new URL(`${proto}://${host}`);
}

export function safeReturnPath(from: string | null | undefined): string {
  if (
    !from ||
    !from.startsWith("/") ||
    from.startsWith("//") ||
    from.startsWith("/login") ||
    from.startsWith("/auth")
  ) {
    return "/";
  }
  return from;
}

async function importAesKey(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
