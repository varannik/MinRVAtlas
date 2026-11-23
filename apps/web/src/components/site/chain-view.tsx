"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Box, Route } from "lucide-react";
import type { Highlight, SiteLayout } from "@/lib/site-layouts";
import { journeyHref } from "@/lib/journey/atlas";
import type { Project } from "@/lib/types";
import { FloorHeading } from "@/components/journey/floors/floor-parts";
import {
  ChainLift,
  ChainLinks,
  LivePill,
  OnSite,
  SectionCard,
  WellLog,
  type CardStat,
  type ChainFloor,
  type ChainLink,
} from "./chain-floors";
import {
  alertsIn,
  hostsOf,
  SECTION_META,
  sensorCount,
  sensorHosts,
  SiteSection,
  SupplySection,
  type Depth,
  type Mode,
  type SectionId,
} from "./chain-sections";
import { buildSubsurface } from "./subsurface/model";
import { useSiteModel } from "./use-site-model";
import { sensorKey, useSiteSensors, type SensorHost, type SensorReadings } from "./use-site-sensors";

/**
 * The live CO₂ removal chain, as floors on the Strata gradient: what reaches
 * the site (liquid CO₂ and water, on their maps), the storage site where it
 * is injected (in 3D), and the rock beneath, where the CO₂ becomes stone.
 * Dashed flows join the floors in the site's line styles. Each view is a live
 * preview that opens full screen in place.
 */

type FloorKey = "supply" | "site" | "deep";

const FLOOR_ID: Record<FloorKey, string> = {
  supply: "chain-floor-supply",
  site: "chain-floor-site",
  deep: "chain-floor-deep",
};

const FLOOR_OF: Record<SectionId, FloorKey> = { feedstock: "supply", water: "supply", site: "site", deep: "deep" };

function statsFor(highlights: Highlight[], hosts: SensorHost[], readings: SensorReadings): CardStat[] {
  return highlights.flatMap(({ host, sensor }) => {
    const definition = hosts.find((entry) => entry.id === host)?.sensors?.find((entry) => entry.id === sensor);
    if (!definition) return [];
    const reading = readings[sensorKey(host, sensor)];
    return [
      {
        key: `${host}/${sensor}`,
        label: definition.label,
        unit: definition.unit,
        text: reading?.text ?? null,
        status: reading?.status ?? null,
      },
    ];
  });
}

function goTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** The chain's bar: back to the Atlas, and which project this is. */
function ChainBar({ project, onClose }: { project: Project; onClose: () => void }) {
  return (
    <div className="journey-panel pointer-events-auto flex min-w-0 items-center gap-3 rounded-2xl py-1.5 pr-4 pl-1.5">
      <button
        type="button"
        onClick={onClose}
        aria-label="Back to the Atlas"
        title="Back to the Atlas (Esc)"
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-calcite/10 px-2.5 text-[11.5px] font-semibold transition-colors hover:bg-calcite/16"
      >
        <ArrowLeft className="size-4" />
        Atlas
      </button>
      <div className="min-w-0">
        <p className="truncate text-[10px] font-semibold tracking-[0.16em] text-sand uppercase">CO₂ removal chain · {project.registry}</p>
        <p className="truncate text-[13.5px] font-semibold tracking-tight">{project.name}</p>
      </div>
    </div>
  );
}

/** A project whose live chain has no 3D model yet: say so, and who builds it. */
function NoChainModel({ project, onClose }: { project: Project; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] overflow-hidden">
      <main className="journey-strata absolute inset-0 overflow-y-auto">
        <section
          aria-label="No 3D model yet"
          className="journey-floor journey-floor--validation grid min-h-full place-items-center px-4 pt-24 pb-16 sm:px-6"
        >
          <div className="journey-panel relative z-[2] w-full max-w-lg rounded-[24px] p-6 text-center sm:p-8">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl border-2 border-dashed border-calcite/30 text-sand">
              <Box className="size-6" />
            </span>
            <p className="mt-5 text-[10px] font-semibold tracking-[0.18em] text-sand uppercase">Live chain · {project.registry}</p>
            <h1 className="mt-1.5 text-[22px] leading-tight font-semibold tracking-tight text-calcite">No 3D model for this project yet</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-calcite/75">
              The live 3D chain of {project.name} has not been created yet: its supply, its storage site and the rock beneath it.
            </p>
            <p className="mt-4 rounded-xl bg-calcite/8 px-4 py-3 text-[13px] leading-relaxed text-calcite">
              Contact the <span className="font-semibold">MinRV admin</span> to have it built.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 items-center gap-1.5 rounded-xl bg-calcite/10 px-3 text-[12px] font-semibold text-calcite transition-colors hover:bg-calcite/16"
              >
                <ArrowLeft className="size-4" />
                Back to the Atlas
              </button>
              <Link
                href={journeyHref(project)}
                className="flex h-9 items-center gap-1.5 rounded-xl bg-olivine-300 px-3 text-[12px] font-semibold text-earth transition-colors hover:bg-olivine-200"
              >
                <Route className="size-4" />
                Open its journey
              </Link>
            </div>
          </div>
        </section>
      </main>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex p-3 sm:p-4">
        <ChainBar project={project} onClose={onClose} />
      </div>
    </div>
  );
}

