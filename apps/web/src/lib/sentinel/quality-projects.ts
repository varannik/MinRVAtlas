import "server-only";

import { PROJECTS } from "@/lib/projects";
import { findConnection } from "@/lib/registries";
import {
  mapCertifyProjects,
  uniqueProjects,
} from "@/lib/registries/isometric/project-map";
import { listCertifyProjects } from "@/lib/registries/isometric/server";
import {
  preferredCertifyProjectId,
  resolveOrgCredentials,
} from "@/lib/registries/server";
import type { Project } from "@/lib/types";

export type QualityProjectOption = {
  id: string;
  name: string;
  registry: string;
  origin: "catalog" | "isometric";
};

function toOption(project: Project): QualityProjectOption {
  return {
    id: project.id,
    name: project.name,
    registry: project.registry,
    origin: project.origin === "isometric" ? "isometric" : "catalog",
  };
}

/** Control-room projects for Quality Console — not Sentinel's own rows. */
export async function listQualityProjects(
  tenantId: string,
): Promise<QualityProjectOption[]> {
  const catalog = PROJECTS.filter((project) => project.tenantId === tenantId);
  const connection = findConnection(tenantId, "Isometric");
  if (!connection) return uniqueProjects(catalog).map(toOption);

  const credentials = resolveOrgCredentials(connection);
  if (!credentials) return uniqueProjects(catalog).map(toOption);

  const listed = await listCertifyProjects(connection.environment, credentials);
  if (listed.nodes.length === 0) {
    return uniqueProjects(catalog).map(toOption);
  }

  const isometric = mapCertifyProjects(
    tenantId,
    listed.nodes,
    preferredCertifyProjectId(connection),
  );
  const liveIds = new Set(isometric.map((project) => project.id));
  const others = catalog.filter(
    (project) => project.registry !== "Isometric" && !liveIds.has(project.id),
  );
  return uniqueProjects([...isometric, ...others]).map(toOption);
}
