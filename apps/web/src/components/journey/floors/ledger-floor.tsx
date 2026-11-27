"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, Check, ChevronLeft, Link2, Lock, TriangleAlert } from "lucide-react";

import type { Ledger } from "@/hooks/use-ledger";
import { addDays, formatRange, monthLabel, rangeDays } from "@/lib/mrv/days";
import { STAGE_META } from "@/lib/mrv/registry-pipeline";
import { ledgerTotals } from "@/lib/mrv/summary";
import type { BlockStage } from "@/lib/mrv/types";
import type { StepId } from "@/lib/journey/types";
import { stepProgress, usePlan, useJourney } from "@/store/journey-store";
import { formatTonnes } from "@/components/stage/format";
import { CubeShell } from "@/components/stage/ledger/cube-shell";
import { BLOCK_TONE, originBadge } from "@/components/stage/theme";
import { useElementSize } from "@/components/stage/use-element-size";
import { CortexAvatar } from "../task-card";
import {
  BOX_DEPTH,
  BOX_FACE,
  BOX_FACE_H,
  BOX_SPAN,
  averageWindow,
  chainLayout,
  runningMean,
  trendBinDays,
  trendBins,
  trendScale,
  type ChainLayout,
} from "./chain-layout";
import { ChainOverview } from "./chain-overview";
import { goToFloor } from "./floor-anchors";
import { FloorHeading, WhereCard } from "./floor-parts";
import { LedgerTrend } from "./ledger-trend";
import { PeriodDetails } from "./period-details";
import { TRACK, TRACK_LABEL, type PeriodBox, type TrackState, type TrackStep } from "./periods";

/** Room above the boxes for Cortex's moon over the period in progress. */
const ROW_TOP = 96;
const ROW_H = ROW_TOP + BOX_FACE_H + BOX_DEPTH;
/** Height of the band joining each box to its days on the trend. */
const LINK_H = 64;
const DETAILS_MAX = 660;

const STAGE_ORDER: BlockStage[] = ["draft", "submitted", "verification", "issues", "issued"];

const STATE_WORD: Record<TrackState, string> = {
  done: "done",
  current: "in progress",
  flagged: "needs a check",
  upcoming: "to come",
};

/** One step on a period's verification track. */
function TrackNode({
  step,
  state,
  ink,
  face,
  live,
  note,
  onOpen,
}: {
  step: TrackStep;
  state: TrackState;
  ink: string;
  face: string;
  live: boolean;
  note: string;
  onOpen?: () => void;
}) {
  const title = `${TRACK_LABEL[step]}: ${STATE_WORD[state]}${note ? ` · ${note}` : ""}`;
  const dot =
    state === "done" ? (
      <span className="grid size-[18px] place-items-center rounded-full" style={{ background: ink, color: face }}>
        <Check className="size-2.5" strokeWidth={3.2} />
      </span>
    ) : state === "flagged" ? (
      <span className="grid size-[18px] place-items-center rounded-full font-mono text-[10px] font-bold" style={{ background: ink, color: face }}>
        !
      </span>
    ) : state === "current" ? (
      <span className="relative grid size-[18px] place-items-center rounded-full border-2" style={{ borderColor: ink }}>
        {live ? <span className="absolute inset-[-4px] animate-ping rounded-full border" style={{ borderColor: ink, opacity: 0.45 }} /> : null}
        <span className="size-2 rounded-full" style={{ background: ink }} />
      </span>
    ) : (
      <span className="size-[18px] rounded-full border" style={{ borderColor: ink, opacity: 0.4 }} />
    );

  const label = (
    <span className="text-[9.5px] leading-none font-semibold" style={{ opacity: state === "upcoming" ? 0.6 : 0.95 }}>
      {TRACK_LABEL[step]}
    </span>
  );

  if (onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        title={`${title} · open the step`}
        className="pointer-events-auto relative z-10 flex flex-col items-center gap-1 rounded-md px-0.5 py-0.5 outline-none hover:bg-black/8 focus-visible:ring-2"
        style={{ ["--tw-ring-color" as string]: ink }}
      >
        {dot}
        {label}
      </button>
    );
  }
  return (
    <span title={title} className="flex flex-col items-center gap-1 px-0.5 py-0.5">
      {dot}
      {label}
    </span>
  );
}

