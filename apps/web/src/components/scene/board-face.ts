import * as THREE from "three";
import { BRAND, FILL, statusFill } from "@/lib/brand";
import { ITEM_STATE_META } from "@/lib/item-state";
import { formatCompact } from "@/lib/format";
import { SUBMISSION_STATUS_META } from "@/lib/submissions";
import type { ItemState, SubmissionBatch } from "@/lib/types";

/**
 * The submission board is a flat slab seen from a single fixed angle: the whole
 * requirement set for one batch is printed on one face, so nothing is ever
 * hidden behind geometry. The face artwork is drawn to a canvas and the status
 * chips are real extruded meshes sitting on top of it, which is why the layout
 * has to be computed once and shared by both.
 */

export const BOARD_W = 4.0;
export const BOARD_H = 2.86;
export const BOARD_D = 0.16;

/** Texture pixels per world unit. */
export const PX = 340;
export const TEX_W = Math.round(BOARD_W * PX);
export const TEX_H = Math.round(BOARD_H * PX);

const PAD = 30;
const BODY_TOP = 150;
const BODY_BOTTOM = TEX_H - 58;
const COLUMN_GAP = 26;
const MAX_ROW_STEP = 66;

const PUCK_PX = 52;
const PUCK_INSET = 6;
export const PUCK_SIZE = PUCK_PX / PX;
export const PUCK_DEPTH = 0.075;

const LABEL_INSET = PUCK_INSET + PUCK_PX + 16;

const SANS =
  "ui-sans-serif, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export const STATE_COLOR: Record<ItemState, string> = {
  complete: FILL.complete,
  pending: FILL.pending,
  rejected: FILL.rejected,
  missing: FILL.missing,
};

export const STATE_EMISSIVE: Record<ItemState, number> = {
  complete: 0.04,
  pending: 0.04,
  rejected: 0.04,
  missing: 0,
};

const ROW_TAG: Partial<Record<ItemState, string>> = {
  missing: "MISSING",
  rejected: "REWORK",
  pending: "IN REVIEW",
};

export interface BoardRow {
  kind: "header" | "item";
  groupIndex: number;
  /** Index into `batch.items`; -1 for group headers. */
  flatIndex: number;
  column: number;
  /** Row centre in texture pixels. */
  y: number;
}

export interface BoardLayout {
  rows: BoardRow[];
  rowStep: number;
  columnX: number[];
  columnWidth: number;
}

/** Split the groups across two columns without ever breaking a group. */
function splitGroups(costs: number[]): number {
  const total = costs.reduce((sum, cost) => sum + cost, 0);
  let best = 1;
  let bestDelta = Number.POSITIVE_INFINITY;
  let acc = 0;

  for (let k = 1; k < costs.length; k += 1) {
    acc += costs[k - 1];
    const delta = Math.abs(acc - total / 2);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = k;
    }
  }

  return best;
}

export function buildBoardLayout(batch: SubmissionBatch): BoardLayout {
  const columnWidth = (TEX_W - PAD * 2 - COLUMN_GAP) / 2;
  const columnX = [PAD, PAD + columnWidth + COLUMN_GAP];
  const costs = batch.groups.map((group) => 1 + group.items.length);
  const split = costs.length > 1 ? splitGroups(costs) : 1;

  const slots = [0, 0];
  const draft: Omit<BoardRow, "y">[] = [];
  let flat = 0;

  batch.groups.forEach((group, groupIndex) => {
    const column = groupIndex < split ? 0 : 1;
    draft.push({ kind: "header", groupIndex, flatIndex: -1, column });
    slots[column] += 1;
    group.items.forEach(() => {
      draft.push({ kind: "item", groupIndex, flatIndex: flat, column });
      slots[column] += 1;
      flat += 1;
    });
  });

  const rowStep = Math.min(
    MAX_ROW_STEP,
    (BODY_BOTTOM - BODY_TOP) / Math.max(slots[0], slots[1]),
  );

  const cursor = [0, 0];
  const rows = draft.map((row) => {
    const y = BODY_TOP + cursor[row.column] * rowStep + rowStep / 2;
    cursor[row.column] += 1;
    return { ...row, y };
  });

  return { rows, rowStep, columnX, columnWidth };
}

/** Texture pixel space to board-local world space (origin at the face centre). */
export function pxToLocal(x: number, y: number): [number, number] {
  return [(x - TEX_W / 2) / PX, (TEX_H / 2 - y) / PX];
}

