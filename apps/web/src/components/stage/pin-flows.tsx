"use client";

import { useEffect, useRef } from "react";
import { stageAnchors, type PortSide, type ScreenPoint } from "./stage-anchors";

/**
 * Two live flows from the project's pin on the globe: left into the removal
 * ledger, right into the site pulse. Paths are rewritten every frame from the
 * shared anchors, so they follow the globe as it turns and the panels as they
 * resize, without re-rendering React.
 */

const SIDES: PortSide[] = ["left", "right"];

function flowPath(pin: ScreenPoint, port: ScreenPoint): string {
  const dx = port.x - pin.x;
  const rise = Math.min(90, Math.abs(port.y - pin.y) * 0.55 + 24);
  const c1x = pin.x + dx * 0.12;
  const c1y = pin.y - rise;
  const c2x = port.x - dx * 0.55;
  const c2y = port.y;
  return `M ${pin.x.toFixed(1)} ${pin.y.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${port.x.toFixed(1)} ${port.y.toFixed(1)}`;
}

export function PinFlows() {
  const groupRefs = useRef<Record<PortSide, SVGGElement | null>>({ left: null, right: null });
  const pathRefs = useRef<Record<PortSide, SVGPathElement[]>>({ left: [], right: [] });
  const haloRef = useRef<SVGGElement>(null);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const pin = stageAnchors.pin;
      for (const side of SIDES) {
        const port = stageAnchors.ports[side];
        const group = groupRefs.current[side];
        const ready = pin.visible && port.visible;
        if (group) group.style.opacity = ready ? "1" : "0";
        if (ready) {
          const d = flowPath(pin, port);
          for (const path of pathRefs.current[side]) path.setAttribute("d", d);
        }
      }
      const halo = haloRef.current;
      if (halo) {
        halo.style.opacity = pin.visible ? "1" : "0";
        halo.setAttribute("transform", `translate(${pin.x.toFixed(1)} ${pin.y.toFixed(1)})`);
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const register = (side: PortSide, index: number) => (node: SVGPathElement | null) => {
    if (node) pathRefs.current[side][index] = node;
  };

  return (
    <svg className="pointer-events-none fixed inset-0 z-[22] hidden lg:block" width="100%" height="100%" aria-hidden>
      {SIDES.map((side) => (
        <g
          key={side}
          ref={(node) => {
            groupRefs.current[side] = node;
          }}
          style={{ opacity: 0, transition: "opacity 400ms ease" }}
        >
          <path ref={register(side, 0)} fill="none" stroke="rgba(190,178,144,0.45)" strokeWidth="7" strokeLinecap="round" />
          <path ref={register(side, 1)} fill="none" stroke="rgba(7,8,8,0.16)" strokeWidth="1" />
          <path
            ref={register(side, 2)}
            id={`pin-flow-${side}`}
            fill="none"
            stroke="rgba(7,8,8,0.62)"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeDasharray="2 7"
            className="motion-safe:animate-[spatial-dash_1.1s_linear_infinite]"
          />
          {[0, 0.8, 1.6].map((delay) => (
            <circle key={delay} r="2.6" fill="#DF7626" className="motion-reduce:hidden">
              <animateMotion dur="2.4s" begin={`${delay}s`} repeatCount="indefinite" rotate="auto">
                <mpath href={`#pin-flow-${side}`} />
              </animateMotion>
            </circle>
          ))}
        </g>
      ))}
      <g ref={haloRef} style={{ opacity: 0, transition: "opacity 400ms ease" }}>
        <circle r="14" fill="none" stroke="rgba(223,118,38,0.55)" strokeWidth="1.2" className="pin-halo" />
        <circle r="5" fill="#FFFFFF" stroke="#DF7626" strokeWidth="2" />
      </g>
    </svg>
  );
}
