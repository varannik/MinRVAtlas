import { DEFAULT_TENANT_ID } from "@/lib/tenants";

export class SentinelHttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "SentinelHttpError";
    this.status = status;
    this.body = body;
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const record = body as Record<string, unknown>;
  if (typeof record.error === "string") return record.error;
  if (typeof record.detail === "string") return record.detail;
  if (typeof record.message === "string") return record.message;
  return fallback;
}

export async function sentinelRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const suffix = path.replace(/^\/+/, "");
  const headers = new Headers(init.headers);
  headers.set("x-tenant-id", DEFAULT_TENANT_ID);
  if (
    init.body &&
    !(init.body instanceof FormData) &&
    !headers.has("content-type")
  ) {
    headers.set("content-type", "application/json");
  }
  return fetch(`/api/sentinel/${suffix}`, {
    ...init,
    headers,
    cache: "no-store",
  });
}

export async function sentinelJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await sentinelRequest(path, init);
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
    throw new SentinelHttpError(
      response.status,
      errorMessage(body, response.statusText),
      body,
    );
  }
  return body as T;
}

export function unwrapItems<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (
    data &&
    typeof data === "object" &&
    Array.isArray((data as { items?: unknown }).items)
  ) {
    return (data as { items: T[] }).items;
  }
  return [];
}

export async function sentinelDownload(path: string): Promise<void> {
  const response = await sentinelRequest(path);
  if (!response.ok) {
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = { raw: text };
      }
    }
    throw new SentinelHttpError(
      response.status,
      errorMessage(body, response.statusText),
      body,
    );
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="?([^"]+)"?/i.exec(disposition);
  const filename = match?.[1] ?? "download";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