export function puckLocal(
  layout: BoardLayout,
  row: BoardRow,
): [number, number] {
  const x = layout.columnX[row.column] + PUCK_INSET + PUCK_PX / 2;
  return pxToLocal(x, row.y);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function clip(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let cut = text;
  while (cut.length > 3 && ctx.measureText(`${cut}…`).width > max) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawTag(
  ctx: CanvasRenderingContext2D,
  text: string,
  right: number,
  centerY: number,
  color: string,
) {
  ctx.font = `600 13px ${SANS}`;
  ctx.textAlign = "left";
  const width = ctx.measureText(text).width + 16;
  const x = right - width;
  roundRect(ctx, x, centerY - 11, width, 22, 5);
  ctx.fillStyle = withAlpha(color, 0.16);
  ctx.fill();
  ctx.strokeStyle = withAlpha(color, 0.4);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(text, x + 8, centerY + 4.5);
  return width;
}

export function createBoardTexture(
  batch: SubmissionBatch,
  layout: BoardLayout,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext("2d")!;
  const status = SUBMISSION_STATUS_META[batch.status];

  const corner = 28;
  ctx.clearRect(0, 0, TEX_W, TEX_H);
  roundRect(ctx, 0, 0, TEX_W, TEX_H, corner);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.save();
  roundRect(ctx, 0, 0, TEX_W, TEX_H, corner);
  ctx.clip();

  // Header block.
  ctx.textAlign = "left";
  ctx.fillStyle = BRAND.rock;
  ctx.font = `600 30px ${MONO}`;
  ctx.fillText(batch.id, PAD, 62);

  ctx.fillStyle = BRAND.shale;
  ctx.font = `400 16px ${SANS}`;
  ctx.fillText(
    `${batch.periodLabel} · ${formatCompact(batch.volume)} tCO₂e · ${batch.specVersion}`,
    PAD,
    92,
  );

  ctx.textAlign = "right";
  ctx.fillStyle = status.color;
  ctx.font = `600 40px ${SANS}`;
  ctx.fillText(`${batch.completion}%`, TEX_W - PAD, 62);
  ctx.fillStyle = BRAND.shale;
  ctx.font = `600 13px ${SANS}`;
  ctx.fillText(
    `${status.label.toUpperCase()} · ${batch.items.length - batch.outstanding}/${batch.items.length} READY`,
    TEX_W - PAD,
    88,
  );

  // Completion bar.
  const barY = 116;
  roundRect(ctx, PAD, barY, TEX_W - PAD * 2, 6, 3);
  ctx.fillStyle = withAlpha(BRAND.sand, 0.55);
  ctx.fill();
  const fill = ((TEX_W - PAD * 2) * batch.completion) / 100;
  if (fill > 6) {
    roundRect(ctx, PAD, barY, fill, 6, 3);
    ctx.fillStyle = statusFill(batch.status);
    ctx.fill();
  }

  // Rows.
  for (const row of layout.rows) {
    const group = batch.groups[row.groupIndex];
    const left = layout.columnX[row.column];
    const right = left + layout.columnWidth;

    if (row.kind === "header") {
      ctx.textAlign = "left";
      roundRect(ctx, left, row.y - 11, 42, 22, 5);
      ctx.fillStyle = withAlpha(group.accent, 0.22);
      ctx.fill();
      ctx.strokeStyle = withAlpha(group.accent, 0.55);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = group.accent;
      ctx.font = `700 13px ${SANS}`;
      ctx.fillText(group.code, left + 9, row.y + 4.5);

      ctx.fillStyle = BRAND.rock;
      ctx.font = `600 17px ${SANS}`;
      const title = group.title.toUpperCase();
      ctx.fillText(title, left + 54, row.y + 5.5);

      const titleEnd = left + 54 + ctx.measureText(title).width + 12;
      ctx.strokeStyle = withAlpha(group.accent, 0.22);
      ctx.beginPath();
      ctx.moveTo(titleEnd, row.y);
      ctx.lineTo(right, row.y);
      ctx.stroke();
      continue;
    }

    const item = batch.items[row.flatIndex];
    const color = STATE_COLOR[item.state];

    // Socket the extruded chip sits in, so a missing item still reads as a slot.
    roundRect(
      ctx,
      left + PUCK_INSET - 3,
      row.y - PUCK_PX / 2 - 3,
      PUCK_PX + 6,
      PUCK_PX + 6,
      7,
    );
    ctx.strokeStyle = withAlpha(color, item.state === "missing" ? 0.5 : 0.3);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // A missing optional item is not a blocker, so it reads as optional first.
    const stateTag = ROW_TAG[item.state];
    const tag =
      item.mandatory && stateTag
        ? { text: stateTag, color: ITEM_STATE_META[item.state].color }
        : item.mandatory
          ? null
          : { text: "OPTIONAL", color: BRAND.shale };

    const tagWidth = tag
      ? drawTag(ctx, tag.text, right, row.y, tag.color) + 10
      : 0;

    ctx.textAlign = "left";
    ctx.fillStyle = item.state === "missing" ? BRAND.shale : BRAND.rock;
    ctx.font = `${item.mandatory ? 500 : 400} 20px ${SANS}`;
    ctx.fillText(
      clip(
        ctx,
        item.label,
        layout.columnWidth - LABEL_INSET - tagWidth - PUCK_INSET,
      ),
      left + LABEL_INSET,
      row.y + 7,
    );
  }

  // Hash chain footer.
  ctx.font = `400 14px ${MONO}`;
  ctx.textAlign = "left";
  ctx.fillStyle = BRAND.shale;
  ctx.fillText(`hash ${batch.hash}`, PAD, TEX_H - 24);
  ctx.textAlign = "right";
  ctx.fillText(
    `parent ${batch.parentHash ?? "genesis"}`,
    TEX_W - PAD,
    TEX_H - 24,
  );

  ctx.restore();
  roundRect(ctx, 1.5, 1.5, TEX_W - 3, TEX_H - 3, Math.max(corner - 1.5, 1));
  ctx.strokeStyle = withAlpha(BRAND.sand, 0.7);
  ctx.lineWidth = 2;
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.premultiplyAlpha = false;
  texture.needsUpdate = true;
  return texture;
}
