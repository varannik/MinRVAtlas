"use client";

import Link from "next/link";
import { ArrowLeft, BookOpen, LogOut, Building2, MapPin, Search, Settings2 } from "lucide-react";
import { Globe3DMark } from "./globe-back-button";
import { RegistrySelect } from "./registry-select";
import { SubmissionChain } from "./submission-chain";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useProjectDefinition } from "@/hooks/use-project-definition";
import { earliestAllowedPeriodStart } from "@/lib/period-desk";
import { latestDesignDate } from "@/lib/project-definition";
import { getTenant } from "@/lib/tenants";
import { useDashboard } from "@/store/dashboard-store";
import { useStage } from "@/store/stage-store";
import type { Project, SubmissionBatch } from "@/lib/types";

/** Way into Certify project setup (design, sites, feedstocks, measurements). */
function SetupButton({ project }: { project: Project }) {
  const { definition, loading } = useProjectDefinition(project);
  const openSetup = useDashboard((state) => state.openSetup);
  if (project.registry !== "Isometric") return null;
  const sealed = Boolean(definition?.complete);
  const status = loading ? "Reading Certify…" : sealed ? "Design complete" : "Design incomplete";
  return (
    <button
      type="button"
      onClick={() => openSetup("design")}
      title={`Project setup — ${status}`}
      className="glass flex h-12 items-center gap-1.5 rounded-2xl px-3 text-[11px] font-semibold text-frost hover:text-carbon-400"
    >
      <Settings2 className="size-3.5" />
      Setup
      {!loading ? <span className={`size-1.5 rounded-full ${sealed ? "bg-carbon-400" : "bg-canyon"}`} aria-hidden /> : null}
    </button>
  );
}
function SpecOriginBadge() {
  const meta = useDashboard((state) => state.specMeta);
  if (!meta) return null;
  const live = meta.origin === "registry-api";
  return (
    <span
      title={
        live
          ? "Monitoring requirements from Isometric Certify"
          : meta.message || meta.fallbackReason || "Bundled rulebook"
      }
      className={`rounded px-1 py-px text-[8px] font-bold tracking-wide ${
        live ? "bg-carbon-400/15 text-carbon-400" : "bg-ink-700 text-mist"
      }`}
    >
      {live ? "LIVE" : "BUNDLED"}
    </span>
  );
}

/* ── Identity box (left) ────────────────────────────────────────── */

function TenantMark({ project }: { project?: Project | null }) {
  const tenantId = useDashboard((state) => state.tenantId);
  const tenant = getTenant(tenantId);
  const user = useCurrentUser();
  const selectProject = useDashboard((state) => state.selectProject);

  /* ── Project-selected state ── */
  if (project) {
    return (
      <button
        type="button"
        onClick={() => selectProject(null)}
        aria-label="Back to world map"
        title="Back to world map"
        className="glass flex h-12 items-center gap-2.5 rounded-2xl px-3 text-left transition-shadow hover:ring-2 hover:ring-carbon-400/30"
      >
        <span className="shrink-0 scale-75">
          <Globe3DMark />
        </span>

        <div className="leading-tight">
          <div className="max-w-40 truncate text-[13px] font-semibold tracking-tight">
            {project.name}
          </div>
          <div className="mt-px flex items-center gap-1.5 text-mist">
            <MapPin className="size-3" />
            <span className="text-[11px] font-medium text-frost">
              {project.country}
            </span>
            <span className="text-[9px] text-mist">·</span>
            <span className="text-[10px] text-mist">{project.registry}</span>
            <SpecOriginBadge />
          </div>
        </div>
      </button>
    );
  }

  /* ── Map state (default): who is signed in, for which tenant ── */
  const initials = (user?.name ?? user?.email ?? "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <div className="glass flex h-12 items-center gap-2.5 rounded-2xl pr-3 pl-1.5">
      <span
        className="grid size-9 shrink-0 place-items-center rounded-xl text-[11px] font-bold"
        style={{
          background: `${tenant.accent}1f`,
          color: tenant.accent,
          boxShadow: `inset 0 0 0 1px ${tenant.accent}33`,
        }}
        aria-hidden
      >
        {tenant.short}
      </span>
      <div className="leading-tight">
        <div className="flex items-center gap-1.5">
          <Building2 className="size-3 text-mist" />
          <span className="text-[13px] font-semibold tracking-tight">{tenant.name}</span>
          <code className="rounded bg-ink-700 px-1 py-px text-[9.5px] font-semibold text-mist" title="Tenant id">
            {tenant.id}
          </code>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-mist">
          <span className="grid size-4 place-items-center rounded-full bg-ink-700 text-[8px] font-bold text-frost">
            {initials}
          </span>
          <span className="max-w-52 truncate font-medium text-frost" title={user?.email}>
            {user ? (user.name ?? user.email) : "Signing in…"}
          </span>
          {user?.role ? <span className="text-[10px]">· {user.role}</span> : null}
        </div>
      </div>
    </div>
  );
}

