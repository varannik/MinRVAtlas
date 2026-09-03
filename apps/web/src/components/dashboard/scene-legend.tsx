"use client";

import {
  Boxes,
  KeyRound,
  MousePointerClick,
  Move3d,
  MoveHorizontal,
  ZoomIn,
} from "lucide-react";
import { STATUS_META } from "@/lib/projects";
import { ITEM_STATE_META } from "@/lib/item-state";
import type { ItemState, ProjectStatus } from "@/lib/types";

const PROJECT_ORDER: ProjectStatus[] = [
  "draft",
  "validation",
  "monitoring",
  "verification",
  "issued",
];

const SLOT_ORDER: ItemState[] = ["complete", "pending", "rejected", "missing"];

export function SceneLegend({
  mode,
}: {
  mode: "map" | "chain" | "workspace";
}) {
  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="glass flex items-center gap-3.5 rounded-2xl px-4 py-2.5">
        {mode === "map"
          ? PROJECT_ORDER.map((status) => (
              <span
                key={status}
                className="flex items-center gap-1.5 text-[11px] text-mist"
              >
                <span
                  className="size-2 rounded-full"
                  style={{ background: STATUS_META[status].color }}
                />
                {STATUS_META[status].label}
              </span>
            ))
          : SLOT_ORDER.map((state) => (
              <span
                key={state}
                className="flex items-center gap-1.5 text-[11px] text-mist"
              >
                <span
                  className="size-2 rounded-sm"
                  style={{
                    background:
                      state === "missing"
                        ? "transparent"
                        : ITEM_STATE_META[state].color,
                    boxShadow:
                      state === "missing"
                        ? `inset 0 0 0 1px ${ITEM_STATE_META[state].color}`
                        : undefined,
                  }}
                />
                {ITEM_STATE_META[state].label}
              </span>
            ))}
      </div>

      <div className="glass hidden items-center gap-4 rounded-2xl px-4 py-2.5 md:flex">
        {mode === "map" ? (
          <>
            <span className="flex items-center gap-1.5 text-[11px] text-mist">
              <Move3d className="size-3.5" />
              Drag to spin
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-mist">
              <ZoomIn className="size-3.5" />
              Scroll to zoom
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-mist">
              <MousePointerClick className="size-3.5" />
              Click a pin for its submission chain
            </span>
          </>
        ) : mode === "workspace" ? (
          <>
            <span className="flex items-center gap-1.5 text-[11px] text-mist">
              <MousePointerClick className="size-3.5" />
              Import files for this requirement
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-mist">
              <KeyRound className="size-3.5" />
              Esc returns to the requirements board
            </span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5 text-[11px] text-mist">
              <MoveHorizontal className="size-3.5" />
              Arrow keys to walk the chain
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-mist">
              <Boxes className="size-3.5" />
              Click a batch in the chain above
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-mist">
              <KeyRound className="size-3.5" />
              Each key seals a period against double counting
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-mist">
              <MousePointerClick className="size-3.5" />
              Click a requirement to enter data
            </span>
          </>
        )}
      </div>
    </div>
  );
}
