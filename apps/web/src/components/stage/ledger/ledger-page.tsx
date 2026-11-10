"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, CalendarRange, Link2 } from "lucide-react";
import { useProjectDefinition } from "@/hooks/use-project-definition";
import { freeGaps, nextOpenDay, presetRange } from "@/lib/mrv/blocks";
import { evaluate, streamCoverage } from "@/lib/mrv/calc/evaluate";
import { isGenericSpec } from "@/lib/mrv/calc/specs";
import { runChecks } from "@/lib/mrv/checks";
import { contains, monthLabel } from "@/lib/mrv/days";
import { STAGE_META } from "@/lib/mrv/registry-pipeline";
import { ledgerTotals } from "@/lib/mrv/summary";
import type { BlockStage, DateRange, DayKey } from "@/lib/mrv/types";
import { earliestAllowedPeriodStart } from "@/lib/period-desk";
import { latestDesignDate } from "@/lib/project-definition";
import { useDashboard } from "@/store/dashboard-store";
import { usePeriodStore } from "@/store/period-store";
import { useStage } from "@/store/stage-store";
import { formatTonnes } from "../format";
import { useStageContext } from "../ledger-context";
import { BLOCK_TONE, ORIGIN_BADGE, PROPOSAL } from "../theme";
import { useElementSize } from "../use-element-size";
import { AttentionList } from "./attention-list";
import { BlockChain } from "./block-chain";
import { BlockDetail, ProposalDetail } from "./block-detail";
import { RemovalTimeline } from "./removal-timeline";
import { TimelineNavigator } from "./timeline-navigator";
import { useLedgerView } from "./use-ledger-view";

const STAGE_ORDER: BlockStage[] = ["draft", "submitted", "verification", "issues", "issued"];

function HeaderFigure({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="min-w-0 px-4">
      <p className="flex items-center gap-1.5 text-[9.5px] font-semibold tracking-[0.12em] text-mist uppercase">
        <span className="size-1.5 rounded-full" style={{ background: color }} />
        {label}
      </p>
      <p className="mt-0.5 font-mono text-[19px] leading-none font-semibold text-frost tabular-nums">
        {value}
        <span className="ml-1 font-sans text-[10px] font-normal text-mist">t</span>
      </p>
    </div>
  );
}

function monthYear(day: DayKey): string {
  return `${monthLabel(day)} ${day.slice(0, 4)}`;
}

function ViewButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg px-2.5 py-1 text-[10.5px] font-semibold ring-1 transition-colors ${
        active ? "bg-rock text-white ring-rock" : "text-mist ring-line/70 hover:bg-white hover:text-frost"
      }`}
    >
      {children}
    </button>
  );
}

function Panel({
  title,
  icon,
  actions,
  className = "",
  children,
}: {
  title: string;
  icon: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`glass rounded-[24px] ${className}`}>
      <header className="flex items-center justify-between gap-3 px-5 pt-4">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.16em] text-mist uppercase">
          {icon}
          {title}
        </p>
        {actions}
      </header>
      {children}
    </section>
  );
}

/**
 * The full removal ledger, opened from its stage card: the block chain, the
 * timeline to batch the next block on, and the selected block's state with
 * the registry and verifier.
 */
export function LedgerPage() {
  const { project, batches, ledger } = useStageContext();
  const { spec, index, blocks, bounds, daily, blockResults, dataset } = ledger;
  const selection = useStage((state) => state.selection);
  const focusedBlockId = useStage((state) => state.focusedBlockId);
  const setSelection = useStage((state) => state.setSelection);
  const focusBlock = useStage((state) => state.focusBlock);
  const openCalc = useStage((state) => state.openCalc);
  const openDesk = useStage((state) => state.openDesk);
  const closeLedger = useStage((state) => state.closeLedger);
  const selectSubmission = useDashboard((state) => state.selectSubmission);
  const addDraft = usePeriodStore((state) => state.addDraft);
  const removePeriod = usePeriodStore((state) => state.removePeriod);
  const { definition } = useProjectDefinition(project);
  const [createError, setCreateError] = useState<string | null>(null);
  const [timelineRef, { height: timelineHeight }] = useElementSize<HTMLDivElement>();

  const focused = blocks.find((block) => block.id === focusedBlockId) ?? null;
  const netById = useMemo(() => new Map([...blockResults].map(([id, result]) => [id, result.root.value])), [blockResults]);

  const span: DateRange | null = selection ?? focused?.range ?? null;
  // One view for the chain and the timeline: the latest blocks until you move it.
  const shown = useLedgerView(project.id, blocks, bounds, span);
  const windowEval = useMemo(() => {
    if (!index || !span) return null;
    if (focused && !selection) return blockResults.get(focused.id) ?? null;
    return evaluate(spec, index, span);
  }, [blockResults, focused, index, selection, spec, span]);

  const coverage = index && span ? streamCoverage(index, span) : null;

  const windowFindings = useMemo(() => {
    if (!span || !windowEval) return [];
    return runChecks({ spec, range: span, evaluation: windowEval, daily: daily.filter((point) => contains(span, point.day)) });
  }, [daily, spec, span, windowEval]);

  const globalFindings = useMemo(() => {
    if (!index || !bounds) return [];
    return runChecks({ spec, range: bounds, evaluation: evaluate(spec, index, bounds), daily });
  }, [bounds, daily, index, spec]);

  const totals = useMemo(() => ledgerTotals(daily, blocks), [blocks, daily]);

  const notBefore = earliestAllowedPeriodStart(
    { ...project, createdOn: project.createdOn ?? definition?.createdOn ?? undefined },
    latestDesignDate(definition?.artifacts ?? []),
  );

  function suggest(months: number) {
    if (!bounds) return;
    const start = nextOpenDay(blocks, bounds) ?? freeGaps(blocks, bounds)[0]?.start;
    if (!start) return;
    const range = presetRange(start, months, blocks, bounds);
    if (range) setSelection(range);
  }

  function selectAllOpen() {
    if (!bounds) return;
    const start = nextOpenDay(blocks, bounds);
    if (start) setSelection({ start, end: bounds.end });
  }

  function createBlock() {
    if (!selection) return;
    const result = addDraft(project.id, selection.start, selection.end, notBefore);
    if (!result.ok) {
      setCreateError(result.error);
      return;
    }
    setCreateError(null);
    focusBlock(result.period.id);
  }

  const badge = ORIGIN_BADGE[dataset?.origin ?? "none"];
  const presets = [
    { label: "Next month", run: () => suggest(1) },
    { label: "Next quarter", run: () => suggest(3) },
    { label: "All open", run: selectAllOpen },
  ];

  return (
    <div className="absolute inset-0 flex flex-col bg-off-white">
      <div aria-hidden className="ledger-page__texture pointer-events-none absolute inset-0" />
      <header className="relative flex items-center gap-4 border-b border-line/70 bg-white/60 px-5 py-3 backdrop-blur-md">
        <button
          type="button"
          onClick={closeLedger}
          className="glass flex h-11 shrink-0 items-center gap-1.5 rounded-2xl px-3.5 text-[12px] font-semibold text-frost hover:text-carbon-400"
        >
          <ArrowLeft className="size-4" />
          Stage
        </button>
        <div className="min-w-0">
          <p className="truncate text-[10px] font-semibold tracking-[0.16em] text-mist uppercase">Removal ledger · {project.name}</p>
          <h1 className="truncate text-[17px] leading-tight font-semibold tracking-tight text-frost">
            {spec.registry} · {spec.methodology}
          </h1>
          <p className="truncate text-[10.5px] text-mist">
            {isGenericSpec(spec) ? "Generic tree until this methodology is transcribed" : spec.edition} · {blocks.length} block{blocks.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="ml-auto hidden items-center divide-x divide-line/70 xl:flex">
          <HeaderFigure label="Net removed" value={formatTonnes(totals.net)} color="#070808" />
          <HeaderFigure label="Issued" value={formatTonnes(totals.issued)} color={BLOCK_TONE.issued.face} />
          <HeaderFigure label="In review" value={formatTonnes(totals.inReview)} color={BLOCK_TONE.verification.face} />
          <HeaderFigure label="Unclaimed" value={formatTonnes(totals.unclaimed)} color={PROPOSAL.stroke} />
        </div>
        <span title={dataset?.note ?? badge.title} className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${badge.className}`}>
          {badge.label}
        </span>
      </header>

      {ledger.status === "loading" ? (
        <div className="relative grid flex-1 place-items-center text-[13px] text-mist">Reading monitoring data…</div>
      ) : ledger.status === "error" || !bounds || !shown.view ? (
        <div className="relative grid flex-1 place-items-center px-6 text-center text-[13px] text-mist">
          {ledger.error ?? dataset?.note ?? "No monitoring data for this project yet."}
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 gap-5 p-5">
          <main className="scroll-slim flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto">
            <Panel
              title="Block chain"
              icon={<Link2 className="size-3.5" />}
              actions={
                <div className="flex flex-wrap items-center gap-3">
                  {STAGE_ORDER.map((stage) => (
                    <span key={stage} className="flex items-center gap-1.5 text-[10.5px] text-mist">
                      <span className="size-2 rounded-[2px]" style={{ background: BLOCK_TONE[stage].face }} />
                      {STAGE_META[stage].label}
                    </span>
                  ))}
                </div>
              }
            >
              <BlockChain
                blocks={shown.visible}
                netById={netById}
                selection={selection}
                selectionNet={selection ? (windowEval?.root.value ?? null) : null}
                onSuggest={() => suggest(3)}
                earlier={shown.earlier}
                later={shown.later}
                live={shown.live}
                onOlder={shown.older}
                onNewer={shown.newer}
              />
            </Panel>

            <Panel
              title="Net removal over time"
              icon={<CalendarRange className="size-3.5" />}
              className="flex min-h-[340px] flex-1 flex-col"
              actions={
                <div className="flex gap-1">
                  {presets.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={preset.run}
                      className="rounded-lg px-2.5 py-1 text-[10.5px] font-semibold text-mist ring-1 ring-line/70 hover:bg-white hover:text-frost"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              }
            >
              <div ref={timelineRef} className="min-h-0 flex-1 px-3 pt-2">
                {timelineHeight > 0 ? (
                  <RemovalTimeline
                    daily={daily}
                    blocks={blocks}
                    bounds={bounds}
                    view={shown.view}
                    onView={shown.setView}
                    findings={globalFindings}
                    height={Math.max(220, timelineHeight - 8)}
                  />
                ) : null}
              </div>
              <div className="flex items-center gap-4 border-t border-line/60 px-5 py-2.5">
                <div className="w-[138px] shrink-0">
                  <p className="text-[9.5px] font-semibold tracking-[0.14em] text-mist uppercase">Showing</p>
                  <p className="truncate text-[11.5px] font-semibold text-frost">
                    {monthYear(shown.view.start)} – {shown.live ? "today" : monthYear(shown.view.end)}
                  </p>
                  <p className="text-[10px] text-mist tabular-nums">
                    {shown.visible.length} of {blocks.length} block{blocks.length === 1 ? "" : "s"}
                  </p>
                </div>
                <TimelineNavigator daily={daily} blocks={blocks} bounds={bounds} view={shown.view} selection={selection} onView={shown.setView} />
                <div className="flex shrink-0 flex-col gap-1">
                  <ViewButton active={shown.atLatest} onClick={shown.showLatest}>
                    Latest
                  </ViewButton>
                  <ViewButton active={shown.showsAll} onClick={shown.showAll}>
                    All
                  </ViewButton>
                </div>
              </div>
              <footer className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line/60 px-5 py-2.5 text-[10.5px] text-mist">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-1.5 rounded-[1px] bg-shale/60" />Net removal, unclaimed</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-1.5 rounded-[1px] bg-[repeating-linear-gradient(45deg,#57544A_0_1px,transparent_1px_3px)]" />Gross, net awaiting inputs</span>
                <span className="flex items-center gap-1.5"><span className="h-1 w-3 bg-[repeating-linear-gradient(45deg,#DF7626_0_1px,transparent_1px_3px)]" />No stream rows</span>
                <span className="flex items-center gap-1.5"><span className="text-signal-amber">▼</span>Unusual day</span>
                <span className="ml-auto">Drag across open days, or click a month, to propose a block · swipe sideways to move in time, pinch to zoom.</span>
              </footer>
            </Panel>
          </main>

          <aside className="glass scroll-slim w-[440px] shrink-0 overflow-y-auto rounded-[24px] p-5">
            {selection ? (
              <ProposalDetail
                creditUnit={spec.creditUnit}
                selection={selection}
                coverage={coverage}
                evaluation={windowEval}
                findings={windowFindings}
                error={createError}
                onCalc={(nodeId) => openCalc({ kind: "range", range: selection }, nodeId)}
                onCreate={createBlock}
                onClear={() => setSelection(null)}
              />
            ) : focused ? (
              <BlockDetail
                registry={project.registry}
                creditUnit={spec.creditUnit}
                block={focused}
                coverage={coverage}
                evaluation={windowEval}
                findings={windowFindings}
                canOpenDesk={Boolean(batches?.some((batch) => batch.id === focused.id))}
                onCalc={(nodeId) => openCalc({ kind: "block", blockId: focused.id }, nodeId)}
                onDesk={() => {
                  selectSubmission(focused.id);
                  openDesk();
                }}
                onDiscard={() => {
                  if (!window.confirm(`Discard draft block ${focused.label}? Its days become unclaimed again.`)) return;
                  removePeriod(project.id, focused.id);
                  focusBlock(null);
                }}
                onClose={() => focusBlock(null)}
              />
            ) : (
              <AttentionList
                blocks={blocks}
                findings={globalFindings}
                unclaimed={totals.unclaimed}
                openFrom={nextOpenDay(blocks, bounds)}
                onBatchNext={() => suggest(3)}
              />
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
