import type { NextRequest } from "next/server";

import { isBrowserSameOrigin } from "@/lib/auth/session";
import { cortexEnv, currentSession, describeFailure, requireProject, type CortexProject } from "@/lib/cortex/intake.server";
import type { RequirementScope } from "@/lib/requirements/catalog";
import { RequirementRefusal, decide, loadRequirements, requirementsEnv, startProposals } from "@/lib/requirements/store.server";

/**
 * Registry values for a project's methodology and edition (lib/requirements).
 * GET ?project=: each value with the built-in one, the approved one and Cortex's newest proposal.
 * POST { project, action: "propose" }: ask Cortex to propose every value from the registry's documents.
 * POST { project, action: "approve" | "reject", requirement, proposal }: decide on one proposal.
 * Values are shared by every organisation on that edition, so only platform admins change them.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };

function refuse(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: NO_STORE });
}

function scopeOf(project: CortexProject): RequirementScope | null {
  if (!project.registry || !project.methodology || !project.edition) return null;
  return { registry: project.registry, methodology: project.methodology, edition: project.edition };
}

function failed(error: unknown, what: string) {
  if (error instanceof RequirementRefusal) return refuse(error.message, error.status);
  const failure = describeFailure(error);
  if (failure.status >= 500) console.error(what, (error as Error)?.name);
  return refuse(failure.message, failure.status);
}

export async function GET(request: NextRequest) {
  const session = await currentSession();
  if (!session) return refuse("Unauthorized", 401);
  const env = cortexEnv();
  const store = requirementsEnv();
  if (!env || !store) return refuse("Registry values are not set up on this deployment.", 503);
  try {
    const project = await requireProject(session, env, request.nextUrl.searchParams.get("project") ?? "");
    const scope = scopeOf(project);
    if (!scope) {
      return Response.json(
        { scope: null, requirements: [], proposing: false, canDecide: false, message: "This project has no methodology edition in Cortex yet." },
        { headers: NO_STORE },
      );
    }
    const view = await loadRequirements(store, scope);
    return Response.json({ ...view, canDecide: session.role === "platform_admin", canPropose: Boolean(store.proposeArn) }, { headers: NO_STORE });
  } catch (error) {
    return failed(error, "requirements read");
  }
}

export async function POST(request: NextRequest) {
  if (!isBrowserSameOrigin(request)) return refuse("Cross-site request refused.", 403);
  const session = await currentSession();
  if (!session) return refuse("Unauthorized", 401);
  const env = cortexEnv();
  const store = requirementsEnv();
  if (!env || !store) return refuse("Registry values are not set up on this deployment.", 503);
  if (session.role !== "platform_admin") return refuse("Only platform admins propose and approve registry values.", 403);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return refuse("Send JSON.", 400);
  }
  const { project: projectId, action, requirement, proposal } = body ?? {};
  if (typeof projectId !== "string" || (action !== "propose" && action !== "approve" && action !== "reject")) {
    return refuse("project and an action (propose, approve or reject) are required.", 400);
  }
  try {
    const project = await requireProject(session, env, projectId);
    const scope = scopeOf(project);
    if (!scope) return refuse("This project has no methodology edition in Cortex yet.", 409);
    const by = { sub: session.sub, name: session.name || session.email };
    if (action === "propose") {
      await startProposals(store, scope, by);
      return Response.json({ proposing: true }, { status: 202, headers: NO_STORE });
    }
    if (typeof requirement !== "string" || typeof proposal !== "string") return refuse("requirement and proposal are required.", 400);
    await decide(store, scope, { requirement, proposal, action, by });
    return Response.json(await loadRequirements(store, scope), { headers: NO_STORE });
  } catch (error) {
    return failed(error, "requirements change");
  }
}
