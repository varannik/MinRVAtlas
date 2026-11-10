"use client";

import { useEffect, useRef } from "react";
import { ArrowRight, MapPin, Plug } from "lucide-react";
import { STATUS_META } from "@/lib/projects";
import { formatCompact } from "@/lib/format";
import { issuedShare, lifetimeForecast } from "@/lib/portfolio-metrics";
import { hasConnection } from "@/lib/registries";
import { useVisibleProjects } from "@/hooks/use-visible-projects";
import { useDashboard } from "@/store/dashboard-store";

export function ProjectRail() {
  const projects = useVisibleProjects();
  const hoveredProjectId = useDashboard((state) => state.hoveredProjectId);
  const focusedProjectId = useDashboard((state) => state.focusedProjectId);
  const hoverProject = useDashboard((state) => state.hoverProject);
  const focusProject = useDashboard((state) => state.focusProject);
  const selectProject = useDashboard((state) => state.selectProject);
  const list = useRef<HTMLDivElement>(null);

  // Keep the focused card in view when it is focused from the globe.
  useEffect(() => {
    if (!focusedProjectId) return;
    list.current
      ?.querySelector(`[data-project="${CSS.escape(focusedProjectId)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedProjectId]);

  return (
    <aside className="glass pointer-events-auto flex h-full w-80 max-w-[86vw] flex-col overflow-hidden rounded-2xl">
      <div className="flex items-baseline justify-between border-b border-line/70 px-4 py-3">
        <h2 className="text-xs font-semibold tracking-[0.14em] text-mist uppercase">Projects</h2>
        <span className="tabular text-xs text-mist">
          {projects.length} project{projects.length === 1 ? "" : "s"}
        </span>
      </div>

      <div ref={list} className="scroll-slim flex-1 overflow-y-auto p-2">
        {projects.length === 0 ? (
          <p className="px-3 py-6 text-sm text-mist">
            No projects match the current filters in this workspace.
          </p>
        ) : null}

        {projects.map((project) => {
          const status = STATUS_META[project.status];
          const hovered = hoveredProjectId === project.id;
          const focused = focusedProjectId === project.id;
          const share = issuedShare(project);

          return (
            <div
              key={project.externalProjectId ?? project.id}
              data-project={project.id}
              className={`mb-1 rounded-xl transition-colors ${
                focused ? "bg-white ring-2 ring-carbon-400/50" : hovered ? "bg-ink-700/80" : "hover:bg-ink-800/70"
              }`}
            >
              <button
                type="button"
                onMouseEnter={() => hoverProject(project.id)}
                onMouseLeave={() => hoverProject(null)}
                onClick={() => focusProject(focused ? null : project.id)}
                onDoubleClick={() => selectProject(project.id)}
                aria-pressed={focused}
                className="w-full px-3 py-2.5 text-left"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm leading-snug font-medium text-frost">{project.name}</span>
                  <span
                    className="mt-1 size-2 shrink-0 rounded-full"
                    title={status.label}
                    style={{ background: status.color }}
                  />
                </div>

                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-mist">
                  <MapPin className="size-3" />
                  {project.country}
                  <span className="text-line">·</span>
                  {project.registry}
                  {hasConnection(project.tenantId, project.id, project.registry) ? (
                    <span
                      title={`Requirements read from ${project.registry} over the registry API`}
                      className="flex items-center gap-0.5 rounded bg-carbon-400/15 px-1 py-px text-[9px] font-bold text-carbon-400"
                    >
                      <Plug className="size-2.5" />
                      API
                    </span>
                  ) : null}
                  {project.origin === "isometric" ? (
                    <span
                      title="Listed from Isometric Certify with organisation credentials"
                      className="rounded bg-ink-700 px-1 py-px text-[9px] font-bold text-mist"
                    >
                      CERTIFY
                    </span>
                  ) : null}
                </div>

                {/* Issued credits against the lifetime forecast. */}
                <div className="mt-2.5 flex items-center gap-2">
                  <div
                    className="h-1 flex-1 overflow-hidden rounded-full bg-ink-600/70"
                    role="meter"
                    aria-label="Credits issued against forecast"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(share)}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(share, project.creditsIssued > 0 ? 1.5 : 0)}%`, background: status.color }}
                    />
                  </div>
                  <span className="tabular text-[11px] text-mist">
                    {share < 1 && share > 0 ? "<1" : Math.round(share)}%
                  </span>
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-mist">
                  <span className="tabular">
                    <span className="font-semibold text-frost">{formatCompact(project.creditsIssued)}</span> issued
                  </span>
                  <span className="tabular">of {formatCompact(lifetimeForecast(project))} forecast</span>
                </div>
              </button>

              {focused ? (
                <div className="px-3 pb-2.5">
                  <button
                    type="button"
                    onClick={() => selectProject(project.id)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-rock px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-earth"
                  >
                    Open project
                    <ArrowRight className="size-3.5" />
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="border-t border-line/70 px-4 py-2 text-[10px] text-mist">
        Click to focus on the map · double-click to open
      </p>
    </aside>
  );
}
