"use client";

import { useState } from "react";

import { sentinelDownload } from "@/lib/sentinel/browser";
import { useQuality } from "@/store/quality-store";
import { Banner, Button, PageHeader } from "./ui";

export function ReportsPage() {
  const projectId = useQuality((state) => state.projectId);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function download(format: "xlsx" | "pdf") {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      await sentinelDownload(
        `v1/reports/export/${projectId}?format=${format}`,
      );
      setNotice(`Downloaded ${format.toUpperCase()} report`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Quality report for the selected Sentinel project. Files stream from FastAPI through the BFF."
      />
      {!projectId ? (
        <Banner kind="info">Select a Sentinel project in the header.</Banner>
      ) : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="ok">{notice}</Banner> : null}
      <div className="flex gap-2">
        <Button
          tone="primary"
          disabled={!projectId || busy}
          onClick={() => void download("xlsx")}
        >
          Download Excel
        </Button>
        <Button disabled={!projectId || busy} onClick={() => void download("pdf")}>
          Download PDF
        </Button>
      </div>
    </div>
  );
}
