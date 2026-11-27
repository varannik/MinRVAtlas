import "server-only";

import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { S3Client } from "@aws-sdk/client-s3";

import type { SessionPayload } from "@/lib/auth/session";
import { cortexEnv, currentSession, describeFailure, projectDynamo, projectS3, projectsFor } from "@/lib/cortex/intake.server";
import { CORTEX_ID, canUploadAs } from "@/lib/cortex/uploads";
import { resolveOwnedProject } from "@/lib/registries/server";
import type { Project } from "@/lib/types";
import { verificationEnv, type StoredVerification, type VerificationEnv } from "./store.server";
import type { VerificationView } from "./types";

/**
 * Shared by the verification routes: who is asking, and the project as they may see
 * it, with clients limited to that project's partition and prefix (Cortex tenant
 * session). An outside verifier holds a grant on the projects they review.
 */

export const NO_STORE = { "cache-control": "private, no-store" };

export function refuse(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: NO_STORE });
}

export function failed(error: unknown, what: string) {
  const failure = describeFailure(error);
  if (failure.status >= 500) console.error(what, (error as Error)?.name);
  return refuse(failure.message, failure.status);
}

/** The supplier's side files the submission; verifiers and platform admins review it. */
export function canFile(role: string): boolean {
  return canUploadAs(role);
}

export function canReview(role: string): boolean {
  return role === "verifier" || role === "platform_admin";
}

export interface VerificationContext {
  session: SessionPayload;
  env: VerificationEnv;
  project: Project;
  dynamo: DynamoDBClient;
  s3: S3Client;
}

export function emptyView(reason: string): VerificationView {
  return { available: false, reason, index: null, pieces: [], files: [], filings: [], canFile: false, canReview: false };
}

export async function verificationContext(projectId: string): Promise<{ failure: Response } | { unavailable: VerificationView } | VerificationContext> {
  const session = await currentSession();
  if (!session) return { failure: refuse("Unauthorized", 401) };
  const cortex = cortexEnv();
  const env = verificationEnv();
  if (!cortex || !env) return { unavailable: emptyView("Verification is not set up on this deployment.") };
  const project = CORTEX_ID.test(projectId) ? await resolveOwnedProject(session.tenantId, projectId) : null;
  if (!project) return { failure: refuse("Unknown project", 404) };
  const { tenantStatus, projects } = await projectsFor(session, cortex);
  if (tenantStatus !== "active") return { unavailable: emptyView("Verification runs for organisations set up on Cortex.") };
  if (!projects.some((item) => item.id === projectId)) return { failure: refuse("You have no access to that project.", 403) };
  const [dynamo, s3] = await Promise.all([projectDynamo(session, cortex, projectId), projectS3(session, cortex, projectId)]);
  return { session, env, project, dynamo, s3 };
}

export function view(stored: StoredVerification, context: VerificationContext): VerificationView {
  return {
    available: true,
    project: { id: context.project.id, name: context.project.name, registry: context.project.registry },
    ...stored,
    canFile: canFile(context.session.role),
    canReview: canReview(context.session.role),
  };
}
