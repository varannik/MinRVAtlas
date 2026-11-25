import "server-only";

import type { DateRange } from "@/lib/mrv/types";
import { submitBlockReason } from "./gate";
import { qualityContext } from "./route.server";
import { loadQuality } from "./store.server";

/**
 * The submit rule (gate.ts) for the signed-in user's project, read through the Cortex
 * tenant session like every quality route. Fails closed: when the checks cannot be
 * read, the write is refused.
 */
export async function qualitySubmitBlock(projectId: string, period: DateRange | null): Promise<string | null> {
  const context = await qualityContext(projectId);
  if ("failure" in context) return "The data quality checks could not be read for this project.";
  if ("unavailable" in context) return context.unavailable.reason ?? "The data quality engine is not available.";
  const stored = await loadQuality(context.dynamo, context.env.table, context.session.tenantId, context.project.id);
  return submitBlockReason(stored.run, stored.findings, period);
}
