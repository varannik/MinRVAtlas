"use client";

import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, CirclePause, FileText, LoaderCircle, ShieldCheck, Trash2, X } from "lucide-react";

import type { Capability, Lobe } from "@/lib/cortex/capabilities";
import {
  adviceFor,
  isSettled,
  labelTitle,
  placeOfKey,
  safeFileName,
  sameDocument,
  uploadProblem,
  ORGANISATION_PINS,
  type CortexDocument,
  type DocumentScope,
  type DocumentStatus,
} from "@/lib/cortex/uploads";
import { postToStorage, sha256Of, type UploadForm } from "@/lib/cortex/upload-client";
import { useCortex } from "@/store/cortex-store";
import { ProjectPicker, noProjectReason, readJson, useCortexProjects } from "./cortex-projects";
import { DocumentAdvice, useDocumentActions } from "./document-advice";

/**
 * Documents on a Cortex pin go to the knowledge pipeline for one project:
 * the server signs an upload form with a session scoped to that project, the
 * browser posts the file to S3, and the list below follows it through the
 * malware scan and admission. A file with the name of one already there
 * replaces it (after a confirmation); a document can be removed from Cortex.
 * Once admitted, Cortex labels it, and may hold it out of search or suggest
 * another pin (document-advice.tsx).
 * Anything Cortex cannot read yet stays staged in this browser, as before.
 */

interface InFlight {
  id: string;
  name: string;
  progress: number;
  /** Fingerprinting the file and checking Cortex does not have it already. */
  checking?: boolean;
  error?: string;
}

/** A dropped file that would replace a document already in Cortex, waiting for a yes. */
interface Replacement {
  id: string;
  file: File;
  existing: CortexDocument;
}

const BUTTON =
  "h-7 rounded-md px-2.5 text-[11.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-olivine-500";

const TIME = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const POLL_MS = 8000;

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── Status ──────────────────────────────────────────────────────────────────

const STATUS: Record<DocumentStatus, { label: string; tone: string; Icon: typeof CircleCheck }> = {
  scanning: { label: "Scanning", tone: "text-signal-sky", Icon: LoaderCircle },
  admitting: { label: "Admitting", tone: "text-signal-sky", Icon: ShieldCheck },
  in_cortex: { label: "In Cortex", tone: "text-olivine-700", Icon: CircleCheck },
  held: { label: "Held", tone: "text-ochre-ink", Icon: CirclePause },
  rejected: { label: "Not admitted", tone: "text-signal-rose", Icon: CircleAlert },
};

