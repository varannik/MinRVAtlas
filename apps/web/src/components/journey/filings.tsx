"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { CircleAlert, CircleCheck, CirclePause, FileSpreadsheet, FileText, LoaderCircle, Upload } from "lucide-react";

import { readJson } from "@/components/cortex/cortex-projects";
import { CAPABILITY_BY_ID, type CapabilityId } from "@/lib/cortex/capabilities";
import { fileInCortex, type Filed } from "@/lib/cortex/upload-client";
import { isSettled, pinAndName, type CortexDocument, type DocumentStatus } from "@/lib/cortex/uploads";
import type { FiledFile, JourneyTask } from "@/lib/journey/types";
import { useJourney } from "@/store/journey-store";

/**
 * Documents given on a journey task. On a saved project each one is filed in
 * Cortex on the task's pin (journey.yaml files_to): Cortex scans, reads and
 * labels it like any upload, and the task records where it is. A file Cortex
 * already has is filed as that document; a spreadsheet is kept by name and
 * fingerprint. A practice journey keeps names only.
 */

const POLL_MS = 8000;

type FileInput = Extract<JourneyTask["input"], { type: "file" }>;

// ── Where a filed document is now ───────────────────────────────────────────

/** The pin and scope a document key is under, for listing it. */
function placeOf(key: string): { scope: "project" | "tenant"; pin: string } | null {
  const parts = key.split("/");
  if (parts[0] !== "tenants") return null; // a registry document
  const rest = parts[2] === "tenant" ? parts.slice(3) : parts.slice(4);
  const { pin } = pinAndName(rest.join("/"));
  return pin ? { scope: parts[2] === "tenant" ? "tenant" : "project", pin } : null;
}

const lists = new Map<string, { at: number; request: Promise<CortexDocument[]> }>();

/** A pin's documents, shared by the task cards on screen (one request per pin every few seconds). */
function pinDocuments(projectId: string, scope: string, pin: string): Promise<CortexDocument[]> {
  const cacheKey = `${projectId}|${scope}|${pin}`;
  const cached = lists.get(cacheKey);
  if (cached && Date.now() - cached.at < POLL_MS / 2) return cached.request;
  const request = fetch(`/api/cortex/documents?${new URLSearchParams({ project: projectId, pin, scope })}`)
    .then((response) => readJson<{ documents: CortexDocument[] }>(response))
    .then((body) => body.documents);
  request.catch(() => lists.delete(cacheKey));
  lists.set(cacheKey, { at: Date.now(), request });
  return request;
}

