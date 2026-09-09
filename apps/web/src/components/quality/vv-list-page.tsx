"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { sentinelJson, unwrapItems } from "@/lib/sentinel/browser";
import { useQuality } from "@/store/quality-store";
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
  const catalogProjectId = useQuality((state) => state.catalogProjectId);
  const projectName = useQuality((state) => state.projectName);
  const [projects, setProjects] = useState<VvProject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!catalogProjectId) {
      setProjects([]);
      return;
    }
    const data = await sentinelJson<unknown>("v2/vv/projects");
    const all = unwrapItems<VvProject>(data);
    setProjects(
      all.filter((project) => project.location === catalogProjectId),
    );
  }, [catalogProjectId]);

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load V&V");
    });
  }, [load]);

  return (
    <div>
      <PageHeader
        title="V&V Projects"
        description="Document packs and checkpoint review for the selected project. Empty until you create a pack."
        actions={
          <>
            <Button onClick={() => void load()} disabled={!catalogProjectId}>
              Refresh
            </Button>
            <Button
              tone="primary"
              disabled={!catalogProjectId}
              onClick={() => setOpen(true)}
            >
              New pack
            </Button>
          </>
        }
      />
      {error ? <Banner kind="error">{error}</Banner> : null}
      <DataTable
        columns={["Name", "Status", "Docs", "Checkpoints", ""]}
        empty="No document checks for this project yet."
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
      {open && catalogProjectId ? (
        <CreateVvModal
          catalogProjectId={catalogProjectId}
          projectName={projectName ?? catalogProjectId}
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
  catalogProjectId,
  projectName,
  onClose,
  onCreated,
}: {
  catalogProjectId: string;
  projectName: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState(`${projectName} document pack`);
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
          description: `CATALOG:${catalogProjectId}`,
          registry_slug: "puro_earth_ccs",
          methodology_code: "PURO-CCS-GSC",
          location: catalogProjectId,
          project_developer: "44.01",
          vintage_year: new Date().getUTCFullYear(),
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
    <Modal title="New document pack" onClose={onClose}>
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Field label="Name">
        <input
          className={inputClass}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <p className="mt-2 mb-4 text-xs text-mist">
        Checkpoints stay empty of project-specific findings until you upload
        documents and run verification for this pack.
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
