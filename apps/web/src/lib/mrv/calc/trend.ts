import { addDays, diffDays } from "../days";
import type { DateRange, DayKey } from "../types";
import { evaluateSubtree, type DatasetIndex } from "./evaluate";
import { walk } from "./tree";
import type { CalcNode, NodeStatus } from "./types";

/**
 * A node's value for each day of a window, for the trend under the calculation
 * tree. An equation is worked out from its terms' values that day; a stream
 * value is that day's reading; a dated value or a methodology constant holds
 * still between its dates, so it draws as a straight line or steps.
 */

export interface TrendPoint {
  day: DayKey;
  value: number | null;
  status: NodeStatus;
}

/** Line through the days for anything read from the stream; steps for values that only change on dates. */
export type TrendShape = "line" | "step";

export interface NodeSources {
  /** Stream metrics read under this node. */
  metrics: Set<string>;
  /** Dated values (lab results, factors) read under this node. */
  fixedKeys: Set<string>;
}

export function nodeTrend(node: CalcNode, index: DatasetIndex, range: DateRange): TrendPoint[] {
  const points: TrendPoint[] = [];
  const total = diffDays(range.start, range.end);
  for (let offset = 0; offset <= total; offset += 1) {
    const day = addDays(range.start, offset);
    const result = evaluateSubtree(node, index, { start: day, end: day });
    points.push({ day, value: result.value, status: result.status });
  }
  return points;
}

export function nodeSources(node: CalcNode): NodeSources {
  const metrics = new Set<string>();
  const fixedKeys = new Set<string>();
  walk(node, (child) => {
    if (child.kind !== "input") return;
    if (child.source.type === "series") metrics.add(child.source.metric);
    if (child.source.type === "fixed") fixedKeys.add(child.source.key);
  });
  return { metrics, fixedKeys };
}

export function trendShape(node: CalcNode): TrendShape {
  return nodeSources(node).metrics.size ? "line" : "step";
}

/** What the trend says a node is, in a few words. */
export function trendKind(node: CalcNode): string {
  if (node.kind === "equation") return "worked out each day from its terms";
  switch (node.source.type) {
    case "series":
      return `${node.source.aggregate === "mean" ? "daily mean" : node.source.aggregate === "sum" ? "daily total" : `daily ${node.source.aggregate}`} of ${node.source.metric}`;
    case "fixed":
      return node.source.scaling === "prorata" ? "a period total shared out by days" : "a dated value, held until the next one";
    case "constant":
      return "a constant set by the methodology";
    case "duration":
      return "hours in each day";
  }
}
