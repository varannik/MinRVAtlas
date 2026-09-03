"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { sentinelJson, unwrapItems } from "@/lib/sentinel/browser";
import type { VvProject } from "./types";
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

export function VvListPage() {
  const [projects, setProjects] = useState<VvProject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const data = await sentinelJson<unknown>("v2/vv/projects");
    setProjects(unwrapItems<VvProject>(data));
  }, []);

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load V&V");
    });
  }, [load]);

  return (
    <div>
      <PageHeader
        title="V&V Projects"
        description="Document packs, verification runs, and checkpoint review. Separate from DQA Sentinel projects."
        actions={
          <>
            <Button onClick={() => void load()}>Refresh</Button>
            <Button tone="primary" onClick={() => setOpen(true)}>
              New project
            </Button>
          </>
        }
      />
      {error ? <Banner kind="error">{error}</Banner> : null}
      <DataTable
        columns={["Name", "Status", "Docs", "Checkpoints", ""]}
        empty="No V&V projects yet."
        rows={projects.map((project) => [
          <span key="n">{project.name}</span>,
          <Pill key="s" tone={severityTone(project.status ?? "")}>
            {project.status ?? "—"}
          </Pill>,
          <span key="d">{project.document_count ?? "—"}</span>,
          <span key="c">{project.checkpoint_stats?.total ?? "—"}</span>,
          <Link
            key="o"
            href={`/quality/vv/${project.id}`}
            className="text-xs text-carbon-400 hover:underline"
          >
            Open
          </Link>,
        ])}
      />
      {open ? (
        <CreateVvModal
          onClose={() => setOpen(false)}
          onCreated={async () => {
            setOpen(false);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function CreateVvModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("Fujairah mineralisation pack");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await sentinelJson("v2/vv/projects", {
        method: "POST",
        body: JSON.stringify({
          name,
          registry_slug: "puro_earth_ccs",
          methodology_code: "PURO-CCS-GSC",
          location: "Fujairah",
          project_developer: "44.01",
          vintage_year: 2026,
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
    <Modal title="New V&V project" onClose={onClose}>
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Field label="Name">
        <input
          className={inputClass}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <p className="mt-2 mb-4 text-xs text-mist">
        Uses the Puro CCS checkpoint catalogue until an Isometric mineralisation
        ruleset exists. Do not use the biochar ruleset for Fujairah.
      </p>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button tone="primary" disabled={busy || !name.trim()} onClick={() => void create()}>
          Create
        </Button>
      </div>
    </Modal>
  );
}
