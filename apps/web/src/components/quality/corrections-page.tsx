"use client";

import { useCallback, useEffect, useState } from "react";

import { sentinelJson } from "@/lib/sentinel/browser";
import { useQuality } from "@/store/quality-store";
import {
  Banner,
  Button,
  DataTable,
  Field,
  inputClass,
  Modal,
  PageHeader,
  Pill,
  severityTone,
} from "./ui";

type Pair = {
  rule_uuid: string;
  rule_id: string;
  rule_name: string;
  dimension: string;
  severity: string;
  correction: {
    id: string | null;
    name: string | null;
    correction_type: string | null;
    auto_apply_threshold?: number;
    correction_active?: boolean;
  } | null;
};

export function CorrectionsPage() {
  const projectId = useQuality((state) => state.projectId);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Pair | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    const data = await sentinelJson<Pair[]>(`v1/rule-studio/pairs/${projectId}`);
    setPairs(Array.isArray(data) ? data : []);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load pairs");
    });
  }, [load, projectId]);

  async function autoPair() {
    if (!projectId) return;
    setBusy(true);
    try {
      const result = await sentinelJson<{ message?: string }>(
        `v1/rule-studio/auto-pair/${projectId}`,
        { method: "POST" },
      );
      setNotice(result.message ?? "Auto-pair complete");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auto-pair failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Correction Manager"
        description="Detection rule paired with a correction strategy."
        actions={
          <>
            <Button onClick={() => void load()} disabled={!projectId}>
              Refresh
            </Button>
            <Button
              tone="primary"
              disabled={!projectId || busy}
              onClick={() => void autoPair()}
            >
              Auto-pair
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
        columns={["Rule", "Dimension", "Severity", "Correction", "Auto-apply", ""]}
        empty="No pairs. Seed DQA rules first, then auto-pair."
        rows={pairs.map((pair) => [
          <span key="r">
            <span className="font-mono text-xs text-signal-sky">{pair.rule_id}</span>{" "}
            {pair.rule_name}
          </span>,
          <span key="d" className="text-mist">
            {pair.dimension}
          </span>,
          <Pill key="s" tone={severityTone(pair.severity)}>
            {pair.severity}
          </Pill>,
          <span key="c">{pair.correction?.name ?? "—"}</span>,
          <span key="a">
            {pair.correction?.auto_apply_threshold ?? "—"}
          </span>,
          pair.correction ? (
            <Button key="e" onClick={() => setEditing(pair)}>
              Edit
            </Button>
          ) : (
            <span key="e" className="text-mist">
              —
            </span>
          ),
        ])}
      />
      {editing ? (
        <PairEditor
          pair={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            setNotice("Pair saved.");
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function PairEditor({
  pair,
  onClose,
  onSaved,
}: {
  pair: Pair;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [threshold, setThreshold] = useState(
    String(pair.correction?.auto_apply_threshold ?? 80),
  );
  const [active, setActive] = useState(
    Boolean(pair.correction?.correction_active),
  );
  const [error, setError] = useState<string | null>(null);

  async function save() {
    try {
      await sentinelJson(`v1/rule-studio/pairs/${pair.rule_uuid}`, {
        method: "PATCH",
        body: JSON.stringify({
          correction: {
            auto_apply_threshold: Number(threshold),
            is_active: active,
          },
        }),
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <Modal title={`${pair.rule_id} pair`} onClose={onClose}>
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Field label="Auto-apply threshold">
        <input
          className={inputClass}
          type="number"
          value={threshold}
          onChange={(event) => setThreshold(event.target.value)}
        />
      </Field>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
        />
        Correction active
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button tone="primary" onClick={() => void save()}>
          Save
        </Button>
      </div>
    </Modal>
  );
}
