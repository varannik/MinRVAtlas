"use client";

import type { ReactNode } from "react";
import { ArrowRight, Boxes, CircleCheck, Leaf, Sprout, X, type LucideIcon } from "lucide-react";
import { BRAND, FILL } from "@/lib/brand";
import { formatArea, formatCompact, formatNumber } from "@/lib/format";
import { issuedShare, lifetimeForecast, portfolioMetrics } from "@/lib/portfolio-metrics";
import { STATUS_META } from "@/lib/projects";
import { useVisibleProjects } from "@/hooks/use-visible-projects";
import { useDashboard } from "@/store/dashboard-store";
import type { Project } from "@/lib/types";

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
    <div className="relative overflow-hidden rounded-xl bg-white/75 px-3.5 py-3 ring-1 ring-line/60">
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} />
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold tracking-[0.12em] text-mist uppercase">
        <Icon className="size-3.5" style={{ color: accent }} />
        {label}
      </div>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="font-mono text-2xl font-semibold tracking-tight text-rock tabular-nums">{value}</span>
        {unit ? <span className="text-[11px] text-shale">{unit}</span> : null}
      </p>
      {detail ? <div className="mt-0.5 text-[11px] text-mist">{detail}</div> : null}
    </div>
  );
}

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink-600/60">
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
      <div className="border-b border-line/70 px-4 py-3">
        <p className="text-[10px] font-semibold tracking-[0.16em] text-mist uppercase">Overview</p>
        <p className="mt-0.5 text-sm font-semibold tracking-tight text-frost">
          {registry === "all" ? "All registries" : registry} portfolio
        </p>
      </div>
      <div className="space-y-2 p-3">
        <Metric
          icon={Boxes}
          accent={BRAND.shale}
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
          accent={BRAND.serpentine}
          label="Forecast removals"
          value={formatCompact(totals.forecast)}
          unit="tCO₂e"
          detail={`${formatCompact(totals.annualForecast)} tCO₂e / yr over crediting periods`}
        />
        <Metric
          icon={Leaf}
          accent={FILL.submitted}
          label="Credits issued"
          value={formatCompact(totals.issued)}
          unit="tCO₂e"
          detail={
            <>
              {pctText(issuedPct)} of forecast
              <Bar value={issuedPct} color={FILL.submitted} />
            </>
          }
        />
        <Metric
          icon={CircleCheck}
          accent={BRAND.canyon}
          label="Credits retired"
          value={formatCompact(totals.retired)}
          unit="tCO₂e"
          detail={
            <>
              {pctText(retiredPct)} of issued
              <Bar value={retiredPct} color={BRAND.canyon} />
            </>
          }
        />
      </div>
      <p className="mt-auto border-t border-line/70 px-4 py-2 text-[10px] leading-relaxed text-mist">
        Filtered by the registry selector. Select a project to see its figures.
      </p>
    </>
  );
}

function ProjectView({ project }: { project: Project }) {
  const focusProject = useDashboard((state) => state.focusProject);
  const selectProject = useDashboard((state) => state.selectProject);
  const status = STATUS_META[project.status];
  const forecast = lifetimeForecast(project);
  const issuedPct = issuedShare(project);
  const retiredPct = pct(project.creditsRetired, project.creditsIssued);

  return (
    <>
      <div className="relative border-b border-line/70 px-4 py-3">
        <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: status.color }} />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-[0.16em] text-mist uppercase">
              {project.registry} · {status.label}
            </p>
            <p className="mt-0.5 text-sm leading-snug font-semibold tracking-tight text-frost">{project.name}</p>
            <p className="mt-0.5 text-[11px] text-mist">
              {project.region}, {project.country} · {formatArea(project.hectares)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => focusProject(null)}
            aria-label="Back to portfolio overview"
            title="Back to portfolio overview"
            className="rounded-md p-1 text-mist hover:bg-white/70"
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-shale">{project.methodology}</p>
        <button
          type="button"
          onClick={() => selectProject(project.id)}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-rock px-3 py-2 text-[12px] font-semibold text-white hover:bg-earth"
        >
          Open project
          <ArrowRight className="size-3.5" />
        </button>
      </div>
      <div className="space-y-2 p-3">
        <Metric
          icon={Sprout}
          accent={BRAND.serpentine}
          label="Forecast removals"
          value={formatCompact(forecast)}
          unit="tCO₂e"
          detail={`${formatCompact(project.annualForecast)} tCO₂e / yr · ${project.creditingYears} yr from ${project.creditingStart || "—"}`}
        />
        <Metric
          icon={Leaf}
          accent={FILL.submitted}
          label="Credits issued"
          value={formatCompact(project.creditsIssued)}
          unit="tCO₂e"
          detail={
            <>
              {pctText(issuedPct)} of forecast · vintage {project.vintage}
              <Bar value={issuedPct} color={FILL.submitted} />
            </>
          }
        />
        <Metric
          icon={CircleCheck}
          accent={BRAND.canyon}
          label="Credits retired"
          value={formatCompact(project.creditsRetired)}
          unit="tCO₂e"
          detail={
            <>
              {pctText(retiredPct)} of issued
              <Bar value={retiredPct} color={BRAND.canyon} />
            </>
          }
        />
        <dl className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
          <div className="rounded-lg bg-white/60 px-2.5 py-1.5">
            <dt className="text-mist">Live sensors</dt>
            <dd className="font-semibold text-rock tabular-nums">{formatNumber(project.sensors)}</dd>
          </div>
          <div className="rounded-lg bg-white/60 px-2.5 py-1.5">
            <dt className="text-mist">Buffer</dt>
            <dd className="font-semibold text-rock tabular-nums">{project.bufferPct}%</dd>
          </div>
        </dl>
      </div>
      <p className="mt-auto border-t border-line/70 px-4 py-2 text-[10px] text-mist">Developer · {project.developer}</p>
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
    <aside className="glass pointer-events-auto flex h-full w-80 max-w-[86vw] flex-col overflow-y-auto rounded-2xl scroll-slim">
      {focused ? <ProjectView project={focused} /> : <PortfolioView projects={projects} registry={registry} />}
    </aside>
  );
}
