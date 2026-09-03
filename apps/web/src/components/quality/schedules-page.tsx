"use client";

import { useCallback, useEffect, useState } from "react";

import { sentinelJson, unwrapItems } from "@/lib/sentinel/browser";
import { useQuality } from "@/store/quality-store";
import type { DqaDataset } from "./types";
import {
  Banner,
  Button,
  DataTable,
  Field,
  inputClass,
  Modal,
  PageHeader,
  Pill,
} from "./ui";

type Schedule = {
  id: string;
  name: string;
  cron_expression?: string;
  timezone?: string;
  is_active?: boolean;
  last_run_status?: string | null;
  next_run_at?: string | null;
  run_count?: number;
};

export function SchedulesPage() {
  const projectId = useQuality((state) => state.projectId);
  const [rows, setRows] = useState<Schedule[]>([]);
  const [datasets, setDatasets] = useState<DqaDataset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    const [schedules, dsData] = await Promise.all([
      sentinelJson<unknown>(
        `v1/schedules?project_id=${encodeURIComponent(projectId)}`,
      ),
      sentinelJson<unknown>(
        `v1/datasets?project_id=${encodeURIComponent(projectId)}`,
      ),
    ]);
    setRows(unwrapItems<Schedule>(schedules));
    setDatasets(unwrapItems<DqaDataset>(dsData));
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load schedules");
    });
  }, [load, projectId]);

  async function toggle(row: Schedule) {
    setError(null);
    try {
      await sentinelJson(`v1/schedules/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !(row.is_active ?? true) }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function runNow(id: string) {
    setError(null);
    try {
      const result = await sentinelJson<{ message?: string }>(
        `v1/schedules/${id}/run-now`,
        { method: "POST" },
      );
      setNotice(result.message ?? "Triggered");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run now failed");
    }
  }

  return (
    <div>
      <PageHeader
        title="Schedules"
        description="Cron-triggered DQA (and optional pipeline) runs for this Sentinel project."
        actions={
          <>
            <Button onClick={() => void load()} disabled={!projectId}>
              Refresh
            </Button>
            <Button
              tone="primary"
              disabled={!projectId}
              onClick={() => setOpen(true)}
            >
              New schedule
            </Button>
          </>
        }
      />
      {!projectId ? (
        <Banner kind="info">Select a Sentinel project in the header.</Banner>
      ) : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="ok">{notice}</Banner> : null}
      <DataTable
        columns={["Name", "Cron", "Active", "Last status", "Runs", ""]}
        empty="No schedules."
        rows={rows.map((row) => [
          <span key="n">{row.name}</span>,
          <span key="c" className="font-mono text-xs">
            {row.cron_expression}
          </span>,
          <Pill key="a" tone={row.is_active ? "ok" : "mist"}>
            {row.is_active ? "on" : "off"}
          </Pill>,
          <span key="s">{row.last_run_status ?? "—"}</span>,
          <span key="r">{row.run_count ?? 0}</span>,
          <span key="act" className="flex flex-wrap gap-1">
            <Button onClick={() => void toggle(row)}>Toggle</Button>
            <Button onClick={() => void runNow(row.id)}>Run now</Button>
          </span>,
        ])}
      />
      {open && projectId ? (
        <CreateScheduleModal
          projectId={projectId}
          datasets={datasets}
          onClose={() => setOpen(false)}
          onCreated={async () => {
            setOpen(false);
            setNotice("Schedule created.");
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function CreateScheduleModal({
  projectId,
  datasets,
  onClose,
  onCreated,
}: {
  projectId: string;
  datasets: DqaDataset[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("Nightly Fujairah DQA");
  const [cron, setCron] = useState("0 6 * * *");
  const [datasetId, setDatasetId] = useState(datasets[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await sentinelJson("v1/schedules", {
        method: "POST",
        body: JSON.stringify({
          name,
          cron_expression: cron,
          timezone: "UTC",
          project_id: projectId,
          dataset_id: datasetId || null,
        }),
      });
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New schedule" onClose={onClose}>
      {error ? <Banner kind="error">{error}</Banner> : null}
      <div className="grid gap-3">
        <Field label="Name">
          <input
            className={inputClass}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Cron">
          <input
            className={inputClass}
            value={cron}
            onChange={(event) => setCron(event.target.value)}
          />
        </Field>
        <Field label="Dataset (for run-now DQA)">
          <select
            className={inputClass}
            value={datasetId}
            onChange={(event) => setDatasetId(event.target.value)}
          >
            <option value="">None</option>
            {datasets.map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {dataset.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            tone="primary"
            disabled={busy || !name.trim()}
            onClick={() => void create()}
          >
            Create
          </Button>
        </div>
      </div>
    </Modal>
  );
}
