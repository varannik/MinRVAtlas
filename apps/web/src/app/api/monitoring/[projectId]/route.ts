import type { NextRequest } from "next/server";

import { canUploadAs } from "@/lib/cortex/uploads";
import { monitoringContext } from "@/lib/monitoring/route.server";
import { listUploads, loadTagMap } from "@/lib/monitoring/store.server";
import { NO_STORE, failed } from "@/lib/quality/route.server";
import { registrySlug } from "@/lib/stream-schema";

/**
 * A project's monitoring data set-up: its tag map (and whether it is approved),
 * the latest uploads, and what the user may do. Read through the Cortex tenant
 * session for this tenant and project.
 */

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: NextRequest, { params }: Context) {
  const { projectId } = await params;
  try {
    const context = await monitoringContext(projectId);
    if ("failure" in context) return context.failure;
    const { dynamo, env, session, project } = context;
    const [tagMap, uploads] = await Promise.all([
      loadTagMap(dynamo, env.table, session.tenantId, project.id),
      listUploads(dynamo, env.table, session.tenantId, project.id),
    ]);
    return Response.json(
      {
        project: { id: project.id, name: project.name, registry: project.registry, folder: `${registrySlug(project.registry)}/${project.id}` },
        tagMap,
        uploads,
        canPropose: canUploadAs(session.role),
        canApprove: session.role === "platform_admin",
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return failed(error, "monitoring read");
  }
}
