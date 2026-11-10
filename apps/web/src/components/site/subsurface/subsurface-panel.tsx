"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Pause, Play, X } from "lucide-react";
import type { Evidence } from "@/lib/site-layouts";
import { phasesAt, STAGES, type SectionMode } from "./dfn";
import { OVERLAYS, type Subsurface, type SubsurfaceView } from "./model";
import { EVIDENCE_COLOR, EVIDENCE_LABEL, PROCESS_COLOR } from "./subsurface-scene";

function Title({ children }: { children: string }) {
  return <p className="mb-1.5 text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">{children}</p>;
}

export function EvidenceBadge({ evidence }: { evidence: Evidence }) {
  return (
    <span
      className="shrink-0 rounded px-1 py-px text-[9px] font-semibold tracking-wide text-white uppercase"
      style={{ background: EVIDENCE_COLOR[evidence] }}
    >
      {EVIDENCE_LABEL[evidence]}
    </span>
  );
}

function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-[11px] text-shale hover:bg-white/60">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-3.5 accent-[#55632A]"
      />
      {children}
    </label>
  );
}

const OVERLAY_LABEL: Record<(typeof OVERLAYS)[number], { label: string; evidence: Evidence }> = {
  fractures: { label: "Fracture network (DFN)", evidence: "interpreted" },
  reaction: { label: "Reaction zones & carbonate", evidence: "simulated" },
  wells: { label: "Wells, intervals & sensors", evidence: "measured" },
  tem: { label: "TEM survey grid", evidence: "measured" },
  seismic: { label: "Microseismic events", evidence: "simulated" },
};

const SECTION_OPTIONS: { id: SectionMode; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "baseline", label: "Baseline" },
  { id: "change", label: "Change" },
];

const COLOURS: { color: string; label: string }[] = [
  { color: PROCESS_COLOR.fluid, label: "Injected fluid" },
  { color: PROCESS_COLOR.dissolved, label: "Dissolved (aqueous) carbon" },
  { color: PROCESS_COLOR.reaction, label: "Fluid–rock reaction" },
  { color: PROCESS_COLOR.carbonate, label: "Carbonate precipitation" },
  { color: PROCESS_COLOR.open, label: "Open fracture" },
  { color: PROCESS_COLOR.partial, label: "Partly filled fracture" },
  { color: PROCESS_COLOR.sealed, label: "Sealed fracture (serpentine)" },
];

/** MMRV domains and the plan's instruments that cover them. */
const DOMAINS: { name: string; covered: string }[] = [
  { name: "Geosphere", covered: "HASA 4 pressure, HASA 1 microseismic, TEM survey" },
  { name: "Hydrosphere", covered: "HASA 2 shallow aquifer, HASA 3 deep sampling" },
  { name: "Atmosphere", covered: "Not in this plan yet" },
  { name: "Biosphere", covered: "Not in this plan yet" },
];

