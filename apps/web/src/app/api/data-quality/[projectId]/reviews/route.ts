import type { NextRequest } from "next/server";

import { isBrowserSameOrigin } from "@/lib/auth/session";
import { canUploadAs } from "@/lib/cortex/uploads";
import { NO_STORE, failed, qualityContext, refuse, runIfNeeded, view } from "@/lib/quality/route.server";
import { loadQuality, saveReview } from "@/lib/quality/store.server";
import { DECISIONS, withReview, type FindingStatus } from "@/lib/quality/types";

/**
 * A person's decision on one finding of the latest run.
 * POST { findingId, decision: "confirmed" | "dismissed" | "open", reason }
 *   Dismissing needs a reason (a planned stop, a known meter swap); it is kept with
 *   the decision and shown to everyone. A confirmed detector finding counts like a
 *   failed check. A re-run then starts, so detectors leave dismissed days out of
 *   their baselines and the stored verdict catches up.
 */

export const dynamic = "force-dynamic";

const MAX_REASON = 500;

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  if (!isBrowserSameOrigin(request)) return refuse("Cross-site request refused.", 403);
  const { projectId } = await params;
  let body: { findingId?: unknown; decision?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return refuse("The decision could not be read.", 400);
  }
  const findingId = typeof body.findingId === "string" ? body.findingId : "";
  const decision = body.decision as FindingStatus;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!/^F-[0-9a-f]{16}$/.test(findingId) || !DECISIONS.includes(decision)) return refuse("The decision could not be read.", 400);
  if (decision === "dismissed" && reason.length < 3) return refuse("Say why you are dismissing this finding.", 422);
  if (reason.length > MAX_REASON) return refuse(`Keep the reason under ${MAX_REASON} characters.`, 422);

  try {
    const context = await qualityContext(projectId);
    if ("failure" in context) return context.failure;
    if ("unavailable" in context) return refuse(context.unavailable.reason ?? "Not available.", 409);
    const { session, env, project, dynamo } = context;
    if (!canUploadAs(session.role)) return refuse("Your role can read these findings but not decide on them.", 403);

    const stored = await loadQuality(dynamo, env.table, session.tenantId, project.id);
    const finding = stored.findings.find((candidate) => candidate.id === findingId);
    if (!finding) return refuse("That finding is not in the latest run. Reload and try again.", 404);
    const review = await saveReview(dynamo, env.table, { tenantId: session.tenantId, projectId: project.id, finding, decision, reason, by: session.sub });

    let next = { ...stored, findings: stored.findings.map((candidate) => (candidate.id === findingId ? withReview(candidate, review) : candidate)) };
    try {
      const rerun = await runIfNeeded(context, true);
      next = rerun.stored;
    } catch (error) {
      // The decision is saved; the re-run can wait for the next one.
      console.error("quality re-run after decision", (error as Error)?.name);
    }
    return Response.json({ ...view(next, session), stale: false }, { headers: NO_STORE });
  } catch (error) {
    return failed(error, "quality decision");
  }
}
