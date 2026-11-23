"use client";

import { useEffect, useRef } from "react";

import { floorAnchors } from "./floor-anchors";

/**
 * The dashed lines that tie the floors together: from the validated project
 * on the top floor down to the first monitoring period on the ledger, and
 * from the selected period down to its calculation tree. They are measured
 * every frame, so they follow the 3D camera, the page's scroll and the block
 * chain's own sideways scroll. The long runs are drawn under each floor's
 * text and panels (z 1); the run into the ledger, the end points and the
 * labels are drawn over them (z 3).
 */

type Point = { x: number; y: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Top or bottom centre of an anchor, kept inside its block chain's visible width. */
function anchorPoint(element: Element, edge: "top" | "bottom", origin: DOMRect): Point {
  const rect = element.getBoundingClientRect();
  let x = rect.left + rect.width / 2;
  const scroller = element.closest("[data-chain-scroller]")?.getBoundingClientRect();
  if (scroller) x = clamp(x, scroller.left + 28, scroller.right - 28);
  return { x: x - origin.left, y: (edge === "top" ? rect.top : rect.bottom) - origin.top };
}

/** An S-curve that leaves and arrives vertically. */
function controls(from: Point, to: Point): [Point, Point] {
  const k = Math.max(48, (to.y - from.y) * 0.5);
  return [
    { x: from.x, y: from.y + k },
    { x: to.x, y: to.y - k },
  ];
}

function curve(from: Point, to: Point): string {
  const [c1, c2] = controls(from, to);
  const f = (n: number) => n.toFixed(1);
  return `M ${f(from.x)} ${f(from.y)} C ${f(c1.x)} ${f(c1.y)}, ${f(c2.x)} ${f(c2.y)}, ${f(to.x)} ${f(to.y)}`;
}

/** The point on the curve whose height is nearest `y`. */
function pointAtY(from: Point, to: Point, y: number): Point {
  const [c1, c2] = controls(from, to);
  let best = from;
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const u = 1 - t;
    const point = {
      x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
      y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y,
    };
    if (Math.abs(point.y - y) < Math.abs(best.y - y)) best = point;
  }
  return best;
}

type Node = SVGPathElement | SVGCircleElement | HTMLSpanElement | null;

function show(nodes: Node[], shown: boolean) {
  for (const node of nodes) if (node) node.style.visibility = shown ? "visible" : "hidden";
}

function dot(node: SVGCircleElement | null, at: Point) {
  node?.setAttribute("cx", at.x.toFixed(1));
  node?.setAttribute("cy", at.y.toFixed(1));
}

