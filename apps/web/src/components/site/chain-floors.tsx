"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Maximize2 } from "lucide-react";
import type { SensorStatus, SiteLayout, SiteZone } from "@/lib/site-layouts";
import { alertsIn, SECTION_META, sensorCount, type Mode, type SectionId } from "./chain-sections";
import { ZONE_COLOR, ZONE_LABEL } from "./site-geometry";
import { STATUS_COLOR } from "./site-objects";
import { onDark } from "./site-panels";
import type { Subsurface } from "./subsurface/model";
import { EvidenceBadge } from "./subsurface/subsurface-panel";
import { sensorKey, type SensorReadings } from "./use-site-sensors";

/**
 * The pieces of the live chain's floors: a view's card, the lift between
 * floors, the live pill, the side panels and the dashed flows that join the
 * views from floor to floor.
 */

export interface CardStat {
  key: string;
  label: string;
  unit: string;
  text: string | null;
  status: SensorStatus | null;
}

/**
 * One view on its floor: a live preview with its name and readings. It opens
 * full screen in place, so the map or scene keeps running without a reload.
 * No ancestor may set a transform or a backdrop filter, or the full-screen
 * stage would be trapped inside the card.
 */
export function SectionCard({
  id,
  mode,
  subtitle,
  stats,
  alerts,
  dark = false,
  className = "",
  onExpand,
  children,
}: {
  id: SectionId;
  mode: Mode;
  subtitle: string;
  stats: CardStat[];
  alerts: number;
  dark?: boolean;
  className?: string;
  onExpand: () => void;
  children: ReactNode;
}) {
  const meta = SECTION_META[id];
  const Icon = meta.icon;
  const expanded = mode === "expanded";

  return (
    <article
      data-chain-anchor={id}
      aria-label={meta.title}
      className={`relative overflow-hidden rounded-[24px] shadow-[0_28px_64px_-30px_rgba(13,24,2,0.6)] ring-1 ${
        dark ? "bg-earth ring-calcite/12" : "bg-[#EEE5DB] ring-earth/10"
      } ${className}`}
    >
      <div className={expanded ? "chain-stage fixed inset-0 z-[90]" : "absolute inset-0"}>{children}</div>
      {!expanded ? (
        <>
          <button
            type="button"
            onClick={onExpand}
            aria-label={`Open ${meta.title} full screen`}
            className="group absolute inset-0 z-10 cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-olivine-300 focus-visible:ring-inset"
          >
            <span className="journey-panel absolute right-4 bottom-4 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold opacity-90 transition-opacity group-hover:opacity-100">
              <Maximize2 className="size-3.5" />
              Explore
            </span>
          </button>
          <div className="journey-panel pointer-events-none absolute top-3 right-12 left-3 z-20 rounded-2xl px-3.5 py-3 sm:right-auto sm:max-w-[26rem] sm:min-w-[19rem]">
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-xl text-calcite ring-1 ring-calcite/20" style={{ background: meta.accent }}>
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold tracking-tight">{meta.title}</p>
                <p className="truncate text-[11px] text-sand">{subtitle}</p>
              </div>
              {alerts > 0 ? (
                <span className="shrink-0 rounded-full bg-[#433A08] px-2 py-0.5 text-[10px] font-semibold text-[#EACD9C]">
                  {alerts} to watch
                </span>
              ) : null}
            </div>
            {stats.length > 0 ? (
              <dl className="mt-2.5 grid grid-cols-3 gap-3 border-t border-calcite/12 pt-2.5">
                {stats.map((stat) => (
                  <div key={stat.key} className="min-w-0">
                    <dd className="flex items-baseline gap-1 font-mono text-[15px] font-semibold tabular-nums">
                      <span
                        className="size-1.5 shrink-0 self-center rounded-full"
                        style={{ background: stat.status ? STATUS_COLOR[stat.status] : "#989077" }}
                      />
                      {stat.text ?? "—"}
                      <span className="font-sans text-[10px] font-normal text-sand">{stat.unit}</span>
                    </dd>
                    <dt className="truncate text-[10px] text-sand">{stat.label}</dt>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </>
      ) : null}
    </article>
  );
}

// ---------------------------------------------------------------------------

export interface ChainFloor {
  floor: 1 | 2 | 3;
  id: string;
  title: string;
  note: string;
}

/** The lift on the right edge: one stop per floor, the floor in view filled. */
export function ChainLift({ floors, viewing, onGo }: { floors: ChainFloor[]; viewing: number; onGo: (floor: ChainFloor) => void }) {
  return (
    <nav
      aria-label="Chain floors"
      className="journey-panel fixed top-1/2 right-3 z-[80] hidden -translate-y-1/2 flex-col gap-1 rounded-2xl p-1.5 md:flex lg:right-5"
    >
      {floors.map((entry, index) => {
        const active = viewing === entry.floor;
        return (
          <div key={entry.id} className="flex flex-col items-center">
            {index > 0 ? <span aria-hidden className="h-3 border-l border-dashed border-calcite/30" /> : null}
            <button
              type="button"
              onClick={() => onGo(entry)}
              aria-current={active ? "location" : undefined}
              title={`Floor ${entry.floor} · ${entry.title}`}
              className={`group relative grid size-10 place-items-center rounded-xl font-mono text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-calcite ${
                active ? "bg-calcite text-earth" : "text-calcite/75 hover:bg-calcite/10 hover:text-calcite"
              }`}
            >
              {entry.floor}
              <span className="journey-panel pointer-events-none absolute top-1/2 right-full mr-2.5 hidden -translate-y-1/2 rounded-xl px-2.5 py-1.5 text-left font-sans whitespace-nowrap group-hover:block group-focus-visible:block">
                <span className="block text-[12px] font-semibold text-calcite">{entry.title}</span>
                <span className="block text-[10.5px] font-normal text-sand">{entry.note}</span>
              </span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}

/** Always on screen: the chain is live, how many readings, and what to watch. */
export function LivePill({ readings, alerts, onWatch }: { readings: number; alerts: number; onWatch: () => void }) {
  return (
    <button
      type="button"
      onClick={onWatch}
      disabled={alerts === 0}
      title={alerts ? "Go to the first reading to watch" : "Every reading is within range"}
      className="journey-panel flex max-w-full items-center gap-2.5 rounded-full py-1.5 pr-3.5 pl-3 text-left transition-[filter] enabled:hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-calcite"
    >
      <span className="relative flex size-2.5 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-olivine-300/70" />
        <span className="relative inline-flex size-2.5 rounded-full bg-olivine-300" />
      </span>
      <span className="shrink-0 text-[9.5px] font-bold tracking-[0.16em] text-olivine-300 uppercase">Live</span>
      <span className="min-w-0 truncate text-[12px] font-semibold">{readings} readings · demo signals</span>
      {alerts > 0 ? (
        <span className="shrink-0 rounded-md bg-[#433A08] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#EACD9C]">{alerts} to watch</span>
      ) : (
        <span className="shrink-0 text-[10.5px] font-semibold text-olivine-300">all in range</span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------

const STATUS_RANK: Record<SensorStatus, number> = { ok: 0, warn: 1, alarm: 2 };

/** The storage site in a list: its zones, and the readings to watch. */
export function OnSite({
  layout,
  readings,
  onOpen,
}: {
  layout: SiteLayout;
  readings: SensorReadings;
  onOpen: (hostId: string) => void;
}) {
  const zones = new Map<SiteZone, { count: number; worst: SensorStatus }>();
  for (const object of layout.objects) {
    const entry = zones.get(object.zone) ?? { count: 0, worst: "ok" as SensorStatus };
    entry.count += 1;
    for (const sensor of object.sensors ?? []) {
      const status = readings[sensorKey(object.id, sensor.id)]?.status;
      if (status && STATUS_RANK[status] > STATUS_RANK[entry.worst]) entry.worst = status;
    }
    zones.set(object.zone, entry);
  }
  const alerts = alertsIn(layout.objects, readings);

  return (
    <aside className="journey-panel rounded-2xl p-4">
      <p className="text-[9.5px] font-semibold tracking-[0.16em] text-sand uppercase">On site</p>
      <p className="mt-0.5 text-[13px] font-semibold">
        {layout.objects.length} objects · {sensorCount(layout.objects)} readings
      </p>
      <ul className="mt-2.5 space-y-1">
        {[...zones].map(([zone, entry]) => (
          <li key={zone} className="flex items-center gap-2 text-[11.5px] text-calcite/85">
            <span className="size-2.5 shrink-0 rounded-sm border-2 border-dashed" style={{ borderColor: onDark(ZONE_COLOR[zone]) }} />
            <span className="min-w-0 flex-1 truncate">{ZONE_LABEL[zone]}</span>
            <span className="font-mono text-[11px] text-sand tabular-nums">{entry.count}</span>
            <span className="size-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[entry.worst] }} />
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[9.5px] font-semibold tracking-[0.16em] text-sand uppercase">To watch</p>
      {alerts.length ? (
        <ul className="mt-1 space-y-0.5">
          {alerts.slice(0, 5).map(({ host, sensor, reading }) => (
            <li key={`${host.id}-${sensor.id}`}>
              <button
                type="button"
                onClick={() => onOpen(host.id)}
                className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[11px] hover:bg-calcite/10"
              >
                <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[reading.status] }} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-semibold">{sensor.label}</span>
                  <span className="text-sand"> · {(host as { name?: string }).name ?? host.id}</span>
                </span>
                <span className="shrink-0 font-mono font-semibold tabular-nums">
                  {reading.text} <span className="font-sans font-normal text-sand">{sensor.unit}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[11.5px] text-olivine-300">Every reading is within range.</p>
      )}
    </aside>
  );
}

/**
 * The rock under the site as a well log: each layer a band as thick as it
 * is deep, lighter at the surface and darker with depth, and the injection
 * interval marked where the CO₂ goes.
 */
export function WellLog({ sub }: { sub: Subsurface }) {
  const { model } = sub;
  const total = Math.max(...model.layers.map((layer) => layer.base));
  const SCALE = 260;

  return (
    <aside className="journey-panel rounded-2xl p-4">
      <p className="text-[9.5px] font-semibold tracking-[0.16em] text-sand uppercase">Well log · the rock under the site</p>
      <ol className="mt-3 space-y-px">
        {model.layers.map((layer) => {
          const injected = layer.top >= model.reservoir.top && layer.base <= model.reservoir.base;
          return (
            <li key={layer.id} className="flex items-stretch gap-3" style={{ minHeight: Math.max(22, ((layer.base - layer.top) / total) * SCALE) }}>
              <span className="w-5 shrink-0 rounded-[3px] ring-1 ring-calcite/15" style={{ background: layer.color }} />
              <span className={`flex min-w-0 flex-1 flex-col justify-center border-l-2 pl-2 ${injected ? "border-olivine-300" : "border-transparent"}`}>
                <span className="truncate text-[11.5px] font-semibold">{layer.name}</span>
                <span className="text-[10px] text-sand">
                  {layer.top}–{layer.base} m{injected ? " · injection interval" : ""}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      <dl className="mt-4 space-y-1.5 border-t border-calcite/12 pt-3">
        {model.parameters.slice(0, 4).map((row) => (
          <div key={row.label}>
            <dt className="text-[10px] text-sand">{row.label}</dt>
            <dd className="flex items-center justify-between gap-2 text-[11.5px] font-semibold">
              {row.value}
              <EvidenceBadge evidence={row.evidence} />
            </dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

// ---------------------------------------------------------------------------

export interface ChainLink {
  from: SectionId;
  to: SectionId;
  /** Where along the target's top edge the flow arrives, 0 to 1. */
  at: number;
  label: string;
  color: string;
  /** Dash pattern; none draws the line solid. */
  dash?: string;
}

/**
 * The flows between floors, in the site's line styles: liquid CO₂ solid,
 * water long-dashed, injectate short-dashed. Measured every frame so they
 * follow the page's scroll. Lines run under the floors' content; the end
 * points and labels sit over it.
 */
export function ChainLinks({ links }: { links: ChainLink[] }) {
  const backRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const floors = backRef.current?.parentElement;
    if (!floors) return;
    let frame = 0;
    const tick = () => {
      const origin = floors.getBoundingClientRect();
      links.forEach((link, index) => {
        const from = floors.querySelector(`[data-chain-anchor="${link.from}"]`)?.getBoundingClientRect();
        const to = floors.querySelector(`[data-chain-anchor="${link.to}"]`)?.getBoundingClientRect();
        const path = floors.querySelector<SVGPathElement>(`[data-chain-link="${index}"]`);
        const start = floors.querySelector<SVGCircleElement>(`[data-chain-start="${index}"]`);
        const end = floors.querySelector<SVGCircleElement>(`[data-chain-end="${index}"]`);
        const label = floors.querySelector<HTMLSpanElement>(`[data-chain-label="${index}"]`);
        if (!from || !to || !path) return;
        const a = { x: from.left + from.width / 2 - origin.left, y: from.bottom - origin.top };
        const b = { x: to.left + to.width * link.at - origin.left, y: to.top - origin.top };
        const k = Math.max(40, (b.y - a.y) * 0.5);
        const f = (n: number) => n.toFixed(1);
        path.setAttribute("d", `M ${f(a.x)} ${f(a.y)} C ${f(a.x)} ${f(a.y + k)}, ${f(b.x)} ${f(b.y - k)}, ${f(b.x)} ${f(b.y)}`);
        start?.setAttribute("cx", f(a.x));
        start?.setAttribute("cy", f(a.y));
        end?.setAttribute("cx", f(b.x));
        end?.setAttribute("cy", f(b.y));
        // The bezier's midpoint, for the label.
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (label) label.style.transform = `translate(${f(mid.x)}px, ${f(mid.y)}px) translate(-50%, -50%)`;
      });
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [links]);

  return (
    <>
      <div ref={backRef} aria-hidden className="pointer-events-none absolute inset-0 z-[1] hidden lg:block">
        <svg className="absolute inset-0 h-full w-full overflow-visible">
          {links.map((link, index) => (
            <path
              key={index}
              data-chain-link={index}
              fill="none"
              stroke={link.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray={link.dash}
              className={link.dash ? "floor-link-flow" : undefined}
            />
          ))}
        </svg>
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0 z-[3] hidden lg:block">
        <svg className="absolute inset-0 h-full w-full overflow-visible">
          {links.map((link, index) => (
            <g key={index}>
              <circle data-chain-start={index} r={3.5} fill={link.color} />
              <circle data-chain-end={index} r={4} fill="#F1F0F0" stroke={link.color} strokeWidth={1.8} />
            </g>
          ))}
        </svg>
        {links.map((link, index) => (
          <span
            key={index}
            data-chain-label={index}
            className="journey-panel absolute top-0 left-0 flex items-center gap-2 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[0.12em] whitespace-nowrap uppercase"
          >
            <svg viewBox="0 0 18 4" className="h-1 w-[18px]" aria-hidden>
              <line x1="0" y1="2" x2="18" y2="2" stroke={onDark(link.color)} strokeWidth="2.4" strokeDasharray={link.dash} />
            </svg>
            {link.label}
          </span>
        ))}
      </div>
    </>
  );
}
