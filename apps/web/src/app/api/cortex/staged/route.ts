import type { NextRequest } from "next/server";

import { NO_STORE, atlasFailure, refuse } from "@/lib/atlas/access.server";
import { changeStaged, listStaged, parseStaged } from "@/lib/atlas/cortex-staged.server";
import { isBrowserSameOrigin } from "@/lib/auth/session";
import { currentSession } from "@/lib/cortex/intake.server";

/**
 * What the signed-in person has staged for Cortex, kept in the Atlas table.
 * GET: { items }. POST { add: [item…] } or { remove: id }: change the list, returns { items }.
 * Items describe data files and details; file contents never come here.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await currentSession();
  if (!session) return refuse("Unauthorized", 401);
  try {
    return Response.json({ items: await listStaged(session) }, { headers: NO_STORE });
  } catch (error) {
    return atlasFailure(error, "cortex staged read");
  }
}

export async function POST(request: NextRequest) {
  if (!isBrowserSameOrigin(request)) return refuse("Cross-site request refused.", 403);
  const session = await currentSession();
  if (!session) return refuse("Unauthorized", 401);
  const body = (await request.json().catch(() => null)) as { add?: unknown; remove?: unknown } | null;
  if (!body) return refuse("JSON body is required", 400);
  try {
    if (Array.isArray(body.add)) {
      const added = body.add.slice(0, 50).map(parseStaged);
      if (added.some((item) => item === null)) return refuse("Not a staged item.", 400);
      const items = await changeStaged(session, (current) => [...(added as NonNullable<(typeof added)[number]>[]), ...current.filter((item) => !added.some((add) => add?.id === item.id))]);
      return Response.json({ items }, { headers: NO_STORE });
    }
    if (typeof body.remove === "string") {
      const id = body.remove;
      const items = await changeStaged(session, (current) => current.filter((item) => item.id !== id));
      return Response.json({ items }, { headers: NO_STORE });
    }
    return refuse("Send add or remove.", 400);
  } catch (error) {
    return atlasFailure(error, "cortex staged change");
  }
}
