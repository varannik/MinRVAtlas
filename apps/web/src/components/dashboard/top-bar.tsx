"use client";

import { useState } from "react";
import Link from "next/link";
import { Boxes, Building2, Check, ChevronDown, Search, ShieldCheck } from "lucide-react";
import { PROJECTS, REGISTRIES } from "@/lib/projects";
import { TENANTS, getTenant } from "@/lib/tenants";
import { useDashboard } from "@/store/dashboard-store";

function TenantSwitcher() {
  const [open, setOpen] = useState(false);
  const tenantId = useDashboard((state) => state.tenantId);
  const setTenant = useDashboard((state) => state.setTenant);
  const tenant = getTenant(tenantId);

  return (
    <div className="relative">
      <div className="glass flex items-center gap-3 rounded-2xl px-4 py-2.5">
        <span
          className="grid size-9 place-items-center rounded-xl ring-1"
          style={{
            background: `${tenant.accent}1f`,
            color: tenant.accent,
            boxShadow: `inset 0 0 0 1px ${tenant.accent}33`,
          }}
        >
          <Boxes className="size-5" />
        </span>

        <div className="leading-tight">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight">
              dMRV Atlas
            </span>
            <span className="hidden text-[10px] text-mist xl:inline">
              Carbon portfolio control room
            </span>
          </div>

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="mt-0.5 flex items-center gap-1.5 text-mist transition-colors hover:text-frost"
          >
            <Building2 className="size-3" />
            <span className="text-[11px] font-medium text-frost">
              {tenant.name}
            </span>
            <span
              className="rounded-full px-1.5 py-px text-[9px] font-semibold"
              style={{ background: `${tenant.accent}1f`, color: tenant.accent }}
            >
              {tenant.plan}
            </span>
            <ChevronDown
              className={`size-3 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      </div>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close workspace menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="glass absolute top-full left-0 z-20 mt-2 w-72 overflow-hidden rounded-2xl p-1.5 shadow-2xl">
            <div className="px-2.5 py-1.5 text-[10px] tracking-[0.14em] text-mist uppercase">
              Workspaces
            </div>
            {TENANTS.map((option) => {
              const active = option.id === tenantId;
              const count = PROJECTS.filter(
                (project) => project.tenantId === option.id,
              ).length;

              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setTenant(option.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                    active ? "bg-ink-700" : "hover:bg-ink-800"
                  }`}
                >
                  <span
                    className="grid size-7 shrink-0 place-items-center rounded-lg text-[10px] font-bold"
                    style={{
                      background: `${option.accent}1f`,
                      color: option.accent,
                    }}
                  >
                    {option.short}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-frost">
                      {option.name}
                    </span>
                    <span className="block text-[10px] text-mist">
                      {option.plan} · {count} project{count === 1 ? "" : "s"} ·{" "}
                      {option.seats} seats
                    </span>
                  </span>
                  {active ? (
                    <Check
                      className="size-3.5 shrink-0"
                      style={{ color: option.accent }}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function TopBar() {
  const query = useDashboard((state) => state.query);
  const setQuery = useDashboard((state) => state.setQuery);
  const registryFilter = useDashboard((state) => state.registryFilter);
  const setRegistryFilter = useDashboard((state) => state.setRegistryFilter);

  const filters = ["all", ...REGISTRIES] as const;

  return (
    <header className="pointer-events-auto flex items-start gap-4 px-5 py-3">
      <TenantSwitcher />

      <label className="glass mt-1 flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl px-4 py-2.5 md:max-w-sm">
        <Search className="size-4 shrink-0 text-mist" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search project, country or methodology"
          className="w-full bg-transparent text-sm text-frost placeholder:text-mist/70 focus:outline-none"
        />
      </label>

      <div className="glass mt-1 hidden items-center gap-1 rounded-2xl p-1.5 lg:flex">
        {filters.map((filter) => {
          const active = registryFilter === filter;
          return (
            <button
              key={filter}
              type="button"
              onClick={() => setRegistryFilter(filter)}
              className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "bg-carbon-400/15 text-carbon-400 ring-1 ring-carbon-400/30"
                  : "text-mist hover:text-frost"
              }`}
            >
              {filter === "all" ? "All registries" : filter}
            </button>
          );
        })}
      </div>

      <Link
        href="/quality"
        className="glass mt-1 ml-auto hidden items-center gap-2 rounded-2xl px-3.5 py-2.5 text-xs font-medium text-mist transition-colors hover:text-frost sm:flex"
      >
        <ShieldCheck className="size-3.5 text-carbon-400" />
        Quality
      </Link>

      <div className="glass mt-1 hidden items-center gap-2 rounded-2xl px-3.5 py-2.5 sm:flex">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-carbon-400/70" />
          <span className="relative inline-flex size-2 rounded-full bg-carbon-400" />
        </span>
        <span className="text-[11px] font-medium tracking-wide text-mist">
          Telemetry live
        </span>
      </div>
    </header>
  );
}
