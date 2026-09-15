import "server-only";

import { isOperatorRole, type OperatorRole } from "./roles";
import { isDevAuthAllowed, type SessionPayload, SESSION_TTL_SECONDS } from "./session";

export function devUserSession(hostname: string): SessionPayload | null {
  if (!isDevAuthAllowed(hostname)) return null;
  const email = process.env.AUTH_DEV_USER?.trim().toLowerCase();
  if (!email || !email.includes("@")) return null;
  const tenantId = process.env.AUTH_DEV_TENANT?.trim() || "fourfourone";
  const roleRaw = process.env.AUTH_DEV_ROLE?.trim() || "platform_admin";
  const role: OperatorRole = isOperatorRole(roleRaw) ? roleRaw : "platform_admin";
  return {
    sub: `dev:${email}`,
    email,
    tenantId,
    role,
    groups: [role],
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    auth: "dev",
  };
}
