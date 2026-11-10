"use client";

import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { ArrowLeftRight, ChevronLeft, ChevronRight, Plus, TriangleAlert } from "lucide-react";
import { formatRange, rangeDays } from "@/lib/mrv/days";
import { STAGE_META } from "@/lib/mrv/registry-pipeline";
import type { DateRange, LedgerBlock } from "@/lib/mrv/types";
import { useStage } from "@/store/stage-store";
import { formatTonnes } from "../format";
import { BLOCK_TONE, PROPOSAL } from "../theme";

const FACE = 92;
const DEPTH = 9;
/** A focused block grows a little instead of wearing an outline. */
const FOCUS_SCALE = 1.1;

/** One block, drawn as a small extruded cube like a block explorer's. */
function BlockCube({
  block,
  net,
  focused,
  hovered,
}: {
  block: LedgerBlock;
  net: number | null;
  focused: boolean;
  hovered: boolean;
}) {
  const focusBlock = useStage((state) => state.focusBlock);
  const hoverBlock = useStage((state) => state.hoverBlock);
  const tone = BLOCK_TONE[block.stage];
  const blockers = block.issues.filter((issue) => issue.severity === "blocker").length;

  return (
    <button
      type="button"
      onClick={() => focusBlock(focused ? null : block.id)}
      onPointerEnter={() => hoverBlock(block.id)}
      onPointerLeave={() => hoverBlock(null)}
      aria-pressed={focused}
      aria-label={`Block ${block.sequence}, ${block.label}, ${STAGE_META[block.stage].label}`}
      data-block-id={block.id}
      className={`group relative shrink-0 cursor-pointer text-left outline-none ${focused ? "z-10" : ""}`}
      style={{ width: FACE + DEPTH, height: FACE + DEPTH }}
    >
      <span
        className="absolute inset-0 transition-transform duration-300 ease-out"
        style={{
          transformOrigin: "50% 100%",
          transform: focused ? `translateY(-3px) scale(${FOCUS_SCALE})` : hovered ? "translateY(-4px)" : undefined,
        }}
      >
        {/* Top and side faces give the block its depth. */}
        <span
          aria-hidden
          className="absolute top-0 left-0"
          style={{ width: FACE, height: DEPTH, background: tone.top, transform: "skewX(-45deg)", transformOrigin: "bottom left" }}
        />
        <span
          aria-hidden
          className="absolute bottom-0"
          style={{ left: FACE, width: DEPTH, height: FACE, background: tone.side, transform: "skewY(-45deg)", transformOrigin: "bottom left" }}
        />
        <span
          className="absolute bottom-0 left-0 flex flex-col justify-between overflow-hidden px-2 py-1.5 transition-shadow duration-300"
          style={{
            width: FACE,
            height: FACE,
            background: `linear-gradient(160deg, ${tone.top} -40%, ${tone.face} 55%)`,
            color: tone.ink,
            boxShadow: focused ? "0 16px 28px rgba(7,8,8,0.28)" : "0 6px 14px rgba(7,8,8,0.12)",
          }}
        >
          <span className="flex items-center justify-between font-mono text-[9px] opacity-80">
            <span>#{block.sequence}</span>
            {block.origin === "sample" ? <span className="tracking-wide uppercase">sample</span> : null}
            {block.origin === "draft" ? <span className="tracking-wide uppercase">draft</span> : null}
          </span>
          <span className="text-[11px] leading-tight font-semibold">{block.label}</span>
          <span className="font-mono text-[15px] leading-none font-semibold tabular-nums">
            {formatTonnes(net)}
            <span className="ml-0.5 text-[9px] font-normal opacity-75">t</span>
          </span>
          <span className="flex items-center justify-between text-[9px] font-medium opacity-90">
            <span>{STAGE_META[block.stage].label}</span>
            {blockers > 0 ? (
              <span className="flex items-center gap-0.5">
                <TriangleAlert className="size-2.5" />
                {blockers}
              </span>
            ) : null}
          </span>
        </span>
      </span>
      {focused ? (
        <span
          aria-hidden
          className="absolute -bottom-3 size-0 border-x-[7px] border-b-[7px] border-x-transparent border-b-rock"
          style={{ left: FACE / 2 - 7 }}
        />
      ) : null}
    </button>
  );
}

/** The window being dragged on the timeline, shown as the next block. */
function ProposalCube({ selection, net, onSuggest }: { selection: DateRange | null; net: number | null; onSuggest: () => void }) {
  if (!selection) {
    return (
      <button
        type="button"
        onClick={onSuggest}
        className="flex shrink-0 flex-col items-center justify-center gap-1 rounded-sm border border-dashed border-shale/50 px-2 text-center text-[10px] leading-snug text-mist transition-colors hover:border-canyon hover:text-signal-amber"
        style={{ width: FACE, height: FACE, marginTop: DEPTH }}
      >
        <Plus className="size-4" />
        Next block
        <span className="text-[9px] opacity-80">drag on the timeline</span>
      </button>
    );
  }
  return (
    <div
      className="flex shrink-0 flex-col justify-between rounded-sm border-2 border-dashed px-2 py-1.5"
      style={{ width: FACE, height: FACE, marginTop: DEPTH, borderColor: PROPOSAL.stroke, background: PROPOSAL.fill, color: PROPOSAL.ink }}
    >
      <span className="font-mono text-[9px] tracking-wide uppercase">Proposed</span>
      <span className="text-[10.5px] leading-tight font-semibold">{formatRange(selection)}</span>
      <span className="font-mono text-[15px] leading-none font-semibold tabular-nums">
        {formatTonnes(net)}
        <span className="ml-0.5 text-[9px] font-normal opacity-75">t</span>
      </span>
      <span className="text-[9px]">{rangeDays(selection)} days</span>
    </div>
  );
}

