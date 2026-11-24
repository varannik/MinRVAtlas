"use client";

import { useMemo } from "react";

import { nodeSources } from "@/lib/mrv/calc/trend";
import { walk } from "@/lib/mrv/calc/tree";
import type { CalcNode } from "@/lib/mrv/calc/types";
import type { DateRange } from "@/lib/mrv/types";
import { findingsForSources, type QualityFinding, type QualitySeverity } from "@/lib/quality/types";

/** Open findings under a card for the window, and the worst of them. */
export interface NodeFlag {
  severity: QualitySeverity;
  count: number;
}

const RANK: Record<QualitySeverity, number> = { blocks: 0, look: 1, info: 2 };

export function nodeFlags(root: CalcNode, findings: QualityFinding[], range: DateRange): Map<string, NodeFlag> {
  const flags = new Map<string, NodeFlag>();
  const open = findings.filter((finding) => finding.status !== "dismissed");
  if (!open.length) return flags;
  walk(root, (node) => {
    const under = findingsForSources(open, nodeSources(node), range);
    if (!under.length) return;
    const severity = under.reduce<QualitySeverity>((worst, finding) => (RANK[finding.severity] < RANK[worst] ? finding.severity : worst), "info");
    flags.set(node.id, { severity, count: under.length });
  });
  return flags;
}

export function useNodeFlags(root: CalcNode, findings: QualityFinding[] | undefined, range: DateRange | null): Map<string, NodeFlag> {
  return useMemo(() => (findings && range ? nodeFlags(root, findings, range) : new Map()), [findings, range, root]);
}
