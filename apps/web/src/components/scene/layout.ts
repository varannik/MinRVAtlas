import * as THREE from "three";

/**
 * Everything on screen is laid out from the live viewport rather than hardcoded
 * world offsets, so the 3D content always sits in the gap left by the DOM panels.
 * `factor` is pixels per world unit at z = 0.
 */
export interface ViewportBox {
  width: number;
  height: number;
  factor: number;
}

/** Portfolio rail plus its gutters. */
export const RAIL_PX = 372;
/** Submission panel plus its gutters. */
export const PANEL_PX = 470;

export const TILE_WIDTH = 1.72;
export const TILE_HEIGHT = 0.86;
export const TILE_ROW_GAP = 1.0;
export const TILE_COUNT = 4;

/**
 * The tile column is yawed toward the camera, so its near edge lands further
 * right on screen than its world x suggests. The gutter absorbs that.
 */
const EDGE_GUTTER = 0.52;
const COLUMN_CLEARANCE = 0.38;

export function tileFit(v: ViewportBox): number {
  const needed = (TILE_COUNT - 1) * TILE_ROW_GAP + TILE_HEIGHT;
  return THREE.MathUtils.clamp(
    Math.min(1, (v.height - 1.0) / needed),
    0.5,
    1,
  );
}

export function tileColumnX(v: ViewportBox, fit: number): number {
  return v.width / 2 - (TILE_WIDTH * fit) / 2 - EDGE_GUTTER;
}

export interface GlobeBand {
  center: number;
  right: number;
  radius: number;
}

/** The free band between the portfolio rail and the KPI column. */
export function globeBand(v: ViewportBox): GlobeBand {
  const fit = tileFit(v);
  const columnLeft = tileColumnX(v, fit) - (TILE_WIDTH * fit) / 2;
  const left = -v.width / 2 + RAIL_PX / v.factor + 0.2;
  const right = columnLeft - COLUMN_CLEARANCE;
  const radius = THREE.MathUtils.clamp(
    Math.min((right - left) / 2, v.height / 2 - 0.45),
    0.65,
    2.7,
  );
  return { center: (left + right) / 2, right, radius };
}

/** Receded board: smaller, further back, parked on the left. */
export const WORKSPACE_BOARD_SCALE = 0.82;
export const WORKSPACE_BOARD_Z = -0.65;
/** Board right edge tucks this far under the popup. */
export const WORKSPACE_OVERLAP_PX = 52;

const _raycaster = new THREE.Raycaster();
const _plane = new THREE.Plane();
const _ndc = new THREE.Vector2();
const _normal = new THREE.Vector3();
const _point = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _hitR = new THREE.Vector3();
const _hitB = new THREE.Vector3();

export interface BoardSlotRect {
  left: number;
  top: number;
  width: number;
  height: number;
  visible: boolean;
}

/**
 * Maps a DOM slot onto a camera-facing plane so the 3D requirement board
 * sits in the same box, centered.
 */
export function boardSlotPose(
  slot: BoardSlotRect,
  camera: THREE.Camera,
  canvas: DOMRect,
  planeZ: number,
  boardW: number,
  boardH: number,
  padPx = 6,
): { x: number; y: number; z: number; scale: number } | null {
  if (!slot.visible || slot.width < 16 || slot.height < 16) return null;

  const left = slot.left + padPx;
  const top = slot.top + padPx;
  const width = slot.width - padPx * 2;
  const height = slot.height - padPx * 2;
  if (width < 8 || height < 8) return null;

  _point.set(0, 0, planeZ);
  camera.getWorldDirection(_normal);
  _plane.setFromNormalAndCoplanarPoint(_normal, _point);

  const hitAt = (sx: number, sy: number, out: THREE.Vector3) => {
    _ndc.set(
      ((sx - canvas.left) / canvas.width) * 2 - 1,
      -((sy - canvas.top) / canvas.height) * 2 + 1,
    );
    _raycaster.setFromCamera(_ndc, camera);
    return _raycaster.ray.intersectPlane(_plane, out);
  };

  const cx = left + width / 2;
  const cy = top + height / 2;
  if (!hitAt(cx, cy, _hit)) return null;
  if (!hitAt(left + width, cy, _hitR)) return null;
  if (!hitAt(cx, top + height, _hitB)) return null;

  const worldW = _hit.distanceTo(_hitR) * 2;
  const worldH = _hit.distanceTo(_hitB) * 2;
  const scale = Math.min(worldW / boardW, worldH / boardH);
  if (!Number.isFinite(scale) || scale <= 0.02) return null;

  return { x: _hit.x, y: _hit.y, z: _hit.z, scale };
}

/** Keeps the submission board clear of the detail panel. */
export function chainFocusX(v: ViewportBox, panelVisible = true): number {
  if (!panelVisible) return chainWorkspaceX(v);
  return -(PANEL_PX / v.factor) / 2 + 0.15;
}

/** Park the board in the left band while the intake popup occupies the right. */
export function chainWorkspaceX(v: ViewportBox): number {
  return -v.width * 0.22;
}
