import { NO_STORE, atlasFailure, refuse } from "@/lib/atlas/access.server";
import { listProjects, listTenants, readLocations } from "@/lib/atlas/catalog.server";
import { currentSession } from "@/lib/cortex/intake.server";

/**
 * The Atlas catalogue for the signed-in person, from the Atlas table.
 * GET: the tenants they may open, those tenants' projects, and the map pins
 * operators set for them. Platform admins see every tenant.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await currentSession();
  if (!session) return refuse("Unauthorized", 401);
  try {
    const admin = session.role === "platform_admin";
    const [tenants, projects, locations] = await Promise.all([listTenants(), listProjects(admin ? undefined : session.tenantId), readLocations()]);
    const ids = new Set(projects.map((project) => project.id));
    return Response.json(
      {
        tenants: admin ? tenants : tenants.filter((tenant) => tenant.id === session.tenantId),
        projects,
        locations: Object.fromEntries(Object.entries(locations).filter(([id]) => ids.has(id))),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return atlasFailure(error, "atlas catalog");
  }
}
