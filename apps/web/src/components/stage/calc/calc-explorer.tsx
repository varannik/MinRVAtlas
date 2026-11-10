"use client";

import { useMemo, useState } from "react";
import { ChevronsDownUp, ChevronsUpDown, CircleAlert, Info, ListChecks, TriangleAlert, X } from "lucide-react";
import { evaluate } from "@/lib/mrv/calc/evaluate";
import { isGenericSpec } from "@/lib/mrv/calc/specs";
import { findNode, pathTo } from "@/lib/mrv/calc/tree";
import type { CalcNode, EquationNode } from "@/lib/mrv/calc/types";
import { runChecks } from "@/lib/mrv/checks";
import { contains, formatRange, rangeDays } from "@/lib/mrv/days";
import type { DateRange, IssueSeverity } from "@/lib/mrv/types";
import { STAGE_META } from "@/lib/mrv/registry-pipeline";
import { useStage, type CalcTarget } from "@/store/stage-store";
import { useStageContext } from "../ledger-context";
import { CALC_TONE, ORIGIN_BADGE, SEVERITY_TONE } from "../theme";
import { CalcRootCard, CalcTermCard } from "./calc-cards";
import { CalcInspector } from "./calc-inspector";
import { equationIds, equationsToDepth, layoutTree } from "./calc-layout";
import { CalcViewport } from "./calc-viewport";

const SEVERITY_ICON: Record<IssueSeverity, typeof TriangleAlert> = { blocker: TriangleAlert, warning: CircleAlert, info: Info };

/** Equations to open so `id` is on screen: its ancestors, and itself if it has terms. */
function opened(root: EquationNode, id: string): string[] {
  const node = findNode(root, id);
  if (!node) return [];
  const path = pathTo(root, id);
  return node.kind === "equation" ? path : path.slice(0, -1);
}

function initialExpanded(root: EquationNode, nodeId: string | null): Set<string> {
  return new Set([...equationsToDepth(root, 1), ...(nodeId ? opened(root, nodeId) : [])]);
}

function targetRange(target: CalcTarget, blocks: { id: string; range: DateRange }[]): DateRange | null {
  if (target.kind === "range") return target.range;
  return blocks.find((block) => block.id === target.blockId)?.range ?? null;
}

/**
 * Full-screen view of how one window's credited number is built: the root on
 * the left, each equation fanning out into its terms until every branch ends
 * in a value from our data. Red dashed branches have no data yet.
 */
