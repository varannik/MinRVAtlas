import "server-only";

import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";

import type { SessionPayload } from "@/lib/auth/session";
import { cortexEnv, currentSession, describeFailure, projectDynamo, projectsFor } from "@/lib/cortex/intake.server";
import { CORTEX_ID, canUploadAs } from "@/lib/cortex/uploads";
import { loadDataset } from "@/lib/mrv/data/load";
import { resolveOwnedProject } from "@/lib/registries/server";
import type { Project } from "@/lib/types";
import { isStale, loadQuality, qualityEnv, startRun, type QualityEnv, type StoredQuality } from "./store.server";
import type { QualityRun, QualityView } from "./types";

/** Shared by the data-quality routes: who is asking, and the project as they may see it. */

export const NO_STORE = { "cache-control": "private, no-store" };

export function refuse(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: NO_STORE });
}

export function failed(error: unknown, what: string) {
  const failure = describeFailure(error);
  if (failure.status >= 500) console.error(what, (error as Error)?.name);
  return refuse(failure.message.replace("Cortex", "The quality engine"), failure.status);
}

export interface QualityContext {
  session: SessionPayload;
  env: QualityEnv;
  project: Project;
  dynamo: DynamoDBClient;
}

/** The signed-in user's project, with a client limited to its quality partition; or a view saying why not. */
export async function qualityContext(projectId: string): Promise<{ failure: Response } | { unavailable: QualityView } | QualityContext> {
  const session = await currentSession();
  if (!session) return { failure: refuse("Unauthorized", 401) };
  const cortex = cortexEnv();
  const env = qualityEnv();
  if (!cortex || !env) {
    return { unavailable: emptyView("The data quality engine is not set up on this deployment.") };
  }
  const project = CORTEX_ID.test(projectId) ? await resolveOwnedProject(session.tenantId, projectId) : null;
  if (!project) return { failure: refuse("Unknown project", 404) };
  // The same grant check as every Cortex route; an organisation not on Cortex simply has no checks yet.
  const { tenantStatus, projects } = await projectsFor(session, cortex);
  if (tenantStatus !== "active") return { unavailable: emptyView("Data quality checks run for organisations set up on Cortex.") };
  if (!projects.some((item) => item.id === projectId)) return { failure: refuse("You have no access to that project.", 403) };
  const dynamo = await projectDynamo(session, cortex, projectId);
  return { session, env, project, dynamo };
}

export function emptyView(reason: string): QualityView {
  return { available: false, reason, run: null, running: null, findings: [], canDecide: false };
}

/** Claude's run summary is for operators first: a viewer (a verifier, an auditor) sees the checks' own words only. */
function forRole(run: QualityRun | null, session: SessionPayload): QualityRun | null {
  if (!run || session.role !== "viewer") return run;
  return { ...run, summary: undefined };
}

export function view(stored: StoredQuality, session: SessionPayload): QualityView {
  return { available: true, ...stored, run: forRole(stored.run, session), canDecide: canUploadAs(session.role), showsSummary: session.role !== "viewer" };
}

/** The last day of data the calculation reads, to tell whether the latest run is out of date. */
export async function dataEnd(project: Project): Promise<string | null> {
  try {
    return (await loadDataset(project)).range?.end ?? null;
  } catch {
    return null;
  }
}

/**
 * Start a run when the data has moved past the latest one (anyone who can see the
 * project), or when asked to (people who may decide). Returns the stored state after.
 */
export async function runIfNeeded(context: QualityContext, force: boolean): Promise<{ stored: StoredQuality; started: boolean }> {
  const { session, env, project, dynamo } = context;
  const stored = await loadQuality(dynamo, env.table, session.tenantId, project.id);
  if (stored.running) return { stored, started: false };
  const due = force ? canUploadAs(session.role) : isStale(stored, await dataEnd(project));
  if (!due) return { stored, started: false };
  const running = await startRun(dynamo, env, {
    tenantId: session.tenantId,
    projectId: project.id,
    registry: project.registry,
    requestedBy: session.sub,
    country: project.country,
  });
  return { stored: { ...stored, running }, started: true };
}
