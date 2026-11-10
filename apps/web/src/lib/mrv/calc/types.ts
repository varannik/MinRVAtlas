import type { FixedScaling } from "../types";

/**
 * A methodology's crediting maths, written as a tree. The root is the credited
 * quantity; every branch is either an equation over its children or a value
 * read from our data. Specs live in `./specs/*` — one file per methodology —
 * so a new registry or edition is a new file, not a UI change.
 */

export type CalcOp = "sum" | "difference" | "product" | "quotient";

export type SeriesAggregate = "sum" | "mean" | "max" | "min" | "last";

/** Where a leaf value comes from. */
export type InputSource =
  /** A stream metric folded over the window. */
  | {
      type: "series";
      metric: string;
      aggregate: SeriesAggregate;
      /** Multiplier into the node's unit, e.g. 0.001 for kg → t. */
      scale?: number;
    }
  /** A dated value: lab result, LCA factor, period total. */
  | {
      type: "fixed";
      key: string;
      scaling: FixedScaling;
      scale?: number;
    }
  /** A number set by the methodology itself. */
  | {
      type: "constant";
      value: number;
      origin: string;
    }
  /** Length of the window, to turn a mean rate into a total. */
  | {
      type: "duration";
      unit: "h" | "d";
    };

interface NodeBase {
  /** Unique in its tree. */
  id: string;
  label: string;
  /** Short math symbol, e.g. "E_cap". */
  symbol: string;
  unit: string;
  /** One line on what the term means. */
  note?: string;
  /** Methodology clause the term comes from. */
  reference?: string;
}

export interface EquationNode extends NodeBase {
  kind: "equation";
  op: CalcOp;
  children: CalcNode[];
}

export interface InputNode extends NodeBase {
  kind: "input";
  source: InputSource;
  /** What an operator should supply when this value is missing. */
  remedy?: string;
}

export type CalcNode = EquationNode | InputNode;

export interface CalcSpec {
  id: string;
  registry: string;
  methodology: string;
  edition: string;
  /** What one credit is called, e.g. "CORC". */
  creditUnit: string;
  root: EquationNode;
  /**
   * Node drawn as a ghost bar on the timeline when the root cannot be
   * calculated, usually the gross stored quantity.
   */
  proxyId?: string;
  sources: string[];
}

export type NodeStatus = "ok" | "partial" | "missing";

export interface NodeResult {
  value: number | null;
  status: NodeStatus;
  /** Share of the window the data covers, 0–1. */
  coverage: number;
  /** Ids of leaf inputs with no data under this node. */
  missing: string[];
  /** Ids of leaf inputs that only partly cover the window. */
  partial: string[];
  /** Human detail, e.g. "88 of 92 days". */
  detail?: string;
}

export interface Evaluation {
  root: NodeResult;
  byId: Map<string, NodeResult>;
}
