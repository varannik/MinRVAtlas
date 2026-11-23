"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Box, Droplets, Factory, Layers, type LucideIcon } from "lucide-react";
import type { FlowKind, SiteLayout, SupplyLayout } from "@/lib/site-layouts";
import type { Project } from "@/lib/types";
import { ZONE_COLOR, ZONE_LABEL } from "./site-geometry";
import { STATUS_COLOR } from "./site-objects";
import { DetailPanel, FeedstockLegend, LegendFooter, SiteLegend, WaterLegend, type Detail } from "./site-panels";
import { SiteScene } from "./site-scene";
import { initialView, type Subsurface, type SubsurfaceView } from "./subsurface/model";
import { FracturePanel, SubsurfacePanel, Timeline } from "./subsurface/subsurface-panel";
import { SupplyMap } from "./supply-map";
import { ROLE_COLOR, ROLE_LABEL, ROUTE_COLOR } from "./supply-style";
import { sensorKey, type SensorHost, type SensorReadings } from "./use-site-sensors";

/**
 * The live chain's four views: the two supply chains on their maps, the
 * storage site in 3D, and the rock beneath it. Each shows as a preview on its
 * floor and opens full screen with its legend, alerts and details.
 */

export type SectionId = "feedstock" | "water" | "site" | "deep";
export type Mode = "overview" | "expanded" | "hidden";
export type Depth = "surface" | "deep";

export const SECTION_META: Record<SectionId, { title: string; icon: LucideIcon; accent: string }> = {
  feedstock: { title: "CO₂ feedstock", icon: Factory, accent: "#414F1B" },
  water: { title: "Water supply", icon: Droplets, accent: "#6F663F" },
  site: { title: "Storage site", icon: Box, accent: "#576627" },
  deep: { title: "Subsurface", icon: Layers, accent: "#3B3E2F" },
};

export { sensorHosts } from "@/lib/site-layouts";

export function hostsOf(chain: SupplyLayout): SensorHost[] {
  return [...chain.nodes, ...chain.routes];
}

export function alertsIn(hosts: SensorHost[], readings: SensorReadings) {
  return hosts.flatMap((host) =>
    (host.sensors ?? [])
      .map((sensor) => ({ host, sensor, reading: readings[sensorKey(host.id, sensor.id)] }))
      .filter(({ reading }) => reading && reading.status !== "ok"),
  );
}

export const sensorCount = (hosts: SensorHost[]) => hosts.reduce((sum, host) => sum + (host.sensors?.length ?? 0), 0);

// ---------------------------------------------------------------------------
// Overlays while a view is full screen.

/** Top-left card while a view is full screen. */
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
    <div className="journey-panel pointer-events-auto absolute top-5 left-5 z-50 flex items-center gap-3 rounded-2xl py-2 pr-4 pl-2">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to the chain"
        title="Back to the chain (Esc)"
        className="flex h-9 items-center gap-1.5 rounded-xl bg-calcite/10 px-2.5 text-[11.5px] font-semibold text-calcite transition-colors hover:bg-calcite/16"
      >
        <ArrowLeft className="size-4" />
        Chain
        <kbd className="rounded bg-calcite/12 px-1 font-sans text-[9.5px] font-semibold text-sand">Esc</kbd>
      </button>
      <div>
        <p className="text-[10px] font-semibold tracking-[0.16em] text-sand uppercase">
          {SECTION_META[id].title} · {project.name}
        </p>
        <p className="text-sm font-semibold tracking-tight text-calcite">{title}</p>
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
    <div className="journey-panel pointer-events-auto absolute top-24 left-5 z-50 max-w-xs space-y-0.5 rounded-2xl p-2">
      <p className="px-2 pt-0.5 pb-1 text-[9.5px] font-semibold tracking-[0.16em] text-sand uppercase">To watch</p>
      {alerts.map(({ host, sensor, reading }) => (
        <button
          key={`${host.id}-${sensor.id}`}
          type="button"
          onClick={() => onSelect(host.id)}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[11px] text-calcite hover:bg-calcite/10"
        >
          <span className="size-2 rounded-full" style={{ background: STATUS_COLOR[reading.status] }} />
          <span className="font-semibold">{sensor.label}</span>
          <span className="ml-auto pl-2 font-mono font-semibold tabular-nums">
            {reading.text} {sensor.unit}
          </span>
        </button>
      ))}
    </div>
  );
}

