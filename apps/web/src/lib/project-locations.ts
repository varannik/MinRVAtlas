import type { Project } from "./types";

/** Operator-entered WGS84 pin for a local catalog project. */
export interface SiteLocation {
  lat: number;
  lng: number;
  updatedAt: string;
}

export type LocationOverlay = Record<string, SiteLocation>;

const LAT_MIN = -90;
const LAT_MAX = 90;
const LNG_MIN = -180;
const LNG_MAX = 180;

export function parseLatitude(value: unknown): number | null {
  return parseBoundedNumber(value, LAT_MIN, LAT_MAX);
}

export function parseLongitude(value: unknown): number | null {
  return parseBoundedNumber(value, LNG_MIN, LNG_MAX);
}

function parseBoundedNumber(
  value: unknown,
  min: number,
  max: number,
): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : NaN;
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
    return null;
  }
  return numeric;
}

export function parseSiteLocation(value: unknown): SiteLocation | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const lat = parseLatitude(record.lat);
  const lng = parseLongitude(record.lng);
  if (lat === null || lng === null) return null;
  const updatedAt =
    typeof record.updatedAt === "string" && record.updatedAt.length > 0
      ? record.updatedAt
      : new Date().toISOString();
  return { lat, lng, updatedAt };
}

export function parseLocationOverlay(value: unknown): LocationOverlay {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const overlay: LocationOverlay = {};
  for (const [projectId, entry] of Object.entries(value)) {
    const location = parseSiteLocation(entry);
    if (location) overlay[projectId] = location;
  }
  return overlay;
}

export function applyLocationOverlay(
  project: Project,
  overlay: LocationOverlay,
): Project {
  const pin = overlay[project.id];
  if (!pin) return project;
  if (pin.lat === project.lat && pin.lng === project.lng) return project;
  return { ...project, lat: pin.lat, lng: pin.lng };
}
