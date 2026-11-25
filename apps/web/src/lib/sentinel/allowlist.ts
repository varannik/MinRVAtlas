/**
 * Fail-closed allowlist for the Sentinel BFF.
 *
 * Incoming Next path is everything after `/api/sentinel/` (no leading `api/`).
 * Upstream is `${SENTINEL_BASE_URL}/api/${path}` except `health` → `/api/health`.
 */

// Document V&V and its protocols only. Sentinel's data quality paths (datasets, runs,
// rules, anomaly, corrections, …) closed with its console pages: data quality is the
// quality engine's (/api/data-quality). The server-side pipeline route does not use this list.
const ALLOWED_PREFIXES = [
  "health",
  "v2/vv",
  "v2/protocols",
] as const;

const DENIED_PREFIXES = [
  "v1/auth",
  "v2/reviewer",
  "v1/connectors",
  "v1/api-keys",
  "v1/webhooks",
  "v1/ingest",
] as const;

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function isDeniedSentinelPath(path: string): boolean {
  return DENIED_PREFIXES.some((prefix) => matchesPrefix(path, prefix));
}

export function isAllowedSentinelPath(path: string): boolean {
  if (!path || path.includes("..")) return false;
  if (isDeniedSentinelPath(path)) return false;
  return ALLOWED_PREFIXES.some((prefix) => matchesPrefix(path, prefix));
}

export function toUpstreamSentinelPath(path: string): string {
  if (path === "health" || path === "health/") return "/api/health";
  return `/api/${path}`;
}
