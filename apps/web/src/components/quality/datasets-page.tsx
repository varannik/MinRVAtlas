"use client";

import { useCallback, useEffect, useState } from "react";

import { sentinelJson, unwrapItems } from "@/lib/sentinel/browser";
import { useQuality } from "@/store/quality-store";
import type { DqaDataset } from "./types";
import { Banner, Button, DataTable, PageHeader, Pill, severityTone } from "./ui";

export function DatasetsPage() {
  const projectId = useQuality((state) => state.projectId);
  const [rows, setRows] = useState<DqaDataset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    const data = await sentinelJson<unknown>(
      `v1/datasets?project_id=${encodeURIComponent(projectId)}`,
    );
    setRows(unwrapItems<DqaDataset>(data));
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load datasets");
    });
  }, [load, projectId]);

  async function upload(file: File) {
    if (!projectId) return;
    const form = new FormData();
    form.set("project_id", projectId);
    form.set("file", file);
    await sentinelJson("v1/datasets/upload", {
      method: "POST",
      body: form,
    });
    setNotice(`Uploaded ${file.name}`);
    await load();
  }

  return (
    <div>
      <PageHeader
        title="Datasets"
        description="Operator CSVs and workbooks held by Sentinel for DQA."
        actions={
          <>
            <Button onClick={() => void load()} disabled={!projectId}>
              Refresh
            </Button>
            <label className="cursor-pointer rounded-xl border border-carbon-400 bg-carbon-400 px-3 py-1.5 text-xs font-medium text-off-white">
              Upload CSV
              <input
                type="file"
                accept=".csv,.xlsx,.xls,.parquet"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void upload(file).catch((err: unknown) => {
                      setError(err instanceof Error ? err.message : "Upload failed");
                    });
                  }
                  event.target.value = "";
                }}
              />
            </label>
          </>
        }
      />
      {!projectId ? (
        <Banner kind="info">Select a Sentinel project in the header.</Banner>
      ) : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="ok">{notice}</Banner> : null}
      <DataTable
        columns={["Name", "Rows", "Cols", "Status"]}
        empty="No datasets."
        rows={rows.map((row) => [
          <span key="n">{row.name}</span>,
          <span key="r" className="tabular">
            {row.row_count ?? "—"}
          </span>,
          <span key="c">{row.column_count ?? "—"}</span>,
          <Pill key="s" tone={severityTone(row.status ?? "")}>
            {row.status ?? "—"}
          </Pill>,
        ])}
      />
    </div>
  );
}
