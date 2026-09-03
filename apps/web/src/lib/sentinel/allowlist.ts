/**
 * Fail-closed allowlist for the Sentinel BFF.
 *
 * Incoming Next path is everything after `/api/sentinel/` (no leading `api/`).
 * Upstream is `${SENTINEL_BASE_URL}/api/${path}` except `health` → `/api/health`.
 */

const ALLOWED_PREFIXES = [
  "health",
  "v1/datasets",
  "v1/runs",
  "v1/rules",
  "v1/corrections",
  "v1/anomaly",
  "v1/knowledge-base",
  "v1/ml",
  "v1/schedules",
  "v1/audit",
  "v1/reports",
  "v1/violations",
  "v1/projects",
  "v1/status",
  "v1/rule-studio",
  "v1/ai",
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
