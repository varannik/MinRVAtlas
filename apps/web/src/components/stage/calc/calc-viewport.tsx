"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Hand, Minus, Plus, Scan } from "lucide-react";
import type { CalcLayout } from "./calc-layout";

/**
 * A pan-and-zoom canvas for the calculation tree. Whenever the tree changes
 * shape (`fitKey`) or the window resizes, it frames the whole tree; drag the
 * background to move, scroll to zoom around the pointer, or use the toolbar.
 * Once you move it yourself, it stays where you put it until the tree changes.
 */

interface View {
  x: number;
  y: number;
  k: number;
}

const MIN_K = 0.2;
const MAX_K = 2.5;
/** Fitting never blows the tree up past this. */
const MAX_FIT_K = 1.05;
const PAD = { left: 56, right: 56, top: 76, bottom: 64 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fitView(bounds: CalcLayout["bounds"], width: number, height: number): View {
  const boxW = Math.max(1, bounds.maxX - bounds.minX);
  const boxH = Math.max(1, bounds.maxY - bounds.minY);
  const k = clamp(Math.min((width - PAD.left - PAD.right) / boxW, (height - PAD.top - PAD.bottom) / boxH), MIN_K, MAX_FIT_K);
  return {
    k,
    x: PAD.left + (width - PAD.left - PAD.right - boxW * k) / 2 - bounds.minX * k,
    y: PAD.top + (height - PAD.top - PAD.bottom - boxH * k) / 2 - bounds.minY * k,
  };
}

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-8 place-items-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
    >
      {children}
    </button>
  );
}

export function CalcViewport({
  bounds,
  fitKey,
  actions,
  children,
}: {
  bounds: CalcLayout["bounds"];
  /** Changes whenever the tree's shape changes, to re-frame it. */
  fitKey: string;
  /** Extra toolbar buttons, e.g. expand all. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [manual, setManual] = useState<{ key: string; view: View } | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);

  useEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const key = `${fitKey}|${Math.round(size.width)}x${Math.round(size.height)}`;
  const fitted = size.width > 0 ? fitView(bounds, size.width, size.height) : { x: 0, y: 0, k: 1 };
  const manualActive = manual?.key === key;
  const view = manualActive ? manual.view : fitted;

  // Wheel needs a non-passive listener to keep the page from scrolling.
  const latest = useRef({ view, key });
  useEffect(() => {
    latest.current = { view, key };
  });
  useEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      const { view: current, key: currentKey } = latest.current;
      const k = clamp(current.k * Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015)), MIN_K, MAX_K);
      const ratio = k / current.k;
      setManual({ key: currentKey, view: { k, x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio } });
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    const cx = size.width / 2;
    const cy = size.height / 2;
    const k = clamp(view.k * factor, MIN_K, MAX_K);
    const ratio = k / view.k;
    setManual({ key, view: { k, x: cx - (cx - view.x) * ratio, y: cy - (cy - view.y) * ratio } });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Cards and toolbar keep their clicks; only the background pans.
    if ((event.target as Element).closest("button, a, [data-no-pan]")) return;
    drag.current = { x: event.clientX, y: event.clientY, view };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    setManual({ key, view: { ...start.view, x: start.view.x + event.clientX - start.x, y: start.view.y + event.clientY - start.y } });
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      ref={frameRef}
      className={`absolute inset-0 touch-none overflow-hidden ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* Under the tree, so cards always sit on top of it. */}
      <p className="pointer-events-none absolute top-6 right-5 flex items-center gap-1.5 text-[10.5px] text-white/35">
        <Hand className="size-3.5" />
        Drag to move · scroll to zoom
      </p>
      <div
        className="absolute top-0 left-0"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
          transformOrigin: "0 0",
          // Glide when the view re-frames itself; follow the hand exactly otherwise.
          transition: manualActive ? "none" : "transform 560ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {children}
      </div>

      <div data-no-pan className="absolute top-4 left-5 flex items-center gap-1 rounded-xl border border-white/10 bg-black/40 p-1 backdrop-blur-md">
        <ToolButton label="Fit the whole tree" onClick={() => setManual(null)}>
          <Scan className="size-4" />
        </ToolButton>
        <span className="mx-0.5 h-5 w-px bg-white/10" />
        <ToolButton label="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
          <Minus className="size-4" />
        </ToolButton>
        <button
          type="button"
          onClick={() => zoomBy(1 / view.k)}
          title="Zoom to 100%"
          className="w-12 rounded-lg py-1.5 text-center font-mono text-[11px] text-white/70 tabular-nums hover:bg-white/10 hover:text-white"
        >
          {Math.round(view.k * 100)}%
        </button>
        <ToolButton label="Zoom in" onClick={() => zoomBy(1.25)}>
          <Plus className="size-4" />
        </ToolButton>
        {actions ? <span className="mx-0.5 h-5 w-px bg-white/10" /> : null}
        {actions}
      </div>
    </div>
  );
}
