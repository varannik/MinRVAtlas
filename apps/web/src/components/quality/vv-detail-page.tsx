"use client";

import { useCallback, useEffect, useState } from "react";

import { sentinelJson, sentinelRequest, unwrapItems } from "@/lib/sentinel/browser";
import type { VvCheckpoint, VvDocument, VvProject } from "./types";
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

export function VvDetailPage({ id }: { id: string }) {
  const [project, setProject] = useState<VvProject | null>(null);
  const [documents, setDocuments] = useState<VvDocument[]>([]);
  const [checkpoints, setCheckpoints] = useState<VvCheckpoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<VvCheckpoint | null>(null);

  const load = useCallback(async () => {
    const [proj, docs, cps] = await Promise.all([
      sentinelJson<VvProject>(`v2/vv/projects/${id}`),
      sentinelJson<unknown>(`v2/vv/projects/${id}/documents`),
      sentinelJson<unknown>(`v2/vv/projects/${id}/checkpoints`),
    ]);
    setProject(proj);
    setDocuments(unwrapItems<VvDocument>(docs));
    setCheckpoints(unwrapItems<VvCheckpoint>(cps));
  }, [id]);

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load project");
    });
  }, [load]);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("document_type", "monitoring_data");
      const response = await sentinelRequest(`v2/vv/projects/${id}/documents`, {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          detail?: string;
          error?: string;
        } | null;
        throw new Error(body?.error || body?.detail || "Upload failed");
      }
      setNotice(`Uploaded ${file.name}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const result = await sentinelJson<{ message?: string }>(
        `v2/vv/projects/${id}/verify`,
        { method: "POST" },
      );
      setNotice(result.message ?? "Verification started");
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verify failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={project?.name ?? "V&V project"}
        description="Upload evidence, run verification, then set verifier status on checkpoints."
        actions={
          <>
            <Button onClick={() => void load()} disabled={busy}>
              Refresh
            </Button>
            <label className="cursor-pointer rounded-xl border border-line bg-ink-800 px-3 py-1.5 text-xs font-medium text-frost">
              Upload
              <input
                type="file"
                className="hidden"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                  event.target.value = "";
                }}
              />
            </label>
            <Button
              tone="primary"
              disabled={busy || documents.length === 0}
              onClick={() => void verify()}
            >
              Run verification
            </Button>
          </>
        }
      />
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="ok">{notice}</Banner> : null}

      <h2 className="mb-2 text-xs font-semibold tracking-[0.12em] text-mist uppercase">
        Documents
      </h2>
      <DataTable
        columns={["File", "Type", "Status"]}
        empty="No documents. Upload a PDF, Word, Excel, CSV or image."
        rows={documents.map((doc) => [
          <span key="n">{doc.name}</span>,
          <span key="t" className="text-mist">
            {doc.document_type}
          </span>,
          <Pill key="s" tone={severityTone(doc.status ?? "")}>
            {doc.status ?? "—"}
          </Pill>,
        ])}
      />

      <h2 className="mt-8 mb-2 text-xs font-semibold tracking-[0.12em] text-mist uppercase">
        Checkpoints
      </h2>
      <DataTable
        columns={["ID", "Name", "Engine", "Verifier", ""]}
        empty="No checkpoints yet. Upload a document and run verification."
        rows={checkpoints.map((cp) => [
          <span key="id" className="font-mono text-xs">
            {cp.checkpoint_id}
          </span>,
          <span key="n">{cp.name}</span>,
          <Pill key="st" tone={severityTone(cp.status ?? "")}>
            {cp.status ?? "pending"}
          </Pill>,
          <span key="v" className="text-mist">
            {cp.verifier_status ?? "unset"}
          </span>,
          <Button key="e" onClick={() => setEditing(cp)}>
            Edit
          </Button>,
        ])}
      />

      {editing ? (
        <CheckpointEditor
          projectId={id}
          checkpoint={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            setNotice("Checkpoint saved.");
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function CheckpointEditor({
  projectId,
  checkpoint,
  onClose,
  onSaved,
}: {
  projectId: string;
  checkpoint: VvCheckpoint;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [status, setStatus] = useState(checkpoint.verifier_status ?? "pass");
  const [note, setNote] = useState(checkpoint.verifier_note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await sentinelJson(
        `v2/vv/projects/${projectId}/checkpoints/${checkpoint.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            verifier_status: status,
            verifier_note: note,
          }),
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
    <Modal title={checkpoint.name} onClose={onClose}>
      {checkpoint.requirement ? (
        <p className="mb-3 text-sm text-mist">{checkpoint.requirement}</p>
      ) : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Field label="Verifier status">
        <select
          className={inputClass}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="pass">pass</option>
          <option value="fail">fail</option>
          <option value="na">n/a</option>
          <option value="pending">pending</option>
        </select>
      </Field>
      <div className="mt-3">
        <Field label="Verifier note">
          <textarea
            className={`${inputClass} min-h-24`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button tone="primary" disabled={saving} onClick={() => void save()}>
          Save checkpoint
        </Button>
      </div>
    </Modal>
  );
}
