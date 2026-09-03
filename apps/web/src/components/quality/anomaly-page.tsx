"use client";

import { useCallback, useEffect, useState } from "react";

import { sentinelJson, unwrapItems } from "@/lib/sentinel/browser";
import { useQuality } from "@/store/quality-store";
import type { DqaDataset } from "./types";
import {
  Banner,
  Button,
  DataTable,
  PageHeader,
  Pill,
  severityTone,
} from "./ui";

type AnomalyHit = {
  parameter?: string;
  value?: number;
  severity?: string;
  alarm_type?: string;
  ensemble_confidence?: number;
  timestamp?: string | null;
};

type AnomalyResult = {
  anomalies_detected?: number;
  total_checks?: number;
  readiness_score?: number;
  processing_ms?: number;
  anomalies?: AnomalyHit[];
  summary?: { critical?: number; high?: number; medium?: number };
};

export function AnomalyPage() {
  const projectId = useQuality((state) => state.projectId);
  const [datasets, setDatasets] = useState<DqaDataset[]>([]);
  const [datasetId, setDatasetId] = useState<string>("");
  const [result, setResult] = useState<AnomalyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    const data = await sentinelJson<unknown>(
      `v1/datasets?project_id=${encodeURIComponent(projectId)}`,
    );
    const list = unwrapItems<DqaDataset>(data);
    setDatasets(list);
    setDatasetId((current) => current || list[0]?.id || "");
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load datasets");
    });
  }, [load, projectId]);

  async function run() {
    if (!datasetId) return;
    setBusy(true);
    setError(null);
    try {
      const data = await sentinelJson<AnomalyResult>(
        `v1/anomaly/run/${datasetId}`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Anomaly run failed");
    } finally {
      setBusy(false);
    }
  }

  const hits = (result?.anomalies ?? []).slice(0, 100);

  return (
    <div>
      <PageHeader
        title="Anomaly detection"
        description="Heuristic / statistical / Isolation Forest ensemble on a stored dataset. Thresholds live under Models."
        actions={
          <Button
            tone="primary"
            disabled={!datasetId || busy}
            onClick={() => void run()}
          >
            Run on selected dataset
          </Button>
        }
      />
      {!projectId ? (
        <Banner kind="info">Select a Sentinel project in the header.</Banner>
      ) : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      <label className="mb-4 block max-w-xl text-xs text-mist">
        Dataset
        <select
          className="mt-1 w-full rounded-xl border border-line bg-ink-800 px-3 py-2 text-sm text-frost"
          value={datasetId}
          onChange={(event) => setDatasetId(event.target.value)}
        >
          {datasets.length === 0 ? <option value="">No datasets</option> : null}
          {datasets.map((dataset) => (
            <option key={dataset.id} value={dataset.id}>
              {dataset.name}
            </option>
          ))}
        </select>
      </label>
      {result ? (
        <p className="mb-4 text-sm text-mist">
          {result.anomalies_detected ?? 0} anomalies / {result.total_checks ?? 0}{" "}
          checks · readiness {result.readiness_score ?? "—"}% ·{" "}
          {result.processing_ms ?? "—"} ms
          {result.summary
            ? ` · critical ${result.summary.critical ?? 0}, high ${result.summary.high ?? 0}`
            : ""}
        </p>
      ) : null}
      <DataTable
        columns={["Parameter", "Value", "Severity", "Alarm", "Confidence", "When"]}
        empty="No anomaly run yet, or no hits on this dataset."
        rows={hits.map((hit) => [
          <span key="p" className="font-mono text-xs">
            {hit.parameter}
          </span>,
          <span key="v">{hit.value ?? "—"}</span>,
          <Pill key="s" tone={severityTone(hit.severity ?? "")}>
            {hit.severity ?? "—"}
          </Pill>,
          <span key="a">{hit.alarm_type ?? "—"}</span>,
          <span key="c">
            {hit.ensemble_confidence != null
              ? `${Math.round(hit.ensemble_confidence * 100)}%`
              : "—"}
          </span>,
          <span key="t" className="text-mist">
            {hit.timestamp ?? "—"}
          </span>,
        ])}
      />
    </div>
  );
}
