"use client";

import { useEffect, useState } from "react";

import { sentinelJson } from "@/lib/sentinel/browser";
import { Banner, Button, DataTable, PageHeader, Pill } from "./ui";

type ModelRow = {
  model_key?: string;
  name?: string;
  model?: string;
  version?: string;
  status?: string;
  is_active?: boolean;
  sample_count?: number;
  trained_at?: string;
};

export function ModelsPage() {
  const [models, setModels] = useState<ModelRow[]>([]);
  const [thresholds, setThresholds] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [ml, th] = await Promise.all([
      sentinelJson<{ models?: ModelRow[] } | ModelRow[]>("v1/ml/status"),
      sentinelJson<{ thresholds?: Record<string, unknown> }>(
        "v1/anomaly/thresholds",
      ),
    ]);
    const list = Array.isArray(ml)
      ? ml
      : Array.isArray(ml?.models)
        ? ml.models
        : [];
    setModels(list);
    setThresholds(th.thresholds ?? th);
  }

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load models");
    });
  }, []);

  async function retrain(kind: "dqa" | "anomaly") {
    setBusy(true);
    setError(null);
    try {
      await sentinelJson(`v1/ml/retrain/${kind}`, { method: "POST" });
      setNotice(`${kind} retrain queued`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retrain failed");
    } finally {
      setBusy(false);
    }
  }

  const thresholdRows = Object.entries(thresholds).map(([key, value]) => {
    const rec =
      value && typeof value === "object"
        ? (value as { min?: number; max?: number; unit?: string })
        : null;
    return [
      <span key="k" className="font-mono text-xs">
        {key}
      </span>,
      <span key="v">
        {rec
          ? `${rec.min ?? "—"} – ${rec.max ?? "—"} ${rec.unit ?? ""}`.trim()
          : String(value)}
      </span>,
    ];
  });

  return (
    <div>
      <PageHeader
        title="Models"
        description="ML registry status and default anomaly thresholds. Retrain is queued on the Sentinel worker."
        actions={
          <>
            <Button onClick={() => void load()}>Refresh</Button>
            <Button disabled={busy} onClick={() => void retrain("dqa")}>
              Retrain DQA
            </Button>
            <Button
              tone="primary"
              disabled={busy}
              onClick={() => void retrain("anomaly")}
            >
              Retrain anomaly
            </Button>
          </>
        }
      />
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="ok">{notice}</Banner> : null}
      <h2 className="mb-2 text-xs font-semibold tracking-[0.12em] text-mist uppercase">
        Registry
      </h2>
      <DataTable
        columns={["Model", "Samples", "Status", "Trained"]}
        empty="No model registry rows yet."
        rows={models.map((model) => [
          <span key="n">
            {model.model_key ?? model.name ?? model.model ?? "—"}
          </span>,
          <span key="v">{model.sample_count ?? model.version ?? "—"}</span>,
          <Pill key="s" tone={model.is_active || model.status === "ready" ? "ok" : "mist"}>
            {model.status ?? (model.is_active ? "active" : "—")}
          </Pill>,
          <span key="t" className="text-mist">
            {model.trained_at ?? "—"}
          </span>,
        ])}
      />
      <h2 className="mt-8 mb-2 text-xs font-semibold tracking-[0.12em] text-mist uppercase">
        Anomaly thresholds
      </h2>
      <DataTable
        columns={["Parameter", "Value"]}
        empty="No thresholds returned."
        rows={thresholdRows}
      />
    </div>
  );
}
