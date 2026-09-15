"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Boxes, Globe2 } from "lucide-react";

import {
  bindQualityProject,
  fetchQualityProjects,
  type QualityProjectOption,
} from "@/lib/sentinel/quality-client";
import {
  readStoredQualityCatalogId,
  useQuality,
} from "@/store/quality-store";
import { isQualityNavActive, QUALITY_NAV } from "./nav";
import { Banner } from "./ui";

export function QualityShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const catalogProjectId = useQuality((state) => state.catalogProjectId);
  const projectId = useQuality((state) => state.projectId);
  const setBoundProject = useQuality((state) => state.setBoundProject);
  const clearProject = useQuality((state) => state.clearProject);
  const [projects, setProjects] = useState<QualityProjectOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bindError, setBindError] = useState<string | null>(null);
  const [binding, setBinding] = useState(false);

  const applyBind = useCallback(
    async (catalogId: string, name?: string) => {
      setBindError(null);
      setBinding(true);
      try {
        const bound = await bindQualityProject(catalogId, name);
        setBoundProject(bound.catalogProjectId, bound.sentinelProjectId, bound.name);
      } catch (error) {
        clearProject();
        setBindError(
          error instanceof Error
            ? error.message
            : "Could not connect this project to the quality engine",
        );
      } finally {
        setBinding(false);
      }
    },
    [clearProject, setBoundProject],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchQualityProjects();
        if (cancelled) return;
        setProjects(list);
        setLoaded(true);
        const stored = readStoredQualityCatalogId();
        const match = stored
          ? list.find((project) => project.id === stored)
          : undefined;
        if (!match) return;
        setBindError(null);
        setBinding(true);
        try {
          const bound = await bindQualityProject(match.id, match.name);
          if (cancelled) return;
          setBoundProject(
            bound.catalogProjectId,
            bound.sentinelProjectId,
            bound.name,
          );
        } catch (error) {
          if (cancelled) return;
          clearProject();
          setBindError(
            error instanceof Error
              ? error.message
              : "Could not connect this project to the quality engine",
          );
        } finally {
          if (!cancelled) setBinding(false);
        }
      } catch (error: unknown) {
        if (cancelled) return;
        setLoadError(
          error instanceof Error ? error.message : "Could not load projects",
        );
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clearProject, setBoundProject]);

  async function onSelectChange(catalogId: string | null) {
    if (!catalogId) {
      clearProject();
      setBindError(null);
      return;
    }
    const option = projects.find((project) => project.id === catalogId);
    await applyBind(catalogId, option?.name);
  }

  const ready = Boolean(catalogProjectId && projectId);

  return (
    <div className="fixed inset-0 z-50 flex bg-ink-950 text-frost">
      <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-ink-900">
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-4">
          <span className="grid size-8 place-items-center rounded-xl bg-carbon-400/15 text-carbon-400 ring-1 ring-carbon-400/30">
            <Boxes className="size-4" />
          </span>
          <div>
            <div className="text-sm font-semibold">Quality Console</div>
            <div className="text-[10px] tracking-wide text-mist uppercase">
              Only operator UI
            </div>
          </div>
        </div>
        <nav className="scroll-slim flex-1 overflow-y-auto px-2 py-3">
          {QUALITY_NAV.map((section) => (
            <div key={section.id} className="mb-4">
              <div className="px-2 pb-1 text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">
                {section.label}
              </div>
              {section.items.map((item) => {
                const active = isQualityNavActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`block rounded-xl px-2.5 py-1.5 text-[13px] ${
                      active
                        ? "bg-ink-800 font-medium text-carbon-400 ring-1 ring-carbon-400/30"
                        : "text-mist hover:bg-ink-800 hover:text-frost"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <Link
          href="/"
          className="flex items-center gap-2 border-t border-line px-4 py-3 text-xs text-mist hover:text-frost"
        >
          <Globe2 className="size-3.5" />
          Control room
        </Link>
        <a
          href="/auth/logout"
          className="px-4 pb-3 text-[11px] text-mist hover:text-frost"
        >
          Sign out
        </a>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-ink-900 px-5 py-3">
          <label className="flex min-w-0 items-center gap-2 text-xs text-mist">
            Project
            <select
              value={catalogProjectId ?? ""}
              onChange={(event) => {
                void onSelectChange(event.target.value || null);
              }}
              disabled={!loaded || projects.length === 0 || binding}
              className="max-w-xs rounded-xl border border-line bg-ink-800 px-2.5 py-1.5 text-sm text-frost disabled:opacity-50"
            >
              <option value="">
                {!loaded
                  ? "Loading…"
                  : projects.length === 0
                    ? "No projects"
                    : "Select a project"}
              </option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          {loadError ? (
            <span className="text-xs text-signal-rose">{loadError}</span>
          ) : binding ? (
            <span className="text-[11px] text-mist">Connecting quality engine…</span>
          ) : (
            <span className="text-[11px] text-mist">
              Tenant fourfourone · BFF /api/sentinel
            </span>
          )}
        </header>
        <main className="scroll-slim min-h-0 flex-1 overflow-auto p-6">
          {bindError ? <Banner kind="error">{bindError}</Banner> : null}
          {projects.length === 0 && loaded && !loadError ? (
            <Banner kind="info">
              No projects in this workspace. Open the control room and load a
              project before configuring quality checks.
            </Banner>
          ) : null}
          {projects.length > 0 && !ready && !binding && !bindError ? (
            <Banner kind="info">
              Select an existing project to configure rules, models, and document
              checks. Those stay empty until you seed defaults or define them.
            </Banner>
          ) : null}
          {ready ? children : null}
        </main>
      </div>
    </div>
  );
}