/** Cortex's documents by key for the places these keys are filed under; polls while any is being read. */
function useFiledDocuments(projectId: string | null, keys: string[]): Record<string, CortexDocument> | null {
  const [documents, setDocuments] = useState<Record<string, CortexDocument> | null>(null);
  const [tick, setTick] = useState(0);
  const places = useMemo(() => {
    const unique = new Map<string, { scope: string; pin: string }>();
    for (const key of keys) {
      const place = placeOf(key);
      if (place) unique.set(`${place.scope}|${place.pin}`, place);
    }
    return [...unique.values()];
  }, [keys]);

  useEffect(() => {
    if (!projectId || places.length === 0) return;
    let live = true;
    Promise.all(places.map((place) => pinDocuments(projectId, place.scope, place.pin)))
      .then((found) => live && setDocuments(Object.fromEntries(found.flat().map((doc) => [doc.key, doc]))))
      .catch(() => live && setDocuments({}));
    return () => {
      live = false;
    };
  }, [projectId, places, tick]);

  const reading = documents !== null && keys.some((key) => documents[key] && !isSettled(documents[key].status));
  useEffect(() => {
    if (!reading) return;
    const timer = window.setTimeout(() => setTick((value) => value + 1), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [reading, tick]);
  return documents;
}

const STATUS: Record<DocumentStatus | "gone" | "registry", { label: string; tone: string; Icon: typeof CircleCheck }> = {
  scanning: { label: "Scanning", tone: "text-[#2A5DB0]", Icon: LoaderCircle },
  admitting: { label: "Being read", tone: "text-[#2A5DB0]", Icon: LoaderCircle },
  in_cortex: { label: "In Cortex", tone: "text-[#2F6B2F]", Icon: CircleCheck },
  held: { label: "Held: open it in Cortex", tone: "text-[#855300]", Icon: CirclePause },
  rejected: { label: "Not admitted", tone: "text-[#A3261A]", Icon: CircleAlert },
  gone: { label: "No longer at this place in Cortex", tone: "text-[#A3261A]", Icon: CircleAlert },
  registry: { label: "In Cortex", tone: "text-[#2F6B2F]", Icon: CircleCheck },
};

/** The files given on a task, each with where it stands in Cortex. Shown in the answer bubble. */
export function FiledList({ files }: { files: FiledFile[] }) {
  const projectId = useJourney((state) => state.project?.id ?? null);
  const keys = useMemo(() => files.flatMap((file) => (file.key ? [file.key] : [])), [files]);
  const documents = useFiledDocuments(projectId, keys);

  return (
    <ul className="grid gap-1">
      {files.map((file) => {
        const sheet = !file.key && file.sha256;
        const Icon = sheet ? FileSpreadsheet : FileText;
        let status: (typeof STATUS)[keyof typeof STATUS] | null = null;
        if (file.key && projectId) {
          const place = placeOf(file.key);
          const doc = documents?.[file.key];
          status = !place ? STATUS.registry : doc ? STATUS[doc.status] : documents ? STATUS.gone : null;
        }
        return (
          <li key={file.key ?? file.name} className="grid text-[12px]">
            <span className="flex min-w-0 items-center gap-1.5">
              <Icon className="size-3 shrink-0 opacity-70" />
              <span className="truncate">{file.name}</span>
            </span>
            {status ? (
              <span className={`flex items-center gap-1 pl-[18px] text-[11px] font-medium ${status.tone}`}>
                <status.Icon className={`size-3 shrink-0 ${status.Icon === LoaderCircle ? "animate-spin" : ""}`} aria-hidden />
                {status.label}
              </span>
            ) : sheet ? (
              <span className="pl-[18px] text-[11px] text-[#141235]/55">Kept by name: Cortex reads PDF and Word</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

// ── Giving files ────────────────────────────────────────────────────────────

interface Sending {
  name: string;
  progress: number;
  done?: boolean;
  note?: string;
  error?: string;
}

/** Choose or drop files: filed in Cortex on a saved project, names only in practice. */
export function FileDrop({ task, input, onAnswer }: { task: JourneyTask; input: FileInput; onAnswer: (files: FiledFile[]) => void }) {
  const inputId = useId();
  const project = useJourney((state) => state.project);
  const [over, setOver] = useState(false);
  const [sending, setSending] = useState<Sending[]>([]);
  const busy = sending.some((row) => !row.done && !row.error);
  const pinName = CAPABILITY_BY_ID[input.pin as CapabilityId]?.name ?? input.pin;
  const takesSheets = input.accept.includes(".xlsx");

  const take = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0 || busy) return;
    if (!project) {
      onAnswer(files.map((file) => ({ name: file.name, size: file.size })));
      return;
    }
    if (!project.canEdit) {
      setSending([{ name: task.label, progress: 0, error: "Your role can read this journey but not change it." }]);
      return;
    }
    setSending(files.map((file) => ({ name: file.name, progress: 0 })));
    const update = (index: number, change: Partial<Sending>) =>
      setSending((rows) => rows.map((row, at) => (at === index ? { ...row, ...change } : row)));
    const results = await Promise.allSettled(
      files.map((file, index) =>
        fileInCortex(file, { projectId: project.id, pin: input.pin }, (fraction) => update(index, { progress: fraction })),
      ),
    );
    const filed: Filed[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        filed.push(result.value);
        update(index, { done: true, progress: 1, note: result.value.alreadyAs ? `Already in Cortex as ${result.value.alreadyAs}` : undefined });
      } else {
        update(index, { error: (result.reason as Error)?.message ?? "Not filed." });
      }
    });
    // Every file or none: give them again and those already sent are recognised by their content.
    if (filed.length !== files.length) return;
    setSending([]);
    onAnswer(filed.map(({ name, size, key, sha256 }) => ({ name, size, key, sha256 })));
  };

  const where = project
    ? `${input.formats} · documents are filed in Cortex under ${pinName}${takesSheets ? "; spreadsheets are kept by name" : ""}`
    : `${input.formats} · practice: only the name and size are kept`;

  return (
    <div className="grid gap-2">
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          void take(event.dataTransfer.files);
        }}
        aria-disabled={busy}
        className={`flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-3 py-2.5 transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-white ${
          over ? "border-[#A99BFF] bg-[#8F7DF7]/20" : "border-white/20 bg-white/[0.04] hover:bg-white/[0.08]"
        } ${busy ? "pointer-events-none opacity-60" : ""}`}
      >
        <input
          id={inputId}
          type="file"
          multiple
          accept={input.accept}
          disabled={busy}
          className="sr-only"
          onChange={(event) => {
            void take(event.target.files);
            event.target.value = "";
          }}
        />
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#8F7DF7]/25 text-[#D9D2FF]">
          <Upload className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-[12.5px] font-semibold text-white">{busy ? "Filing in Cortex…" : "Choose or drop files"}</span>
          <span className="block text-[11px] text-white/55">{where}</span>
        </span>
      </label>
      {sending.length > 0 ? (
        <ul className="grid gap-1.5" aria-live="polite">
          {sending.map((row, index) => (
            <li key={`${row.name}-${index}`} className="grid gap-1 text-[11.5px]">
              <span className="flex min-w-0 items-center gap-1.5 text-white/85">
                {row.error ? (
                  <CircleAlert className="size-3.5 shrink-0 text-[#FFB59A]" aria-hidden />
                ) : row.done ? (
                  <CircleCheck className="size-3.5 shrink-0 text-[#B5E3A1]" aria-hidden />
                ) : (
                  <LoaderCircle className="size-3.5 shrink-0 animate-spin" aria-hidden />
                )}
                <span className="truncate">{row.name}</span>
              </span>
              {row.error ? <span className="pl-5 text-[#FFC9B5]">{row.error}</span> : null}
              {row.note ? <span className="pl-5 text-white/60">{row.note}</span> : null}
              {!row.done && !row.error ? (
                <span className="ml-5 h-1 overflow-hidden rounded-full bg-white/10">
                  <span className="block h-full rounded-full bg-[#A99BFF]" style={{ width: `${Math.round(row.progress * 100)}%` }} />
                </span>
              ) : null}
            </li>
          ))}
          {!busy && sending.some((row) => row.error) && sending.some((row) => row.done) ? (
            <li className="text-[11px] text-white/60">
              Nothing was given yet. Fix the files above and give them all again: those already in Cortex are recognised.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
