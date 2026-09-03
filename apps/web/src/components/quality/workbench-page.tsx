"use client";

import { useCallback, useEffect, useState } from "react";

import { sentinelJson, unwrapItems } from "@/lib/sentinel/browser";
import { useQuality } from "@/store/quality-store";
import type { DqaDataset, DqaRun } from "./types";
import {
  Banner,
  Button,
  DataTable,
  PageHeader,
  Pill,
  severityTone,
} from "./ui";

type Suggestion = {
  id: string;
  dataset_id?: string;
  suggestion_source?: string;
  original_value?: unknown;
  suggested_value?: unknown;
  correction_method?: string;
  confidence_score?: number;
  explanation?: string | null;
  status?: string;
};

function preview(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value.slice(0, 80);
  try {
    return JSON.stringify(value).slice(0, 80);
  } catch {
    return String(value);
  }
}

export function WorkbenchPage() {
  const projectId = useQuality((state) => state.projectId);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [datasets, setDatasets] = useState<DqaDataset[]>([]);
  const [latestRun, setLatestRun] = useState<DqaRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    const [dsData, runs] = await Promise.all([
      sentinelJson<unknown>(
        `v1/datasets?project_id=${encodeURIComponent(projectId)}`,
      ),
      sentinelJson<DqaRun[]>(`v1/runs/project/${projectId}?limit=1`),
    ]);
    const list = unwrapItems<DqaDataset>(dsData);
    setDatasets(list);
    const run = Array.isArray(runs) ? (runs[0] ?? null) : null;
    setLatestRun(run);
    const datasetId = list[0]?.id;
    if (!datasetId) {
      setSuggestions([]);
      return;
    }
    const data = await sentinelJson<Suggestion[]>(
      `v1/corrections/suggestions?dataset_id=${encodeURIComponent(datasetId)}`,
    );
    setSuggestions(Array.isArray(data) ? data : []);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load workbench");
    });
  }, [load, projectId]);

  async function generate() {
    if (!latestRun) return;
    setBusy(true);
    setError(null);
    try {
      const result = await sentinelJson<{ message?: string; count?: number }>(
        `v1/corrections/generate/${latestRun.id}`,
        { method: "POST" },
      );
      setNotice(result.message ?? `Generated ${result.count ?? 0} suggestions`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generate failed");
    } finally {
      setBusy(false);
    }
  }

  async function approve(id: string) {
    setError(null);
    try {
      await sentinelJson("v1/corrections/approve", {
        method: "POST",
        body: JSON.stringify({ suggestion_id: id }),
      });
      setNotice("Approved");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed");
    }
  }

  async function reject(id: string) {
    setError(null);
    try {
      await sentinelJson(`v1/corrections/reject/${id}`, { method: "POST" });
      setNotice("Rejected");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reject failed");
    }
  }

  return (
    <div>
      <PageHeader
        title="Correction workbench"
        description="Suggestions from the latest dataset. Approve uses Sentinel’s four-eyes rule — the M2M service user cannot approve a suggestion it generated."
        actions={
          <>
            <Button onClick={() => void load()} disabled={!projectId}>
              Refresh
            </Button>
            <Button
              tone="primary"
              disabled={!latestRun || busy}
              onClick={() => void generate()}
            >
              Generate from latest run
            </Button>
          </>
        }
      />
      {!projectId ? (
        <Banner kind="info">Select a Sentinel project in the header.</Banner>
      ) : null}
      {datasets.length === 0 && projectId ? (
        <Banner kind="info">Upload a dataset first.</Banner>
      ) : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="ok">{notice}</Banner> : null}
      <DataTable
        columns={["Method", "From", "To", "Confidence", "Status", ""]}
        empty="No suggestions. Run DQA, then generate."
        rows={suggestions.map((item) => [
          <span key="m">{item.correction_method ?? item.suggestion_source}</span>,
          <span key="o" className="font-mono text-xs">
            {preview(item.original_value)}
          </span>,
          <span key="n" className="font-mono text-xs">
            {preview(item.suggested_value)}
          </span>,
          <span key="c">
            {item.confidence_score != null
              ? `${Math.round(item.confidence_score * 100)}%`
              : "—"}
          </span>,
          <Pill key="s" tone={severityTone(item.status ?? "")}>
            {item.status ?? "—"}
          </Pill>,
          item.status === "pending" ? (
            <span key="a" className="flex gap-1">
              <Button onClick={() => void approve(item.id)}>Approve</Button>
              <Button tone="danger" onClick={() => void reject(item.id)}>
                Reject
              </Button>
            </span>
          ) : (
            <span key="a" className="text-mist">
              —
            </span>
          ),
        ])}
      />
    </div>
  );
}
