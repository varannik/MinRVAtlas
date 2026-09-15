"use client";

import { X } from "lucide-react";
import { VALIDATION_STEPS } from "@/lib/registries/isometric/setup-stage";
import type { SetupTabId } from "@/lib/registries/isometric/setup-types";
import { useProjectSetup } from "@/hooks/use-project-setup";
import { useDashboard } from "@/store/dashboard-store";
import type { Project } from "@/lib/types";
import { DesignTab } from "./design-tab";
import { FeedstocksTab } from "./feedstocks-tab";
import { MeasurementsTab } from "./measurements-tab";
import { SitesTab } from "./sites-tab";

const TAB_LABEL: Record<SetupTabId, string> = {
  design: "Design",
  sites: "Storage sites",
  feedstocks: "Feedstocks",
  measurements: "Field measurements",
};

export function ProjectSetupWorkspace({ project }: { project: Project }) {
  const closeSetup = useDashboard((state) => state.closeSetup);
  const setupTab = useDashboard((state) => state.setupTab);
  const setSetupTab = useDashboard((state) => state.setSetupTab);
  const { snapshot, loading, saving, error } = useProjectSetup(project);
  const tabs = snapshot?.tabs ?? ["design", "sites"];
  const active = tabs.includes(setupTab) ? setupTab : tabs[0];
  const stage = snapshot?.stage ?? "draft";
  const locked = Boolean(snapshot?.locked);
  const stageIndex = VALIDATION_STEPS.findIndex((row) => row.id === stage);

  return (
    <aside className="glass pointer-events-auto flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl">
      <header className="border-b border-line/70 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.16em] text-mist uppercase">
              Project setup
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-frost">
              Project design
            </h2>
            <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-mist">
              Fetch, edit and file Certify setup evidence for this project.
            </p>
          </div>
          <button
            type="button"
            onClick={closeSetup}
            aria-label="Close project setup"
            className="grid size-8 shrink-0 place-items-center rounded-xl text-mist hover:text-frost"
          >
            <X className="size-4" />
          </button>
        </div>

        <ol className="mt-3 flex items-center gap-2 text-[11px]">
          {VALIDATION_STEPS.map((step, index) => {
            const current = index === stageIndex;
            const done = index < stageIndex;
            return (
              <li key={step.id} className="flex items-center gap-2">
                {index > 0 ? <span className="h-px w-6 bg-line" /> : null}
                <span
                  className={`flex items-center gap-1.5 ${
                    current ? "text-frost" : done ? "text-carbon-400" : "text-mist"
                  }`}
                >
                  <span
                    className={`grid size-5 place-items-center rounded-full text-[10px] font-semibold ${
                      current
                        ? "bg-frost text-off-white"
                        : done
                          ? "bg-carbon-400/20 text-carbon-400"
                          : "bg-ink-700 text-mist"
                    }`}
                  >
                    {step.n}
                  </span>
                  {step.label}
                </span>
              </li>
            );
          })}
        </ol>
      </header>

      <nav className="flex gap-1 border-b border-line/70 px-3">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setSetupTab(tab)}
            className={`border-b-2 px-3 py-2 text-[12px] font-medium ${
              active === tab
                ? "border-carbon-400 text-frost"
                : "border-transparent text-mist hover:text-frost"
            }`}
          >
            {TAB_LABEL[tab]}
          </button>
        ))}
      </nav>

      {error ? (
        <p className="px-4 py-2 text-[12px] text-signal-rose">{error}</p>
      ) : null}
      {saving ? (
        <p className="px-4 py-1 text-[11px] text-mist">Writing to Certify…</p>
      ) : null}

      {loading && !snapshot ? (
        <p className="px-4 py-8 text-sm text-mist">Fetching Certify project setup…</p>
      ) : snapshot ? (
        active === "design" ? (
          <DesignTab project={project} snapshot={snapshot} locked={locked} />
        ) : active === "sites" ? (
          <SitesTab project={project} snapshot={snapshot} locked={locked} />
        ) : active === "feedstocks" ? (
          <FeedstocksTab project={project} snapshot={snapshot} locked={locked} />
        ) : (
          <MeasurementsTab project={project} snapshot={snapshot} locked={locked} />
        )
      ) : (
        <p className="px-4 py-8 text-sm text-mist">
          No setup data came back from Certify.
        </p>
      )}

      {snapshot?.warning ? (
        <p className="border-t border-line/70 px-4 py-2 text-[10px] leading-relaxed text-mist">
          {snapshot.warning}
        </p>
      ) : null}
    </aside>
  );
}
