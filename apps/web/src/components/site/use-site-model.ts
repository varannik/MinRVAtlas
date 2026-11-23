"use client";

import { useEffect, useState } from "react";
import type { SiteLayout } from "@/lib/site-layouts";

/**
 * A project's live 3D site model, read from /api/atlas (the Atlas table says
 * which version is live; its files come from the assets bucket).
 */

export type SiteModelState =
  | { status: "loading" }
  | { status: "none" }
  | { status: "ready"; layout: SiteLayout; version: number }
  | { status: "error"; error: string };

export function useSiteModel(projectId: string): SiteModelState {
  const [held, setHeld] = useState<{ projectId: string; state: SiteModelState } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/atlas/projects/${encodeURIComponent(projectId)}/site-model`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          layout?: SiteLayout | null;
          manifest?: { version: number } | null;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok) {
          setHeld({ projectId, state: { status: "error", error: payload.error ?? `The 3D model did not load (${response.status}).` } });
        } else if (payload.layout && payload.manifest) {
          setHeld({ projectId, state: { status: "ready", layout: payload.layout, version: payload.manifest.version } });
        } else {
          setHeld({ projectId, state: { status: "none" } });
        }
      })
      .catch(() => {
        if (!cancelled) setHeld({ projectId, state: { status: "error", error: "The 3D model did not load." } });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return held?.projectId === projectId ? held.state : { status: "loading" };
}
