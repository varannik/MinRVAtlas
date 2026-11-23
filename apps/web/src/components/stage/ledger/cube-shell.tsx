"use client";

import type { ReactNode } from "react";
import type { BlockTone } from "../theme";

/** A focused block grows a little instead of wearing an outline. */
const FOCUS_SCALE = 1.1;

/**
 * The extruded cube every ledger block is drawn as, like a block explorer's:
 * a front face with a top and a side for depth. It lifts when hovered and
 * grows a little when focused. The journey's period boxes are drawn with it.
 */
export function CubeShell({
  tone,
  face,
  depth,
  focused,
  hovered,
  children,
}: {
  tone: BlockTone;
  face: { width: number; height: number };
  depth: number;
  focused: boolean;
  hovered: boolean;
  children: ReactNode;
}) {
  return (
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
        style={{ width: face.width, height: depth, background: tone.top, transform: "skewX(-45deg)", transformOrigin: "bottom left" }}
      />
      <span
        aria-hidden
        className="absolute bottom-0"
        style={{ left: face.width, width: depth, height: face.height, background: tone.side, transform: "skewY(-45deg)", transformOrigin: "bottom left" }}
      />
      <span
        className="absolute bottom-0 left-0 flex flex-col justify-between overflow-hidden transition-shadow duration-300"
        style={{
          width: face.width,
          height: face.height,
          background: `linear-gradient(160deg, ${tone.top} -40%, ${tone.face} 55%)`,
          color: tone.ink,
          boxShadow: focused ? "0 16px 28px rgba(13,24,2,0.28)" : "0 6px 14px rgba(13,24,2,0.12)",
        }}
      >
        {children}
      </span>
    </span>
  );
}
