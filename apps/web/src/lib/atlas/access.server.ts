import "server-only";

import type { SessionPayload } from "@/lib/auth/session";
import { currentSession } from "@/lib/cortex/intake.server";
import type { Project } from "@/lib/types";
import { findProject } from "./catalog.server";
import { AtlasConflict, AtlasUnavailable } from "./store.server";

export const NO_STORE = { "cache-control": "private, no-store" } as const;

export function refuse(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: NO_STORE });
}

/** A session may see its own tenant's projects; platform admins see every tenant's. */
export function canSee(session: SessionPayload, project: Pick<Project, "tenantId">): boolean {
  return session.role === "platform_admin" || project.tenantId === session.tenantId;
}

/** The signed-in person and a catalogue project they may see, or the response that says why not. */
export async function sessionProject(projectId: string): Promise<{ session: SessionPayload; project: Project } | Response> {
  const session = await currentSession();
  if (!session) return refuse("Unauthorized", 401);
  const project = await findProject(projectId);
  if (!project || !canSee(session, project)) return refuse("Unknown project", 404);
  return { session, project };
}

/** Maps the Atlas errors to responses; anything else is logged and hidden. */
export function atlasFailure(error: unknown, what: string): Response {
  if (error instanceof AtlasUnavailable) return refuse(error.message, 503);
  if (error instanceof AtlasConflict) return refuse(error.message, 409);
  console.error(what, (error as Error)?.name, (error as Error)?.message);
  return refuse("The Atlas data store did not answer.", 502);
}
