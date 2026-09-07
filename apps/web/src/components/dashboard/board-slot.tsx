"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { boardSlot } from "../scene/requirement-anchor";

/** Frame the 3D requirement board is scaled into, or the HTML period desk. */
export function BoardSlot({ children }: { children?: ReactNode }) {
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
      boardSlot.visible =
        !boardSlot.covered && box.width > 8 && box.height > 8;
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frame);
      boardSlot.visible = false;
    };
  }, []);

  return (
    <div
      ref={ref}
      data-board-slot
      className="flex h-full min-h-0 w-full items-stretch justify-center"
    >
      <div className="h-full w-full max-w-[56rem]">{children}</div>
    </div>
  );
}
