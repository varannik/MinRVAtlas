"use client";

import Link from "next/link";
import { Boxes, Building2, ChevronDown, MapPin, Search, ShieldCheck } from "lucide-react";
import { Globe3DMark } from "./globe-back-button";
import { RegistrySelect } from "./registry-select";
import { SubmissionChain } from "./submission-chain";
import { getTenant } from "@/lib/tenants";
import { useDashboard } from "@/store/dashboard-store";
import type { Project, SubmissionBatch } from "@/lib/types";

/* ── Atlas box (left) ───────────────────────────────────────────── */

function TenantMark({ project }: { project?: Project | null }) {
  const tenantId = useDashboard((state) => state.tenantId);
  const tenant = getTenant(tenantId);
  const open = useDashboard((state) => state.portfolioOpen);
  const togglePortfolio = useDashboard((state) => state.togglePortfolio);
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
          </div>
        </div>
      </button>
    );
  }

  /* ── Map state (default) ── */
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls="portfolio-drawer"
      onClick={togglePortfolio}
      className={`glass flex h-12 items-center gap-2.5 rounded-2xl px-3 text-left transition-shadow ${
        open ? "ring-2 ring-carbon-400/40" : ""
      }`}
    >
      <span
        className="grid size-8 shrink-0 place-items-center rounded-xl ring-1"
        style={{
          background: `${tenant.accent}1f`,
          color: tenant.accent,
          boxShadow: `inset 0 0 0 1px ${tenant.accent}33`,
        }}
      >
        <Boxes className="size-4" />
      </span>

      <div className="leading-tight">
        <div className="text-[13px] font-semibold tracking-tight">dMRV Atlas</div>
        <div className="mt-px flex items-center gap-1.5 text-mist">
          <Building2 className="size-3" />
          <span className="text-[11px] font-medium text-frost">{tenant.name}</span>
          <span
            className="rounded-full px-1.5 py-px text-[9px] font-semibold"
            style={{ background: `${tenant.accent}1f`, color: tenant.accent }}
          >
            {tenant.plan}
          </span>
        </div>
      </div>

      <ChevronDown
        className={`size-3.5 shrink-0 text-mist transition-transform ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
}

/* ── Top Bar ────────────────────────────────────────────────────── */

export function TopBar({
  project,
  batches,
  activeBatchId,
}: {
  project?: Project | null;
  batches?: SubmissionBatch[] | null;
  activeBatchId?: string | null;
}) {
  const query = useDashboard((state) => state.query);
  const setQuery = useDashboard((state) => state.setQuery);
  const onMap = !project;

  return (
    <header className="pointer-events-auto relative flex h-16 items-center px-5">
      {/* Left cluster */}
      <div className="relative z-10 flex h-12 items-center gap-3">
        <TenantMark project={project} />
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
      ) : batches && activeBatchId ? (
        <div className="pointer-events-none absolute inset-x-5 inset-y-0 z-0 flex items-center justify-center">
          <SubmissionChain batches={batches} activeId={activeBatchId} />
        </div>
      ) : null}

      {/* Right cluster */}
      <div className="relative z-10 ml-auto flex h-12 items-center gap-3">
        <Link
          href="/quality"
          className="glass hidden h-12 items-center gap-2 rounded-2xl px-4 text-xs font-medium text-mist transition-colors hover:text-frost sm:flex"
        >
          <ShieldCheck className="size-3.5 text-carbon-400" />
          Quality
        </Link>

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