export function CalcExplorer({ target, initialNodeId }: { target: CalcTarget; initialNodeId: string | null }) {
  const { project, ledger } = useStageContext();
  const { spec, index, blocks, daily, dataset } = ledger;
  const closeCalc = useStage((state) => state.closeCalc);
  const [expanded, setExpanded] = useState<Set<string>>(() => initialExpanded(spec.root, initialNodeId));
  const [selectedId, setSelectedId] = useState<string>(() => initialNodeId ?? spec.root.id);
  const [checksOpen, setChecksOpen] = useState(false);

  const range = targetRange(target, blocks);
  const block = target.kind === "block" ? blocks.find((row) => row.id === target.blockId) : null;
  const evaluation = useMemo(() => (index && range ? evaluate(spec, index, range) : null), [index, range, spec]);
  const findings = useMemo(() => {
    if (!evaluation || !range) return [];
    return runChecks({ spec, range, evaluation, daily: daily.filter((point) => contains(range, point.day)) });
  }, [daily, evaluation, range, spec]);

  const layout = useMemo(() => layoutTree(spec.root, expanded), [expanded, spec.root]);
  const fitKey = useMemo(() => [...expanded].sort().join(","), [expanded]);
  const allIds = useMemo(() => equationIds(spec.root), [spec.root]);

  /** Select a node and open every branch above it. */
  const navigate = (id: string) => {
    setSelectedId(id);
    setExpanded((current) => {
      const next = new Set(current);
      for (const open of opened(spec.root, id)) next.add(open);
      return next;
    });
  };

  /** Clicking a term selects it; clicking an equation also opens or folds it. */
  const toggle = (node: CalcNode) => {
    setSelectedId(node.id);
    if (node.kind !== "equation" || node.id === spec.root.id) return;
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  };

  const selected = findNode(spec.root, selectedId) ?? spec.root;
  const badge = ORIGIN_BADGE[dataset?.origin ?? "none"];
  const allOpen = expanded.size >= allIds.length;

  return (
    <div className="calc-stage absolute inset-0 flex flex-col" role="dialog" aria-modal="true" aria-label="Calculation tree">
      <header className="flex items-center gap-5 border-b border-white/10 px-6 py-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold tracking-[0.18em] text-white/45 uppercase">
            Calculation tree · {spec.registry} · {spec.methodology}
          </p>
          <h2 className="mt-0.5 truncate text-[18px] font-semibold tracking-tight text-white">
            {block ? `Block #${block.sequence} · ${block.label}` : "Proposed block"}
            {range ? <span className="font-normal text-white/50"> · {formatRange(range)} · {rangeDays(range)} days</span> : null}
          </h2>
          <p className="mt-0.5 truncate text-[11px] text-white/40">
            {isGenericSpec(spec) ? "Generic tree — this methodology's equations are not transcribed yet" : spec.edition}
            {block ? ` · ${STAGE_META[block.stage].label}` : ""} · {project.name}
          </p>
        </div>
        <div className="hidden items-center gap-3 md:flex">
          {(["ok", "partial", "missing"] as const).map((status) => (
            <span key={status} className="flex items-center gap-1.5 text-[10.5px] text-white/60">
              <svg width="22" height="6" aria-hidden>
                <line x1="1" x2="21" y1="3" y2="3" stroke={CALC_TONE[status].line} strokeWidth="1.6" strokeDasharray={status === "missing" ? "3 3" : undefined} />
              </svg>
              {CALC_TONE[status].label}
            </span>
          ))}
        </div>
        <span title={dataset?.note ?? badge.title} className={`rounded-md px-2 py-1 text-[10px] font-semibold ${badge.className}`}>
          {badge.label}
        </span>
        <button
          type="button"
          onClick={closeCalc}
          aria-label="Close calculation tree"
          className="grid size-9 place-items-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1 overflow-hidden">
          <div aria-hidden className="calc-stage__grid absolute inset-0" />

          {!evaluation || !index || !range ? (
            <div className="grid h-full place-items-center text-[13px] text-white/50">
              {ledger.status === "loading" ? "Reading monitoring data…" : "This window has no data to calculate."}
            </div>
          ) : (
            <>
              <CalcViewport
                bounds={layout.bounds}
                fitKey={fitKey}
                actions={
                  <button
                    type="button"
                    onClick={() => setExpanded(new Set(allOpen ? equationsToDepth(spec.root, 0) : allIds))}
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-white/70 hover:bg-white/10 hover:text-white"
                  >
                    {allOpen ? <ChevronsDownUp className="size-3.5" /> : <ChevronsUpDown className="size-3.5" />}
                    {allOpen ? "Collapse all" : "Expand all"}
                  </button>
                }
              >
                <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1} aria-hidden>
                  {layout.edges.map((edge) => {
                    const status = evaluation.byId.get(edge.toId)?.status ?? "missing";
                    const tone = CALC_TONE[status];
                    return (
                      <g key={edge.id} className="calc-edge">
                        <path
                          d={edge.d}
                          style={{ d: `path("${edge.d}")`, transition: "d 480ms cubic-bezier(0.22, 1, 0.36, 1)" }}
                          fill="none"
                          stroke={tone.line}
                          strokeOpacity={status === "ok" ? 0.7 : 0.9}
                          strokeWidth={1.3}
                          strokeDasharray={status === "missing" ? "4 4" : undefined}
                        />
                        <circle cx={edge.end.x - 3} cy={edge.end.y} r={3.2} fill={tone.line} />
                        {edge.glyph ? (
                          <g transform={`translate(${edge.end.x - 24} ${edge.end.y})`}>
                            <circle r={8} fill="#0D1802" stroke={tone.line} strokeOpacity={0.6} />
                            <text textAnchor="middle" dy="3.5" fontSize="11" fill={tone.ink} fontFamily="var(--font-mono)">
                              {edge.glyph}
                            </text>
                          </g>
                        ) : null}
                      </g>
                    );
                  })}
                </svg>

                {layout.cards.map((card) => {
                  const result = evaluation.byId.get(card.node.id);
                  if (!result) return null;
                  return card.variant === "root" ? (
                    <CalcRootCard
                      key={card.node.id}
                      card={card}
                      result={result}
                      creditUnit={spec.creditUnit}
                      selected={selectedId === card.node.id}
                      onSelect={() => setSelectedId(spec.root.id)}
                    />
                  ) : (
                    <CalcTermCard key={card.node.id} card={card} result={result} selected={selectedId === card.node.id} onSelect={() => toggle(card.node)} />
                  );
                })}
              </CalcViewport>

              {findings.length ? (
                <section data-no-pan className="absolute bottom-5 left-5 max-w-[45%]">
                  {checksOpen ? (
                    <div className="w-[340px] max-w-full rounded-2xl border border-white/10 bg-black/50 p-3 backdrop-blur-md">
                      <button
                        type="button"
                        onClick={() => setChecksOpen(false)}
                        className="mb-1.5 flex w-full items-center justify-between text-[10px] font-semibold tracking-[0.16em] text-white/45 uppercase hover:text-white/70"
                      >
                        Data checks · {findings.length}
                        <X className="size-3.5" />
                      </button>
                      <ul className="scroll-slim max-h-48 space-y-0.5 overflow-y-auto">
                        {findings.map((finding) => {
                          const Icon = SEVERITY_ICON[finding.severity];
                          return (
                            <li key={finding.id}>
                              <button
                                type="button"
                                disabled={!finding.nodeId}
                                onClick={() => finding.nodeId && navigate(finding.nodeId)}
                                className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left enabled:hover:bg-white/[0.06]"
                              >
                                <Icon className="mt-0.5 size-3.5 shrink-0" style={{ color: finding.severity === "blocker" ? CALC_TONE.missing.line : finding.severity === "warning" ? CALC_TONE.partial.line : SEVERITY_TONE.info.color }} />
                                <span className="min-w-0 text-[11.5px] leading-snug text-white/80">{finding.title}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setChecksOpen(true)}
                      className="flex items-center gap-2 rounded-full border border-white/10 bg-black/50 px-3.5 py-2 text-[11.5px] font-semibold text-white/80 backdrop-blur-md hover:text-white"
                    >
                      <ListChecks className="size-4" style={{ color: findings.some((finding) => finding.severity === "blocker") ? CALC_TONE.missing.line : CALC_TONE.partial.line }} />
                      Data checks · {findings.length}
                    </button>
                  )}
                </section>
              ) : null}
            </>
          )}
        </main>

        <aside className="w-[360px] shrink-0 border-l border-white/10 bg-black/25 backdrop-blur-sm">
          {evaluation && index && range ? (
            <CalcInspector key={selected.id} node={selected} evaluation={evaluation} index={index} range={range} onNavigate={navigate} />
          ) : null}
        </aside>
      </div>
    </div>
  );
}
