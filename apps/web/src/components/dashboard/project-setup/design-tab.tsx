"use client";

import { useMemo, useState } from "react";
import { ChevronDown, FileUp } from "lucide-react";
import {
  PDD_SECTION_META,
  PDD_SOURCE_CATEGORIES,
  pddCatalogFor,
  pddSourcePrefix,
  type PddSectionId,
  type PddSourceCategory,
} from "@/lib/registries/isometric/pdd-catalog";
import type { Source } from "@/lib/registries/isometric/api";
import type { ProjectSetupSnapshot } from "@/lib/registries/isometric/setup-types";
import type { Project } from "@/lib/types";
import { useProjectSetup } from "@/hooks/use-project-setup";

function sourcesFor(
  sources: Source[],
  section: PddSectionId,
  key: string,
): Source[] {
  const prefix = pddSourcePrefix(section, key);
  return sources.filter((source) =>
    (source.supplier_reference_id ?? "").startsWith(prefix),
  );
}

export function DesignTab({
  project,
  snapshot,
  locked,
}: {
  project: Project;
  snapshot: ProjectSetupSnapshot;
  locked: boolean;
}) {
  const { submit, saving } = useProjectSetup(project);
  const catalog = useMemo(
    () => pddCatalogFor(project.methodologyKey),
    [project.methodologyKey],
  );
  const sections = useMemo(() => {
    const ids = Object.keys(PDD_SECTION_META) as PddSectionId[];
    return ids.map((id) => ({
      id,
      ...PDD_SECTION_META[id],
      items: catalog.filter((row) => row.section === id),
    }));
  }, [catalog]);
  const [section, setSection] = useState<PddSectionId>("project-setup");
  const [openKey, setOpenKey] = useState<string | null>(catalog[0]?.key ?? null);
  const active = sections.find((row) => row.id === section) ?? sections[0];
  const filed = catalog.filter((row) =>
    sourcesFor(snapshot.sources, row.section, row.key).length > 0,
  ).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap gap-1 border-b border-line/70 px-3 pt-2">
        {sections.map((row) => {
          const count = row.items.filter(
            (item) => sourcesFor(snapshot.sources, item.section, item.key).length > 0,
          ).length;
          return (
            <button
              key={row.id}
              type="button"
              onClick={() => setSection(row.id)}
              className={`border-b-2 px-2.5 py-1.5 text-[11px] font-medium ${
                section === row.id
                  ? "border-carbon-400 text-frost"
                  : "border-transparent text-mist hover:text-frost"
              }`}
            >
              {row.code}: {row.title}
              <span className="ml-1.5 tabular text-[10px] text-mist">
                {count}/{row.items.length}
              </span>
            </button>
          );
        })}
      </div>

      <div className="scroll-slim min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
        {snapshot.definition.artifacts
          .filter((row) => row.kind === "pdd")
          .map((artifact) => (
            <a
              key={artifact.id}
              href={artifact.href}
              target="_blank"
              rel="noreferrer"
              className="block rounded-xl bg-white/70 px-3 py-2 text-[12px] text-frost ring-1 ring-line/60 hover:underline"
            >
              Published · {artifact.title}
            </a>
          ))}

        {active.items.map((item) => {
          const files = sourcesFor(snapshot.sources, item.section, item.key);
          const open = openKey === item.key;
          return (
            <article
              key={item.key}
              className="rounded-xl bg-white/70 ring-1 ring-line/60"
            >
              <button
                type="button"
                onClick={() => setOpenKey(open ? null : item.key)}
                className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
              >
                <ChevronDown
                  className={`mt-0.5 size-3.5 shrink-0 text-mist transition-transform ${
                    open ? "" : "-rotate-90"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-frost">{item.title}</p>
                  <p className="mt-0.5 text-[11px] text-mist">{item.hint}</p>
                </div>
                <span className="shrink-0 text-[10px] tracking-wide text-mist uppercase">
                  {files.length > 0 ? `${files.length} file${files.length === 1 ? "" : "s"}` : "Not started"}
                </span>
              </button>
              {open ? (
                <RequirementForm
                  itemKey={item.key}
                  section={item.section}
                  reference={item.reference}
                  files={files}
                  locked={locked}
                  saving={saving}
                  onSubmit={async (draft, file) => {
                    await submit(
                      {
                        action: "uploadDesignSource",
                        section: item.section,
                        requirementKey: item.key,
                        category: draft.category,
                        reason: draft.reason,
                        pages: draft.pages,
                        notes: draft.notes,
                      },
                      file ? [file] : [],
                    );
                  }}
                />
              ) : null}
            </article>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line/70 px-4 py-2.5 text-[11px] text-mist">
        <span>
          {filed} of {catalog.length} requirements have evidence in Certify
        </span>
        <a
          href="https://registry.isometric.com/account/certify"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-carbon-400 hover:underline"
        >
          Finish drafting in Certify
        </a>
      </div>
    </div>
  );
}

function RequirementForm({
  itemKey,
  section,
  reference,
  files,
  locked,
  saving,
  onSubmit,
}: {
  itemKey: string;
  section: PddSectionId;
  reference: string;
  files: Source[];
  locked: boolean;
  saving: boolean;
  onSubmit: (
    draft: {
      category: PddSourceCategory;
      reason: string;
      pages: string;
      notes: string;
    },
    file: File | null,
  ) => Promise<void>;
}) {
  const [category, setCategory] = useState<PddSourceCategory>("plan-assessment");
  const [reason, setReason] = useState("");
  const [pages, setPages] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  void itemKey;
  void section;

  return (
    <div className="space-y-2 border-t border-line/50 px-3 py-2.5">
      <p className="text-[10px] tracking-wide text-mist uppercase">{reference}</p>
      {files.length > 0 ? (
        <ul className="space-y-1">
          {files.map((source) => (
            <li key={source.id} className="text-[11px] text-frost">
              {source.display_name || source.original_filename || source.id}
              {source.description ? (
                <span className="ml-1 text-mist">{source.description}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-mist">
          Category
          <select
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as PddSourceCategory)
            }
            className="mt-1 w-full rounded-lg bg-ink-800/80 px-2 py-1.5 text-[12px] text-frost"
          >
            {PDD_SOURCE_CATEGORIES.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[10px] text-mist">
          Pages
          <input
            value={pages}
            onChange={(event) => setPages(event.target.value)}
            placeholder="e.g. 14–21"
            className="mt-1 w-full rounded-lg bg-ink-800/80 px-2 py-1.5 text-[12px] text-frost"
          />
        </label>
      </div>
      <label className="block text-[10px] text-mist">
        Reason for attachment
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="mt-1 w-full rounded-lg bg-ink-800/80 px-2 py-1.5 text-[12px] text-frost"
        />
      </label>
      <label className="block text-[10px] text-mist">
        Notes
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          className="mt-1 w-full rounded-lg bg-ink-800/80 px-2 py-1.5 text-[12px] text-frost"
        />
      </label>
      <div className="flex items-center justify-between gap-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-mist">
          <FileUp className="size-3.5" />
          {file ? file.name : "Choose file"}
          <input
            type="file"
            className="hidden"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <button
          type="button"
          disabled={!file || saving}
          onClick={() => void onSubmit({ category, reason, pages, notes }, file)}
          className="rounded-lg bg-carbon-400/15 px-3 py-1.5 text-[11px] font-semibold text-carbon-400 disabled:opacity-40"
        >
          Upload to Certify
        </button>
      </div>
      {locked ? (
        <p className="text-[10px] text-mist">
          Published design is on file. Additional sources can still be attached;
          official edits stay in Certify while a review is open.
        </p>
      ) : null}
    </div>
  );
}
