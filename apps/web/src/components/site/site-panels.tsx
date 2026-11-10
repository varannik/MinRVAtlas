"use client";

import { useMemo, type ReactNode } from "react";
import { ArrowRight, Box, Truck, X, type LucideIcon } from "lucide-react";
import type {
  FlowKind,
  MeasurementType,
  SiteLayout,
  SiteSensor,
  SiteZone,
  SupplyLayout,
} from "@/lib/site-layouts";
import { FLOW_COLOR, FLOW_KINDS, FLOW_LABEL, ZONE_COLOR, ZONE_LABEL } from "./site-geometry";
import { STATUS_COLOR } from "./site-objects";
import { ROLE_COLOR, ROUTE_COLOR, TANKER_COLOR } from "./supply-style";
import { sensorKey, type SensorReading, type SensorReadings } from "./use-site-sensors";

const STATUS_TEXT = { ok: "Within range", warn: "Watch", alarm: "Out of range" } as const;

// ---------------------------------------------------------------------------
// Small pieces.

export function Toggle({
  on,
  onClick,
  icon: Icon,
  children,
}: {
  on: boolean;
  onClick: () => void;
  icon: LucideIcon;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors ${
        on ? "bg-rock text-white" : "bg-white/70 text-shale hover:bg-white"
      }`}
    >
      <Icon className="size-3.5" />
      {children}
    </button>
  );
}

export function SectionTitle({ children }: { children: string }) {
  return (
    <p className="mb-1.5 text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">{children}</p>
  );
}

const MEASUREMENT_TEXT: Record<MeasurementType, string> = {
  continuous: "Continuous measurement",
  discrete: "Discrete measurement",
  estimated: "Estimated measurement",
};

/** The block diagram's arrows: blue continuous, black discrete, slashed estimated. */
export function MeasurementGlyph({ type }: { type: MeasurementType }) {
  const stroke = type === "continuous" ? "#3BA3E0" : "#070808";
  return (
    <svg viewBox="0 0 22 10" className="h-2.5 w-5.5 shrink-0" aria-hidden>
      <line x1="1" y1="5" x2="17" y2="5" stroke={stroke} strokeWidth="1.6" />
      <path d="M15 2 L20 5 L15 8 Z" fill={stroke} />
      {type === "estimated" ? (
        <>
          <line x1="6" y1="8.5" x2="9" y2="1.5" stroke={stroke} strokeWidth="1.4" />
          <line x1="9.5" y1="8.5" x2="12.5" y2="1.5" stroke={stroke} strokeWidth="1.4" />
        </>
      ) : null}
    </svg>
  );
}

export function MeasurementKey() {
  return (
    <div>
      <SectionTitle>Measurements</SectionTitle>
      <ul className="space-y-0.5">
        {(Object.keys(MEASUREMENT_TEXT) as MeasurementType[]).map((type) => (
          <li key={type} className="flex items-center gap-2 text-[11px] text-shale">
            <MeasurementGlyph type={type} />
            {MEASUREMENT_TEXT[type].replace(" measurement", "")}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail panel, shared by every view.

export type Detail = {
  hostId: string;
  eyebrow: string;
  title: string;
  color: string;
  description: string;
  sensors: SiteSensor[];
  facts?: [string, string][];
  action?: { label: string; onClick: () => void };
};

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="text-rock">{value}</dd>
    </>
  );
}

function SensorCard({ sensor, reading }: { sensor: SiteSensor; reading?: SensorReading }) {
  const measurement = sensor.measurement ?? "continuous";
  const bands: [string, number | undefined][] = [
    ["Watch above", sensor.warnAbove],
    ["Alarm above", sensor.alarmAbove],
    ["Watch below", sensor.warnBelow],
  ];
  return (
    <article className="rounded-xl bg-white/75 px-3 py-2.5 ring-1 ring-line/60">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-rock">{sensor.label}</p>
        {reading ? (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
            style={{ background: STATUS_COLOR[reading.status] }}
          >
            {STATUS_TEXT[reading.status]}
          </span>
        ) : null}
      </div>
      <p className="mt-1 font-mono text-xl font-semibold text-rock tabular-nums">
        {reading?.text ?? "—"}
        <span className="ml-1 font-sans text-[12px] font-normal text-shale">{sensor.unit}</span>
      </p>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10.5px] text-mist">
        <dt>Measurement</dt>
        <dd className="flex items-center gap-1.5 text-rock">
          <MeasurementGlyph type={measurement} />
          {MEASUREMENT_TEXT[measurement].replace(" measurement", "")}
        </dd>
        <dt>Stream column</dt>
        <dd className="font-mono text-rock">
          {sensor.metric}
          {sensor.proposed ? <span className="ml-1 font-sans text-signal-amber">(proposed)</span> : null}
        </dd>
        {bands
          .filter(([, value]) => value !== undefined)
          .map(([label, value]) => (
            <FactRow key={label} label={label} value={`${value} ${sensor.unit}`} />
          ))}
        <dt>Source</dt>
        <dd className="text-signal-amber">Demo signal</dd>
      </dl>
    </article>
  );
}

/** Sensors in their process blocks, keeping the order they were listed in. */
function grouped(sensors: SiteSensor[]): [string | null, SiteSensor[]][] {
  const groups: [string | null, SiteSensor[]][] = [];
  for (const sensor of sensors) {
    const name = sensor.group ?? null;
    const last = groups.find(([group]) => group === name);
    if (last) last[1].push(sensor);
    else groups.push([name, [sensor]]);
  }
  return groups;
}

export function DetailPanel({
  detail,
  readings,
  assumptions,
  onClose,
}: {
  detail: Detail;
  readings: SensorReadings;
  assumptions: string[];
  onClose: () => void;
}) {
  return (
    <aside className="glass pointer-events-auto absolute top-24 right-5 bottom-5 z-50 flex w-80 flex-col overflow-hidden rounded-2xl">
      <div className="relative border-b border-line/70 px-4 py-3">
        <div className="absolute inset-y-0 left-0 w-1.5" style={{ background: detail.color }} />
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">{detail.eyebrow}</p>
            <p className="mt-0.5 text-sm font-semibold tracking-tight text-frost">{detail.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="rounded-md p-1 text-mist hover:bg-white/70"
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-shale">{detail.description}</p>
        {detail.facts?.length ? (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10.5px] text-mist">
            {detail.facts.map(([label, value]) => (
              <FactRow key={label} label={label} value={value} />
            ))}
          </dl>
        ) : null}
        {detail.action ? (
          <button
            type="button"
            onClick={detail.action.onClick}
            className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-rock px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-earth"
          >
            <Box className="size-3.5" />
            {detail.action.label}
          </button>
        ) : null}
      </div>

      <div className="scroll-slim flex-1 space-y-2 overflow-y-auto p-3">
        {detail.sensors.length === 0 ? (
          <p className="px-1 py-4 text-[12px] text-mist">No sensors mapped to this object yet.</p>
        ) : null}
        {grouped(detail.sensors).map(([group, sensors]) => (
          <section key={group ?? "_"} className="space-y-2">
            {group ? (
              <p className="px-1 pt-1 text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">{group}</p>
            ) : null}
            {sensors.map((sensor) => (
              <SensorCard
                key={sensor.id}
                sensor={sensor}
                reading={readings[sensorKey(detail.hostId, sensor.id)]}
              />
            ))}
          </section>
        ))}
        <details className="rounded-xl px-1 pt-2 text-[10.5px] leading-relaxed text-mist">
          <summary className="cursor-pointer font-semibold">How this model was made</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {assumptions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Legends.

export function LegendFooter({ sensorCount }: { sensorCount: number }) {
  return (
    <p className="border-t border-line/70 pt-2 text-[10px] leading-relaxed text-mist">
      {sensorCount} readings · <span className="font-semibold text-signal-amber">demo values</span>.
      Drag to rotate, scroll to zoom, right-drag to pan. Click an item for details.
    </p>
  );
}

export function SiteLegend({
  layout,
  flows,
  onToggleFlow,
  footer,
}: {
  layout: SiteLayout;
  flows: Record<FlowKind, boolean>;
  onToggleFlow: (kind: FlowKind) => void;
  footer: ReactNode;
}) {
  const zones = useMemo(() => {
    const seen = new Set<SiteZone>();
    for (const object of layout.objects) seen.add(object.zone);
    return [...seen];
  }, [layout]);

  return (
    <>
      <div>
        <SectionTitle>Flows</SectionTitle>
        <div className="flex flex-wrap gap-1">
          {FLOW_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={flows[kind]}
              onClick={() => onToggleFlow(kind)}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-opacity ${
                flows[kind] ? "bg-white text-rock" : "bg-white/40 text-mist opacity-60"
              }`}
            >
              <span className="h-0.5 w-3 rounded" style={{ background: FLOW_COLOR[kind] }} />
              {FLOW_LABEL[kind]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <SectionTitle>Zones</SectionTitle>
        <ul className="space-y-0.5">
          {zones.map((zone) => (
            <li key={zone} className="flex items-center gap-2 text-[11px] text-shale">
              <span className="size-2.5 rounded-sm border-2 border-dashed" style={{ borderColor: ZONE_COLOR[zone] }} />
              {ZONE_LABEL[zone]}
            </li>
          ))}
        </ul>
      </div>
      <MeasurementKey />
      {footer}
    </>
  );
}

