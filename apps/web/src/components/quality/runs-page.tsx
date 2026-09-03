"use client";

import { useCallback, useEffect, useState } from "react";

import { sentinelJson, unwrapItems } from "@/lib/sentinel/browser";
import { useQuality } from "@/store/quality-store";
import type { DqaDataset, DqaRun } from "./types";
import { Banner, Button, DataTable, PageHeader, Pill, severityTone } from "./ui";

export function RunsPage() {
  const projectId = useQuality((state) => state.projectId);
  const [runs, setRuns] = useState<DqaRun[]>([]);
  const [datasets, setDatasets] = useState<DqaDataset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    const [runData, dsData] = await Promise.all([
      sentinelJson<DqaRun[]>(`v1/runs/project/${projectId}?limit=50`),
      sentinelJson<unknown>(
        `v1/datasets?project_id=${encodeURIComponent(projectId)}`,
      ),
    ]);
    setRuns(Array.isArray(runData) ? runData : unwrapItems<DqaRun>(runData));
    setDatasets(unwrapItems<DqaDataset>(dsData));
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load runs");
    });
  }, [load, projectId]);

  async function runLatest() {
    if (!projectId || datasets.length === 0) return;
    setBusy(true);
    try {
      const created = await sentinelJson<DqaRun>("v1/runs", {
        method: "POST",
        body: JSON.stringify({
          dataset_id: datasets[0].id,
          project_id: projectId,
        }),
      });
      setNotice(`Queued run ${created.id}`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="DQA Runs"
        description="Trigger and inspect quality runs. Rule Manager edits apply here."
        actions={
          <>
            <Button onClick={() => void load()} disabled={!projectId}>
              Refresh
            </Button>
            <Button
              tone="primary"
              disabled={!projectId || busy || datasets.length === 0}
              onClick={() => void runLatest()}
            >
              Run latest dataset
            </Button>
          </>
        }
      />
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="ok">{notice}</Banner> : null}
      <DataTable
        columns={["Run", "Status", "Violations", "Gate", "When"]}
        empty="No runs yet."
        rows={runs.map((run) => [
          <span key="id" className="font-mono text-xs">
            {String(run.id).slice(0, 8)}
          </span>,
          <Pill key="s" tone={severityTone(run.status)}>
            {run.status}
          </Pill>,
          <span key="v">{run.total_violations ?? "—"}</span>,
          <Pill key="g" tone={run.gate_passed ? "ok" : "bad"}>
            {run.gate_passed ? "pass" : "fail"}
          </Pill>,
          <span key="t" className="text-mist">
            {run.triggered_at ?? "—"}
          </span>,
        ])}
      />
    </div>
  );
}
