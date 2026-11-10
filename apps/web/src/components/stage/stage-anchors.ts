/**
 * Screen positions shared between the 3D globe and the DOM panels, kept off
 * React so they can change every frame without re-rendering.
 *
 * - The globe writes `pin` (the open project's pin head, in CSS px).
 * - Each panel's FlowPort writes its socket into `ports`.
 * - The stage frame writes `band`, the free gap between the panels, which the
 *   globe fits itself into.
 */

export interface ScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

export const stageAnchors = {
  pin: { x: 0, y: 0, visible: false } as ScreenPoint,
  ports: {
    left: { x: 0, y: 0, visible: false } as ScreenPoint,
    right: { x: 0, y: 0, visible: false } as ScreenPoint,
  },
  band: { left: 0, right: 0, top: 0, bottom: 0, valid: false },
};

export type PortSide = keyof typeof stageAnchors.ports;
