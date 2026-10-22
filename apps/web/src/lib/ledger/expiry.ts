/** One year from the credential timestamp, when that timestamp can be read. */
export function expiryFromIssuedAt(issuedAt: Date): Date {
  const expires = new Date(issuedAt.getTime());
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  return expires;
}

/** Read `iat` from a JWT access token. Signature checks stay with the registry. */
export function issuedAtFromAccessToken(accessToken: string): Date | null {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { iat?: unknown };
    if (typeof payload.iat !== "number" || !Number.isFinite(payload.iat)) return null;
    const issued = new Date(payload.iat * 1000);
    return Number.isNaN(issued.getTime()) ? null : issued;
  } catch {
    return null;
  }
}

export function credentialWindow(
  accessToken: string,
  explicitIssuedAt?: string | null,
): { issuedAt: string | null; expiresAt: string | null } {
  const explicit = explicitIssuedAt?.trim();
  let issued: Date | null = null;
  if (explicit) {
    const parsed = new Date(explicit);
    if (!Number.isNaN(parsed.getTime())) issued = parsed;
  }
  if (!issued) issued = issuedAtFromAccessToken(accessToken);
  if (!issued) return { issuedAt: null, expiresAt: null };
  return {
    issuedAt: issued.toISOString(),
    expiresAt: expiryFromIssuedAt(issued).toISOString(),
  };
}