/** While the model loads, or when it cannot: the chain's floor with a note on it. */
function ChainNote({ project, onClose, children }: { project: Project; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[70] overflow-hidden">
      <main className="journey-strata absolute inset-0">
        <section className="journey-floor journey-floor--validation grid h-full place-items-center px-4">
          <div className="journey-panel relative z-[2] flex items-center gap-3 rounded-full px-4 py-2 text-[12.5px]">{children}</div>
        </section>
      </main>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex p-3 sm:p-4">
        <ChainBar project={project} onClose={onClose} />
      </div>
    </div>
  );
}

/**
 * A project's live dashboard, the same on every registry: its live chain,
 * built from the 3D model stored for it, or a note that none is built yet.
 */
export function ChainView({ project, onClose }: { project: Project; onClose: () => void }) {
  const model = useSiteModel(project.id);
  if (model.status === "loading") {
    return (
      <ChainNote project={project} onClose={onClose}>
        <span className="size-2 animate-pulse rounded-full bg-olivine-300" />
        Reading the 3D model…
      </ChainNote>
    );
  }
  if (model.status === "error") {
    return (
      <ChainNote project={project} onClose={onClose}>
        <span className="size-2 rounded-full bg-[#E0A79D]" />
        {model.error}
      </ChainNote>
    );
  }
  return model.status === "ready" ? (
    <LiveChain project={project} layout={model.layout} onClose={onClose} />
  ) : (
    <NoChainModel project={project} onClose={onClose} />
  );
}

