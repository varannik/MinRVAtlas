import type { NextRequest } from "next/server";

import { atlasFailure, refuse, sessionProject } from "@/lib/atlas/access.server";
import { currentSiteModel, siteModelAsset } from "@/lib/atlas/site-models.server";

/**
 * One file of a project's 3D site model: /v<version>/<asset key>.
 * Only the live version's listed assets are served. A version's files never
 * change, so the browser may keep them for good; a new version has a new URL.
 */

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ projectId: string; key: string[] }> };

export async function GET(_request: NextRequest, { params }: Context) {
  const { projectId, key } = await params;
  const [versionPart, ...rest] = key;
  const version = Number(versionPart?.replace(/^v/, ""));
  if (!Number.isInteger(version) || rest.length === 0) return refuse("Unknown asset", 404);
  try {
    const ready = await sessionProject(projectId);
    if (ready instanceof Response) return ready;
    const manifest = await currentSiteModel(ready.project.id);
    if (!manifest || manifest.version !== version) return refuse("Unknown asset", 404);
    const found = await siteModelAsset(manifest, rest.join("/"));
    if (!found) return refuse("Unknown asset", 404);
    return new Response(Buffer.from(found.body), {
      headers: {
        "content-type": found.asset.contentType,
        "content-length": String(found.body.byteLength),
        "cache-control": "private, max-age=31536000, immutable",
        etag: `"${found.asset.sha256}"`,
      },
    });
  } catch (error) {
    return atlasFailure(error, "site model asset");
  }
}
