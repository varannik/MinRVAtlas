import path from "node:path";
import type { SiteLayout } from "@/lib/site-layouts/types";
import { FUJAIRAH_SITE } from "./fujairah";

/** Every project's 3D site model, as authored. Seeded to the site-models bucket. */
export const SITE_LAYOUTS: SiteLayout[] = [FUJAIRAH_SITE];

/** The photo each model was traced from, stored with the model as a source asset. */
export const SITE_PHOTOS: Record<string, { file: string }> = {
  [FUJAIRAH_SITE.projectId]: { file: path.join(process.cwd(), "scripts/seed/sources/site-layouts/fujairah-aerial.jpg") },
};

export function siteLayoutFor(projectId: string | null | undefined): SiteLayout | null {
  return SITE_LAYOUTS.find((layout) => layout.projectId === projectId) ?? null;
}