function placeLabel(node: HTMLSpanElement | null, at: Point) {
  if (node) node.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -50%)`;
}

interface Refs {
  hubPath: SVGPathElement | null;
  hubDrop: SVGPathElement | null;
  hubStart: SVGCircleElement | null;
  hubEnd: SVGCircleElement | null;
  hubLabel: HTMLSpanElement | null;
  calcPath: SVGPathElement | null;
  calcStart: SVGCircleElement | null;
  calcEnd: SVGCircleElement | null;
  calcLabel: HTMLSpanElement | null;
}

/** How far into the ledger floor the line from the hub runs along the seam. */
const SEAM = 44;
/** Radius of the line's turns. */
const TURN = 18;

export function FloorLinks({ hubLabel, calcLabel }: { hubLabel: string; calcLabel: string }) {
  const backRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const floors = backRef.current?.parentElement;
    if (!floors) return;
    const pick = <T extends Element>(key: keyof Refs) => floors.querySelector<T>(`[data-link="${key}"]`);
    const r: Refs = {
      hubPath: pick<SVGPathElement>("hubPath"),
      hubDrop: pick<SVGPathElement>("hubDrop"),
      hubStart: pick<SVGCircleElement>("hubStart"),
      hubEnd: pick<SVGCircleElement>("hubEnd"),
      hubLabel: pick<HTMLSpanElement>("hubLabel"),
      calcPath: pick<SVGPathElement>("calcPath"),
      calcStart: pick<SVGCircleElement>("calcStart"),
      calcEnd: pick<SVGCircleElement>("calcEnd"),
      calcLabel: pick<HTMLSpanElement>("calcLabel"),
    };
    let frame = 0;
    const tick = () => {
      {
        const origin = floors.getBoundingClientRect();
        const panel = floors.querySelector("[data-ledger-panel]")?.getBoundingClientRect();
        const ledgerTop = document.getElementById("floor-ledger")?.getBoundingClientRect().top;

        // Validated project → first period: down from the hub to the seam between
        // the floors, along it to the margin beside the ledger, down the margin
        // and in over the top of the first box. It never crosses the floor's text.
        const scene = floors.querySelector('[data-floor-anchor="scene"]');
        const first = floors.querySelector('[data-floor-anchor="first"]');
        const hubShown = Boolean(scene && first && panel && floorAnchors.hub.valid);
        show([r.hubPath, r.hubDrop, r.hubStart, r.hubEnd, r.hubLabel], hubShown);
        if (hubShown && scene && first && panel) {
          const rect = scene.getBoundingClientRect();
          const from = { x: rect.left - origin.left + floorAnchors.hub.x, y: rect.top - origin.top + floorAnchors.hub.y };
          const to = anchorPoint(first, "top", origin);
          const panelLeft = panel.left - origin.left;
          const panelRight = panel.right - origin.left;
          const panelTop = panel.top - origin.top;
          const leftSide = to.x <= (panelLeft + panelRight) / 2;
          const gutter = leftSide ? Math.max(6, panelLeft / 2) : panelRight + Math.max(6, Math.min(24, (origin.width - panelRight) / 2));
          const seam = ledgerTop != null ? ledgerTop - origin.top + SEAM : panelTop - 60;
          const seamY = Math.max(from.y + 24, Math.min(seam, panelTop - 30));
          const enterY = panelTop + 28;
          const dir = gutter < from.x ? -1 : 1;
          const turn = Math.max(0, Math.min(TURN, Math.abs(from.x - gutter) / 2, (seamY - from.y) / 2));
          const f = (n: number) => n.toFixed(1);
          r.hubPath?.setAttribute(
            "d",
            `M ${f(from.x)} ${f(from.y)} L ${f(from.x)} ${f(seamY - turn)} Q ${f(from.x)} ${f(seamY)} ${f(from.x + dir * turn)} ${f(seamY)} ` +
              `L ${f(gutter - dir * turn)} ${f(seamY)} Q ${f(gutter)} ${f(seamY)} ${f(gutter)} ${f(seamY + turn)} L ${f(gutter)} ${f(enterY)}`,
          );
          const k = Math.max(24, (to.y - enterY) * 0.6);
          r.hubDrop?.setAttribute("d", `M ${f(gutter)} ${f(enterY)} C ${f(gutter)} ${f(enterY + k)}, ${f(to.x)} ${f(to.y - k)}, ${f(to.x)} ${f(to.y)}`);
          dot(r.hubStart, from);
          dot(r.hubEnd, to);
          // The label rides the seam, between the hub and the margin.
          placeLabel(r.hubLabel, { x: clamp((from.x + gutter) / 2, 110, origin.width - 110), y: seamY });
        }

        // Selected period → its calculation, from the panel's lower edge under the selected block.
        const selected = floors.querySelector('[data-floor-anchor="selected"]');
        const target = floors.querySelector('[data-floor-anchor="calc"]');
        const calcShown = Boolean(selected && target && panel);
        show([r.calcPath, r.calcStart, r.calcEnd, r.calcLabel], calcShown);
        if (calcShown && selected && target && panel) {
          const from = { x: anchorPoint(selected, "bottom", origin).x, y: panel.bottom - origin.top };
          const to = anchorPoint(target, "top", origin);
          r.calcPath?.setAttribute("d", curve(from, to));
          dot(r.calcStart, from);
          dot(r.calcEnd, to);
          placeLabel(r.calcLabel, pointAtY(from, to, (from.y + to.y) / 2));
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const dash = { fill: "none", strokeWidth: 1.6, strokeDasharray: "6 4", strokeLinecap: "round" as const, className: "floor-link-flow" };
  const label =
    "pointer-events-none absolute top-0 left-0 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em] whitespace-nowrap uppercase";

  return (
    <>
      <div ref={backRef} aria-hidden className="pointer-events-none absolute inset-0 z-[1]">
        <svg className="absolute inset-0 h-full w-full overflow-visible">
          <path data-link="hubPath" stroke="#414F1B" strokeOpacity={0.85} {...dash} />
          <circle data-link="hubStart" r={3.5} fill="#414F1B" />
          <path data-link="calcPath" stroke="#EADAC7" strokeOpacity={0.85} {...dash} />
        </svg>
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0 z-[3]">
        <svg className="absolute inset-0 h-full w-full overflow-visible">
          <path data-link="hubDrop" stroke="#414F1B" strokeOpacity={0.85} {...dash} />
          <circle data-link="hubEnd" r={4} fill="#F1F0F0" stroke="#414F1B" strokeWidth={1.6} />
          <circle data-link="calcStart" r={3.5} fill="#EADAC7" stroke="#57544A" strokeWidth={1} />
          <circle data-link="calcEnd" r={4} fill="#0D1802" stroke="#B2BE8B" strokeWidth={1.6} />
        </svg>
        <span data-link="hubLabel" className={`${label} bg-olivine-800 text-calcite shadow-[0_6px_16px_-6px_rgba(13,24,2,0.5)]`}>
          {hubLabel}
        </span>
        <span data-link="calcLabel" className={`${label} border border-calcite/20 bg-earth/70 text-calcite backdrop-blur-md`}>
          {calcLabel}
        </span>
      </div>
    </>
  );
}
