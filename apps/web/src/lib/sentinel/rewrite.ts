import {
  isCatalogProjectId,
  mapCatalogProjectId,
} from "./config";

const PROJECT_ID_KEYS = new Set(["project_id", "projectId"]);

function rewriteId(value: string, projectMap: Record<string, string>): string {
  if (!isCatalogProjectId(value)) return value;
  return mapCatalogProjectId(value, projectMap);
}

export function rewriteSearchParams(
  search: URLSearchParams,
  projectMap: Record<string, string>,
): URLSearchParams {
  const next = new URLSearchParams(search);
  for (const key of PROJECT_ID_KEYS) {
    const value = next.get(key);
    if (value) next.set(key, rewriteId(value, projectMap));
  }
  return next;
}

export function rewriteJsonValue(
  value: unknown,
  projectMap: Record<string, string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteJsonValue(item, projectMap));
  }
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (PROJECT_ID_KEYS.has(key) && typeof child === "string") {
      out[key] = rewriteId(child, projectMap);
    } else {
      out[key] = rewriteJsonValue(child, projectMap);
    }
  }
  return out;
}

export function rewriteFormData(
  form: FormData,
  projectMap: Record<string, string>,
): FormData {
  const next = new FormData();
  form.forEach((value, key) => {
    if (
      PROJECT_ID_KEYS.has(key) &&
      typeof value === "string" &&
      isCatalogProjectId(value)
    ) {
      next.append(key, mapCatalogProjectId(value, projectMap));
      return;
    }
    next.append(key, value);
  });
  return next;
}
