import { cortexEnv, currentSession, describeFailure, projectsFor } from "@/lib/cortex/intake.server";
import { canShareAcrossOrganisation, canUploadAs } from "@/lib/cortex/uploads";

/** Projects the signed-in user may give documents to, from the Cortex tenancy table. */

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };

export async function GET() {
  const session = await currentSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });

  const env = cortexEnv();
  if (!env) {
    return Response.json(
      { configured: false, tenantStatus: "unknown", projects: [], canUpload: false, canRemove: false, canShare: false },
      { headers: NO_STORE },
    );
  }
  try {
    const { tenantStatus, projects } = await projectsFor(session, env);
    return Response.json(
      {
        configured: true,
        tenantStatus,
        projects,
        canUpload: canUploadAs(session.role),
        canRemove: canUploadAs(session.role) && Boolean(env.removalArn),
        // Documents for every project in the organisation (admins).
        canShare: canUploadAs(session.role) && canShareAcrossOrganisation(session.role),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    const failure = describeFailure(error);
    console.error("cortex projects", (error as Error)?.name);
    return Response.json({ error: failure.message }, { status: failure.status, headers: NO_STORE });
  }
}
