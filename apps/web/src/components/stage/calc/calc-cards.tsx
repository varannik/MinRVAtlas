"use client";

import dynamic from "next/dynamic";
import { useReducedMotion } from "motion/react";
import { Activity, ChevronLeft, ChevronRight, Clock, Hash, Lock, Sigma } from "lucide-react";
import { formulaText } from "@/lib/mrv/calc/tree";
import type { CalcNode, EquationNode, InputNode, NodeResult } from "@/lib/mrv/calc/types";
import { formatPercent, formatQuantity } from "../format";
import { CALC_TONE } from "../theme";
import { ROOT_ORB_Y, type PlacedCard } from "./calc-layout";

// WebGL only runs in the browser.
const Co2Cloud = dynamic(() => import("./co2-cloud").then((mod) => mod.Co2Cloud), { ssr: false });

/** Size of the CO₂ cloud and its capture ring at the root. */
const ORB = 164;

/** Short description of where a leaf's value comes from. */
export function sourceLabel(node: InputNode): string {
  const source = node.source;
  switch (source.type) {
    case "series":
      return `Stream · ${source.aggregate} · ${source.metric}`;
    case "fixed":
      return `${source.scaling === "prorata" ? "Period total" : "Factor"} · ${source.key}`;
    case "constant":
      return `Methodology · ${source.origin}`;
    case "duration":
      return "Window length";
  }
}

export function KindIcon({ node, className }: { node: CalcNode; className?: string }) {
  if (node.kind === "equation") return <Sigma className={className} />;
  switch (node.source.type) {
    case "series":
      return <Activity className={className} />;
    case "fixed":
      return <Hash className={className} />;
    case "constant":
      return <Lock className={className} />;
    case "duration":
      return <Clock className={className} />;
  }
}

function Coverage({ result }: { result: NodeResult }) {
  const tone = CALC_TONE[result.status];
  const lit = result.status === "missing" ? 0 : Math.max(1, Math.round(result.coverage * 3));
  return (
    <span className="flex items-center gap-0.5" title={`${formatPercent(result.coverage)} covered`}>
      {[0, 1, 2].map((index) => (
        <span key={index} className="h-1.5 w-2.5 rounded-[2px]" style={{ background: index < lit ? tone.line : "rgba(255,255,255,0.12)" }} />
      ))}
    </span>
  );
}

function Value({ result, unit, size }: { result: NodeResult; unit: string; size: "lg" | "md" | "sm" }) {
  const tone = CALC_TONE[result.status];
  const text = size === "lg" ? "text-[30px]" : size === "md" ? "text-[16px]" : "text-[12px]";
  if (result.value == null) {
    return <span className={`font-semibold ${size === "lg" ? "text-[17px]" : "text-[12.5px]"}`} style={{ color: tone.ink }}>{size === "lg" ? "Not calculable" : "No data"}</span>;
  }
  return (
    <span className="flex items-baseline gap-1">
      <span className={`font-mono leading-none font-semibold tabular-nums ${text}`} style={{ color: result.status === "ok" ? "#F4EFE1" : tone.ink }}>
        {formatQuantity(result.value)}
      </span>
      <span className="text-[10px] text-white/50">{unit}</span>
    </span>
  );
}

const shared = (node: CalcNode) => node.id.includes("@");

