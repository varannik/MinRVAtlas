"use client";

import { useEffect, useMemo, useState } from "react";

import { getRequirementSpec } from "@/lib/registries";
import type { LiveSpecMeta } from "@/lib/registries";
import type { Project, RequirementSpec } from "@/lib/types";

interface SpecResponse {
  spec: RequirementSpec;
  meta: LiveSpecMeta;
}

/**
 * Resolve a project's requirements, preferring what the registry itself says.
 *
 * The bundled rulebook renders immediately so the board never waits, then the
 * platform's own API route is asked for a live read. The browser only ever
 * talks to this app: the registry call happens machine-to-machine on the
 * server, with credentials this code cannot see.
 */
export function useRequirementSpec(project: Project | undefined) {
  const bundled = useMemo(
    () => (project ? getRequirementSpec(project) : undefined),
    [project],
  );

  // Tagged with the project it belongs to, so a stale response is ignored
  // rather than cleared on the next render.
  const [live, setLive] = useState<{
    projectId: string;
    response: SpecResponse;
  } | null>(null);

  useEffect(() => {
    if (!project) return;

    const controller = new AbortController();

    fetch(
      `/api/registry/requirements?projectId=${encodeURIComponent(project.id)}`,
      {
        headers: { "x-tenant-id": project.tenantId },
        signal: controller.signal,
      },
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: SpecResponse | null) => {
        if (payload?.spec) setLive({ projectId: project.id, response: payload });
      })
      .catch(() => {
        // The bundled spec is already on screen; a failed probe changes nothing.
      });

    return () => controller.abort();
  }, [project]);

  const resolved = project && live?.projectId === project.id ? live.response : null;

  const spec = resolved?.spec ?? bundled;
  const meta: LiveSpecMeta | undefined = project
    ? (resolved?.meta ?? { origin: "bundled", registry: project.registry })
    : undefined;

  return { spec, meta, loading: Boolean(project) && !resolved };
}
