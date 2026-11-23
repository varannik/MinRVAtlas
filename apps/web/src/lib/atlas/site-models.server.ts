import "server-only";

import type { SiteLayout } from "@/lib/site-layouts";
import { SITE_MODEL_CURRENT, projectPk } from "./keys";
import { getDoc, getJsonObject, getObject } from "./store.server";

/**
 * A project's 3D site model. The table holds which version is live (its
 * manifest); the bucket holds that version's files, under a prefix nothing
 * ever overwrites. Publishing a new model writes a new prefix and then moves
 * the pointer, so a viewer never sees half of one version and half of another.
 */

export interface SiteModelFile {
  key: string;
  contentType: string;
  sha256: string;
  bytes: number;
}

export interface SiteModelAsset extends SiteModelFile {
  /** What the asset is for: the source photo, a mesh, a texture. */
  role: string;
  width?: number;
  height?: number;
}

export interface SiteModelManifest {
  format: string;
  tenantId: string;
  projectId: string;
  version: number;
  createdAt: string;
  /** Where the version's files sit in the bucket. */
  prefix: string;
  layout: SiteModelFile;
  assets: SiteModelAsset[];
}

export async function currentSiteModel(projectId: string): Promise<SiteModelManifest | null> {
  return (await getDoc<SiteModelManifest>(projectPk(projectId), SITE_MODEL_CURRENT))?.doc ?? null;
}

// A version's files never change, so one read per version is enough.
const layouts = new Map<string, SiteLayout>();

export async function siteModelLayout(manifest: SiteModelManifest): Promise<SiteLayout | null> {
  const id = `${manifest.prefix}@${manifest.layout.sha256}`;
  const hit = layouts.get(id);
  if (hit) return hit;
  const layout = await getJsonObject<SiteLayout>(`${manifest.prefix}/${manifest.layout.key}`);
  if (layout) layouts.set(id, layout);
  return layout;
}

/** One of the version's assets, only if the manifest lists it. */
export async function siteModelAsset(manifest: SiteModelManifest, key: string) {
  const asset = manifest.assets.find((entry) => entry.key === key);
  if (!asset) return null;
  const object = await getObject(`${manifest.prefix}/${asset.key}`);
  return object ? { ...object, asset } : null;
}