export function CalcRootCard({
  card,
  result,
  creditUnit,
  selected,
  onSelect,
}: {
  card: PlacedCard;
  result: NodeResult;
  creditUnit: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const node = card.node as EquationNode;
  const tone = CALC_TONE[result.status];
  const missing = result.missing.length;
  const reduceMotion = useReducedMotion();
  return (
    <button
      type="button"
      onClick={onSelect}
      className="calc-card-pos group absolute flex flex-col items-center text-center outline-none"
      style={{ left: card.x, top: card.y, width: card.w, height: card.h }}
    >
      <span className="relative grid shrink-0 place-items-center" style={{ width: ORB, height: ORB, marginTop: ROOT_ORB_Y - ORB / 2 }}>
        <span
          aria-hidden
          className="absolute inset-[18px] rounded-full"
          style={{ background: `radial-gradient(circle, ${tone.glow} 0%, transparent 68%)`, opacity: selected ? 1 : 0.7 }}
        />
        <span aria-hidden className="calc-orb-ring" style={{ ["--ring" as string]: tone.line, inset: 0 }} />
        <Co2Cloud glow={tone.line} size={ORB - 20} still={Boolean(reduceMotion)} />
        <span className="absolute -bottom-1 rounded-full bg-black/50 px-1.5 font-mono text-[9.5px] tracking-wide text-white/60">CO₂</span>
      </span>
      <span className="mt-5 text-[12.5px] font-semibold tracking-wide text-white/85">{node.label}</span>
      <span className="mt-1.5">
        <Value result={result} unit={result.value == null ? "" : `${creditUnit}s`} size="lg" />
      </span>
      <span className="mt-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: `${tone.line}26`, color: tone.ink }}>
        {result.status === "missing" ? `${missing} input${missing === 1 ? "" : "s"} missing` : result.status === "partial" ? "Partly covered" : "Fully calculated"}
      </span>
      <span className="mt-1.5 font-mono text-[10.5px] text-white/45">
        {node.symbol} = {formulaText(node)}
      </span>
    </button>
  );
}

export function CalcTermCard({
  card,
  result,
  selected,
  onSelect,
}: {
  card: PlacedCard;
  result: NodeResult;
  selected: boolean;
  onSelect: () => void;
}) {
  const { node } = card;
  const tone = CALC_TONE[result.status];
  const missing = result.status === "missing";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-expanded={node.kind === "equation" ? card.expanded : undefined}
      className="calc-card-pos absolute flex flex-col justify-center rounded-xl px-3 text-left outline-none transition-[box-shadow,background-color] duration-200 hover:bg-white/[0.07]"
      style={{
        left: card.x,
        top: card.y,
        width: card.w,
        height: card.h,
        background: selected ? "rgba(190,178,144,0.12)" : "rgba(255,255,255,0.045)",
        border: `1px ${missing ? "dashed" : "solid"} ${selected ? tone.line : `${tone.line}55`}`,
        boxShadow: selected ? `0 0 0 1px ${tone.line}, 0 0 28px ${tone.glow}` : "0 8px 24px rgba(0,0,0,0.25)",
      }}
    >
      <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r" style={{ background: tone.line }} />
      <span className="flex items-center gap-1.5">
        <KindIcon node={node} className="size-3 shrink-0 text-white/45" />
        <span className="shrink-0 font-mono text-[10.5px] font-semibold" style={{ color: tone.ink }}>{node.symbol}</span>
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-white/80">{node.label}</span>
        {shared(node) ? <span className="shrink-0 rounded bg-white/10 px-1 text-[8.5px] text-white/60">shared</span> : null}
      </span>
      <span className="mt-1.5 flex items-center justify-between gap-2">
        <Value result={result} unit={node.unit} size="md" />
        <Coverage result={result} />
      </span>
      <span className="mt-1 truncate text-[9.5px] text-white/40">
        {node.kind === "equation" ? `${node.symbol} = ${formulaText(node)} · ${node.children.length} terms` : missing ? (node.remedy ?? sourceLabel(node)) : sourceLabel(node)}
      </span>
      {node.kind === "equation" ? (
        // Open/fold toggle on the edge the branches leave from. Chevrons, so it
        // never reads as one of the + − × ÷ operator badges on the edges.
        <span
          aria-hidden
          className="absolute top-1/2 -right-[11px] grid size-[22px] -translate-y-1/2 place-items-center rounded-full text-[#0D1802] shadow-[0_0_0_3px_#0D1802]"
          style={{ background: tone.line }}
        >
          {card.expanded ? <ChevronLeft className="size-3.5" strokeWidth={2.5} /> : <ChevronRight className="size-3.5" strokeWidth={2.5} />}
        </span>
      ) : null}
    </button>
  );
}
