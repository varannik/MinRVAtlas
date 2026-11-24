"use client";

import { BookOpen, CircleAlert, Wrench } from "lucide-react";
import { fixedRowsFor, type DatasetIndex } from "@/lib/mrv/calc/evaluate";
import { OP_GLYPH, formulaText } from "@/lib/mrv/calc/tree";
import type { CalcNode, Evaluation, InputNode } from "@/lib/mrv/calc/types";
import { formatDay } from "@/lib/mrv/days";
import type { DateRange } from "@/lib/mrv/types";
import { formatPercent, formatQuantity } from "../format";
import { CALC_TONE } from "../theme";
import { KindIcon, sourceLabel } from "./calc-cards";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-white/10 px-5 py-4">
      <p className="mb-2 text-[10px] font-semibold tracking-[0.16em] text-white/45 uppercase">{title}</p>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-[11.5px]">
      <span className="text-white/50">{label}</span>
      <span className="min-w-0 truncate text-right font-mono text-white/85">{value}</span>
    </div>
  );
}

const FOLD: Record<string, string> = {
  sum: "readings added up",
  mean: "mean of the readings",
  max: "highest reading",
  min: "lowest reading",
  last: "last reading",
};

/** What a leaf is and how it is read: description only. Its values are on the trend under the tree. */
function InputSourceDetail({ node, index, range }: { node: InputNode; index: DatasetIndex; range: DateRange }) {
  const source = node.source;
  if (source.type === "series") {
    return (
      <Section title="How it's measured">
        <Row label="Stream metric" value={source.metric} />
        <Row label="Each day" value={FOLD[source.aggregate]} />
        <Row label="Over the period" value={source.aggregate === "sum" ? "days added up" : FOLD[source.aggregate]} />
        {source.scale && source.scale !== 1 ? <Row label="Into the unit" value={`× ${source.scale}`} /> : null}
        <p className="mt-2 text-[11px] leading-relaxed text-white/45">Its value day by day, and what the data quality checks found in it, are on the trend under the tree.</p>
      </Section>
    );
  }
  if (source.type === "fixed") {
    const rows = fixedRowsFor(index, source.key, range);
    const origins = [...new Set(rows.map((row) => row.source))];
    return (
      <Section title="How it's measured">
        <Row label="Dated value" value={source.key} />
        <Row label="Applied as" value={source.scaling === "prorata" ? "a total, shared out by days" : "a factor, held until the next value"} />
        <Row label="Values in the period" value={String(rows.length)} />
        {origins.length ? <p className="mt-2 text-[11px] leading-relaxed text-white/55">From {origins.join(", ")}.</p> : null}
      </Section>
    );
  }
  if (source.type === "constant") {
    return (
      <Section title="How it's measured">
        <Row label="Value" value={formatQuantity(source.value)} />
        <Row label="Set by" value={source.origin} />
      </Section>
    );
  }
  return (
    <Section title="How it's measured">
      <Row label="Counted in" value={source.unit === "h" ? "hours" : "days"} />
      <Row label="From · to" value={`${formatDay(range.start)} · ${formatDay(range.end)}`} />
    </Section>
  );
}

export function CalcInspector({
  node,
  evaluation,
  index,
  range,
  onNavigate,
}: {
  node: CalcNode;
  evaluation: Evaluation;
  index: DatasetIndex;
  range: DateRange;
  onNavigate: (id: string) => void;
}) {
  const result = evaluation.byId.get(node.id);
  if (!result) return null;
  const tone = CALC_TONE[result.status];

  return (
    <div className="flex h-full flex-col">
      <header className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-2">
          <KindIcon node={node} className="size-4 text-white/50" />
          <span className="font-mono text-[13px] font-semibold" style={{ color: tone.ink }}>
            {node.symbol}
          </span>
          <span className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: `${tone.line}26`, color: tone.ink }}>
            {tone.label}
          </span>
        </div>
        <h3 className="mt-1.5 text-[17px] leading-snug font-semibold text-white">{node.label}</h3>
        {node.note ? <p className="mt-1 text-[12px] leading-relaxed text-white/55">{node.note}</p> : null}
        <p className="mt-3 flex items-baseline gap-1.5">
          <span className="font-mono text-[30px] leading-none font-semibold tabular-nums" style={{ color: result.value == null ? tone.ink : "#F4EFE1" }}>
            {result.value == null ? "—" : formatQuantity(result.value)}
          </span>
          <span className="text-[12px] text-white/50">{node.unit}</span>
        </p>
        <p className="mt-1 text-[11px] text-white/45">
          {formatPercent(result.coverage)} of {formatDay(range.start)} – {formatDay(range.end)} covered
          {result.detail ? ` · ${result.detail}` : ""}
        </p>
      </header>

      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto pb-6">
        {node.kind === "input" && result.status !== "ok" && node.remedy ? (
          <div className="mx-5 mb-4 flex gap-2.5 rounded-xl px-3 py-2.5 text-[11.5px] leading-relaxed" style={{ background: `${tone.line}1f`, color: tone.ink }}>
            <Wrench className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <span className="font-semibold">To complete this term: </span>
              {node.remedy}
            </span>
          </div>
        ) : null}

        {node.kind === "equation" ? (
          <Section title="Equation">
            <p className="mb-2 font-mono text-[12.5px] text-white/85">
              {node.symbol} = {formulaText(node)}
            </p>
            <ul className="space-y-1">
              {node.children.map((child, position) => {
                const childResult = evaluation.byId.get(child.id);
                const childTone = CALC_TONE[childResult?.status ?? "missing"];
                return (
                  <li key={child.id}>
                    <button
                      type="button"
                      onClick={() => onNavigate(child.id)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.06]"
                    >
                      <span className="w-3 text-center font-mono text-[12px] text-white/40">{position === 0 ? "" : OP_GLYPH[node.op]}</span>
                      <span className="size-1.5 shrink-0 rounded-full" style={{ background: childTone.line }} />
                      <span className="shrink-0 font-mono text-[11px]" style={{ color: childTone.ink }}>
                        {child.symbol}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11.5px] text-white/70">{child.label}</span>
                      <span className="shrink-0 font-mono text-[11.5px] text-white/85">
                        {childResult?.value == null ? "no data" : `${formatQuantity(childResult.value)} ${child.unit}`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Section>
        ) : (
          <>
            <Section title="Source">
              <p className="text-[11.5px] text-white/75">{sourceLabel(node)}</p>
            </Section>
            <InputSourceDetail node={node} index={index} range={range} />
          </>
        )}

        {result.missing.length && node.kind === "equation" ? (
          <Section title="Blocking inputs">
            <p className="flex items-start gap-2 text-[11.5px] leading-relaxed" style={{ color: CALC_TONE.missing.ink }}>
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              {result.missing.length} input{result.missing.length === 1 ? " has" : "s have"} no data under this term. Open the red branches to see what to supply.
            </p>
          </Section>
        ) : null}

        {node.reference ? (
          <Section title="Methodology">
            <p className="flex items-start gap-2 text-[11.5px] text-white/65">
              <BookOpen className="mt-0.5 size-3.5 shrink-0" />
              {node.reference}
            </p>
          </Section>
        ) : null}
      </div>
    </div>
  );
}
