"use client";

import type { ReactNode } from "react";
import { Boxes, CircleCheck, Leaf, Sprout, X, type LucideIcon } from "lucide-react";
import { PALETTE } from "@/lib/brand";
import { formatArea, formatCompact, formatNumber } from "@/lib/format";
import { issuedShare, lifetimeForecast, portfolioMetrics } from "@/lib/portfolio-metrics";
import { STATUS_META } from "@/lib/projects";
import { useVisibleProjects } from "@/hooks/use-visible-projects";
import { useDashboard } from "@/store/dashboard-store";
import type { Project } from "@/lib/types";
import { ProjectActions } from "./project-actions";

const LABEL = "text-[10.5px] font-semibold tracking-[0.14em] text-strata-700 uppercase";

/* One colour per figure, following the carbonation path from forecast to retired. */
const TONE = {
  projects: PALETTE.strata700,
  forecast: PALETTE.serpentine500,
  issued: PALETTE.olivine500,
  retired: PALETTE.olivine800,
} as const;

function Metric({
  icon: Icon,
  accent,
  label,
  value,
  unit,
  detail,
}: {
  icon: LucideIcon;
  accent: string;
  label: string;
  value: string;
  unit?: string;
  detail?: ReactNode;
}) {
  return (
    <div className="glass-card rounded-2xl px-4 py-3.5">
      <div className="flex items-center gap-2 text-[10.5px] font-semibold tracking-[0.12em] text-strata-700 uppercase">
        <span
          className="grid size-6 shrink-0 place-items-center rounded-full"
          style={{ background: `color-mix(in oklab, ${accent} 16%, transparent)`, color: accent }}
        >
          <Icon className="size-3.5" />
        </span>
        {label}
      </div>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="text-[26px] leading-none font-semibold tracking-tight text-earth tabular-nums">{value}</span>
        {unit ? <span className="text-[11px] font-medium text-strata-700">{unit}</span> : null}
      </p>
      {detail ? <div className="mt-1.5 text-[11px] text-strata-700">{detail}</div> : null}
    </div>
  );
}

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-strata-300/45">
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, value)}%`, background: color }} />
    </div>
  );
}

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
const pctText = (value: number) => (value > 0 && value < 1 ? "<1%" : `${Math.round(value)}%`);

function PortfolioView({ projects, registry }: { projects: Project[]; registry: string }) {
  const totals = portfolioMetrics(projects);
  const issuedPct = pct(totals.issued, totals.forecast);
  const retiredPct = pct(totals.retired, totals.issued);

  return (
    <>
      <div className="px-5 pt-4 pb-3">
        <p className={LABEL}>Overview</p>
        <p className="mt-1 text-[15px] font-semibold tracking-tight text-earth">
          {registry === "all" ? "All registries" : registry} portfolio
        </p>
      </div>
      <div className="space-y-2 px-3 pb-3">
        <Metric
          icon={Boxes}
          accent={TONE.projects}
          label="Projects"
          value={formatNumber(totals.projects)}
          detail={
            totals.projects > 0
              ? Object.entries(
                  projects.reduce<Record<string, number>>((counts, project) => {
                    counts[project.status] = (counts[project.status] ?? 0) + 1;
                    return counts;
                  }, {}),
                )
                  .map(([status, count]) => `${count} ${STATUS_META[status as Project["status"]].label.toLowerCase()}`)
                  .join(" · ")
              : "No projects for this registry"
          }
        />
        <Metric
          icon={Sprout}
          accent={TONE.forecast}
          label="Forecast removals"
          value={formatCompact(totals.forecast)}
          unit="tCO₂e"
          detail={`${formatCompact(totals.annualForecast)} tCO₂e / yr over crediting periods`}
        />
        <Metric
          icon={Leaf}
          accent={TONE.issued}
          label="Credits issued"
          value={formatCompact(totals.issued)}
          unit="tCO₂e"
          detail={
            <>
              {pctText(issuedPct)} of forecast
              <Bar value={issuedPct} color={TONE.issued} />
            </>
          }
        />
        <Metric
          icon={CircleCheck}
          accent={TONE.retired}
          label="Credits retired"
          value={formatCompact(totals.retired)}
          unit="tCO₂e"
          detail={
            <>
              {pctText(retiredPct)} of issued
              <Bar value={retiredPct} color={TONE.retired} />
            </>
          }
        />
      </div>
      <p className="mt-auto border-t border-strata-400/25 px-5 py-2.5 text-[10.5px] leading-relaxed text-strata-700">
        Filtered by the registry selector. Select a project to see its figures.
      </p>
    </>
  );
}

function ProjectView({ project }: { project: Project }) {
  const focusProject = useDashboard((state) => state.focusProject);
  const status = STATUS_META[project.status];
  const forecast = lifetimeForecast(project);
  const issuedPct = issuedShare(project);
  const retiredPct = pct(project.creditsRetired, project.creditsIssued);

  return (
    <>
      <div className="px-5 pt-4 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={`flex flex-wrap items-center gap-1.5 ${LABEL}`}>
              {project.registry}
              <span className="text-strata-400">·</span>
              <span className="inline-flex items-center gap-1" style={{ color: status.color }}>
                <span className="size-1.5 rounded-full" style={{ background: status.color }} />
                {status.label}
              </span>
            </p>
            <p className="mt-1 text-[15px] leading-snug font-semibold tracking-tight text-earth">{project.name}</p>
            <p className="mt-0.5 text-[11.5px] text-strata-700">
              {project.region}, {project.country} · {formatArea(project.hectares)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => focusProject(null)}
            aria-label="Back to portfolio overview"
            title="Back to portfolio overview"
            className="grid size-8 shrink-0 place-items-center rounded-full text-strata-700 transition-colors hover:bg-white/80 hover:text-earth focus-visible:outline-2 focus-visible:outline-olivine-500"
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-2 text-[11.5px] text-strata-700">{project.methodology}</p>
        <div className="mt-3">
          <ProjectActions project={project} />
        </div>
      </div>
      <div className="space-y-2 px-3 pb-3">
        <Metric
          icon={Sprout}
          accent={TONE.forecast}
          label="Forecast removals"
          value={formatCompact(forecast)}
          unit="tCO₂e"
          detail={`${formatCompact(project.annualForecast)} tCO₂e / yr · ${project.creditingYears} yr from ${project.creditingStart || "—"}`}
        />
        <Metric
          icon={Leaf}
          accent={TONE.issued}
          label="Credits issued"
          value={formatCompact(project.creditsIssued)}
          unit="tCO₂e"
          detail={
            <>
              {pctText(issuedPct)} of forecast · vintage {project.vintage}
              <Bar value={issuedPct} color={TONE.issued} />
            </>
          }
        />
        <Metric
          icon={CircleCheck}
          accent={TONE.retired}
          label="Credits retired"
          value={formatCompact(project.creditsRetired)}
          unit="tCO₂e"
          detail={
            <>
              {pctText(retiredPct)} of issued
              <Bar value={retiredPct} color={TONE.retired} />
            </>
          }
        />
        <dl className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
          <div className="glass-well rounded-xl px-3 py-2">
            <dt className="text-strata-700">Live sensors</dt>
            <dd className="mt-0.5 text-[13px] font-semibold text-earth tabular-nums">{formatNumber(project.sensors)}</dd>
          </div>
          <div className="glass-well rounded-xl px-3 py-2">
            <dt className="text-strata-700">Buffer</dt>
            <dd className="mt-0.5 text-[13px] font-semibold text-earth tabular-nums">{project.bufferPct}%</dd>
          </div>
        </dl>
      </div>
      <p className="mt-auto border-t border-strata-400/25 px-5 py-2.5 text-[10.5px] text-strata-700">
        Developer · {project.developer}
      </p>
    </>
  );
}

/** Right-hand overview: portfolio totals for the registry filter, or the focused project. */
export function PortfolioOverview() {
  const projects = useVisibleProjects();
  const registry = useDashboard((state) => state.registryFilter);
  const focusedProjectId = useDashboard((state) => state.focusedProjectId);
  const focused = projects.find((project) => project.id === focusedProjectId);

  return (
    <aside className="glass scroll-slim pointer-events-auto flex h-full w-80 max-w-[86vw] flex-col overflow-y-auto rounded-[26px]">
      {focused ? <ProjectView project={focused} /> : <PortfolioView projects={projects} registry={registry} />}
    </aside>
  );
}
