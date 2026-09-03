"use client";

import { useEffect, useRef } from "react";
import { useDashboard } from "@/store/dashboard-store";
import { panelAnchor, requirementAnchor } from "../scene/requirement-anchor";

function cubic(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (Math.abs(dx) < 64) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  return `M ${x1} ${y1} C ${x1 + dx * 0.36} ${y1}, ${x1 + dx * 0.64} ${y2}, ${x2} ${y2}`;
}

/**
 * Thin dashed cubic from the selected requirement (receded board) to the
 * floating intake popup. Path `d` is written from rAF so the dashboard does
 * not re-render every frame.
 */
export function SpatialConnector() {
  const selectedSlotId = useDashboard((state) => state.selectedSlotId);
  const glowRef = useRef<SVGPathElement>(null);
  const dashRef = useRef<SVGPathElement>(null);
  const growRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    if (!selectedSlotId) return;

    let frame = 0;
    const tick = () => {
      const wide = window.innerWidth >= 1024;
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const ready =
        wide &&
        !reduced &&
        requirementAnchor.valid &&
        panelAnchor.visible;
      const glow = glowRef.current;
      const dash = dashRef.current;
      const grow = growRef.current;
      if (!glow || !dash || !grow) {
        frame = window.requestAnimationFrame(tick);
        return;
      }
      if (!ready) {
        glow.setAttribute("opacity", "0");
        dash.setAttribute("opacity", "0");
        grow.setAttribute("opacity", "0");
      } else {
        const d = cubic(
          requirementAnchor.screenX,
          requirementAnchor.screenY,
          panelAnchor.screenX,
          panelAnchor.screenY,
        );
        glow.setAttribute("d", d);
        dash.setAttribute("d", d);
        grow.setAttribute("d", d);
        glow.setAttribute("opacity", "1");
        dash.setAttribute("opacity", "1");
        grow.setAttribute("opacity", "1");
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [selectedSlotId]);

  if (!selectedSlotId) return null;

  return (
    <svg
        className="pointer-events-none fixed inset-0 z-[25] hidden lg:block"
      width="100%"
      height="100%"
      aria-hidden
    >
      <path
        ref={glowRef}
        fill="none"
        stroke="rgba(139, 156, 70, 0.28)"
        strokeWidth="1.25"
        strokeDasharray="1.5 8"
        opacity="0"
        style={{ animation: "spatial-dash 1.6s linear infinite" }}
      />
      <path
        ref={dashRef}
        fill="none"
        stroke="rgba(7, 8, 8, 0.28)"
        strokeWidth="1"
        strokeLinecap="round"
        strokeDasharray="1.5 8"
        opacity="0"
        style={{ animation: "spatial-dash 1.6s linear infinite" }}
      />
      <path
        key={selectedSlotId}
        ref={growRef}
        fill="none"
        stroke="rgba(7, 8, 8, 0.45)"
        strokeWidth="1"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="1"
        opacity="0"
        style={{
          animation: "spatial-grow 0.6s cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      />
    </svg>
  );
}
