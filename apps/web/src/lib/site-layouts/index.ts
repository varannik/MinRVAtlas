import { FUJAIRAH_SITE } from "./fujairah";
import type { SiteLayout } from "./types";

export type * from "./types";

const LAYOUTS: Record<string, SiteLayout> = {
  [FUJAIRAH_SITE.projectId]: FUJAIRAH_SITE,
};

export function siteLayoutFor(projectId: string | null | undefined): SiteLayout | null {
  if (!projectId) return null;
  return LAYOUTS[projectId] ?? null;
}