function Legend({ children }: { children: ReactNode }) {
  return (
    <div className="journey-panel scroll-slim pointer-events-auto absolute bottom-5 left-5 z-50 max-h-[calc(100%-7.5rem)] w-64 space-y-3 overflow-y-auto rounded-2xl p-3">
      {children}
    </div>
  );
}

/** Above or below ground: the storage site's two floors, one switch. */
function DepthSwitch({ depth, onDepth }: { depth: Depth; onDepth: (depth: Depth) => void }) {
  const options: { id: Depth; label: string; icon: LucideIcon }[] = [
    { id: "surface", label: "Surface", icon: Box },
    { id: "deep", label: "Subsurface", icon: Layers },
  ];
  return (
    <div className="journey-panel pointer-events-auto absolute top-5 right-5 z-50 flex items-center gap-1 rounded-2xl p-1.5" role="group" aria-label="Depth">
      {options.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={depth === id}
          onClick={() => onDepth(id)}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors ${
            depth === id ? "bg-olivine-300 text-earth" : "text-calcite/80 hover:bg-calcite/10"
          }`}
        >
          <Icon className="size-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Storage site, above and below ground.

const WELL_ROLE: Record<string, string> = {
  injection: "Injection well",
  observation: "Observation well",
  "shallow-aquifer": "Shallow aquifer monitoring well",
  seismic: "Seismic monitoring well",
};

const ALL_FLOWS: Record<FlowKind, boolean> = { co2: true, water: true, injectate: true, power: true, data: true };

export function SiteSection({
  project,
  layout,
  sub,
  readings,
  depth,
  mode,
  selectedId,
  onSelect,
  onBack,
  onDepth,
}: {
  project: Project;
  layout: SiteLayout;
  sub: Subsurface | null;
  readings: SensorReadings;
  depth: Depth;
  mode: Mode;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onBack: () => void;
  onDepth: (depth: Depth) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [flows, setFlows] = useState<Record<FlowKind, boolean>>(ALL_FLOWS);
  const [view, setView] = useState<SubsurfaceView | null>(() => (sub ? initialView(sub.model) : null));
  const [playing, setPlaying] = useState(false);
  const updateView = useCallback(
    (next: Partial<SubsurfaceView>) => setView((current) => (current ? { ...current, ...next } : current)),
    [],
  );
  const selectFracture = useCallback(
    (index: number | null) => {
      updateView({ selectedFracture: index });
      if (index !== null) onSelect(null);
    },
    [onSelect, updateView],
  );
  const selectObject = useCallback(
    (id: string | null) => {
      onSelect(id);
      if (id !== null) updateView({ selectedFracture: null });
    },
    [onSelect, updateView],
  );
  const expanded = mode === "expanded";
  const below = depth === "deep" && sub !== null && view !== null;
  const deep = expanded && below;

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
          subsurface={below}
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
          <ExpandedHeader
            id={depth === "deep" ? "deep" : "site"}
            project={project}
            title={depth === "deep" ? `Under ${layout.name}` : layout.name}
            onBack={onBack}
          />
          {sub ? <DepthSwitch depth={depth} onDepth={onDepth} /> : null}
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
              onClose={() => onSelect(null)}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Regional chains: CO₂ feedstock and water supply.

export function SupplySection({
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
      action: node.role === "site" ? { label: "Open the storage site", onClick: onOpenSite } : undefined,
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
