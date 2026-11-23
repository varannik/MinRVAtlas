/**
 * Where the validated project sits on screen, written by the 3D scene every
 * frame (pixels inside the scene's canvas) and read by the dashed line that
 * runs from it down to the first monitoring period on the ledger floor.
 * Plain mutable state: it changes every frame and nothing re-renders on it.
 */
export const floorAnchors = {
  hub: { x: 0, y: 0, valid: false },
};

/** DOM anchors the floor links join, marked with `data-floor-anchor`. */
export type FloorAnchor = "scene" | "first" | "selected" | "calc";

export const FLOOR_IDS = {
  1: "floor-validation",
  2: "floor-ledger",
  3: "floor-calc",
} as const;

export type FloorNumber = keyof typeof FLOOR_IDS;

/** Scroll the journey to one of its floors. */
export function goToFloor(floor: FloorNumber, smooth = true): void {
  document.getElementById(FLOOR_IDS[floor])?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
}
