"use client";

import { Boxes, MapPin, Plug } from "lucide-react";
import { STATUS_META } from "@/lib/projects";
import { formatCompact } from "@/lib/format";
import { hasConnection } from "@/lib/registries";
import { getSubmissions } from "@/lib/submissions";
import { useVisibleProjects } from "@/hooks/use-visible-projects";
import { useDashboard } from "@/store/dashboard-store";

export function ProjectRail() {
  const projects = useVisibleProjects();
  const hoveredProjectId = useDashboard((state) => state.hoveredProjectId);
  const hoverProject = useDashboard((state) => state.hoverProject);
  const selectProject = useDashboard((state) => state.selectProject);

  return (
    <aside className="glass pointer-events-auto flex h-full w-80 max-w-[86vw] flex-col overflow-hidden rounded-2xl">
      <div className="flex items-baseline justify-between border-b border-line/70 px-4 py-3">
        <h2 className="text-xs font-semibold tracking-[0.14em] text-mist uppercase">
          Portfolio
        </h2>
        <span className="tabular text-xs text-mist">
          {projects.length} project{projects.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="scroll-slim flex-1 overflow-y-auto p-2">
        {projects.length === 0 ? (
          <p className="px-3 py-6 text-sm text-mist">
            No projects match the current filters in this workspace.
          </p>
        ) : null}

        {projects.map((project) => {
          const status = STATUS_META[project.status];
          const batches = getSubmissions(project);
          const open = batches[batches.length - 1];
          const hovered = hoveredProjectId === project.id;

          return (
            <button
              key={project.id}
              type="button"
              onMouseEnter={() => hoverProject(project.id)}
              onMouseLeave={() => hoverProject(null)}
              onClick={() => selectProject(project.id)}
              className={`mb-1 w-full rounded-xl px-3 py-2.5 text-left transition-colors ${
                hovered ? "bg-ink-700/80" : "hover:bg-ink-800/70"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm leading-snug font-medium text-frost">
                  {project.name}
                </span>
                <span
                  className="mt-1 size-2 shrink-0 rounded-full"
                  style={{ background: status.color }}
                />
              </div>

              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-mist">
                <MapPin className="size-3" />
                {project.country}
                <span className="text-line">·</span>
                {project.registry}
                {hasConnection(project.tenantId, project.id) ? (
                  <span
                    title={`Requirements read from ${project.registry} over the registry API`}
                    className="flex items-center gap-0.5 rounded bg-carbon-400/15 px-1 py-px text-[9px] font-bold text-carbon-400"
                  >
                    <Plug className="size-2.5" />
                    API
                  </span>
                ) : null}
              </div>

              <div className="mt-2.5 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink-600/70">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${open.completion}%`,
                      background: status.color,
                    }}
                  />
                </div>
                <span className="tabular text-[11px] text-mist">
                  {open.completion}%
                </span>
              </div>

              <div className="mt-1.5 flex items-center justify-between text-[11px] text-mist">
                <span className="flex items-center gap-1">
                  <Boxes className="size-3" />
                  {batches.length} batch{batches.length === 1 ? "" : "es"}
                </span>
                <span className="tabular">
                  {formatCompact(project.creditsIssued)} issued
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
