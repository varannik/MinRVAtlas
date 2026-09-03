"use client";

import { useEffect, useRef } from "react";
import { boardSlot } from "../scene/requirement-anchor";

/** Invisible frame the 3D requirement board is scaled and parked into. */
export function BoardSlot() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let frame = 0;

    const tick = () => {
      const box = node.getBoundingClientRect();
      boardSlot.left = box.left;
      boardSlot.top = box.top;
      boardSlot.width = box.width;
      boardSlot.height = box.height;
      boardSlot.visible = box.width > 8 && box.height > 8;
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frame);
      boardSlot.visible = false;
    };
  }, []);

  return <div ref={ref} data-board-slot className="h-full min-h-0 w-full" />;
}
