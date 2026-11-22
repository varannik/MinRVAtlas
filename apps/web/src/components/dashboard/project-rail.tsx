"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { MapPin, Plug, Plus } from "lucide-react";
import { STATUS_META } from "@/lib/projects";
import { formatCompact } from "@/lib/format";
import { issuedShare, lifetimeForecast } from "@/lib/portfolio-metrics";
import { hasConnection } from "@/lib/registries";
import { useVisibleProjects } from "@/hooks/use-visible-projects";
import { useDashboard } from "@/store/dashboard-store";
import { ProjectActions } from "./project-actions";
import { RegistrySwitch } from "./registry-select";

const LABEL = "text-[10.5px] font-semibold tracking-[0.14em] text-strata-700 uppercase";

/** Left menu of the Atlas: new project, the registry filter, then the projects it lets through. */
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
    <aside className="glass pointer-events-auto flex h-full w-80 max-w-[86vw] flex-col overflow-hidden rounded-[26px]">
      {/* Creating a project comes first and does not depend on the registry filter. */}
      <div className="px-2 pt-2">
        <Link
          href="/journey?project=new"
          title="Start a project and let Cortex walk you through setup"
          className="group flex items-center gap-3 rounded-2xl border border-dashed border-strata-400/70 px-3 py-2.5 transition-colors hover:border-olivine-500 hover:bg-white/55 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olivine-500"
        >
          <span className="btn-primary grid size-8 shrink-0 place-items-center rounded-full">
            <Plus className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-earth">New project</span>
            <span className="block text-[11px] text-strata-700">Cortex walks you through setup</span>
          </span>
        </Link>
      </div>

      {/* Registry: a filter for the map and the list below. */}
      <div className="px-4 pt-3 pb-4">
        <p className={`mb-2 px-1 ${LABEL}`}>Registry</p>
        <RegistrySwitch />
      </div>

      <div className="mx-4 h-px bg-strata-400/30" aria-hidden />

      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <h2 className={LABEL}>Projects</h2>
        <span className="glass-well tabular rounded-full px-2 py-0.5 text-[10.5px] font-semibold text-strata-700">
          {projects.length}
        </span>
      </div>

      <div ref={list} className="scroll-slim flex-1 overflow-y-auto px-2 pt-1 pb-2">
        {projects.length === 0 ? (
          <p className="px-3 py-6 text-sm text-strata-700">
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
              className={`mb-1 rounded-2xl transition-[background-color,box-shadow] duration-200 ${
                focused
                  ? "bg-white/85 shadow-[0_1px_2px_rgba(13,24,2,0.06),0_8px_24px_-10px_rgba(13,24,2,0.22)] ring-1 ring-olivine-300"
                  : hovered
                    ? "bg-white/55"
                    : "hover:bg-white/45"
              }`}
            >
              <button
                type="button"
                onMouseEnter={() => hoverProject(project.id)}
                onMouseLeave={() => hoverProject(null)}
                onClick={() => focusProject(focused ? null : project.id)}
                onDoubleClick={() => selectProject(project.id)}
                aria-pressed={focused}
                className="w-full rounded-2xl px-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-olivine-500"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[13.5px] leading-snug font-semibold tracking-tight text-earth">
                    {project.name}
                  </span>
                  <span
                    className="mt-px inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                    style={{
                      background: `color-mix(in oklab, ${status.color} 14%, transparent)`,
                      color: status.color,
                    }}
                  >
                    <span className="size-1.5 rounded-full" style={{ background: status.color }} />
                    {status.label}
                  </span>
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-strata-700">
                  <MapPin className="size-3" />
                  {project.country}
                  <span className="text-strata-400">·</span>
                  {project.registry}
                  {hasConnection(project.tenantId, project.id, project.registry) ? (
                    <span
                      title={`Requirements read from ${project.registry} over the registry API`}
                      className="flex items-center gap-0.5 rounded-full bg-olivine-100 px-1.5 py-px text-[9px] font-bold text-olivine-800"
                    >
                      <Plug className="size-2.5" />
                      API
                    </span>
                  ) : null}
                  {project.origin === "isometric" ? (
                    <span
                      title="Listed from Isometric Certify with organisation credentials"
                      className="rounded-full bg-strata-300/55 px-1.5 py-px text-[9px] font-bold text-strata-700"
                    >
                      CERTIFY
                    </span>
                  ) : null}
                </div>

                {/* Issued credits against the lifetime forecast. */}
                <div className="mt-3 flex items-center gap-2">
                  <div
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-strata-300/45"
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
                  <span className="tabular text-[11px] font-medium text-strata-700">
                    {share < 1 && share > 0 ? "<1" : Math.round(share)}%
                  </span>
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-strata-700">
                  <span className="tabular">
                    <span className="font-semibold text-earth">{formatCompact(project.creditsIssued)}</span> issued
                  </span>
                  <span className="tabular">of {formatCompact(lifetimeForecast(project))} forecast</span>
                </div>
              </button>

              {focused ? (
                <div className="px-3 pb-3">
                  <ProjectActions project={project} size="sm" />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="border-t border-strata-400/25 px-5 py-2.5 text-[10.5px] text-strata-700">
        Click to focus on the map · double-click to open
      </p>
    </aside>
  );
}
