"use client";

import { useCallback, useEffect, useState } from "react";

import { sentinelJson, unwrapItems } from "@/lib/sentinel/browser";
import type { ProtocolCheckpoint, ProtocolRecord } from "./types";
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

export function ProtocolsPage() {
  const [protocols, setProtocols] = useState<ProtocolRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<ProtocolCheckpoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProtocolCheckpoint | null>(null);

  const loadProtocols = useCallback(async () => {
    const data = await sentinelJson<unknown>("v2/protocols/protocols");
    const list = unwrapItems<ProtocolRecord>(data);
    setProtocols(list);
    setSelectedId((current) => current ?? list[0]?.id ?? null);
  }, []);

  const loadCheckpoints = useCallback(async (protocolId: string) => {
    const data = await sentinelJson<unknown>(
      `v2/protocols/protocols/${protocolId}/checkpoints`,
    );
    setCheckpoints(unwrapItems<ProtocolCheckpoint>(data));
  }, []);

  useEffect(() => {
    void loadProtocols().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load protocols");
    });
  }, [loadProtocols]);

  useEffect(() => {
    if (!selectedId) return;
    void loadCheckpoints(selectedId).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load checkpoints");
    });
  }, [loadCheckpoints, selectedId]);

  return (
    <div>
      <PageHeader
        title="Protocol Manager"
        description="Living protocol registry. Edit checkpoint definitions used by V&V packs."
        actions={<Button onClick={() => void loadProtocols()}>Refresh</Button>}
      />
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="ok">{notice}</Banner> : null}
      <Field label="Protocol">
        <select
          className={`${inputClass} max-w-xl`}
          value={selectedId ?? ""}
          onChange={(event) => setSelectedId(event.target.value || null)}
        >
          {protocols.map((protocol) => (
            <option key={protocol.id} value={protocol.id}>
              {protocol.code ?? protocol.name} · {protocol.version ?? ""}
            </option>
          ))}
        </select>
      </Field>
      <div className="mt-4">
        <DataTable
          columns={["ID", "Category", "Name", "Critical", ""]}
          empty="No checkpoints on this protocol."
          rows={checkpoints.map((cp) => [
            <span key="id" className="font-mono text-xs">
              {cp.checkpoint_id}
            </span>,
            <span key="c" className="text-mist">
              {cp.category}
            </span>,
            <span key="n">{cp.name}</span>,
            <Pill key="k" tone={cp.critical ? "bad" : "mist"}>
              {cp.critical ? "critical" : "standard"}
            </Pill>,
            <Button key="e" onClick={() => setEditing(cp)}>
              Edit
            </Button>,
          ])}
        />
      </div>
      {editing && selectedId ? (
        <ProtocolCheckpointEditor
          protocolId={selectedId}
          checkpoint={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            setNotice("Protocol checkpoint saved.");
            await loadCheckpoints(selectedId);
          }}
        />
      ) : null}
    </div>
  );
}

function ProtocolCheckpointEditor({
  protocolId,
  checkpoint,
  onClose,
  onSaved,
}: {
  protocolId: string;
  checkpoint: ProtocolCheckpoint;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(checkpoint.name);
  const [requirement, setRequirement] = useState(checkpoint.requirement ?? "");
  const [critical, setCritical] = useState(Boolean(checkpoint.critical));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await sentinelJson(
        `v2/protocols/protocols/${protocolId}/checkpoints/${checkpoint.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ name, requirement, critical }),
        },
      );
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={checkpoint.checkpoint_id} onClose={onClose}>
      {error ? <Banner kind="error">{error}</Banner> : null}
      <div className="grid gap-3">
        <Field label="Name">
          <input
            className={inputClass}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Requirement">
          <textarea
            className={`${inputClass} min-h-28`}
            value={requirement}
            onChange={(event) => setRequirement(event.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={critical}
            onChange={(event) => setCritical(event.target.checked)}
          />
          Critical
        </label>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" disabled={saving} onClick={() => void save()}>
            Save checkpoint
          </Button>
        </div>
      </div>
    </Modal>
  );
}