/** The blocks beyond the view, as a small fanned stack that pages to them. */
function HistoryStub({ direction, count, onClick }: { direction: "older" | "newer"; count: number; onClick: () => void }) {
  const older = direction === "older";
  const what = count > 0 ? `${count} ${older ? "earlier" : "newer"} block${count === 1 ? "" : "s"}` : `${older ? "Earlier" : "Later"} days`;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Show ${what.toLowerCase()}`}
      aria-label={`Show ${what.toLowerCase()}`}
      className="group relative shrink-0 outline-none"
      style={{ width: 58, height: FACE }}
    >
      {[2, 1].map((layer) => (
        <span
          key={layer}
          aria-hidden
          className="absolute inset-0 rounded-md border border-shale/25 bg-white/50"
          style={{ transform: `translateX(${(older ? -1 : 1) * layer * 5}px) scale(${1 - layer * 0.07})`, opacity: 1 - layer * 0.3 }}
        />
      ))}
      <span className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 rounded-md border border-shale/40 bg-white/85 text-mist shadow-[0_6px_14px_rgba(7,8,8,0.08)] transition-colors group-hover:border-canyon group-hover:text-signal-amber">
        {older ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
        {count > 0 ? <span className="font-mono text-[15px] leading-none font-semibold text-frost tabular-nums">{count}</span> : null}
        <span className="text-[9px] leading-tight">{count > 0 ? (older ? "earlier" : "newer") : older ? "earlier days" : "later days"}</span>
      </span>
    </button>
  );
}

/**
 * The blocks inside the ledger's view, oldest first, with the next block where
 * it would fall in time. Stacks at either end page to the blocks beyond it.
 */
export function BlockChain({
  blocks,
  netById,
  selection,
  selectionNet,
  onSuggest,
  earlier,
  later,
  live,
  onOlder,
  onNewer,
}: {
  /** Blocks inside the view, oldest first. */
  blocks: LedgerBlock[];
  netById: Map<string, number | null>;
  selection: DateRange | null;
  selectionNet: number | null;
  onSuggest: () => void;
  /** Blocks wholly before and after the view. */
  earlier: number;
  later: number;
  /** The view reaches the last day of data, so the next block belongs at its end. */
  live: boolean;
  onOlder?: () => void;
  onNewer?: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const focusedBlockId = useStage((state) => state.focusedBlockId);
  const hoveredBlockId = useStage((state) => state.hoveredBlockId);
  const shownKey = `${blocks[0]?.id}|${blocks[blocks.length - 1]?.id}|${blocks.length}`;

  // Open on the newest end of what is shown, like a block explorer.
  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollLeft = node.scrollWidth;
  }, [shownKey]);

  // Bring a block focused from the timeline into view, sideways only.
  useEffect(() => {
    const node = scroller.current;
    if (!node || !focusedBlockId) return;
    const cube = node.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(focusedBlockId)}"]`);
    if (!cube) return;
    // The scroller is the cube's offset parent, so offsetLeft is in scroll space.
    const left = cube.offsetLeft;
    const right = left + cube.offsetWidth;
    if (left < node.scrollLeft + 16) node.scrollTo({ left: left - 16, behavior: "smooth" });
    else if (right > node.scrollLeft + node.clientWidth - 16) node.scrollTo({ left: right - node.clientWidth + 16, behavior: "smooth" });
  }, [focusedBlockId]);

  // The proposal sits where its days fall; with none, the open slot waits at the newest end.
  const slotAt = selection ? blocks.findIndex((block) => block.range.start > selection.start) : -1;
  const slotIndex = selection ? (slotAt === -1 ? blocks.length : slotAt) : live ? blocks.length : null;
  const slot: ReactNode = (
    <>
      <div className="flex shrink-0 flex-col items-center self-stretch px-1 text-shale/60" aria-hidden>
        <span className="w-px flex-1 border-l border-dashed border-shale/40" />
        <ArrowLeftRight className="my-1 size-3" />
        <span className="w-px flex-1 border-l border-dashed border-shale/40" />
      </div>
      <ProposalCube selection={selection} net={selectionNet} onSuggest={onSuggest} />
    </>
  );

  return (
    <div ref={scroller} className="scroll-slim relative flex items-end gap-3 overflow-x-auto overflow-y-hidden px-4 pt-5 pb-4">
      {onOlder ? <HistoryStub direction="older" count={earlier} onClick={onOlder} /> : null}
      {blocks.length === 0 && !onOlder && !onNewer ? (
        <p className="shrink-0 self-center pr-2 text-[11px] leading-relaxed text-mist" style={{ maxWidth: 220 }}>
          No blocks yet. Every block you create here is a registry batch; blocks never overlap.
        </p>
      ) : null}
      {blocks.map((block, index) => (
        <Fragment key={block.id}>
          {index === slotIndex ? slot : null}
          <BlockCube block={block} net={netById.get(block.id) ?? null} focused={block.id === focusedBlockId} hovered={block.id === hoveredBlockId} />
        </Fragment>
      ))}
      {slotIndex === blocks.length ? slot : null}
      {onNewer ? <HistoryStub direction="newer" count={later} onClick={onNewer} /> : null}
    </div>
  );
}