function LiveChain({
  project,
  layout,
  onClose,
}: {
  project: Project;
  layout: SiteLayout;
  onClose: () => void;
}) {
  const hosts = useMemo(() => sensorHosts(layout), [layout]);
  const readings = useSiteSensors(project.id);
  const sub = useMemo(() => buildSubsurface(layout), [layout]);
  const [expanded, setExpanded] = useState<SectionId | null>(null);
  const [siteSelected, setSiteSelected] = useState<string | null>(null);
  const [deepSelected, setDeepSelected] = useState<string | null>(null);
  const scrollRef = useRef<HTMLElement>(null);
  const [inView, setInView] = useState<Set<string>>(() => new Set([FLOOR_ID.supply, FLOOR_ID.site]));
  const [viewing, setViewing] = useState<string>(FLOOR_ID.supply);

  const sections = useMemo(() => {
    const list: SectionId[] = [];
    if (layout.feedstock) list.push("feedstock");
    if (layout.water) list.push("water");
    list.push("site");
    if (sub) list.push("deep");
    return list;
  }, [layout, sub]);

  const floors = useMemo(() => {
    const keys: { key: FloorKey; title: string; note: string }[] = [];
    if (layout.feedstock || layout.water) keys.push({ key: "supply", title: "CO₂ and water in", note: "Feedstock and water, by road" });
    keys.push({ key: "site", title: "Storage site", note: layout.name });
    if (sub) keys.push({ key: "deep", title: "Subsurface", note: "Where the CO₂ becomes stone" });
    return keys.map((entry, index): ChainFloor & { key: FloorKey } => ({
      ...entry,
      id: FLOOR_ID[entry.key],
      floor: (index + 1) as 1 | 2 | 3,
    }));
  }, [layout, sub]);
  const floorNumber = (key: FloorKey) => floors.find((entry) => entry.key === key)?.floor ?? 1;

  const links = useMemo(() => {
    const list: ChainLink[] = [];
    if (layout.feedstock) list.push({ from: "feedstock", to: "site", at: 0.28, label: "Liquid CO₂ · by tanker", color: "#414F1B" });
    if (layout.water) list.push({ from: "water", to: "site", at: 0.72, label: "Water · by tanker", color: "#6F663F", dash: "10 6" });
    if (sub) list.push({ from: "site", to: "deep", at: 0.5, label: "Carbonated water · injected", color: "#B2BE8B", dash: "4 5" });
    return list;
  }, [layout, sub]);

  // Which floors are on screen: their views run, the others pause.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const ratios = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) ratios.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
        setInView(new Set([...ratios].filter(([, ratio]) => ratio > 0).map(([id]) => id)));
        const best = [...ratios].sort((a, b) => b[1] - a[1])[0];
        if (best && best[1] > 0) setViewing(best[0]);
      },
      { root, threshold: [0, 0.15, 0.35, 0.55, 0.75] },
    );
    for (const entry of floors) {
      const node = document.getElementById(entry.id);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, [floors]);

  // Esc closes the full-screen view before the dashboard sees it.
  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setExpanded(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [expanded]);

  // The floor holding a full-screen view rises over the others, whose content
  // would otherwise paint over it (each floor's content is its own layer).
  const layer = (key: FloorKey) => (expanded && FLOOR_OF[expanded] === key ? "z-[100]" : "z-[2]");

  const modeOf = (id: SectionId): Mode =>
    expanded ? (expanded === id ? "expanded" : "hidden") : inView.has(FLOOR_ID[FLOOR_OF[id]]) ? "overview" : "hidden";
  const back = () => setExpanded(null);
  const setDepth = (depth: Depth) => setExpanded(depth === "deep" ? "deep" : "site");

  const alerts = alertsIn(hosts, readings);
  const watchFirst = () => {
    const first = alerts[0];
    if (!first) return;
    const where: FloorKey = layout.objects.some((object) => object.id === first.host.id) ? "site" : "supply";
    goTo(FLOOR_ID[where]);
  };

  const feedstock = layout.feedstock;
  const water = layout.water;
  const capture = feedstock?.nodes.find((node) => node.role === "capture")?.name;
  const plants = water?.nodes.filter((node) => node.role === "primary" || node.role === "backup").length ?? 0;
  const supplyCard = "h-[min(60svh,560px)] min-h-[380px]";

  return (
    <div className="fixed inset-0 z-[70] overflow-hidden">
      <main
        ref={scrollRef}
        className={`journey-strata scroll-slim absolute inset-0 overflow-x-clip ${expanded ? "overflow-y-hidden" : "overflow-y-auto"}`}
      >
        <div className="relative">
          {floors.some((entry) => entry.key === "supply") ? (
            <section
              id={FLOOR_ID.supply}
              aria-label={`Floor ${floorNumber("supply")}, CO₂ and water in`}
              className="journey-floor journey-floor--validation px-4 pt-24 pb-28 sm:px-6 lg:px-10 lg:pr-28"
            >
              <div className="relative z-[2]">
                <FloorHeading
                  floor={floorNumber("supply")}
                  eyebrow="what reaches the site"
                  title="CO₂ and water in"
                  sub={`Liquid CO₂ comes by tanker${capture ? ` from ${capture}` : ""}${
                    plants ? `, and water from ${plants} treatment plant${plants === 1 ? "" : "s"}` : ""
                  }. Both arrive at the storage site on the floor below. Open a map to follow the tankers.`}
                />
              </div>
              <div className={`relative mt-6 grid gap-5 lg:grid-cols-2 ${layer("supply")}`}>
                {feedstock ? (
                  <SectionCard
                    id="feedstock"
                    mode={modeOf("feedstock")}
                    subtitle={feedstock.name}
                    stats={statsFor(feedstock.highlights ?? [], hostsOf(feedstock), readings)}
                    alerts={alertsIn(hostsOf(feedstock), readings).length}
                    className={supplyCard}
                    onExpand={() => setExpanded("feedstock")}
                  >
                    <SupplySection
                      id="feedstock"
                      project={project}
                      supply={feedstock}
                      readings={readings}
                      mode={modeOf("feedstock")}
                      onBack={back}
                      onOpenSite={() => setExpanded("site")}
                    />
                  </SectionCard>
                ) : null}
                {water ? (
                  <SectionCard
                    id="water"
                    mode={modeOf("water")}
                    subtitle={water.name}
                    stats={statsFor(water.highlights ?? [], hostsOf(water), readings)}
                    alerts={alertsIn(hostsOf(water), readings).length}
                    className={supplyCard}
                    onExpand={() => setExpanded("water")}
                  >
                    <SupplySection
                      id="water"
                      project={project}
                      supply={water}
                      readings={readings}
                      mode={modeOf("water")}
                      onBack={back}
                      onOpenSite={() => setExpanded("site")}
                    />
                  </SectionCard>
                ) : null}
              </div>
            </section>
          ) : null}

          <section
            id={FLOOR_ID.site}
            aria-label={`Floor ${floorNumber("site")}, storage site`}
            className="journey-floor journey-floor--ledger px-4 pt-24 pb-28 sm:px-6 lg:px-10 lg:pr-28"
          >
            <div className={`relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem] ${layer("site")}`}>
              <div className="order-2 lg:order-1">
                <SectionCard
                  id="site"
                  mode={modeOf("site")}
                  subtitle={layout.name}
                  stats={statsFor(layout.highlights ?? [], layout.objects, readings)}
                  alerts={alertsIn(layout.objects, readings).length}
                  className="h-[min(72svh,720px)] min-h-[440px]"
                  onExpand={() => setExpanded("site")}
                >
                  <SiteSection
                    project={project}
                    layout={layout}
                    sub={sub}
                    readings={readings}
                    depth="surface"
                    mode={modeOf("site")}
                    selectedId={siteSelected}
                    onSelect={setSiteSelected}
                    onBack={back}
                    onDepth={setDepth}
                  />
                </SectionCard>
              </div>
              <div className="order-1 flex flex-col gap-5 lg:order-2">
                <FloorHeading
                  floor={floorNumber("site")}
                  eyebrow="where it is injected"
                  title="Storage site"
                  sub={`${layout.name}: the CO₂ and the water meet here, are mixed into carbonated water and injected. Open the site to see every system, flow and reading.`}
                />
                <OnSite
                  layout={layout}
                  readings={readings}
                  onOpen={(id) => {
                    setSiteSelected(id);
                    setExpanded("site");
                  }}
                />
              </div>
            </div>
          </section>

          {sub ? (
            <section
              id={FLOOR_ID.deep}
              aria-label={`Floor ${floorNumber("deep")}, subsurface`}
              className="journey-floor journey-floor--calc px-4 pt-24 pb-24 sm:px-6 lg:px-10 lg:pr-28"
            >
              <div className={`relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem] ${layer("deep")}`}>
                <div className="order-2 lg:order-1">
                  <SectionCard
                    id="deep"
                    mode={modeOf("deep")}
                    subtitle={`${sub.model.layers.length} layers · injection at ${sub.model.reservoir.top}–${sub.model.reservoir.base} m`}
                    stats={[]}
                    alerts={0}
                    dark
                    className="h-[min(76svh,760px)] min-h-[460px]"
                    onExpand={() => setExpanded("deep")}
                  >
                    <SiteSection
                      project={project}
                      layout={layout}
                      sub={sub}
                      readings={readings}
                      depth="deep"
                      mode={modeOf("deep")}
                      selectedId={deepSelected}
                      onSelect={setDeepSelected}
                      onBack={back}
                      onDepth={setDepth}
                    />
                  </SectionCard>
                </div>
                <div className="order-1 flex flex-col gap-5 lg:order-2">
                  <FloorHeading
                    floor={floorNumber("deep")}
                    dark
                    eyebrow="where the CO₂ becomes stone"
                    title="Subsurface"
                    sub="Carbonated water goes down the injection well into fractured peridotite. There the CO₂ reacts with the rock and turns into carbonate, stored for good."
                  />
                  <WellLog sub={sub} />
                </div>
              </div>
            </section>
          ) : null}

          {expanded === null ? <ChainLinks links={links} /> : null}
        </div>
      </main>

      {expanded === null ? (
        <>
          <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex items-start justify-between gap-3 p-3 sm:p-4">
            <ChainBar project={project} onClose={onClose} />
            <div className="pointer-events-auto absolute top-4 left-1/2 hidden -translate-x-1/2 md:block">
              <LivePill readings={sensorCount(hosts)} alerts={alerts.length} onWatch={watchFirst} />
            </div>
          </div>
          <div className="fixed inset-x-3 bottom-3 z-[80] flex justify-center md:hidden">
            <LivePill readings={sensorCount(hosts)} alerts={alerts.length} onWatch={watchFirst} />
          </div>
          <ChainLift floors={floors} viewing={floors.find((entry) => entry.id === viewing)?.floor ?? 1} onGo={(entry) => goTo(entry.id)} />
        </>
      ) : (
        <div
          className="journey-panel fixed bottom-5 left-1/2 z-[110] flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-2xl p-1.5"
          role="tablist"
          aria-label="Views in the chain"
        >
          {sections.map((id) => {
            const meta = SECTION_META[id];
            const Icon = meta.icon;
            const active = expanded === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setExpanded(id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                  active ? "bg-olivine-300 text-earth" : "text-calcite/80 hover:bg-calcite/10"
                }`}
              >
                <Icon className="size-3.5" />
                {meta.title}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
