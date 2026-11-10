"use client";

import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { FlowPort } from "../flow-port";
import type { PortSide } from "../stage-anchors";

/**
 * One shell for both stage cards, so the ledger and the site pulse read as a
 * pair: header, one headline number with its picture, a row of supporting
 * figures, and a preview of the page the card opens. The whole card is the
 * way in; details live on that page, not here.
 */

export interface StageMetric {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  /** Key dot, matching the headline picture. */
  color?: string;
}

export interface StageCardProps {
  side: PortSide;
  eyebrow: string;
  badge: { label: string; className: string; title?: string; live?: boolean };
  title: string;
  subtitle: string;
  hero: { label: string; value: string; unit?: string; caption: string };
  /** Picture under the headline number, 44 px tall. */
  visual: ReactNode;
  metrics: StageMetric[];
  /** Background of the footer: a glimpse of the destination. */
  preview: ReactNode;
  cta: { label: string; detail: string };
  /** Omit when there is nowhere to go; the card then reads as static. */
  onOpen?: () => void;
}

function Badge({ badge }: { badge: StageCardProps["badge"] }) {
  return (
    <span title={badge.title} className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${badge.className}`}>
      {badge.live ? (
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
        </span>
      ) : null}
      {badge.label}
    </span>
  );
}

function Body({ eyebrow, badge, title, subtitle, hero, visual, metrics, preview, cta, onOpen }: StageCardProps) {
  return (
    <>
      <header className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-[0.18em] text-mist uppercase">{eyebrow}</p>
          <h2 className="mt-1 truncate text-[15px] leading-tight font-semibold tracking-tight text-frost">{title}</h2>
          <p className="mt-0.5 truncate text-[11px] text-mist">{subtitle}</p>
        </div>
        <Badge badge={badge} />
      </header>

      <section className="px-5 pt-4">
        <p className="text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">{hero.label}</p>
        <p className="mt-1 flex items-baseline gap-1.5">
          <span className="font-mono text-[40px] leading-none font-semibold tracking-tight text-rock tabular-nums">{hero.value}</span>
          {hero.unit ? <span className="text-[13px] text-shale">{hero.unit}</span> : null}
        </p>
        <p className="mt-1 truncate text-[11px] text-mist">{hero.caption}</p>
        <div className="mt-3 h-11">{visual}</div>
      </section>

      <dl className="mt-3 grid border-t border-line/60" style={{ gridTemplateColumns: `repeat(${metrics.length}, minmax(0, 1fr))` }}>
        {metrics.map((metric, index) => (
          <div key={metric.label} className={`min-w-0 px-4 py-3 ${index > 0 ? "border-l border-line/60" : ""}`}>
            <dt className="flex items-center gap-1.5 truncate text-[10px] font-semibold tracking-[0.1em] text-mist uppercase">
              {metric.color ? <span className="size-1.5 shrink-0 rounded-full" style={{ background: metric.color }} /> : null}
              {metric.label}
            </dt>
            <dd className="mt-1 flex items-baseline gap-1">
              <span className="font-mono text-[18px] leading-none font-semibold text-frost tabular-nums">{metric.value}</span>
              {metric.unit ? <span className="text-[10px] text-mist">{metric.unit}</span> : null}
            </dd>
            {metric.hint ? <dd className="mt-1 truncate text-[10px] text-mist">{metric.hint}</dd> : null}
          </div>
        ))}
      </dl>

      <div className="relative mx-2 mb-2 h-[88px] overflow-hidden rounded-[20px] bg-rock">
        <div aria-hidden className="absolute inset-0">
          {preview}
        </div>
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-rock/85 via-rock/30 to-transparent" />
        <div className="absolute inset-x-3.5 bottom-3 flex items-end justify-between gap-3 text-white">
          <span className="min-w-0">
            <span className="block text-[14px] leading-tight font-semibold">{cta.label}</span>
            <span className="block truncate text-[10.5px] text-white/70">{cta.detail}</span>
          </span>
          {onOpen ? (
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white text-rock transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
              <ArrowUpRight className="size-4" />
            </span>
          ) : null}
        </div>
      </div>
    </>
  );
}

export function StageCard(props: StageCardProps) {
  const shell =
    "glass relative flex w-full flex-col overflow-hidden rounded-[28px] text-left transition-[transform,box-shadow] duration-300 ease-out";
  return (
    <div className="relative w-full">
      <FlowPort side={props.side} className="top-1/2 -translate-y-1/2" />
      {props.onOpen ? (
        <button
          type="button"
          onClick={props.onOpen}
          aria-label={`${props.cta.label}: ${props.title}`}
          className={`${shell} group cursor-pointer outline-none hover:-translate-y-1 hover:shadow-[0_22px_48px_rgba(7,8,8,0.14)] focus-visible:ring-2 focus-visible:ring-carbon-400/60`}
        >
          <Body {...props} />
        </button>
      ) : (
        <div className={shell}>
          <Body {...props} />
        </div>
      )}
    </div>
  );
}