export function SubsurfacePanel({
  sub,
  view,
  onChange,
}: {
  sub: Subsurface;
  view: SubsurfaceView;
  onChange: (next: Partial<SubsurfaceView>) => void;
}) {
  const { model, dfn } = sub;
  const setVisible = (key: string, value: boolean) =>
    onChange({ visible: { ...view.visible, [key]: value } });
  const counts = {
    open: dfn.fractures.filter((f) => f.state === "open").length,
    partial: dfn.fractures.filter((f) => f.state === "partial").length,
    sealed: dfn.fractures.filter((f) => f.state === "sealed").length,
  };

  return (
    <>
      <div>
        <Title>Fujairah reference scenario</Title>
        <dl className="space-y-1">
          {model.parameters.map((row) => (
            <div key={row.label}>
              <dt className="text-[10px] text-mist">{row.label}</dt>
              <dd className="flex items-center justify-between gap-2 text-[11.5px] font-semibold text-rock">
                {row.value}
                <EvidenceBadge evidence={row.evidence} />
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div>
        <Title>Geology</Title>
        {model.layers.map((layer) => (
          <Check
            key={layer.id}
            checked={view.visible[layer.id] !== false}
            onChange={(value) => setVisible(layer.id, value)}
          >
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: layer.color }} />
            <span className="min-w-0 flex-1 truncate" title={layer.description}>
              {layer.name}
            </span>
            <span className="text-[10px] whitespace-nowrap text-mist">
              {layer.top}–{layer.base} m
            </span>
          </Check>
        ))}
      </div>

      <div>
        <Title>Overlays</Title>
        {OVERLAYS.map((key) => (
          <Check key={key} checked={view.visible[key] !== false} onChange={(value) => setVisible(key, value)}>
            <span className="min-w-0 flex-1 truncate">{OVERLAY_LABEL[key].label}</span>
            <EvidenceBadge evidence={OVERLAY_LABEL[key].evidence} />
          </Check>
        ))}
        <p className="mt-1 px-1 text-[10px] text-mist">
          {dfn.fractures.length} fractures · {counts.open} open · {counts.partial} partly filled · {counts.sealed}{" "}
          sealed · {dfn.connectedCount} connected to the injection interval
        </p>
        <div className="mt-2 flex items-center gap-2 px-1">
          <span className="text-[11px] text-shale">TEM section</span>
          <div className="ml-auto flex rounded-md bg-white/60 p-0.5">
            {SECTION_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={view.section === option.id}
                onClick={() => onChange({ section: option.id })}
                className={`rounded px-2 py-0.5 text-[10.5px] font-semibold ${
                  view.section === option.id ? "bg-rock text-white" : "text-shale"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 px-1 text-[10px] leading-relaxed text-mist">
          TEM measures resistivity, not carbonate. A low-resistivity anomaly shows where conductive fluid went.
        </p>
      </div>

      <div>
        <Title>Colours</Title>
        <ul className="grid grid-cols-2 gap-x-2 gap-y-0.5">
          {COLOURS.map((entry) => (
            <li key={entry.label} className="flex items-center gap-1.5 text-[10.5px] text-shale">
              <span className="size-2.5 shrink-0 rounded-sm ring-1 ring-black/10" style={{ background: entry.color }} />
              {entry.label}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <Title>Evidence</Title>
        <ul className="space-y-0.5 text-[10.5px] text-shale">
          <li className="flex items-start gap-1.5">
            <EvidenceBadge evidence="measured" /> Well data, cores, logs, survey results.
          </li>
          <li className="flex items-start gap-1.5">
            <EvidenceBadge evidence="interpreted" /> Structures or pathways inferred from measurements.
          </li>
          <li className="flex items-start gap-1.5">
            <EvidenceBadge evidence="simulated" /> Modelled fluid, reaction and precipitation.
          </li>
        </ul>
      </div>

      <div>
        <Title>Monitoring domains</Title>
        <ul className="space-y-0.5 text-[10.5px]">
          {DOMAINS.map((domain) => (
            <li key={domain.name} className="flex gap-2">
              <span className="w-20 shrink-0 font-semibold text-rock">{domain.name}</span>
              <span className="text-shale">{domain.covered}</span>
            </li>
          ))}
        </ul>
      </div>

      <details className="border-t border-line/70 pt-2 text-[10.5px] leading-relaxed text-mist">
        <summary className="cursor-pointer font-semibold">Sources and limits</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {model.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
        <p className="mt-1.5 font-semibold text-shale">Sources</p>
        <ul className="list-disc space-y-0.5 pl-4">
          {model.sources.map((source) => (
            <li key={source}>{source}</li>
          ))}
        </ul>
      </details>
    </>
  );
}

// ---------------------------------------------------------------------------

export function Timeline({
  sub,
  view,
  playing,
  onPlay,
  onChange,
}: {
  sub: Subsurface;
  view: SubsurfaceView;
  playing: boolean;
  onPlay: (playing: boolean) => void;
  onChange: (next: Partial<SubsurfaceView>) => void;
}) {
  const stage = STAGES[Math.min(STAGES.length - 1, Math.floor(view.t))];
  const phases = phasesAt(view.t);
  const reached = sub.dfn.fractures.filter((f) => f.connected && f.arrival <= phases.front);
  const reach = reached.reduce((max, f) => Math.max(max, Math.hypot(f.x - sub.frame.well.x, f.z - sub.frame.well.z)), 0);
  const tracer = sub.dfn.observationArrival !== null && sub.dfn.observationArrival <= phases.front;

  // Playback: about 20 s from baseline to verification.
  const latest = useRef(view.t);
  useEffect(() => {
    latest.current = view.t;
  }, [view.t]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = Math.min(6, latest.current + ((now - last) / 1000) * 0.3);
      last = now;
      onChange({ t: next });
      if (next >= 6) onPlay(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [onChange, onPlay, playing]);

  return (
    <div className="glass pointer-events-auto absolute bottom-[84px] left-1/2 z-50 w-[min(760px,calc(100%-40rem))] min-w-[520px] -translate-x-1/2 rounded-2xl px-4 py-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            if (!playing && view.t >= 6) onChange({ t: 0 });
            onPlay(!playing);
          }}
          aria-label={playing ? "Pause" : "Play"}
          className="grid size-8 shrink-0 place-items-center rounded-full bg-rock text-white"
        >
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-rock">
            {stage.id} · {stage.name}
            <span className="ml-2 align-middle">
              <EvidenceBadge evidence={view.t < 1 ? "interpreted" : "simulated"} />
            </span>
          </p>
          <p className="truncate text-[11px] text-shale">{stage.text}</p>
        </div>
        <dl className="hidden shrink-0 gap-3 text-[10.5px] lg:flex">
          <div>
            <dt className="text-mist">Fluid reach</dt>
            <dd className="font-mono font-semibold text-rock">{Math.round(reach)} m</dd>
          </div>
          <div>
            <dt className="text-mist">Wet fractures</dt>
            <dd className="font-mono font-semibold text-rock">{reached.length}</dd>
          </div>
          <div>
            <dt className="text-mist">Tracer at HASA 3</dt>
            <dd className={`font-semibold ${tracer ? "text-[#1d8fa3]" : "text-mist"}`}>{tracer ? "Detected" : "Not yet"}</dd>
          </div>
        </dl>
      </div>
      <input
        type="range"
        min={0}
        max={6}
        step={0.01}
        value={view.t}
        onChange={(event) => {
          onPlay(false);
          onChange({ t: Number(event.target.value) });
        }}
        aria-label="Timeline"
        className="mt-2 w-full accent-[#55632A]"
      />
      <div className="flex justify-between">
        {STAGES.map((entry, index) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => {
              onPlay(false);
              onChange({ t: index });
            }}
            className={`text-[10px] font-semibold ${Math.floor(view.t) === index ? "text-rock" : "text-mist hover:text-rock"}`}
            title={entry.name}
          >
            {entry.id}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function FracturePanel({
  sub,
  index,
  t,
  onClose,
}: {
  sub: Subsurface;
  index: number;
  t: number;
  onClose: () => void;
}) {
  const f = sub.dfn.fractures[index];
  if (!f) return null;
  const phases = phasesAt(t);
  const layer = sub.model.layers.find((entry) => entry.id === f.layerId);
  const status = !f.connected
    ? "Not connected to the injection interval"
    : f.arrival > phases.front
      ? "Connected; fluid not arrived yet"
      : f.arrival <= phases.carbonate
        ? "Carbonate precipitating"
        : f.arrival <= phases.reaction
          ? "Reacting with host rock"
          : "Carrying injected fluid";
  const rows: [string, string][] = [
    ["Layer", layer?.name ?? f.layerId],
    ["Depth", `${f.depth.toFixed(0)} m`],
    ["Position (x, z)", `${f.x.toFixed(0)} m, ${f.z.toFixed(0)} m from site centre`],
    ["Set", f.set],
    ["Dip / dip direction", `${f.dip.toFixed(0)}° / ${f.azimuth.toFixed(0)}°`],
    ["Length × height", `${f.length.toFixed(0)} × ${f.height.toFixed(0)} m`],
    ["Aperture", `${f.aperture.toFixed(2)} mm`],
    ["Permeability", `${f.permeability.toExponential(1)} m² (cubic law)`],
    ["Fill state", f.state === "open" ? "Open" : f.state === "partial" ? "Partly filled" : "Sealed"],
    ["Mineral filling", f.filling],
    ["Hydraulic activity", f.connected ? `Active · ${f.hops} steps, ${f.pathM.toFixed(0)} m path` : "Inactive"],
    ["Now", status],
  ];

  return (
    <aside className="glass pointer-events-auto absolute top-24 right-5 z-50 w-80 overflow-hidden rounded-2xl">
      <div className="relative border-b border-line/70 px-4 py-3">
        <div className="absolute inset-y-0 left-0 w-1.5" style={{ background: PROCESS_COLOR[f.state] }} />
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">Fracture #{f.index + 1}</p>
            <p className="mt-0.5 text-sm font-semibold tracking-tight text-frost">Discrete fracture network</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close fracture" className="rounded-md p-1 text-mist hover:bg-white/70">
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-shale">
          <EvidenceBadge evidence="interpreted" /> Generated from assumed fracture statistics.
        </p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-4 py-3 text-[11px]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-mist">{label}</dt>
            <dd className="text-rock">{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
