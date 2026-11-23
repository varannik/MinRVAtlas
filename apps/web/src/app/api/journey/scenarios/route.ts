import { NO_STORE, atlasFailure, refuse } from "@/lib/atlas/access.server";
import { listScenarios } from "@/lib/atlas/scenarios.server";
import { currentSession } from "@/lib/cortex/intake.server";

/**
 * Practice journeys' starting points, from the Atlas table.
 * GET: [{ id, name, place, tag }]. Their answers stay on the server.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await currentSession();
  if (!session) return refuse("Unauthorized", 401);
  try {
    const scenarios = (await listScenarios()).map(({ id, name, place, tag }) => ({ id, name, place, tag }));
    return Response.json({ scenarios }, { headers: NO_STORE });
  } catch (error) {
    return atlasFailure(error, "journey scenarios");
  }
}
