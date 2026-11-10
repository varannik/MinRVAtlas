import type { CalcNode, CalcOp, EquationNode, InputNode, InputSource, SeriesAggregate } from "./types";
import type { FixedScaling } from "../types";

/**
 * Small constructors so a methodology spec reads like its equations.
 * Only spec files use these; everything else reads the plain tree.
 */

type Meta = Pick<InputNode, "note" | "reference" | "remedy">;

function input(id: string, symbol: string, label: string, unit: string, source: InputSource, meta: Meta = {}): InputNode {
  return { kind: "input", id, symbol, label, unit, source, ...meta };
}

export function equation(
  id: string,
  symbol: string,
  label: string,
  unit: string,
  op: CalcOp,
  children: CalcNode[],
  meta: Pick<EquationNode, "note" | "reference"> = {},
): EquationNode {
  return { kind: "equation", id, symbol, label, unit, op, children, ...meta };
}

export function series(
  id: string,
  symbol: string,
  label: string,
  unit: string,
  metric: string,
  aggregate: SeriesAggregate,
  meta: Meta & { scale?: number } = {},
): InputNode {
  const { scale, ...rest } = meta;
  return input(id, symbol, label, unit, { type: "series", metric, aggregate, scale }, rest);
}

export function fixed(
  id: string,
  symbol: string,
  label: string,
  unit: string,
  key: string,
  scaling: FixedScaling,
  meta: Meta & { scale?: number } = {},
): InputNode {
  const { scale, ...rest } = meta;
  return input(id, symbol, label, unit, { type: "fixed", key, scaling, scale }, rest);
}

export function constant(id: string, symbol: string, label: string, unit: string, value: number, origin: string, meta: Meta = {}): InputNode {
  return input(id, symbol, label, unit, { type: "constant", value, origin }, meta);
}

export function duration(id: string, unit: "h" | "d" = "h"): InputNode {
  return input(id, "Δt", "Window length", unit, { type: "duration", unit }, {
    note: "Hours in the selected window, turning a mean rate into a total.",
  });
}

/**
 * Re-use a term in another equation. Ids must stay unique, so the copy gets a
 * suffix; the UI shows it as the same quantity.
 */
export function reuse<T extends CalcNode>(node: T, suffix: string): T {
  if (node.kind === "input") return { ...node, id: `${node.id}@${suffix}` };
  return {
    ...node,
    id: `${node.id}@${suffix}`,
    children: node.children.map((child) => reuse(child, suffix)),
  } as T;
}

/** Id with any `@copy` suffix removed, to match a re-used term to its original. */
export function baseId(id: string): string {
  const at = id.indexOf("@");
  return at === -1 ? id : id.slice(0, at);
}