function PeriodRibbon({
  project,
  batches,
  activeBatchId,
}: {
  project: Project;
  batches: SubmissionBatch[];
  activeBatchId: string | null;
}) {
  const { definition } = useProjectDefinition(project);
  const notBefore = earliestAllowedPeriodStart(
    {
      ...project,
      createdOn: project.createdOn ?? definition?.createdOn ?? undefined,
    },
    latestDesignDate(definition?.artifacts ?? []),
  );
  return (
    <div className="pointer-events-none absolute inset-x-5 inset-y-0 z-0 flex items-center justify-center">
      <SubmissionChain
        batches={batches}
        activeId={activeBatchId}
        notBefore={notBefore}
        tenantId={project.tenantId}
      />
    </div>
  );
}

/* ── Top Bar ────────────────────────────────────────────────────── */

export function TopBar({
  project,
  batches,
  activeBatchId,
  stageMode = false,
  onBackToStage,
}: {
  project?: Project | null;
  batches?: SubmissionBatch[] | null;
  activeBatchId?: string | null;
  /** The project stage is showing; it has its own block chain. */
  stageMode?: boolean;
  onBackToStage?: () => void;
}) {
  const query = useDashboard((state) => state.query);
  const setQuery = useDashboard((state) => state.setQuery);
  const deskOpen = useStage((state) => state.deskOpen);
  const onMap = !project;

  return (
    <header className="pointer-events-auto relative flex h-16 items-center px-5">
      {/* Left cluster */}
      <div className="relative z-10 flex h-12 items-center gap-3">
        <TenantMark project={project} />
        {project && deskOpen && onBackToStage ? (
          <button
            type="button"
            onClick={onBackToStage}
            title="Back to the removal ledger"
            className="glass flex h-12 items-center gap-1.5 rounded-2xl px-3 text-[11px] font-semibold text-frost hover:text-carbon-400"
          >
            <ArrowLeft className="size-3.5" />
            Ledger
          </button>
        ) : null}
        {project ? <SetupButton project={project} /> : null}
        {onMap ? <RegistrySelect /> : null}
      </div>

      {/* Center slot */}
      {onMap ? (
        <div className="pointer-events-none absolute inset-x-5 inset-y-0 z-0 flex items-center justify-center">
          <label className="glass pointer-events-auto flex h-12 w-full max-w-md items-center gap-2.5 rounded-2xl px-4">
            <Search className="size-4 shrink-0 text-mist" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search project, country or methodology"
              className="w-full bg-transparent text-sm text-frost placeholder:text-mist/70 focus:outline-none"
            />
          </label>
        </div>
      ) : project && !stageMode ? (
        <PeriodRibbon
          project={project}
          batches={batches ?? []}
          activeBatchId={activeBatchId ?? null}
        />
      ) : null}

      {/* Right cluster */}
      <div className="relative z-10 ml-auto flex h-12 items-center gap-3">
        <Link
          href="/manual"
          className="glass flex h-12 items-center gap-2 rounded-2xl px-3 text-xs font-medium text-mist transition-colors hover:text-frost sm:px-4"
        >
          <BookOpen className="size-3.5 text-carbon-400" />
          Guide
        </Link>
        <a
          href="/auth/logout"
          title="Sign out"
          aria-label="Sign out"
          className="glass grid h-12 w-12 place-items-center rounded-2xl text-mist transition-colors hover:text-frost"
        >
          <LogOut className="size-3.5" />
        </a>

        <div
          className="glass hidden h-12 w-12 place-items-center rounded-2xl sm:grid"
          title="Telemetry live"
          aria-label="Telemetry live"
        >
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-carbon-400/70" />
            <span className="relative inline-flex size-2 rounded-full bg-carbon-400" />
          </span>
        </div>
      </div>
    </header>
  );
}
