import type { CalcNode, CalcOp, EquationNode } from "./types";

/** Depth-first walk, parents before children. */
export function walk(node: CalcNode, visit: (node: CalcNode, depth: number, parent: EquationNode | null) => void, depth = 0, parent: EquationNode | null = null): void {
  visit(node, depth, parent);
  if (node.kind === "equation") {
    for (const child of node.children) walk(child, visit, depth + 1, node);
  }
}

export function findNode(root: CalcNode, id: string): CalcNode | null {
  let found: CalcNode | null = null;
  walk(root, (node) => {
    if (!found && node.id === id) found = node;
  });
  return found;
}

/** Root-to-node chain of ids, or [] when the id is not in the tree. */
export function pathTo(root: CalcNode, id: string): string[] {
  if (root.id === id) return [root.id];
  if (root.kind !== "equation") return [];
  for (const child of root.children) {
    const rest = pathTo(child, id);
    if (rest.length) return [root.id, ...rest];
  }
  return [];
}

export function leaves(root: CalcNode): CalcNode[] {
  const out: CalcNode[] = [];
  walk(root, (node) => {
    if (node.kind === "input") out.push(node);
  });
  return out;
}

/** Stream metrics a spec reads, so a data source can fetch only those. */
export function seriesMetrics(root: CalcNode): string[] {
  const metrics = new Set<string>();
  walk(root, (node) => {
    if (node.kind === "input" && node.source.type === "series") metrics.add(node.source.metric);
  });
  return [...metrics];
}

/** Fixed-value keys a spec reads. */
export function fixedKeys(root: CalcNode): string[] {
  const keys = new Set<string>();
  walk(root, (node) => {
    if (node.kind === "input" && node.source.type === "fixed") keys.add(node.source.key);
  });
  return [...keys];
}

export const OP_GLYPH: Record<CalcOp, string> = {
  sum: "+",
  difference: "−",
  product: "×",
  quotient: "÷",
};

/** "S − E − L", "M × f_bio". */
export function formulaText(node: EquationNode): string {
  const glyph = OP_GLYPH[node.op];
  return node.children.map((child) => child.symbol).join(` ${glyph} `);
}

/** Operator between a parent and its n-th child, for edge labels. */
export function edgeGlyph(parent: EquationNode, index: number): string {
  if (index === 0) return parent.op === "difference" || parent.op === "quotient" ? "" : OP_GLYPH[parent.op];
  return OP_GLYPH[parent.op];
}