/** The four verification steps in a row, joined like the loop they come from. */
function Track({
  box,
  ink,
  face,
  notes,
  onOpen,
}: {
  box: PeriodBox;
  ink: string;
  face: string;
  notes: Partial<Record<TrackStep, string>>;
  onOpen?: (step: TrackStep) => void;
}) {
  const reached = TRACK.filter((step) => box.track[step] !== "upcoming").length;
  return (
    <div className="relative">
      <span aria-hidden className="absolute top-[11px] right-[22px] left-[22px] h-px" style={{ background: ink, opacity: 0.28 }} />
      <span
        aria-hidden
        className="absolute top-[11px] left-[22px] h-px"
        style={{ background: ink, opacity: 0.8, width: `calc((100% - 44px) * ${Math.max(0, reached - 1) / (TRACK.length - 1)})` }}
      />
      <ol className="relative grid grid-cols-4" aria-label="Verification steps">
        {TRACK.map((step) => (
          <li key={step} className="flex justify-center">
            <TrackNode
              step={step}
              state={box.track[step]}
              ink={ink}
              face={face}
              live={box.live}
              note={notes[step] ?? ""}
              onOpen={onOpen ? () => onOpen(step) : undefined}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Cortex as a small moon over the period in progress, with the "you are here" pill. */
function LiveBeacon({ anchor }: { anchor: boolean }) {
  return (
    <div
      aria-hidden
      data-floor-anchor={anchor ? "first" : undefined}
      className="pointer-events-none absolute -top-[80px] left-0 z-20 flex flex-col items-center"
      style={{ width: BOX_FACE }}
    >
      <span className="cortex-moon">
        <CortexAvatar size={20} />
      </span>
      <span className="mt-1 rounded-full bg-olivine-800 px-2 py-0.5 text-[9.5px] font-bold tracking-[0.14em] text-calcite uppercase shadow-[0_0_0_3px_rgba(178,190,139,0.4)]">
        You are here
      </span>
      <span className="h-2.5 border-l border-dashed border-olivine-800" />
    </div>
  );
}

function PeriodCube({
  box,
  net,
  selected,
  expanded,
  hovered,
  anchorFirst,
  onSelect,
  onHover,
  onOpenStep,
}: {
  box: PeriodBox;
  net: number | null;
  selected: boolean;
  expanded: boolean;
  hovered: boolean;
  anchorFirst: boolean;
  onSelect: () => void;
  onHover: (hovered: boolean) => void;
  onOpenStep: (step: StepId) => void;
}) {
  const tasks = useJourney((state) => state.tasks);
  const plan = usePlan();
  const tone = BLOCK_TONE[box.tone];
  const dates = box.range ? `${formatRange(box.range)} · ${rangeDays(box.range)} d` : "Dates not given yet";

  // The live period's track reads from the journey: how much of each step is in.
  const notes: Partial<Record<TrackStep, string>> = {};
  let status: string;
  if (box.live) {
    for (const step of TRACK) {
      const progress = stepProgress(plan.stepById[step], tasks);
      notes[step] = `${progress.done}/${progress.total}${progress.flagged ? ` · ${progress.flagged} to check` : ""}`;
    }
    const at = TRACK.find((step) => box.track[step] === "current" || box.track[step] === "flagged") ?? "issued";
    status = `${plan.stepById[at].label} · ${notes[at]}`;
  } else {
    const blockers = box.block?.issues.filter((issue) => issue.severity === "blocker").length ?? 0;
    status = `${box.block ? STAGE_META[box.block.stage].label : ""}${blockers ? ` · ${blockers} blocker${blockers === 1 ? "" : "s"}` : ""}`;
  }

  const select = (
    <button
      type="button"
      onClick={onSelect}
      aria-expanded={expanded}
      aria-label={`${box.label}, ${dates}: ${expanded ? "hide" : "show"} its details`}
      className="absolute inset-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset"
      style={{ ["--tw-ring-color" as string]: tone.ink }}
    />
  );
  const marker =
    selected && !expanded ? (
      <span
        data-floor-anchor="selected"
        aria-hidden
        className="absolute -bottom-4 size-0 border-x-[8px] border-t-[8px] border-x-transparent border-t-earth"
        style={{ left: BOX_FACE / 2 - 8 }}
      />
    ) : selected ? (
      <span data-floor-anchor="selected" aria-hidden className="absolute bottom-0 size-0" style={{ left: BOX_FACE / 2 }} />
    ) : null;

  if (box.locked) {
    return (
      <div
        data-box-id={box.id}
        data-floor-anchor={anchorFirst ? "first" : undefined}
        className={`relative flex flex-col justify-between rounded-sm border-2 border-dashed bg-white/30 p-3 text-earth/75 transition-colors ${
          expanded || hovered ? "border-earth/60 bg-white/45" : "border-earth/30"
        }`}
        style={{ width: BOX_FACE, height: BOX_FACE_H, marginTop: BOX_DEPTH }}
        onPointerEnter={() => onHover(true)}
        onPointerLeave={() => onHover(false)}
      >
        {select}
        <span className="pointer-events-none flex items-center justify-between font-mono text-[9.5px]">
          <span>#{box.sequence}</span>
          <Lock className="size-3" />
        </span>
        <span className="pointer-events-none">
          <span className="block text-[13px] leading-tight font-semibold text-earth">{box.label}</span>
          <span className="mt-1 block text-[10.5px] leading-snug">Opens once the facility is validated and the crediting period starts.</span>
        </span>
        <span className="pointer-events-none">
          <Track box={box} ink="#0D1802" face="#EADAC7" notes={{}} />
        </span>
        {marker}
      </div>
    );
  }

  return (
    <div
      data-box-id={box.id}
      data-floor-anchor={anchorFirst && !box.live ? "first" : undefined}
      className={`relative ${selected ? "z-10" : ""}`}
      style={{ width: BOX_SPAN, height: BOX_FACE_H + BOX_DEPTH }}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
    >
      <CubeShell tone={tone} face={{ width: BOX_FACE, height: BOX_FACE_H }} depth={BOX_DEPTH} focused={selected} hovered={hovered}>
        {select}
        <span className="pointer-events-none relative flex h-full flex-col justify-between p-3">
          <span className="flex items-center justify-between font-mono text-[9.5px] opacity-80">
            <span>#{box.sequence}</span>
            {box.live ? (
              <span className="tracking-wide uppercase">this period</span>
            ) : box.block?.origin === "sample" ? (
              <span className="tracking-wide uppercase">sample</span>
            ) : box.block?.origin === "draft" ? (
              <span className="tracking-wide uppercase">draft</span>
            ) : null}
          </span>
          <span>
            <span className="block text-[13px] leading-tight font-semibold">{box.label}</span>
            <span className="mt-0.5 block text-[10px] opacity-75">{dates}</span>
          </span>
          <span className="font-mono text-[19px] leading-none font-semibold tabular-nums">
            {box.range ? formatTonnes(net) : "—"}
            <span className="ml-1 font-sans text-[10px] font-normal opacity-75">t CO₂ net</span>
          </span>
          <Track
            box={box}
            ink={tone.ink}
            face={tone.face}
            notes={notes}
            onOpen={box.live ? (step) => onOpenStep(step) : undefined}
          />
          <span className="flex items-center gap-1 truncate text-[10px] font-medium opacity-90">
            {box.track.audit === "flagged" ? <TriangleAlert className="size-3 shrink-0" /> : null}
            <span className="truncate">{status}</span>
          </span>
        </span>
      </CubeShell>
      {box.live ? <LiveBeacon anchor={anchorFirst} /> : null}
      {marker}
    </div>
  );
}

/** Where the details panel sits under a box: centred on it, kept inside the chain. */
function detailsPlacement(layout: ChainLayout, left: number, viewport: number) {
  const width = Math.min(DETAILS_MAX, Math.max(280, viewport - 24));
  const centre = left + BOX_FACE / 2;
  const at = Math.min(Math.max(12, centre - width / 2), Math.max(12, layout.width - 12 - width));
  return { left: at, width, notch: centre - at };
}

/**
 * The band joining each box to its days on the trend, and the details panel
 * that opens under a box. While the panel is open the bands drop straight
 * past it, so every box stays tied to its days.
 */
function DetailsAndLinks({
  layout,
  boxes,
  open,
  net,
  ledger,
  viewport,
  hoveredId,
  selectedId,
  onClose,
}: {
  layout: ChainLayout;
  boxes: PeriodBox[];
  open: PeriodBox | null;
  net: number | null;
  ledger: Ledger | null;
  viewport: number;
  hoveredId: string | null;
  selectedId: string | null;
  onClose: () => void;
}) {
  const [rowRef, { height: stem }] = useElementSize<HTMLDivElement>();
  const gradient = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const openLeft = open ? layout.left.get(open.id) : undefined;
  const place = openLeft != null ? detailsPlacement(layout, openLeft, viewport) : null;
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative" style={{ width: layout.width }}>
      <svg aria-hidden className="pointer-events-none absolute top-0 left-0" width={layout.width} height={stem + LINK_H}>
        <defs>
          {STAGE_ORDER.map((stage) => (
            <linearGradient key={stage} id={`${gradient}-${stage}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={BLOCK_TONE[stage].face} stopOpacity={0.95} />
              <stop offset="1" stopColor={BLOCK_TONE[stage].band} stopOpacity={0.35} />
            </linearGradient>
          ))}
        </defs>
        {boxes.map((box) => {
          const left = layout.left.get(box.id);
          if (!box.range || left == null) return null;
          const tone = BLOCK_TONE[box.tone];
          const fl = left;
          const fr = left + BOX_FACE;
          const tl = layout.x(box.range.start);
          const tr = layout.x(addDays(box.range.end, 1));
          const y1 = stem;
          const y2 = stem + LINK_H;
          const k = LINK_H * 0.55;
          const lit = box.id === hoveredId || box.id === selectedId;
          const left_ = `M ${fl} ${y1} C ${fl} ${y1 + k}, ${tl} ${y2 - k}, ${tl} ${y2}`;
          const right_ = `M ${fr} ${y1} C ${fr} ${y1 + k}, ${tr} ${y2 - k}, ${tr} ${y2}`;
          return (
            <g key={box.id} opacity={lit ? 1 : 0.6}>
              {stem > 0 ? (
                <path d={`M ${fl} 0 V ${y1} M ${fr} 0 V ${y1}`} stroke={tone.side} strokeOpacity={0.55} strokeDasharray="3 4" fill="none" />
              ) : null}
              <path
                d={`M ${fl} ${y1} C ${fl} ${y1 + k}, ${tl} ${y2 - k}, ${tl} ${y2} L ${tr} ${y2} C ${tr} ${y2 - k}, ${fr} ${y1 + k}, ${fr} ${y1} Z`}
                fill={`url(#${gradient}-${box.tone})`}
                fillOpacity={lit ? 0.85 : 0.5}
              />
              <path d={`${left_} ${right_}`} stroke={tone.side} strokeOpacity={lit ? 0.9 : 0.5} strokeWidth={lit ? 1.4 : 1} fill="none" />
            </g>
          );
        })}
      </svg>

      <div ref={rowRef} className="relative z-[3]">
        <AnimatePresence initial={false}>
          {open && place ? (
            <motion.div
              key="details"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
              onAnimationComplete={() => panelRef.current?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" })}
            >
              <motion.div
                ref={panelRef}
                initial={false}
                animate={{ marginLeft: place.left }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="scroll-mt-24 scroll-mb-28 pt-3 pb-1"
                style={{ width: place.width }}
              >
                <PeriodDetails box={open} net={net} ledger={ledger} notch={place.notch} onClose={onClose} />
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      <div style={{ height: LINK_H }} />
    </div>
  );
}

function Figure({ label, value, swatch }: { label: string; value: string; swatch?: string }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[9.5px] font-semibold tracking-[0.14em] text-strata-700 uppercase">
        {swatch ? <span className="size-2 rounded-[2px]" style={{ background: swatch }} /> : null}
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-[17px] leading-none font-semibold text-earth">
        {value}
        <span className="ml-1 font-sans text-[10px] font-normal text-strata-700">t</span>
      </dd>
    </div>
  );
}

/** Before the ledger has data: why the trend is empty, held in view while the row scrolls. */
function TrendNote({ text, viewport }: { text: string; viewport: number }) {
  return (
    <div className="sticky left-0 grid h-[132px] place-items-center px-6 text-center text-[12px] text-strata-700" style={{ width: viewport || undefined }}>
      {text}
    </div>
  );
}

/** Keep a stretch of the chain on screen, scrolling sideways only as far as needed. */
function reveal(scroller: RefObject<HTMLDivElement | null>, from: number, to: number) {
  const node = scroller.current;
  if (!node) return;
  const view = node.scrollLeft;
  const room = node.clientWidth;
  if (from < view + 12) node.scrollTo({ left: from - 12, behavior: "smooth" });
  else if (to > view + room - 12) node.scrollTo({ left: Math.min(from - 12, to - room + 12), behavior: "smooth" });
}

/**
 * Floor 2: the removal ledger. Every box is one monitoring period and carries
 * the same verification steps as the journey's loop; the period in progress
 * follows the journey. Under the boxes, the CO₂ removal trend runs from the
 * first day of monitoring to today, each box joined to the days it covers.
 * Boxes and trend scroll together. A box opens its details under it, and its
 * calculation on the floor below.
 */
export function LedgerFloor({
  scope,
  ledger,
  boxes,
  netById,
  selectedId,
  onSelect,
}: {
  /** The project the ledger belongs to. */
  scope: string;
  ledger: Ledger | null;
  boxes: PeriodBox[];
  netById: Map<string, number | null>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const current = useJourney((state) => state.current);
  const selectStep = useJourney((state) => state.selectStep);
  const plan = usePlan();
  const inLoop = plan.stepById[current].phase === "verification";
  const [scrollerRef, { width: viewport }] = useElementSize<HTMLDivElement>();
  const history = ledger?.bounds ?? null;
  const daily = ledger?.daily;
  const blocks = ledger?.blocks;

  const layout = useMemo(() => chainLayout(boxes, history, viewport), [boxes, history, viewport]);
  const ordered = useMemo(() => {
    const byId = new Map(boxes.map((box) => [box.id, box]));
    return layout.order.map((id) => byId.get(id)).filter((box): box is PeriodBox => Boolean(box));
  }, [boxes, layout]);

  const binDays = trendBinDays(layout.pxPerDay);
  const windowBins = averageWindow(binDays);
  const bins = useMemo(() => trendBins(daily ?? [], binDays), [binDays, daily]);
  const average = useMemo(() => runningMean(bins.map((bin) => bin.perDay), windowBins), [bins, windowBins]);
  const max = useMemo(() => trendScale(bins), [bins]);
  const totals = useMemo(() => (daily && blocks ? ledgerTotals(daily, blocks) : null), [blocks, daily]);

  const [opened, setOpened] = useState<{ scope: string; id: string } | null>(null);
  const openId = opened?.scope === scope ? opened.id : null;
  const openBox = openId ? (ordered.find((box) => box.id === openId) ?? null) : null;
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const pick = useCallback(
    (id: string) => {
      const closing = openId === id;
      onSelect(id);
      setOpened(closing ? null : { scope, id });
      const left = layout.left.get(id);
      if (left == null) return;
      const place = detailsPlacement(layout, left, viewport);
      reveal(scrollerRef, closing ? left : Math.min(left, place.left), closing ? left + BOX_SPAN : Math.max(left + BOX_SPAN, place.left + place.width));
    },
    [layout, onSelect, openId, scope, scrollerRef, viewport],
  );

  // Open on the selected period, once per project, when the data has arrived.
  const placedFor = useRef("");
  const ready = `${scope}:${ledger?.status ?? "none"}`;
  useLayoutEffect(() => {
    const node = scrollerRef.current;
    if (!node || viewport === 0 || placedFor.current === ready) return;
    placedFor.current = ready;
    const id = selectedId ?? layout.order[layout.order.length - 1];
    const left = id ? layout.left.get(id) : undefined;
    if (left != null) node.scrollLeft = left + BOX_SPAN / 2 - node.clientWidth / 2;
  }, [layout, ready, scrollerRef, selectedId, viewport]);

  // When the first period is scrolled out of view, the line from the validated
  // project ends on a button that brings it back.
  const first = ordered[0] ?? null;
  const firstLeft = first ? layout.left.get(first.id) : undefined;
  const [firstHidden, setFirstHidden] = useState(false);
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node || firstLeft == null) return;
    const check = () => setFirstHidden(node.scrollLeft > firstLeft + BOX_SPAN * 0.6);
    const frame = window.requestAnimationFrame(check);
    node.addEventListener("scroll", check, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      node.removeEventListener("scroll", check);
    };
  }, [firstLeft, scrollerRef]);

  const badge = originBadge(ledger?.dataset);
  const selected = boxes.find((box) => box.id === selectedId) ?? null;
  const trendReady = Boolean(history && ledger?.status === "ready" && bins.length);

  return (
    <section id="floor-ledger" aria-label="Floor 2, removal ledger" className="journey-floor journey-floor--ledger px-4 pt-24 pb-24 sm:px-6 lg:px-10 lg:pr-28">
      <div className="relative z-[2] flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <FloorHeading
          floor={2}
          eyebrow="verification, every monitoring period"
          title="Removal ledger"
          sub="Each block is one monitoring period, taken through the same steps: Monitor, Report, Verification and Credits issued. Under the blocks, the CO₂ removed from the first day of monitoring to today, each block joined to its days. Open a block for where it stands, its issues and what is left to do."
        >
          {totals && history ? (
            <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              <Figure label={`Net removed since ${monthLabel(history.start)} ${history.start.slice(0, 4)}`} value={formatTonnes(totals.net)} />
              <Figure label="Issued" value={formatTonnes(totals.issued)} swatch={BLOCK_TONE.issued.face} />
              <Figure label="In review" value={formatTonnes(totals.inReview)} swatch={BLOCK_TONE.verification.face} />
              {totals.unclaimed > 0 ? <Figure label="Not in a block yet" value={formatTonnes(totals.unclaimed)} swatch="#A8A087" /> : null}
            </dl>
          ) : null}
        </FloorHeading>
        {inLoop ? (
          <aside className="w-full shrink-0 xl:w-[20rem]">
            <WhereCard />
          </aside>
        ) : null}
      </div>

      <div className="relative z-[2] mt-6">
        <section data-ledger-panel className="glass min-w-0 rounded-[24px]">
          {/* The panel's top edge stays clear: the line from the validated project drops in there. */}
          <div
            ref={scrollerRef}
            data-chain-scroller
            tabIndex={0}
            aria-label="Monitoring periods and the CO₂ removal trend. Scroll sideways to move through time."
            className="scroll-slim relative overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-t-[24px] outline-none focus-visible:ring-2 focus-visible:ring-earth/40 focus-visible:ring-inset"
          >
            <div className="relative pb-3" style={{ width: layout.width }}>
              <div className="relative" style={{ height: ROW_H }}>
                {first && firstHidden ? (
                  <div className="sticky left-0 z-30 h-0 w-0">
                    <button
                      type="button"
                      data-floor-anchor="first"
                      onClick={() => scrollerRef.current?.scrollTo({ left: 0, behavior: "smooth" })}
                      className="absolute left-3 flex items-center gap-1 rounded-full bg-[#1D250A]/92 py-1 pr-3 pl-1.5 text-[10.5px] font-semibold whitespace-nowrap text-calcite shadow-[0_8px_18px_-8px_rgba(13,24,2,0.6)] backdrop-blur-md hover:bg-[#1D250A]"
                      style={{ top: ROW_TOP - 34 }}
                    >
                      <ChevronLeft className="size-3.5" />
                      #{first.sequence}
                      <span className="hidden sm:inline"> · {first.label} · the first period</span>
                    </button>
                  </div>
                ) : null}
                {ordered.map((box, index) => (
                  <div key={box.id} className="absolute" style={{ left: layout.left.get(box.id), top: ROW_TOP }}>
                    <PeriodCube
                      box={box}
                      net={netById.get(box.id) ?? null}
                      selected={box.id === selectedId}
                      expanded={box.id === openId}
                      hovered={box.id === hoveredId}
                      anchorFirst={index === 0 && !firstHidden}
                      onSelect={() => pick(box.id)}
                      onHover={(on) => setHoveredId((prev) => (on ? box.id : prev === box.id ? null : prev))}
                      onOpenStep={(step) => selectStep(step)}
                    />
                  </div>
                ))}
              </div>

              <DetailsAndLinks
                layout={layout}
                boxes={ordered}
                open={openBox}
                net={openBox ? (netById.get(openBox.id) ?? null) : null}
                ledger={ledger}
                viewport={viewport}
                hoveredId={hoveredId}
                selectedId={selectedId}
                onClose={() => setOpened(null)}
              />

              {trendReady && history ? (
                <LedgerTrend
                  layout={layout}
                  history={history}
                  bins={bins}
                  average={average}
                  averageDays={windowBins * binDays}
                  max={max}
                  binDays={binDays}
                  boxes={ordered}
                  selectedId={selectedId}
                  hoveredId={hoveredId}
                  scroller={scrollerRef}
                  onHover={setHoveredId}
                  onPick={pick}
                />
              ) : (
                <TrendNote
                  viewport={viewport}
                  text={
                    ledger?.status === "loading"
                      ? "Reading monitoring data…"
                      : ledger?.status === "error"
                        ? (ledger.error ?? "The monitoring data could not be read.")
                        : "No monitoring data yet. The CO₂ removal trend fills in here, from the first day of monitoring to today."
                  }
                />
              )}
            </div>
          </div>

          {trendReady ? <ChainOverview scroller={scrollerRef} layout={layout} history={history} bins={bins} max={max} boxes={ordered} /> : null}

          <footer className="space-y-2 border-t border-earth/10 px-5 py-3 text-[10.5px] text-strata-700">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
              <span className="flex items-center gap-1.5 font-semibold tracking-[0.14em] text-strata-700 uppercase">
                <Link2 className="size-3.5" />
                Blocks
                {ledger ? (
                  <span title={ledger.dataset?.note ?? badge.title} className={`ml-1 rounded-full px-2 py-0.5 text-[9.5px] tracking-normal normal-case ${badge.className}`}>
                    {badge.label}
                  </span>
                ) : null}
              </span>
              {STAGE_ORDER.map((stage) => (
                <span key={stage} className="flex items-center gap-1.5">
                  <span className="size-2 rounded-[2px]" style={{ background: BLOCK_TONE[stage].face, boxShadow: `inset 0 0 0 1px ${BLOCK_TONE[stage].side}` }} />
                  {STAGE_META[stage].label}
                </span>
              ))}
              <span className="text-earth/30">|</span>
              <span className="flex items-center gap-1.5">
                <span className="grid size-3.5 place-items-center rounded-full bg-earth text-calcite">
                  <Check className="size-2" strokeWidth={3.5} />
                </span>
                Done
              </span>
              <span className="flex items-center gap-1.5">
                <span className="grid size-3.5 place-items-center rounded-full border-2 border-earth">
                  <span className="size-1.5 rounded-full bg-earth" />
                </span>
                In progress
              </span>
              <span className="flex items-center gap-1.5">
                <span className="grid size-3.5 place-items-center rounded-full bg-earth font-mono text-[8px] font-bold text-calcite">!</span>
                Needs a check
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3.5 rounded-full border border-earth/40" />
                To come
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
              <span className="font-semibold tracking-[0.14em] uppercase">Trend</span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-1.5 rounded-t-[1px] bg-[#A8A087]" />
                Net removal a day{binDays > 1 ? `, ${binDays}-day bars` : ""}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4 rounded-full bg-earth" />
                {windowBins * binDays}-day average
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-3 rounded-[2px] bg-[#BEB290]/45" />A block&apos;s days
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-1.5 bg-[repeating-linear-gradient(45deg,#57544A_0_1px,transparent_1px_3px)]" />
                Gross, net not calculable yet
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1 w-3 rounded-[1px] bg-[#A77618]/55" />
                No stream rows
              </span>
              <span className="hidden text-strata-700/80 lg:inline">Swipe sideways or drag the trend to move in time · click a block or its days to open it</span>
              <button
                type="button"
                onClick={() => goToFloor(3)}
                className="btn-glass ml-auto inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-[11.5px] font-semibold text-earth"
              >
                {selected ? `${selected.label}: its calculation` : "Calculation"}
                <ArrowDown className="size-3.5" />
              </button>
            </div>
          </footer>
        </section>
      </div>
    </section>
  );
}
