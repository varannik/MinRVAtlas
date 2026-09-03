import "server-only";

import {
  getSentinelConfig,
  SentinelProjectMapError,
} from "./config";
import {
  rewriteFormData,
  rewriteJsonValue,
  rewriteSearchParams,
} from "./rewrite";
import { toUpstreamSentinelPath } from "./allowlist";

const UPSTREAM_TIMEOUT_MS = 120_000;

export class SentinelUpstreamError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "SentinelUpstreamError";
    this.status = status;
    this.body = body;
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const record = body as Record<string, unknown>;
  if (typeof record.error === "string") return record.error;
  if (typeof record.detail === "string") return record.detail;
  if (Array.isArray(record.detail)) {
    return record.detail
      .map((item) =>
        typeof item === "object" && item && "msg" in item
          ? String((item as { msg: unknown }).msg)
          : String(item),
      )
      .join("; ");
  }
  if (typeof record.message === "string") return record.message;
  return fallback;
}

export async function sentinelUpstream(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const config = getSentinelConfig();
  if (!config.baseUrl) {
    throw new SentinelUpstreamError(503, "SENTINEL_BASE_URL is not configured", null);
  }
  if (!config.serviceToken) {
    throw new SentinelUpstreamError(
      503,
      "SENTINEL_SERVICE_TOKEN is not configured",
      null,
    );
  }

  const suffix = path.replace(/^\/+/, "");
  const url = new URL(toUpstreamSentinelPath(suffix), `${config.baseUrl}/`);
  if (init.body === undefined) {
    const search = rewriteSearchParams(url.searchParams, config.projectMap);
    url.search = search.toString();
  }

  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${config.serviceToken}`);

  let body = init.body;
  if (body instanceof FormData) {
    body = rewriteFormData(body, config.projectMap);
    headers.delete("content-type");
  } else if (typeof body === "string" && headers.get("content-type")?.includes("json")) {
    try {
      body = JSON.stringify(
        rewriteJsonValue(JSON.parse(body) as unknown, config.projectMap),
      );
    } catch (error) {
      if (error instanceof SentinelProjectMapError) throw error;
    }
  }

  return fetch(url, {
    ...init,
    headers,
    body,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
}

export async function sentinelUpstreamJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await sentinelUpstream(path, init);
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { raw: text };
    }
  }
  if (!response.ok) {
    throw new SentinelUpstreamError(
      response.status,
      errorMessage(body, response.statusText),
      body,
    );
  }
  return body as T;
}
