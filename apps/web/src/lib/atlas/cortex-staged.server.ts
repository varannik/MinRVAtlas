import "server-only";

import type { SessionPayload } from "@/lib/auth/session";
import { CAPABILITIES, type CapabilityId, type IntakeKind } from "@/lib/cortex/capabilities";
import { CORTEX_STAGED_SK, userPk } from "./keys";
import { AtlasConflict, getDoc, putDoc } from "./store.server";

/**
 * What a person has staged for Cortex but not sent: a description of each
 * data file or set of details (never the file itself), in the Atlas table.
 */

export interface StagedItem {
  id: string;
  capabilityId: CapabilityId;
  kind: IntakeKind;
  name: string;
  size?: number;
  mime?: string;
  fields?: Record<string, string>;
  addedAt: string;
}

const MAX_ITEMS = 200;
const KINDS: IntakeKind[] = ["document", "data", "metadata"];

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;
}

/** A staged item from a request, or null when it is not one. */
export function parseStaged(raw: unknown): StagedItem | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const id = text(item.id, 80);
  const name = text(item.name, 255);
  const capabilityId = item.capabilityId as CapabilityId;
  const kind = item.kind as IntakeKind;
  if (!id || !name || !CAPABILITIES.some((capability) => capability.id === capabilityId) || !KINDS.includes(kind)) return null;
  let fields: Record<string, string> | undefined;
  if (item.fields !== undefined) {
    if (!item.fields || typeof item.fields !== "object") return null;
    fields = {};
    for (const [key, value] of Object.entries(item.fields as Record<string, unknown>).slice(0, 40)) {
      const field = text(value, 2000);
      if (text(key, 80) && field) fields[key] = field;
    }
  }
  return {
    id,
    capabilityId,
    kind,
    name,
    size: typeof item.size === "number" && item.size >= 0 ? item.size : undefined,
    mime: text(item.mime, 120),
    fields,
    addedAt: new Date().toISOString(),
  };
}

function key(session: SessionPayload) {
  return { pk: userPk(session.tenantId, session.sub), sk: CORTEX_STAGED_SK };
}

export async function listStaged(session: SessionPayload): Promise<StagedItem[]> {
  const { pk, sk } = key(session);
  return (await getDoc<{ items: StagedItem[] }>(pk, sk))?.doc.items ?? [];
}

/** Applies one change to the list, retrying if another tab changed it meanwhile. */
export async function changeStaged(session: SessionPayload, change: (items: StagedItem[]) => StagedItem[]): Promise<StagedItem[]> {
  const { pk, sk } = key(session);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stored = await getDoc<{ items: StagedItem[] }>(pk, sk);
    const items = change(stored?.doc.items ?? []).slice(0, MAX_ITEMS);
    try {
      await putDoc(pk, sk, { items }, stored?.version ?? 0);
      return items;
    } catch (error) {
      if (!(error instanceof AtlasConflict)) throw error;
    }
  }
  throw new AtlasConflict();
}