function RouteKey({ supply }: { supply: SupplyLayout }) {
  return (
    <>
      {supply.routes.map((route) => (
        <li key={route.id} className="flex items-center gap-2">
          <span
            className={`h-0 w-4 border-t-[3px] ${route.role === "backup" ? "border-dashed" : ""}`}
            style={{ borderColor: ROUTE_COLOR[supply.commodity][route.role] }}
          />
          {route.provider ?? (route.role === "primary" ? "Primary route" : "Back-up route")} ·{" "}
          {route.distanceKm} km
        </li>
      ))}
      <li className="flex items-center gap-2">
        <Truck className="size-3.5" style={{ color: TANKER_COLOR[supply.commodity] }} />
        Tanker, loaded · <span className="text-mist">grey: returning empty</span>
      </li>
    </>
  );
}

export function WaterLegend({
  supply,
  readings,
  footer,
}: {
  supply: SupplyLayout;
  readings: SensorReadings;
  footer: ReactNode;
}) {
  const plants = supply.nodes.filter((node) => node.role === "primary" || node.role === "backup");
  const dispatched = plants.map((node) => ({
    node,
    m3: readings[sensorKey(node.id, "dispatched")]?.value ?? 0,
  }));
  const total = dispatched.reduce((sum, row) => sum + row.m3, 0);

  return (
    <>
      <div>
        <SectionTitle>Today</SectionTitle>
        <p className="font-mono text-lg font-semibold text-rock tabular-nums">
          {Math.round(total).toLocaleString("en-GB")}
          <span className="ml-1 font-sans text-[11px] font-normal text-shale">m³ dispatched</span>
        </p>
        <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-white/60">
          {dispatched.map(({ node, m3 }) => (
            <span
              key={node.id}
              style={{ width: `${total ? (m3 / total) * 100 : 0}%`, background: ROLE_COLOR[node.role] }}
            />
          ))}
        </div>
        <ul className="mt-1 space-y-0.5">
          {dispatched.map(({ node, m3 }) => (
            <li key={node.id} className="flex items-center gap-2 text-[11px] text-shale">
              <span className="size-2 rounded-full" style={{ background: ROLE_COLOR[node.role] }} />
              {node.name.replace(/ Treatment Plant$/, "")}
              <span className="ml-auto font-mono text-rock tabular-nums">
                {total ? Math.round((m3 / total) * 100) : 0}%
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <SectionTitle>Map key</SectionTitle>
        <ul className="space-y-1 text-[11px] text-shale">
          <RouteKey supply={supply} />
          <li className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: ROLE_COLOR.primary }} />
            Sewage treatment plant
          </li>
          <li className="flex items-center gap-2">
            <span className="size-2.5 rotate-45" style={{ background: ROLE_COLOR.site }} />
            CO₂ storage site
          </li>
        </ul>
      </div>
      {footer}
    </>
  );
}

const FEEDSTOCK_STEPS = ["Capture unit", "Liquefaction", "Tanker", "Storage site"];

export function FeedstockLegend({
  supply,
  readings,
  footer,
}: {
  supply: SupplyLayout;
  readings: SensorReadings;
  footer: ReactNode;
}) {
  const route = supply.routes[0];
  const value = (sensor: string) => (route ? readings[sensorKey(route.id, sensor)] : undefined);
  const delivered = value("delivered");
  const trips = value("trips");
  const perTrip = value("net-per-trip");

  return (
    <>
      <div>
        <SectionTitle>Today</SectionTitle>
        <p className="font-mono text-lg font-semibold text-rock tabular-nums">
          {delivered?.text ?? "—"}
          <span className="ml-1 font-sans text-[11px] font-normal text-shale">t liquid CO₂ delivered</span>
        </p>
        <p className="text-[11px] text-shale">
          {trips?.text ?? "—"} tanker trips · {perTrip?.text ?? "—"} t net per trip (weighing bridge)
        </p>
      </div>
      <div>
        <SectionTitle>Chain</SectionTitle>
        <ol className="flex flex-wrap items-center gap-1 text-[10.5px] font-medium text-rock">
          {FEEDSTOCK_STEPS.map((step, index) => (
            <li key={step} className="flex items-center gap-1">
              <span className="rounded-md bg-white/80 px-1.5 py-0.5">{step}</span>
              {index < FEEDSTOCK_STEPS.length - 1 ? <ArrowRight className="size-3 text-mist" /> : null}
            </li>
          ))}
        </ol>
      </div>
      <div>
        <SectionTitle>Map key</SectionTitle>
        <ul className="space-y-1 text-[11px] text-shale">
          <RouteKey supply={supply} />
          <li className="flex items-center gap-2">
            <span className="size-2.5 rounded-[2px]" style={{ background: ROLE_COLOR.capture }} />
            CO₂ capture site
          </li>
          <li className="flex items-center gap-2">
            <span className="size-2.5 rotate-45" style={{ background: ROLE_COLOR.site }} />
            CO₂ storage site
          </li>
        </ul>
      </div>
      <MeasurementKey />
      {footer}
    </>
  );
}
