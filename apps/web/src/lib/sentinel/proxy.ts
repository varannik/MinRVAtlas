import "server-only";

import type { NextRequest } from "next/server";

import {
  isAllowedSentinelPath,
  toUpstreamSentinelPath,
} from "./allowlist";
import {
  getSentinelConfig,
  resolveRequestTenant,
  SentinelProjectMapError,
} from "./config";
import {
  rewriteFormData,
  rewriteJsonValue,
  rewriteSearchParams,
} from "./rewrite";

const PROXY_TIMEOUT_MS = 120_000;
const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "cache-control": "private, no-store" } },
  );
}

function restPathFromRequest(request: NextRequest): string {
  const prefix = "/api/sentinel";
  const pathname = request.nextUrl.pathname;
  if (!pathname.startsWith(prefix)) return "";
  return pathname.slice(prefix.length).replace(/^\/+/, "");
}

async function buildUpstreamBody(
  request: NextRequest,
  projectMap: Record<string, string>,
): Promise<{ body?: BodyInit; contentType?: string }> {
  if (!METHODS_WITH_BODY.has(request.method)) return {};
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType && request.headers.get("content-length") === "0") {
    return {};
  }

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    return { body: rewriteFormData(form, projectMap) };
  }

  if (contentType.includes("application/json")) {
    const text = await request.text();
    if (!text) return {};
    try {
      const parsed: unknown = JSON.parse(text);
      return {
        body: JSON.stringify(rewriteJsonValue(parsed, projectMap)),
        contentType: "application/json",
      };
    } catch {
      return { body: text, contentType };
    }
  }

  const buffer = await request.arrayBuffer();
  if (buffer.byteLength === 0) return {};
  return { body: buffer, contentType: contentType || undefined };
}

function copyUpstreamHeaders(upstream: Response): Headers {
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const contentDisposition = upstream.headers.get("content-disposition");
  if (contentDisposition) headers.set("content-disposition", contentDisposition);
  headers.set("cache-control", "private, no-store");
  return headers;
}

export async function proxySentinel(request: NextRequest): Promise<Response> {
  const tenantId = resolveRequestTenant(request);
  if (!tenantId) return jsonError("Unknown tenant", 403);

  const config = getSentinelConfig();
  if (tenantId !== config.tenantId) {
    return jsonError("Sentinel is not provisioned for this tenant", 403);
  }

  const path = restPathFromRequest(request);
  if (!isAllowedSentinelPath(path)) {
    return jsonError("Path is not allowed", 403);
  }

  if (!config.baseUrl) {
    return jsonError("SENTINEL_BASE_URL is not configured", 503);
  }

  const isHealth = path === "health" || path === "health/";
  if (!isHealth && !config.serviceToken) {
    return jsonError("SENTINEL_SERVICE_TOKEN is not configured", 503);
  }

  let search: URLSearchParams;
  try {
    search = rewriteSearchParams(
      request.nextUrl.searchParams,
      config.projectMap,
    );
  } catch (error) {
    if (error instanceof SentinelProjectMapError) {
      return jsonError(error.message, 400);
    }
    throw error;
  }

  const upstreamUrl = new URL(toUpstreamSentinelPath(path), `${config.baseUrl}/`);
  for (const [key, value] of search.entries()) {
    upstreamUrl.searchParams.set(key, value);
  }

  const headers = new Headers();
  const accept = request.headers.get("accept");
  if (accept) headers.set("accept", accept);
  if (config.serviceToken) {
    headers.set("authorization", `Bearer ${config.serviceToken}`);
  }

  let body: BodyInit | undefined;
  try {
    const built = await buildUpstreamBody(request, config.projectMap);
    body = built.body;
    if (built.contentType) headers.set("content-type", built.contentType);
  } catch (error) {
    if (error instanceof SentinelProjectMapError) {
      return jsonError(error.message, 400);
    }
    throw error;
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: copyUpstreamHeaders(upstream),
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "Data Sentinel timed out"
        : "Data Sentinel is unreachable";
    return jsonError(message, 502);
  }
}
