"use client";

import { useEffect, useState } from "react";

import { sentinelJson, unwrapItems } from "@/lib/sentinel/browser";
import { useQuality } from "@/store/quality-store";
import type { DqaRun, DqaViolation } from "./types";
import { Banner, DataTable, PageHeader, Pill, severityTone } from "./ui";

export function ViolationsPage() {
  const projectId = useQuality((state) => state.projectId);
  const [items, setItems] = useState<DqaViolation[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    void (async () => {
      const runs = await sentinelJson<DqaRun[]>(
        `v1/runs/project/${projectId}?limit=1`,
      );
      const latest = Array.isArray(runs) ? runs[0] : null;
      if (!latest) {
        setItems([]);
        return;
      }
      const data = await sentinelJson<unknown>(
        `v1/violations?run_id=${latest.id}&limit=100`,
      );
      setItems(unwrapItems<DqaViolation>(data));
    })().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load violations");
    });
  }, [projectId]);

  return (
    <div>
      <PageHeader
        title="Violations"
        description="From the latest DQA run on the selected Sentinel project."
      />
      {error ? <Banner kind="error">{error}</Banner> : null}
      <DataTable
        columns={["Rule", "Dimension", "Severity", "Field", "Records"]}
        empty="No violations on the latest run."
        rows={items.map((item) => [
          <span key="r" className="font-mono text-xs">
            {item.rule_id}
          </span>,
          <span key="d">{item.dimension}</span>,
          <Pill key="s" tone={severityTone(item.severity)}>
            {item.severity}
          </Pill>,
          <span key="f">{item.affected_field ?? "—"}</span>,
          <span key="c">{item.record_count ?? "—"}</span>,
        ])}
      />
    </div>
  );
}
