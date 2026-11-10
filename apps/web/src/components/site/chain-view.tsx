"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowLeft,
  Box,
  Droplets,
  Factory,
  Layers,
  Maximize2,
  type LucideIcon,
} from "lucide-react";
import type { FlowKind, Highlight, SiteLayout, SupplyLayout } from "@/lib/site-layouts";
import type { Project } from "@/lib/types";
import { ZONE_COLOR, ZONE_LABEL } from "./site-geometry";
import { STATUS_COLOR } from "./site-objects";
import {
  DetailPanel,
  FeedstockLegend,
  LegendFooter,
  SiteLegend,
  Toggle,
  WaterLegend,
  type Detail,
} from "./site-panels";
import { SiteScene } from "./site-scene";
import { buildSubsurface, initialView, type SubsurfaceView } from "./subsurface/model";
import { FracturePanel, SubsurfacePanel, Timeline } from "./subsurface/subsurface-panel";
import { SupplyMap } from "./supply-map";
import { ROLE_COLOR, ROLE_LABEL, ROUTE_COLOR } from "./supply-style";
import {
  sensorKey,
  useSiteSensors,
  type SensorHost,
  type SensorReadings,
} from "./use-site-sensors";

type SectionId = "feedstock" | "site" | "water";
type Mode = "overview" | "expanded" | "hidden";

const SECTION_META: Record<SectionId, { title: string; icon: LucideIcon; accent: string }> = {
  feedstock: { title: "CO₂ feedstock", icon: Factory, accent: "#DF7626" },
  site: { title: "Storage site", icon: Box, accent: "#7B4FB3" },
  water: { title: "Water supply", icon: Droplets, accent: "#2F6FE0" },
};

// Overview geometry, in px: outer padding, gap between columns, header height.
const PAD = 20;
const GAP = 16;
const TOP = 84;

function columnWidth(count: number): string {
  return `calc((100% - ${PAD * 2 + GAP * (count - 1)}px) / ${count})`;
}

function panelStyle(index: number, count: number, mode: Mode): CSSProperties {
  if (mode === "expanded") {
    return { top: 0, left: 0, width: "100%", height: "100%", borderRadius: 0, zIndex: 30 };
  }
  const width = columnWidth(count);
  return {
    top: TOP,
    left: `calc(${PAD}px + ${index} * (${width} + ${GAP}px))`,
    width,
    height: `calc(100% - ${TOP + PAD}px)`,
    borderRadius: 20,
    zIndex: 10,
    opacity: mode === "hidden" ? 0 : 1,
    pointerEvents: mode === "hidden" ? "none" : undefined,
  };
}

/** Every object, plant, site and route that carries sensors, in one list. */
function sensorHosts(layout: SiteLayout): SensorHost[] {
  const chains = [layout.feedstock, layout.water].filter(Boolean) as SupplyLayout[];
  return [...layout.objects, ...chains.flatMap((chain) => [...chain.nodes, ...chain.routes])];
}

function hostsOf(chain: SupplyLayout): SensorHost[] {
  return [...chain.nodes, ...chain.routes];
}

function alertsIn(hosts: SensorHost[], readings: SensorReadings) {
  return hosts.flatMap((host) =>
    (host.sensors ?? [])
      .map((sensor) => ({ host, sensor, reading: readings[sensorKey(host.id, sensor.id)] }))
      .filter(({ reading }) => reading && reading.status !== "ok"),
  );
}

// ---------------------------------------------------------------------------
// Panel shell: a preview column that grows to full screen.

