"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, MapPin, Route, Search, Settings2, X } from "lucide-react";
import { AccountToolbar } from "../nav/account-toolbar";
import { Globe3DMark } from "./globe-back-button";
import { SubmissionChain } from "./submission-chain";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useProjectDefinition } from "@/hooks/use-project-definition";
import { earliestAllowedPeriodStart } from "@/lib/period-desk";
import { journeyHref } from "@/lib/journey/atlas";
import { latestDesignDate } from "@/lib/project-definition";
import { getTenant } from "@/lib/tenants";
import { useDashboard } from "@/store/dashboard-store";
import { useStage } from "@/store/stage-store";
import type { Project, SubmissionBatch } from "@/lib/types";

/** Every control in the bar is the same glass pill. */
const PILL = "glass flex h-11 items-center rounded-full";
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olivine-500";

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
      className={`${PILL} glass-hover gap-1.5 px-4 text-[11.5px] font-semibold text-earth ${FOCUS}`}
    >
      <Settings2 className="size-3.5 text-olivine-700" />
      Setup
      {!loading ? <span className={`size-1.5 rounded-full ${sealed ? "bg-olivine-500" : "bg-ochre"}`} aria-hidden /> : null}
    </button>
  );
}
/** Way into the project journey, on any registry. */
function JourneyButton({ project }: { project: Project }) {
  return (
    <Link
      href={journeyHref(project)}
      title="Where this project is on its journey"
      className={`${PILL} glass-hover gap-1.5 px-4 text-[11.5px] font-semibold text-earth ${FOCUS}`}
    >
      <Route className="size-3.5 text-olivine-700" />
      Journey
    </Link>
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
      className={`rounded-full px-1.5 py-px text-[8px] font-bold tracking-wide ${
        live ? "bg-olivine-100 text-olivine-800" : "bg-strata-300/55 text-strata-700"
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
        className={`${PILL} glass-hover gap-2 pr-4 pl-1.5 text-left ${FOCUS}`}
      >
        <span className="shrink-0 scale-75">
          <Globe3DMark />
        </span>

        <div className="leading-tight">
          <div className="max-w-40 truncate text-[13px] font-semibold tracking-tight text-earth">
            {project.name}
          </div>
          <div className="mt-px flex items-center gap-1.5 text-strata-700">
            <MapPin className="size-3" />
            <span className="text-[11px] font-medium text-earth">
              {project.country}
            </span>
            <span className="text-[9px] text-strata-400">·</span>
            <span className="text-[10px]">{project.registry}</span>
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
    <div className={`${PILL} gap-2.5 pr-4 pl-1`}>
      <span
        className="grid size-9 shrink-0 place-items-center rounded-full text-[10px] font-bold tracking-tight text-calcite shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
        style={{ background: "linear-gradient(in oklab 140deg, #0d1802 0%, #414f1b 58%, #8b9c44 125%)" }}
        aria-hidden
      >
        {tenant.short}
      </span>
      <div className="leading-tight">
        <div className="flex items-center gap-1.5">
          <Building2 className="size-3 text-strata-700" />
          <span className="text-[13px] font-semibold tracking-tight text-earth">{tenant.name}</span>
          <code className="rounded-full bg-strata-300/45 px-1.5 py-px text-[9.5px] font-semibold text-strata-700" title="Tenant id">
            {tenant.id}
          </code>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-strata-700">
          <span className="grid size-4 place-items-center rounded-full bg-olivine-100 text-[8px] font-bold text-olivine-800">
            {initials}
          </span>
          <span className="max-w-52 truncate font-medium text-earth" title={user?.email}>
            {user ? (user.name ?? user.email) : "Signing in…"}
          </span>
          {user?.role ? <span className="text-[10px]">· {user.role}</span> : null}
        </div>
      </div>
    </div>
  );
}

/* ── Search (centre, map state) ─────────────────────────────────── */

const noSubscribe = () => () => {};
const shortcutLabel = () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K");

function AtlasSearch() {
  const query = useDashboard((state) => state.query);
  const setQuery = useDashboard((state) => state.setQuery);
  const input = useRef<HTMLInputElement>(null);
  const shortcut = useSyncExternalStore(noSubscribe, shortcutLabel, () => "⌘K");

  // ⌘K / Ctrl K jumps to the search from anywhere on the map.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <label className={`${PILL} glass-field pointer-events-auto w-full max-w-[540px] gap-2.5 pr-1.5 pl-4`}>
      <Search className="size-4 shrink-0 text-strata-700" />
      <input
        ref={input}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          // Escape clears the search first; the map handles it once the field is empty.
          if (event.key === "Escape" && query) {
            event.stopPropagation();
            setQuery("");
          }
        }}
        aria-label="Search projects"
        placeholder="Search project, country or methodology"
        className="h-full w-full bg-transparent text-[13.5px] text-earth placeholder:text-strata-600 focus:outline-none"
      />
      {query ? (
        <button
          type="button"
          onClick={() => {
            setQuery("");
            input.current?.focus();
          }}
          aria-label="Clear search"
          className={`grid size-8 shrink-0 place-items-center rounded-full text-strata-700 transition-colors hover:bg-white/80 hover:text-earth ${FOCUS}`}
        >
          <X className="size-3.5" />
        </button>
      ) : (
        <kbd className="glass-well hidden h-7 shrink-0 items-center rounded-full px-2.5 font-sans text-[10.5px] font-semibold text-strata-700 sm:flex">
          {shortcut}
        </kbd>
      )}
    </label>
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
  const deskOpen = useStage((state) => state.deskOpen);
  const onMap = !project;

  return (
    <header className="pointer-events-auto relative flex h-16 items-center px-5">
      {/* Left cluster */}
      <div className="relative z-10 flex h-11 items-center gap-2">
        <TenantMark project={project} />
        {project && deskOpen && onBackToStage ? (
          <button
            type="button"
            onClick={onBackToStage}
            title="Back to the removal ledger"
            className={`${PILL} glass-hover gap-1.5 px-4 text-[11.5px] font-semibold text-earth ${FOCUS}`}
          >
            <ArrowLeft className="size-3.5" />
            Ledger
          </button>
        ) : null}
        {project ? <SetupButton project={project} /> : null}
        {project ? <JourneyButton project={project} /> : null}
      </div>

      {/* Center slot */}
      {onMap ? (
        <div className="pointer-events-none absolute inset-x-5 inset-y-0 z-0 flex items-center justify-center">
          <AtlasSearch />
        </div>
      ) : project && !stageMode ? (
        <PeriodRibbon
          project={project}
          batches={batches ?? []}
          activeBatchId={activeBatchId ?? null}
        />
      ) : null}

      {/* Right cluster: one toolbar */}
      <AccountToolbar className="relative z-10 ml-auto" />
    </header>
  );
}
