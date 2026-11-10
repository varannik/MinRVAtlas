"use client";

import { useEffect, useRef } from "react";
import { stageAnchors, type PortSide } from "./stage-anchors";

/**
 * The socket where a pin flow meets a panel. Sits on the panel's inner edge
 * and reports its centre every frame, so the flow follows any layout change.
 */
export function FlowPort({ side, className = "top-[34px]" }: { side: PortSide; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const anchor = stageAnchors.ports[side];
    let frame = 0;
    const tick = () => {
      const box = node.getBoundingClientRect();
      anchor.x = box.left + box.width / 2;
      anchor.y = box.top + box.height / 2;
      anchor.visible = box.width > 0;
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      anchor.visible = false;
    };
  }, [side]);

  return (
    <span
      ref={ref}
      aria-hidden
      className={`absolute z-10 grid size-3.5 place-items-center rounded-full bg-white ring-1 ring-sand ${
        side === "left" ? "-right-[7px]" : "-left-[7px]"
      } ${className}`}
    >
      <span className="size-1.5 animate-pulse rounded-full bg-canyon" />
    </span>
  );
}
