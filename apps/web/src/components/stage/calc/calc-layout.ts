import { edgeGlyph } from "@/lib/mrv/calc/tree";
import type { CalcNode, EquationNode } from "@/lib/mrv/calc/types";

/**
 * Where each card of the calculation tree sits, in world pixels (the viewport
 * pans and zooms over them). A left-to-right tidy tree: every expanded branch
 * stays on screen, leaves stack top to bottom, and each parent sits centred on
 * its children. All geometry lives here; the React side only draws it.
 */

export type CardVariant = "root" | "term";

export interface PlacedCard {
  node: CalcNode;
  variant: CardVariant;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  /** Equation whose terms are showing. */
  expanded: boolean;
}

export interface PlacedEdge {
  id: string;
  fromId: string;
  toId: string;
  d: string;
  glyph: string;
  /** Child end of the edge, for the joint dot and operator badge. */
  end: { x: number; y: number };
}

export interface CalcLayout {
  cards: PlacedCard[];
  edges: PlacedEdge[];
  /** World-space box around every card. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const ROOT_W = 230;
const ROOT_H = 280;
/** The molecule's centre, below the root card's top; edges leave from here. */
export const ROOT_ORB_Y = 90;
const ROOT_OUT = ROOT_W / 2 + 84;
const CARD_W = 248;
const CARD_H = 76;
const ROW = CARD_H + 16;
/** Horizontal room for edges between columns. */
const GUTTER = 120;

function columnX(depth: number): number {
  if (depth === 0) return 0;
  return ROOT_W + GUTTER + (depth - 1) * (CARD_W + GUTTER);
}

function curve(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(36, (x2 - x1) * 0.55);
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${(x1 + dx).toFixed(1)} ${y1.toFixed(1)}, ${(x2 - dx).toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

/** Ids of every equation in the tree, for "expand all". */
export function equationIds(root: EquationNode): string[] {
  const ids: string[] = [];
  const visit = (node: CalcNode) => {
    if (node.kind !== "equation") return;
    ids.push(node.id);
    node.children.forEach(visit);
  };
  visit(root);
  return ids;
}

/** Equations down to `depth` levels below the root, the default view. */
export function equationsToDepth(root: EquationNode, depth: number): string[] {
  const ids: string[] = [];
  const visit = (node: CalcNode, level: number) => {
    if (node.kind !== "equation" || level > depth) return;
    ids.push(node.id);
    node.children.forEach((child) => visit(child, level + 1));
  };
  visit(root, 0);
  return ids;
}

/** The root is always open; other equations open when their id is in `expanded`. */
export function layoutTree(root: EquationNode, expanded: ReadonlySet<string>): CalcLayout {
  const cards: PlacedCard[] = [];
  const edges: PlacedEdge[] = [];
  let cursor = 0;

  const place = (node: CalcNode, depth: number): { card: PlacedCard; centerY: number } => {
    const open = node.kind === "equation" && (depth === 0 || expanded.has(node.id));
    const kids = open && node.kind === "equation" ? node.children : [];
    const w = depth === 0 ? ROOT_W : CARD_W;
    const h = depth === 0 ? ROOT_H : CARD_H;

    let centerY: number;
    let placedKids: { card: PlacedCard; centerY: number }[] = [];
    if (kids.length === 0) {
      centerY = cursor + CARD_H / 2;
      cursor += ROW;
    } else {
      placedKids = kids.map((child) => place(child, depth + 1));
      centerY = (placedKids[0].centerY + placedKids[placedKids.length - 1].centerY) / 2;
    }

    const top = depth === 0 ? centerY - ROOT_ORB_Y : centerY - h / 2;
    const card: PlacedCard = { node, variant: depth === 0 ? "root" : "term", x: columnX(depth), y: top, w, h, depth, expanded: kids.length > 0 };
    cards.push(card);

    if (node.kind === "equation") {
      const fromX = depth === 0 ? card.x + ROOT_OUT : card.x + card.w;
      placedKids.forEach(({ card: child, centerY: childY }, index) => {
        const end = { x: child.x, y: childY };
        edges.push({
          id: `${node.id}->${child.node.id}`,
          fromId: node.id,
          toId: child.node.id,
          d: curve(fromX, centerY, end.x, end.y),
          glyph: edgeGlyph(node, index),
          end,
        });
      });
    }
    return { card, centerY };
  };

  place(root, 0);

  const bounds = cards.reduce(
    (box, card) => ({
      minX: Math.min(box.minX, card.x),
      minY: Math.min(box.minY, card.y),
      maxX: Math.max(box.maxX, card.x + card.w),
      maxY: Math.max(box.maxY, card.y + card.h),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );

  return { cards, edges, bounds };
}
