import type { NextRequest } from "next/server";

import { NO_STORE, atlasFailure, sessionProject } from "@/lib/atlas/access.server";
import { currentSiteModel, siteModelLayout } from "@/lib/atlas/site-models.server";

/**
 * A project's live 3D site model.
 * GET: { manifest, layout } for the version that is live, with the layout's
 * photo pointing at its asset route; { manifest: null } when the project has
 * no model yet, which the chain page shows as "not built yet".
 */

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: NextRequest, { params }: Context) {
  const { projectId } = await params;
  try {
    const ready = await sessionProject(projectId);
    if (ready instanceof Response) return ready;
    const manifest = await currentSiteModel(ready.project.id);
    if (!manifest) return Response.json({ manifest: null, layout: null }, { headers: NO_STORE });
    const layout = await siteModelLayout(manifest);
    if (!layout) return Response.json({ manifest: null, layout: null }, { headers: NO_STORE });
    const base = `/api/atlas/projects/${encodeURIComponent(ready.project.id)}/site-model/assets/v${manifest.version}`;
    const photo = layout.photo.src ? { ...layout.photo, src: `${base}/${layout.photo.src}` } : layout.photo;
    return Response.json({ manifest, layout: { ...layout, photo } }, { headers: NO_STORE });
  } catch (error) {
    return atlasFailure(error, "site model");
  }
}
