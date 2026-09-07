import type { Project } from "./types";

const COUNTRY: Record<
  string,
  { name: string; lat: number; lng: number }
> = {
  ARE: { name: "United Arab Emirates", lat: 25.29, lng: 56.26 },
  GBR: { name: "United Kingdom", lat: 51.51, lng: -0.13 },
  USA: { name: "United States", lat: 39.83, lng: -98.58 },
  ISL: { name: "Iceland", lat: 64.96, lng: -19.02 },
  NOR: { name: "Norway", lat: 60.47, lng: 8.47 },
  CAN: { name: "Canada", lat: 56.13, lng: -106.35 },
  AUS: { name: "Australia", lat: -25.27, lng: 133.78 },
  KEN: { name: "Kenya", lat: -0.02, lng: 37.91 },
  OMN: { name: "Oman", lat: 21.51, lng: 55.92 },
};

export function countryFromIso3(code: string | null | undefined): {
  name: string;
  lat: number;
  lng: number;
} {
  const key = (code ?? "").toUpperCase();
  return COUNTRY[key] ?? { name: code || "Unknown", lat: 20, lng: 10 };
}

export function certifyProjectId(project: Pick<Project, "id" | "externalProjectId">): string {
  return scopedCertifyId(project) ?? project.id;
}

/** Certify `prj_…` only — undefined means fall back to ISOMETRIC_PROJECT_ID. */
export function scopedCertifyId(
  project: Pick<Project, "id" | "externalProjectId">,
): string | undefined {
  if (project.externalProjectId && isCertifyProjectId(project.externalProjectId)) {
    return project.externalProjectId;
  }
  if (isCertifyProjectId(project.id)) return project.id;
  return undefined;
}

export function isCertifyProjectId(id: string): boolean {
  return /^prj_[A-Za-z0-9]+$/i.test(id);
}