function Panel({
  id,
  index,
  count,
  mode,
  subtitle,
  highlights,
  hosts,
  readings,
  onExpand,
  children,
}: {
  id: SectionId;
  index: number;
  count: number;
  mode: Mode;
  subtitle: string;
  highlights: Highlight[];
  hosts: SensorHost[];
  readings: SensorReadings;
  onExpand: () => void;
  children: ReactNode;
}) {
  const meta = SECTION_META[id];
  const Icon = meta.icon;
  const alerts = alertsIn(hosts, readings).length;
  const stats = highlights.flatMap(({ host, sensor }) => {
    const owner = hosts.find((entry) => entry.id === host);
    const definition = owner?.sensors?.find((entry) => entry.id === sensor);
    const reading = readings[sensorKey(host, sensor)];
    return definition ? [{ key: `${host}/${sensor}`, definition, reading }] : [];
  });

  return (
    <section
      aria-label={meta.title}
      className="absolute overflow-hidden bg-[#ECE7DD] shadow-[0_10px_30px_rgba(7,8,8,0.10)] ring-1 ring-line/60 transition-[top,left,width,height,border-radius,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
      style={panelStyle(index, count, mode)}
    >
      {children}

      {mode === "overview" ? (
        <>
          <button
            type="button"
            onClick={onExpand}
            aria-label={`Open ${meta.title} full screen`}
            className="group absolute inset-0 z-10 cursor-zoom-in"
          >
            <span className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-rock/85 px-3 py-1.5 text-[11px] font-semibold text-white opacity-80 shadow transition-opacity group-hover:opacity-100">
              <Maximize2 className="size-3.5" />
              Explore full screen
            </span>
          </button>
          <div className="glass pointer-events-none absolute top-3 right-3 left-3 z-20 rounded-2xl px-3.5 py-3">
            <div className="flex items-center gap-2">
              <span
                className="grid size-7 place-items-center rounded-lg text-white"
                style={{ background: meta.accent }}
              >
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold tracking-tight text-frost">{meta.title}</p>
                <p className="truncate text-[11px] text-mist">{subtitle}</p>
              </div>
              {alerts > 0 ? (
                <span className="rounded-full bg-signal-amber px-2 py-0.5 text-[10px] font-semibold text-white">
                  {alerts} alert{alerts > 1 ? "s" : ""}
                </span>
              ) : null}
            </div>
            {stats.length > 0 ? (
              <dl className="mt-2.5 grid grid-cols-3 gap-2 border-t border-line/60 pt-2.5">
                {stats.map(({ key, definition, reading }) => (
                  <div key={key} className="min-w-0">
                    <dd className="flex items-baseline gap-1 font-mono text-[15px] font-semibold text-rock tabular-nums">
                      <span
                        className="size-1.5 shrink-0 self-center rounded-full"
                        style={{ background: reading ? STATUS_COLOR[reading.status] : "#ccc" }}
                      />
                      {reading?.text ?? "—"}
                      <span className="font-sans text-[10px] font-normal text-shale">{definition.unit}</span>
                    </dd>
                    <dt className="truncate text-[10px] text-mist">{definition.label}</dt>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

/** Top-left card while a panel is full screen. */
function ExpandedHeader({
  id,
  project,
  title,
  onBack,
}: {
  id: SectionId;
  project: Project;
  title: string;
  onBack: () => void;
}) {
  return (
    <div className="glass pointer-events-auto absolute top-5 left-5 z-50 flex items-center gap-3 rounded-2xl py-2 pr-4 pl-2">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to chain"
        title="Back to chain (Esc)"
        className="flex h-9 items-center gap-1.5 rounded-xl bg-white/80 px-2.5 text-[11.5px] font-semibold text-rock hover:bg-white"
      >
        <ArrowLeft className="size-4" />
        Chain
        <kbd className="rounded bg-ink-900 px-1 font-sans text-[9.5px] font-semibold text-mist">Esc</kbd>
      </button>
      <div>
        <p className="text-[10px] font-semibold tracking-[0.16em] text-mist uppercase">
          {SECTION_META[id].title} · {project.name}
        </p>
        <p className="text-sm font-semibold tracking-tight text-frost">{title}</p>
      </div>
    </div>
  );
}

function AlertList({
  hosts,
  readings,
  onSelect,
}: {
  hosts: SensorHost[];
  readings: SensorReadings;
  onSelect: (id: string) => void;
}) {
  const alerts = alertsIn(hosts, readings);
  if (alerts.length === 0) return null;
  return (
    <div className="glass pointer-events-auto absolute top-24 left-5 z-50 max-w-xs space-y-1 rounded-2xl p-2.5">
      {alerts.map(({ host, sensor, reading }) => (
        <button
          key={`${host.id}-${sensor.id}`}
          type="button"
          onClick={() => onSelect(host.id)}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[11px] hover:bg-white/70"
        >
          <span className="size-2 rounded-full" style={{ background: STATUS_COLOR[reading.status] }} />
          <span className="font-semibold text-rock">{sensor.label}</span>
          <span className="ml-auto font-mono font-semibold tabular-nums">
            {reading.text} {sensor.unit}
          </span>
        </button>
      ))}
    </div>
  );
}

function Legend({ children }: { children: ReactNode }) {
  return (
    <div className="glass scroll-slim pointer-events-auto absolute bottom-5 left-5 z-50 max-h-[calc(100%-7.5rem)] w-64 space-y-3 overflow-y-auto rounded-2xl p-3">
      {children}
    </div>
  );
}

const sensorCount = (hosts: SensorHost[]) => hosts.reduce((sum, host) => sum + (host.sensors?.length ?? 0), 0);

// ---------------------------------------------------------------------------
// Storage site.

const WELL_ROLE: Record<string, string> = {
  injection: "Injection well",
  observation: "Observation well",
  "shallow-aquifer": "Shallow aquifer monitoring well",
  seismic: "Seismic monitoring well",
};

function SiteSection({
  project,
  layout,
  readings,
  mode,
  onBack,
}: {
  project: Project;
  layout: SiteLayout;
  readings: SensorReadings;
  mode: Mode;
  onBack: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [subsurface, setSubsurface] = useState(false);
  const [flows, setFlows] = useState<Record<FlowKind, boolean>>({
    co2: true,
    water: true,
    injectate: true,
    power: true,
    data: true,
  });
  const sub = useMemo(() => buildSubsurface(layout), [layout]);
  const [view, setView] = useState<SubsurfaceView | null>(() => (sub ? initialView(sub.model) : null));
  const [playing, setPlaying] = useState(false);
  const updateView = useCallback(
    (next: Partial<SubsurfaceView>) => setView((current) => (current ? { ...current, ...next } : current)),
    [],
  );
  const selectFracture = useCallback(
    (index: number | null) => {
      updateView({ selectedFracture: index });
      if (index !== null) setSelectedId(null);
    },
    [updateView],
  );
  const selectObject = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      if (id !== null) updateView({ selectedFracture: null });
    },
    [updateView],
  );
  const expanded = mode === "expanded";
  const deep = expanded && subsurface && sub !== null && view !== null;

  const object = expanded ? layout.objects.find((entry) => entry.id === selectedId) : undefined;
  const placed = deep ? sub.wells.find((entry) => entry.object.id === selectedId) : undefined;
  const detail: Detail | null = object
    ? {
        hostId: object.id,
        eyebrow: ZONE_LABEL[object.zone],
        title: `${object.code ? `${object.code} · ` : ""}${object.name}`,
        color: ZONE_COLOR[object.zone],
        description: placed ? `${object.description} ${placed.well.note}` : object.description,
        sensors: object.sensors ?? [],
        facts: placed
          ? [
              ["Role", WELL_ROLE[placed.well.role]],
              ["Drilled depth", `${placed.depth} m (${placed.well.evidence})`],
              ...placed.well.intervals.map(
                (interval): [string, string] => [interval.label, `${interval.top}–${interval.base} m`],
              ),
              // One row per kind of sensor, listing every depth it sits at.
              ...[...new Set(placed.well.sensors.map((sensor) => sensor.label))].map((label): [string, string] => [
                label,
                placed.well.sensors
                  .filter((sensor) => sensor.label === label)
                  .map((sensor) => `${sensor.depth} m`)
                  .join(", "),
              ]),
            ]
          : undefined,
      }
    : null;

  return (
    <>
      <div className="absolute inset-0">
        <SiteScene
          layout={layout}
          readings={readings}
          selectedId={expanded ? selectedId : null}
          hoveredId={expanded ? hoveredId : null}
          subsurface={subsurface}
          sub={sub}
          subsurfaceView={view}
          flows={flows}
          compact={!expanded}
          paused={mode === "hidden"}
          onSelect={selectObject}
          onHover={setHoveredId}
          onSelectFracture={selectFracture}
        />
      </div>
      {expanded ? (
        <>
          <ExpandedHeader id="site" project={project} title={layout.name} onBack={onBack} />
          {sub ? (
            <div className="glass pointer-events-auto absolute top-5 right-5 z-50 flex items-center gap-1.5 rounded-2xl p-1.5">
              <Toggle
                on={subsurface}
                onClick={() => {
                  setSubsurface((value) => !value);
                  setPlaying(false);
                }}
                icon={Layers}
              >
                Subsurface
              </Toggle>
            </div>
          ) : null}
          {deep ? (
            <>
              <Legend>
                <SubsurfacePanel sub={sub} view={view} onChange={updateView} />
              </Legend>
              <Timeline sub={sub} view={view} playing={playing} onPlay={setPlaying} onChange={updateView} />
              {view.selectedFracture !== null ? (
                <FracturePanel
                  sub={sub}
                  index={view.selectedFracture}
                  t={view.t}
                  onClose={() => updateView({ selectedFracture: null })}
                />
              ) : null}
            </>
          ) : (
            <>
              <AlertList hosts={layout.objects} readings={readings} onSelect={selectObject} />
              <Legend>
                <SiteLegend
                  layout={layout}
                  flows={flows}
                  onToggleFlow={(kind) => setFlows((state) => ({ ...state, [kind]: !state[kind] }))}
                  footer={<LegendFooter sensorCount={sensorCount(layout.objects)} />}
                />
              </Legend>
            </>
          )}
          {detail && !(deep && view.selectedFracture !== null) ? (
            <DetailPanel
              detail={detail}
              readings={readings}
              assumptions={deep ? sub.model.notes : layout.assumptions}
              onClose={() => setSelectedId(null)}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Regional chains: CO₂ feedstock and water supply.

function SupplySection({
  id,
  project,
  supply,
  readings,
  mode,
  onBack,
  onOpenSite,
}: {
  id: "feedstock" | "water";
  project: Project;
  supply: SupplyLayout;
  readings: SensorReadings;
  mode: Mode;
  onBack: () => void;
  onOpenSite: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const expanded = mode === "expanded";
  const hosts = useMemo(() => hostsOf(supply), [supply]);
  const nameOf = (nodeId: string) => supply.nodes.find((node) => node.id === nodeId)?.name ?? nodeId;

  let detail: Detail | null = null;
  const node = expanded ? supply.nodes.find((entry) => entry.id === selectedId) : undefined;
  const route = expanded ? supply.routes.find((entry) => entry.id === selectedId) : undefined;
  if (node) {
    const outbound = supply.routes.find((entry) => entry.from === node.id);
    const facts: [string, string][] = [];
    if (node.address) facts.push(["Address", node.address]);
    facts.push([
      "Coordinates",
      `${node.at[0].toFixed(5)}, ${node.at[1].toFixed(5)}${node.estimated ? " (estimated)" : ""}`,
    ]);
    if (outbound) facts.push(["Route to site", `${outbound.distanceKm} km · ~${outbound.durationMin} min by road`]);
    detail = {
      hostId: node.id,
      eyebrow: ROLE_LABEL[node.role],
      title: node.name,
      color: ROLE_COLOR[node.role],
      description: node.description,
      sensors: node.sensors ?? [],
      facts,
      action: node.role === "site" ? { label: "Open storage site model", onClick: onOpenSite } : undefined,
    };
  } else if (route) {
    const facts: [string, string][] = [
      ["From", nameOf(route.from)],
      ["To", nameOf(route.to)],
      ["Road distance", `${route.distanceKm} km · ~${route.durationMin} min`],
    ];
    if (route.provider) facts.unshift(["Provider", route.provider]);
    detail = {
      hostId: route.id,
      eyebrow: route.provider ? `Transport · ${route.provider}` : "Transport",
      title: route.name ?? `${nameOf(route.from)} → ${nameOf(route.to)}`,
      color: ROUTE_COLOR[supply.commodity][route.role],
      description: route.description ?? "Road route between the two sites.",
      sensors: route.sensors ?? [],
      facts,
    };
  }

  const footer = <LegendFooter sensorCount={sensorCount(hosts)} />;

  return (
    <>
      <SupplyMap
        supply={supply}
        readings={readings}
        selectedId={expanded ? selectedId : null}
        hoveredId={expanded ? hoveredId : null}
        compact={!expanded}
        paused={mode === "hidden"}
        onSelect={setSelectedId}
        onHover={setHoveredId}
      />
      {expanded ? (
        <>
          <ExpandedHeader id={id} project={project} title={supply.name} onBack={onBack} />
          <AlertList hosts={hosts} readings={readings} onSelect={setSelectedId} />
          <Legend>
            {supply.commodity === "co2" ? (
              <FeedstockLegend supply={supply} readings={readings} footer={footer} />
            ) : (
              <WaterLegend supply={supply} readings={readings} footer={footer} />
            )}
          </Legend>
          {detail ? (
            <DetailPanel
              detail={detail}
              readings={readings}
              assumptions={supply.assumptions}
              onClose={() => setSelectedId(null)}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------

export function ChainView({
  project,
  layout,
  onClose,
}: {
  project: Project;
  layout: SiteLayout;
  onClose: () => void;
}) {
  const hosts = useMemo(() => sensorHosts(layout), [layout]);
  const readings = useSiteSensors(hosts);
  const [expanded, setExpanded] = useState<SectionId | null>(null);

  const sections = useMemo(() => {
    const list: SectionId[] = [];
    if (layout.feedstock) list.push("feedstock");
    list.push("site");
    if (layout.water) list.push("water");
    return list;
  }, [layout]);

  // Esc closes the full-screen panel before the dashboard sees it.
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

  const modeOf = (id: SectionId): Mode =>
    expanded === null ? "overview" : expanded === id ? "expanded" : "hidden";
  const back = () => setExpanded(null);
  const count = sections.length;
  const width = columnWidth(count);

  return (
    <div className="fixed inset-0 z-[70] overflow-hidden bg-off-white">
      {/* Overview header */}
      <div className="absolute inset-x-0 top-0 z-20 flex h-[84px] items-center justify-between gap-4 px-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back to project"
            title="Back to project (Esc)"
            className="glass grid size-11 place-items-center rounded-2xl text-rock hover:bg-white"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div>
            <p className="text-[10px] font-semibold tracking-[0.16em] text-mist uppercase">
              CO₂ removal chain · {project.registry} · {project.methodology}
            </p>
            <p className="text-base font-semibold tracking-tight text-frost">{project.name}</p>
          </div>
        </div>
        <p className="hidden text-[11px] text-mist md:block">
          Click a panel to explore it full screen · <span className="font-semibold">Esc</span> to go back
        </p>
      </div>

      {sections.map((id, index) => {
        const mode = modeOf(id);
        if (id === "site") {
          return (
            <Panel
              key={id}
              id={id}
              index={index}
              count={count}
              mode={mode}
              subtitle={layout.name}
              highlights={layout.highlights ?? []}
              hosts={layout.objects}
              readings={readings}
              onExpand={() => setExpanded(id)}
            >
              <SiteSection project={project} layout={layout} readings={readings} mode={mode} onBack={back} />
            </Panel>
          );
        }
        const supply = (id === "feedstock" ? layout.feedstock : layout.water)!;
        return (
          <Panel
            key={id}
            id={id}
            index={index}
            count={count}
            mode={mode}
            subtitle={supply.name}
            highlights={supply.highlights ?? []}
            hosts={hostsOf(supply)}
            readings={readings}
            onExpand={() => setExpanded(id)}
          >
            <SupplySection
              id={id}
              project={project}
              supply={supply}
              readings={readings}
              mode={mode}
              onBack={back}
              onOpenSite={() => setExpanded("site")}
            />
          </Panel>
        );
      })}

      {/* Hand-offs between columns */}
      {expanded === null
        ? sections.slice(0, -1).map((id, index) => {
            const next = sections[index + 1];
            const label =
              id === "feedstock" && next === "site"
                ? { text: "Liquid CO₂", arrow: "→", color: "#DF7626" }
                : id === "site" && next === "water"
                  ? { text: "Water", arrow: "←", color: "#2F6FE0" }
                  : null;
            if (!label) return null;
            return (
              <span
                key={`${id}-${next}`}
                className="pointer-events-none absolute z-40 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap shadow-md ring-1"
                style={{
                  top: `calc(${TOP}px + (100% - ${TOP + PAD}px) / 2)`,
                  left: `calc(${PAD}px + ${index + 1} * ${width} + ${index}  * ${GAP}px + ${GAP / 2}px)`,
                  color: label.color,
                  ["--tw-ring-color" as string]: label.color,
                }}
              >
                {label.arrow === "←" ? <span aria-hidden>{label.arrow}</span> : null}
                {label.text}
                {label.arrow === "→" ? <span aria-hidden>{label.arrow}</span> : null}
              </span>
            );
          })
        : null}

      {/* Jump between panels while one is full screen */}
      {expanded !== null ? (
        <div
          className="glass pointer-events-auto absolute bottom-5 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-2xl p-1.5"
          role="tablist"
          aria-label="Chain panels"
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
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                  active ? "bg-rock text-white" : "text-shale hover:bg-white/80"
                }`}
              >
                <Icon className="size-3.5" />
                {meta.title}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
