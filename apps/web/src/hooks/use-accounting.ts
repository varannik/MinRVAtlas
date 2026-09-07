"use client";

import { useCallback, useEffect, useState } from "react";
import {
  emptyAccounting,
  type AccountingSnapshot,
} from "@/lib/accounting";
import type { Project } from "@/lib/types";

const cache = new Map<string, AccountingSnapshot>();

function cacheKey(projectId: string, start: string, end: string): string {
  return `${projectId}:${start}:${end}`;
}

export function useAccounting(
  project: Project | undefined,
  periodStart: string | undefined,
  periodEnd: string | undefined,
) {
  const [snapshot, setSnapshot] = useState<AccountingSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!project || project.registry !== "Isometric" || !periodStart || !periodEnd) {
      setSnapshot(null);
      return;
    }
    const key = cacheKey(project.id, periodStart, periodEnd);
    setLoading(true);
    try {
      const response = await fetch(
        `/api/registry/accounting?projectId=${encodeURIComponent(project.id)}&periodStart=${encodeURIComponent(periodStart)}&periodEnd=${encodeURIComponent(periodEnd)}`,
        { headers: { "x-tenant-id": project.tenantId } },
      );
      const payload = (await response.json().catch(() => null)) as
        | AccountingSnapshot
        | { error?: string }
        | null;
      if (payload && "templates" in payload) {
        cache.set(key, payload);
        setSnapshot(payload);
      } else {
        const fallback = emptyAccounting(
          payload && "error" in payload ? payload.error : "Could not load GHG accounting.",
        );
        setSnapshot(fallback);
      }
    } catch (error) {
      setSnapshot(
        emptyAccounting(
          error instanceof Error ? error.message : "Could not load GHG accounting.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [periodEnd, periodStart, project]);

  useEffect(() => {
    if (!project || !periodStart || !periodEnd) {
      setSnapshot(null);
      return;
    }
    const key = cacheKey(project.id, periodStart, periodEnd);
    const hit = cache.get(key);
    if (hit) setSnapshot(hit);
    void reload();
  }, [periodEnd, periodStart, project, reload]);

  return { snapshot, loading: loading && !snapshot, reload };
}
