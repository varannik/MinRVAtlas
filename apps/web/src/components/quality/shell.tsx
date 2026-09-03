"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Boxes, Globe2 } from "lucide-react";

import { sentinelJson, unwrapItems } from "@/lib/sentinel/browser";
import {
  readStoredQualityProjectId,
  useQuality,
} from "@/store/quality-store";
import { isQualityNavActive, QUALITY_NAV } from "./nav";
import type { SentinelProject } from "./types";

export function QualityShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const projectId = useQuality((state) => state.projectId);
  const setProjectId = useQuality((state) => state.setProjectId);
  const [projects, setProjects] = useState<SentinelProject[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const stored = readStoredQualityProjectId();
    if (stored) setProjectId(stored);
    let cancelled = false;
    void sentinelJson<unknown>("v1/projects")
      .then((data) => {
        if (cancelled) return;
        const list = unwrapItems<SentinelProject>(data);
        setProjects(list);
        const current = stored ?? useQuality.getState().projectId;
        if (!current && list.length > 0) {
          const fujairah = list.find((project) =>
            project.name.toLowerCase().includes("fujairah"),
          );
          setProjectId((fujairah ?? list[0]).id);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "Could not load Sentinel projects",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [setProjectId]);

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
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-ink-900 px-5 py-3">
          <label className="flex min-w-0 items-center gap-2 text-xs text-mist">
            Sentinel project
            <select
              value={projectId ?? ""}
              onChange={(event) => setProjectId(event.target.value || null)}
              className="max-w-xs rounded-xl border border-line bg-ink-800 px-2.5 py-1.5 text-sm text-frost"
            >
              {projects.length === 0 ? (
                <option value="">No projects</option>
              ) : null}
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          {loadError ? (
            <span className="text-xs text-signal-rose">{loadError}</span>
          ) : (
            <span className="text-[11px] text-mist">
              Tenant fourfourone · BFF /api/sentinel · Vite UI retired
            </span>
          )}
        </header>
        <main className="scroll-slim min-h-0 flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
