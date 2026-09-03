"use client";

import { useCallback, useEffect, useState } from "react";

import { sentinelJson } from "@/lib/sentinel/browser";
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

type KnowledgeEntry = {
  id: string;
  domain?: string;
  parameter?: string | null;
  category?: string;
  title: string;
  description?: string;
  action?: string | null;
  severity?: string;
  is_active?: boolean;
};

export function KnowledgePage() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<KnowledgeEntry | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const data = await sentinelJson<KnowledgeEntry[]>(
      "v1/knowledge-base/?active_only=false",
    );
    setEntries(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load knowledge base");
    });
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Knowledge Base"
        description="Operational text used by Sentinel’s GenAI recommendations. Match existing entries; do not invent a parallel catalogue."
        actions={
          <>
            <Button onClick={() => void load()}>Refresh</Button>
            <Button tone="primary" onClick={() => setCreating(true)}>
              New entry
            </Button>
          </>
        }
      />
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="ok">{notice}</Banner> : null}
      <DataTable
        columns={["Title", "Domain", "Category", "Severity", "Active", ""]}
        empty="No knowledge entries."
        rows={entries.map((entry) => [
          <span key="t">{entry.title}</span>,
          <span key="d" className="font-mono text-xs">
            {entry.domain}
          </span>,
          <span key="c" className="text-mist">
            {entry.category}
          </span>,
          <Pill key="s" tone={severityTone(entry.severity ?? "")}>
            {entry.severity ?? "—"}
          </Pill>,
          <Pill key="a" tone={entry.is_active ? "ok" : "mist"}>
            {entry.is_active ? "on" : "off"}
          </Pill>,
          <Button key="e" onClick={() => setEditing(entry)}>
            Edit
          </Button>,
        ])}
      />
      {editing ? (
        <KnowledgeEditor
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            setNotice("Entry saved.");
            await load();
          }}
        />
      ) : null}
      {creating ? (
        <KnowledgeEditor
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            setNotice("Entry created.");
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function KnowledgeEditor({
  entry,
  onClose,
  onSaved,
}: {
  entry?: KnowledgeEntry;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState(entry?.title ?? "");
  const [domain, setDomain] = useState(entry?.domain ?? "ccs");
  const [category, setCategory] = useState(entry?.category ?? "general");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [action, setAction] = useState(entry?.action ?? "");
  const [severity, setSeverity] = useState(entry?.severity ?? "medium");
  const [active, setActive] = useState(entry?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    const payload = {
      title,
      domain,
      category,
      description,
      action: action || null,
      severity,
      is_active: active,
    };
    try {
      if (entry) {
        await sentinelJson(`v1/knowledge-base/${entry.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await sentinelJson("v1/knowledge-base/", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={entry ? "Edit knowledge entry" : "New knowledge entry"} onClose={onClose}>
      {error ? <Banner kind="error">{error}</Banner> : null}
      <div className="grid gap-3">
        <Field label="Title">
          <input
            className={inputClass}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label="Domain">
          <input
            className={inputClass}
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
          />
        </Field>
        <Field label="Category">
          <input
            className={inputClass}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          />
        </Field>
        <Field label="Severity">
          <select
            className={inputClass}
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
          >
            {["critical", "high", "medium", "low", "info"].map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description">
          <textarea
            className={`${inputClass} min-h-24`}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <Field label="Recommended action">
          <textarea
            className={`${inputClass} min-h-20`}
            value={action}
            onChange={(event) => setAction(event.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
          />
          Active
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            tone="primary"
            disabled={saving || !title.trim() || !domain.trim() || !description.trim()}
            onClick={() => void save()}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
