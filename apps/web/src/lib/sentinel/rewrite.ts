import { isCatalogProjectId } from "./config";
import { ensureSentinelUuid } from "./bind";

const PROJECT_ID_KEYS = new Set(["project_id", "projectId"]);

async function rewriteId(value: string): Promise<string> {
  if (!isCatalogProjectId(value)) return value;
  return ensureSentinelUuid(value);
}

export async function rewritePath(path: string): Promise<string> {
  const parts = path.split("/");
  const next = await Promise.all(
    parts.map(async (part) => {
      if (!part || !isCatalogProjectId(part)) return part;
      return ensureSentinelUuid(part);
    }),
  );
  return next.join("/");
}

export async function rewriteSearchParams(
  search: URLSearchParams,
): Promise<URLSearchParams> {
  const next = new URLSearchParams(search);
  for (const key of PROJECT_ID_KEYS) {
    const value = next.get(key);
    if (value) next.set(key, await rewriteId(value));
  }
  return next;
}

export async function rewriteJsonValue(value: unknown): Promise<unknown> {
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => rewriteJsonValue(item)));
  }
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (PROJECT_ID_KEYS.has(key) && typeof child === "string") {
      out[key] = await rewriteId(child);
    } else {
      out[key] = await rewriteJsonValue(child);
    }
  }
  return out;
}

export async function rewriteFormData(form: FormData): Promise<FormData> {
  const next = new FormData();
  const entries: [string, FormDataEntryValue][] = [];
  form.forEach((value, key) => {
    entries.push([key, value]);
  });
  for (const [key, value] of entries) {
    if (
      PROJECT_ID_KEYS.has(key) &&
      typeof value === "string" &&
      isCatalogProjectId(value)
    ) {
      next.append(key, await ensureSentinelUuid(value));
      continue;
    }
    next.append(key, value);
  }
  return next;
}
