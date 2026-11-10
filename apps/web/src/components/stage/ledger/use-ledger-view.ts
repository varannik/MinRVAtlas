"use client";

import { useMemo, useState } from "react";
import { clampView, latestView, newerView, olderView, revealRange, sameRange, viewBlocks } from "@/lib/mrv/ledger-view";
import type { DateRange, LedgerBlock } from "@/lib/mrv/types";

interface Held {
  /** Project the view belongs to. */
  scope: string;
  /** Focus it last followed, so a new focus slides the view once. */
  focusKey: string;
  /** Null follows the latest blocks. */
  view: DateRange | null;
}

export interface LedgerView {
  view: DateRange | null;
  /** Blocks inside the view, oldest first. */
  visible: LedgerBlock[];
  /** Blocks wholly before and after the view. */
  earlier: number;
  later: number;
  /** The view reaches the last day of data, where the next block goes. */
  live: boolean;
  atLatest: boolean;
  showsAll: boolean;
  setView: (view: DateRange) => void;
  showLatest: () => void;
  showAll: () => void;
  /** Page to older or newer blocks; absent at either end. */
  older?: () => void;
  newer?: () => void;
}

/**
 * The view the block chain and timeline share. It opens on the latest blocks
 * and stays where you move it. Focusing a block or window outside it slides
 * it just far enough to show that block or window.
 */
export function useLedgerView(scope: string, blocks: LedgerBlock[], bounds: DateRange | null, focus: DateRange | null): LedgerView {
  const focusKey = focus ? `${focus.start}/${focus.end}` : "";
  const [held, setHeld] = useState<Held>({ scope, focusKey: "", view: null });
  const latest = useMemo(() => (bounds ? latestView(blocks, bounds) : null), [blocks, bounds]);

  // Follow a new project or focus while rendering, React's pattern for state that tracks props.
  if (held.scope !== scope || held.focusKey !== focusKey) {
    const kept = held.scope === scope ? held.view : null;
    let view = kept;
    if (focus && bounds && latest) {
      view = revealRange(kept ? clampView(kept, bounds) : latest, focus, bounds);
      if (sameRange(view, latest)) view = null;
    }
    setHeld({ scope, focusKey, view });
  }

  const view = bounds && latest ? (held.scope === scope && held.view ? clampView(held.view, bounds) : latest) : null;
  const parts = view ? viewBlocks(blocks, view) : { visible: [], earlier: 0, later: 0 };
  const hold = (next: DateRange | null) => setHeld((prev) => ({ ...prev, view: next }));
  const older = view && bounds ? olderView(view, blocks, bounds) : null;
  const newer = view && bounds ? newerView(view, blocks, bounds) : null;

  return {
    view,
    ...parts,
    live: Boolean(view && bounds && view.end >= bounds.end),
    atLatest: sameRange(view, latest),
    showsAll: Boolean(view && bounds && sameRange(view, bounds)),
    setView: (next) => hold(bounds ? clampView(next, bounds) : next),
    showLatest: () => hold(null),
    showAll: () => hold(bounds),
    older: older ? () => hold(older) : undefined,
    newer: newer ? () => hold(sameRange(newer, latest) ? null : newer) : undefined,
  };
}