export function StatusChip({ status }: { status: DocumentStatus }) {
  const { label, tone, Icon } = STATUS[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold ${tone}`}>
      <Icon className={`size-3.5 ${status === "scanning" ? "animate-spin" : ""}`} aria-hidden />
      {label}
    </span>
  );
}

function Row({
  lobe,
  name,
  meta,
  aside,
  children,
}: {
  lobe: Lobe;
  name: string;
  meta: string;
  aside: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li className="grid gap-1.5 rounded-lg border border-strata-300/80 bg-white/75 px-2.5 py-2">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5">
        <span className="grid size-7 place-items-center rounded-md" style={{ background: lobe.tint, color: lobe.ink }}>
          <FileText className="size-3.5" />
        </span>
        <span className="grid min-w-0">
          <span className="truncate text-[12.5px] font-semibold text-earth" title={name}>
            {name}
          </span>
          <span className="truncate text-[11px] text-strata-700">{meta}</span>
        </span>
        {aside}
      </div>
      {children}
    </li>
  );
}

// ── Intake ──────────────────────────────────────────────────────────────────

/**
 * Documents already given for one pin, refreshed while any is still moving: the
 * project's own, or (scope "tenant") the organisation's, which every project searches.
 */
function ProjectDocuments({
  capability,
  lobe,
  projectId,
  projectName,
  owner,
  scope,
  canUpload,
  canRemove,
  canShare,
  renderDropzone,
}: {
  capability: Capability;
  lobe: Lobe;
  projectId: string;
  projectName: string;
  /** Whose documents these are, for the copy: the project's name or "your organisation". */
  owner: string;
  scope: DocumentScope;
  canUpload: boolean;
  canRemove: boolean;
  /** May give documents to every project (moves there need it too). */
  canShare: boolean;
  renderDropzone: (onFiles: (files: File[]) => void) => React.ReactNode;
}) {
  const stageFiles = useCortex((state) => state.stageFiles);
  const [documents, setDocuments] = useState<CortexDocument[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<InFlight[]>([]);
  const [kept, setKept] = useState<string[]>([]);
  const [replacements, setReplacements] = useState<Replacement[]>([]);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  // Document name -> "" while its removal runs, or why it failed.
  const [removing, setRemoving] = useState<Record<string, string>>({});
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ project: projectId, pin: capability.id, scope });
    fetch(`/api/cortex/documents?${query}`, { signal: controller.signal })
      .then((response) => readJson<{ documents: CortexDocument[] }>(response))
      .then((body) => {
        setDocuments(body.documents);
        setListError(null);
      })
      .catch((failure: Error) => {
        if (!controller.signal.aborted) setListError(failure.message);
      });
    return () => controller.abort();
  }, [capability.id, projectId, scope, refresh]);

  const { acting, act, pending } = useDocumentActions(documents, () => setRefresh((value) => value + 1));
  const moving =
    pending ||
    uploads.some((upload) => !upload.error) ||
    (documents ?? []).some((doc) => !isSettled(doc.status) || removing[doc.name] === "");
  useEffect(() => {
    if (!moving) return;
    const timer = window.setTimeout(() => setRefresh((value) => value + 1), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [moving, refresh]);

  const progress = (id: string, change: Partial<InFlight>) =>
    setUploads((current) => current.map((upload) => (upload.id === id ? { ...upload, ...change } : upload)));

  const send = async (file: File) => {
    const id = newId();
    const name = safeFileName(file.name);
    setRemoving((current) => {
      const next = { ...current };
      delete next[name]; // a fresh upload of a removed name starts clean
      return next;
    });
    setUploads((current) => [...current, { id, name: file.name, progress: 0, checking: true }]);
    try {
      const sha256 = await sha256Of(file);
      const form = await readJson<UploadForm>(
        await fetch("/api/cortex/uploads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId, pin: capability.id, fileName: file.name, size: file.size, sha256, scope }),
        }),
      );
      progress(id, { checking: false });
      await postToStorage(form, file, (fraction) => progress(id, { progress: fraction }));
      setUploads((current) => current.filter((upload) => upload.id !== id));
      setRefresh((value) => value + 1);
    } catch (failure) {
      progress(id, { error: (failure as Error).message });
    }
  };

  const take = (files: File[]) => {
    const readable = canUpload ? files.filter((file) => !uploadProblem(file)) : [];
    const others = files.filter((file) => !readable.includes(file));
    setKept(others.map((file) => `${file.name} (${canUpload ? uploadProblem(file) : "your role can read Cortex but not add to it"})`));
    if (others.length > 0) stageFiles(capability.id, "document", others);
    const clashes: Replacement[] = [];
    for (const file of readable) {
      const existing = sameDocument(file.name, documents ?? []);
      if (existing) clashes.push({ id: newId(), file, existing });
      else void send(file);
    }
    if (clashes.length > 0) setReplacements((current) => [...current, ...clashes]);
  };

  const settle = (id: string, replace: boolean) => {
    const choice = replacements.find((item) => item.id === id);
    setReplacements((current) => current.filter((item) => item.id !== id));
    if (replace && choice) void send(choice.file);
  };

  const remove = async (doc: CortexDocument) => {
    setConfirmRemove(null);
    setRemoving((current) => ({ ...current, [doc.name]: "" }));
    try {
      const query = new URLSearchParams({ project: projectId, pin: capability.id, name: doc.name, scope });
      await readJson(await fetch(`/api/cortex/documents?${query}`, { method: "DELETE" }));
      setRefresh((value) => value + 1);
    } catch (failure) {
      setRemoving((current) => ({ ...current, [doc.name]: (failure as Error).message }));
    }
  };

  return (
    <div className="grid gap-2">
      {scope === "tenant" && !canUpload ? (
        <p className="rounded-xl border border-dashed border-strata-300/80 px-3.5 py-3 text-[12px] leading-snug text-strata-700">
          Documents here are searched by every project in your organisation. Only organisation admins add or remove
          them.
        </p>
      ) : (
        renderDropzone(take)
      )}
      {kept.length > 0 && (
        <p className="text-[11.5px] leading-snug text-strata-700" role="status">
          Kept in this browser, not sent: {kept.join("; ")}.
        </p>
      )}
      {replacements.map(({ id, file, existing }) => {
        const busy = !isSettled(existing.status);
        return (
          <div key={id} className="grid gap-2 rounded-xl border border-strata-300/80 bg-white/75 px-3 py-2.5" role="alertdialog">
            <p className="text-[12px] leading-snug text-earth">
              <span className="font-semibold">{existing.name}</span> is already in Cortex for {owner} (
              {STATUS[existing.status].label.toLowerCase()}, {TIME.format(new Date(existing.uploadedAt))}).{" "}
              {busy
                ? "It is still being processed; drop the file again once that has finished."
                : `Replace it with ${file.name}? Search keeps using the old one until the new file is indexed.`}
            </p>
            <div className="flex gap-1.5">
              {!busy && (
                <button type="button" onClick={() => settle(id, true)} className={`${BUTTON} bg-olivine-800 text-white hover:bg-olivine-900`}>
                  Replace
                </button>
              )}
              <button type="button" onClick={() => settle(id, false)} className={`${BUTTON} border border-strata-300/80 text-earth hover:bg-white/80`}>
                {busy ? "OK" : "Cancel"}
              </button>
            </div>
          </div>
        );
      })}

      <div className="flex items-baseline justify-between gap-2 pt-1">
        <span className="text-[11.5px] font-semibold text-earth">In Cortex for {owner}</span>
        {moving && <span className="text-[11px] text-strata-700">Updating…</span>}
      </div>
      {listError && (
        <p className="text-[11.5px] text-signal-rose" role="alert">
          {listError}
        </p>
      )}
      <ul className="grid gap-1.5" aria-live="polite">
        {uploads.map((upload) => (
          <Row
            key={upload.id}
            lobe={lobe}
            name={upload.name}
            meta={
              upload.error ??
              (upload.checking ? "Checking Cortex does not have it already…" : `Uploading · ${Math.round(upload.progress * 100)}%`)
            }
            aside={
              upload.error ? (
                <button
                  type="button"
                  onClick={() => setUploads((current) => current.filter((item) => item.id !== upload.id))}
                  aria-label={`Dismiss ${upload.name}`}
                  className="grid size-7 place-items-center rounded-md text-strata-700 transition-colors hover:bg-white/80 hover:text-earth focus-visible:outline-2 focus-visible:outline-olivine-500"
                >
                  <X className="size-3.5" />
                </button>
              ) : (
                <LoaderCircle className="size-3.5 animate-spin text-strata-700" aria-hidden />
              )
            }
          >
            {!upload.error && (
              <span className="h-1 overflow-hidden rounded-full bg-strata-300/60">
                <span
                  className="block h-full rounded-full transition-[width]"
                  style={{ width: `${Math.round(upload.progress * 100)}%`, background: lobe.ink }}
                />
              </span>
            )}
          </Row>
        ))}
        {(documents ?? []).map((doc) => {
          const removal = removing[doc.name];
          const removable = canRemove && isSettled(doc.status) && removal === undefined;
          const titled = doc.label?.checked ? labelTitle(doc.label) : "";
          const advice =
            removal === undefined
              ? adviceFor(
                  { scope, pin: capability.id, label: doc.label },
                  { canUpload, canShare, placeOf: (key) => placeOfKey(key, projectName) },
                )
              : null;
          const request = { project: projectId, pin: capability.id, name: doc.name, scope };
          return (
            <Row
              key={doc.key}
              lobe={lobe}
              name={doc.name}
              meta={
                removal
                  ? `Not removed: ${removal}`
                  : [titled, formatBytes(doc.size), TIME.format(new Date(doc.uploadedAt)), doc.detail]
                      .filter(Boolean)
                      .join(" · ")
              }
              aside={
                <span className="flex items-center gap-1.5">
                  {removal === "" ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-signal-sky">
                      <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                      Removing
                    </span>
                  ) : (
                    <StatusChip status={doc.status} />
                  )}
                  {removable && (
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(doc.key)}
                      aria-label={`Remove ${doc.name} from Cortex`}
                      className="grid size-7 place-items-center rounded-md text-strata-700 transition-colors hover:bg-white/80 hover:text-earth focus-visible:outline-2 focus-visible:outline-olivine-500"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </span>
              }
            >
              {advice && (
                <DocumentAdvice
                  advice={advice}
                  acting={acting[doc.key]}
                  onKeep={() => void act(doc, request, "keep")}
                  onStay={() => void act(doc, request, "stay")}
                  onMove={() => advice.kind === "move" && void act(doc, request, "move", advice.to)}
                  onRemove={removable ? () => setConfirmRemove(doc.key) : undefined}
                  who={scope === "tenant" ? "An organisation admin" : "Someone who can add to this project"}
                />
              )}
              {confirmRemove === doc.key && (
                <div className="grid gap-2 border-t border-strata-300/80 pt-2" role="alertdialog">
                  <p className="text-[11.5px] leading-snug text-earth">
                    Remove {doc.name} from Cortex for {owner}? Search stops using it within a few minutes. The
                    original is kept as a deleted version for audit.
                  </p>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => void remove(doc)} className={`${BUTTON} bg-signal-rose text-white hover:bg-signal-rose/85`}>
                      Remove
                    </button>
                    <button type="button" onClick={() => setConfirmRemove(null)} className={`${BUTTON} border border-strata-300/80 text-earth hover:bg-white/80`}>
                      Keep
                    </button>
                  </div>
                </div>
              )}
            </Row>
          );
        })}
      </ul>
      {documents && documents.length === 0 && uploads.length === 0 && (
        <p className="rounded-xl border border-dashed border-strata-300/80 px-3.5 py-3 text-[12.5px] text-strata-700">
          No documents for {capability.name} {scope === "tenant" ? "for your organisation" : "on this project"} yet.
        </p>
      )}
    </div>
  );
}

/**
 * The document dropzone of a pin, wired to Cortex when this deployment has it.
 * Without Cortex (or a project), files stay staged in this browser as before.
 */
export function DocumentIntake({
  capability,
  lobe,
  renderDropzone,
}: {
  capability: Capability;
  lobe: Lobe;
  renderDropzone: (onFiles: (files: File[]) => void) => React.ReactNode;
}) {
  const { reply, error } = useCortexProjects();
  const stored = useCortex((state) => state.projectId);
  const setProject = useCortex((state) => state.setProject);
  const stageFiles = useCortex((state) => state.stageFiles);
  const [scope, setScope] = useState<DocumentScope>("project");
  const stageLocally = (files: File[]) => stageFiles(capability.id, "document", files);
  const sharable = ORGANISATION_PINS.has(capability.id);

  if (!reply) {
    return (
      <div className="grid gap-1.5">
        {renderDropzone(stageLocally)}
        <p className="text-[11.5px] text-strata-700">
          {error ? `Cortex is unavailable (${error}). Files stay in this browser.` : "Connecting to Cortex…"}
        </p>
      </div>
    );
  }
  const project = reply.projects.find((item) => item.id === stored) ?? reply.projects[0];
  const why = noProjectReason(reply, project);
  if (why || !project) {
    return (
      <div className="grid gap-1.5">
        {renderDropzone(stageLocally)}
        <p className="text-[11.5px] text-strata-700">{why} Files stay in this browser.</p>
      </div>
    );
  }

  const forOrganisation = sharable && scope === "tenant";
  return (
    <div className="grid gap-2.5">
      <ProjectPicker projects={reply.projects} value={project.id} onChange={setProject} />
      {sharable && (
        <div className="grid gap-1">
          <span className="text-[11.5px] font-medium text-strata-700">Give to</span>
          <div role="radiogroup" aria-label="Give documents to" className="grid grid-cols-2 gap-1 rounded-lg bg-strata-300/45 p-0.5">
            {(
              [
                ["project", "This project"],
                ["tenant", "Every project"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={scope === value}
                onClick={() => setScope(value)}
                className={`h-7 rounded-md text-[12px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-olivine-500 ${
                  scope === value ? "bg-white/75 text-earth shadow-sm" : "text-strata-700 hover:text-earth"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {forOrganisation && (
            <span className="text-[11px] leading-snug text-strata-700">
              Every project in your organisation searches these, alongside its own documents.
            </span>
          )}
        </div>
      )}
      <ProjectDocuments
        key={`${capability.id}:${project.id}:${forOrganisation ? "tenant" : "project"}`}
        capability={capability}
        lobe={lobe}
        projectId={project.id}
        projectName={project.name}
        owner={forOrganisation ? "your organisation" : project.name}
        scope={forOrganisation ? "tenant" : "project"}
        canUpload={forOrganisation ? reply.canShare : reply.canUpload}
        canRemove={forOrganisation ? reply.canShare && reply.canRemove : reply.canRemove}
        canShare={reply.canShare}
        renderDropzone={renderDropzone}
      />
    </div>
  );
}
