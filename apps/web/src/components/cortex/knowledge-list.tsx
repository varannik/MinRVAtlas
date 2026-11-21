"use client";

import { useEffect, useState } from "react";
import { CircleAlert, FileText, LoaderCircle, RotateCw, Trash2 } from "lucide-react";

import { CAPABILITY_BY_ID, isCapabilityId } from "@/lib/cortex/capabilities";
import {
  adviceFor,
  documentPlace,
  duplicateNotes,
  isSettled,
  labelTitle,
  placeOfKey,
  type DocumentScope,
  type KnowledgeDocument,
} from "@/lib/cortex/uploads";
import { readJson, type CortexProjectOption } from "./cortex-projects";
import { DocumentAdvice, useDocumentActions } from "./document-advice";
import { StatusChip } from "./document-intake";

/**
 * Everything one project's Cortex searches read, in the three scopes the search
 * combines: registry documents for its methodology and edition, the organisation's
 * documents (every project) and the project's own, across all pins. Each shows what
 * Cortex made of it (title, version), and what Cortex suggests: keep a held document
 * in search, or move one to the pin it belongs on.
 */

const POLL_MS = 8000;
const TIME = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const BUTTON =
  "h-7 rounded-md px-2.5 text-[11.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rock";

interface KnowledgeReply {
  documents: KnowledgeDocument[];
  gaps: string[];
}

function pinName(pin: string | null): string | null {
  if (!pin) return null;
  return isCapabilityId(pin) ? `${CAPABILITY_BY_ID[pin].name} pin` : pin;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Group({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <p className="flex min-w-0 items-baseline gap-1.5 text-[11.5px]">
        <span className="font-semibold text-rock">{title}</span>
        <span className="truncate text-mist">{note}</span>
      </p>
      {children}
    </div>
  );
}

export function KnowledgeList({
  project,
  canUpload,
  canRemove,
  canShare,
}: {
  project: CortexProjectOption;
  canUpload: boolean;
  canRemove: boolean;
  canShare: boolean;
}) {
  const [reply, setReply] = useState<KnowledgeReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [confirm, setConfirm] = useState<string | null>(null);
  // Document key -> "" while its removal runs, or why it failed.
  const [removing, setRemoving] = useState<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/cortex/knowledge?${new URLSearchParams({ project: project.id })}`, { signal: controller.signal })
      .then((response) => readJson<KnowledgeReply>(response))
      .then((body) => {
        setReply(body);
        setError(null);
      })
      .catch((failure: Error) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [project.id, refresh]);

  const documents = reply?.documents ?? [];
  const { acting, act, pending } = useDocumentActions(reply?.documents ?? null, () => setRefresh((value) => value + 1));
  const moving = pending || documents.some((doc) => !isSettled(doc.status) || removing[doc.key] === "");
  useEffect(() => {
    if (!moving) return;
    const timer = window.setTimeout(() => setRefresh((value) => value + 1), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [moving, refresh]);

  const remove = async (doc: KnowledgeDocument) => {
    setConfirm(null);
    setRemoving((current) => ({ ...current, [doc.key]: "" }));
    try {
      const query = new URLSearchParams({ project: project.id, pin: doc.pin ?? "", name: doc.name, scope: doc.scope });
      await readJson(await fetch(`/api/cortex/documents?${query}`, { method: "DELETE" }));
      setRefresh((value) => value + 1);
    } catch (failure) {
      setRemoving((current) => ({ ...current, [doc.key]: (failure as Error).message }));
    }
  };

  if (!reply) {
    return (
      <p className="text-[12px] text-mist" role={error ? "alert" : "status"}>
        {error ?? "Reading what Cortex holds…"}
      </p>
    );
  }

  const placeOf = (doc: KnowledgeDocument) => documentPlace(doc, project.name);
  const notes = duplicateNotes(documents, placeOf);
  const request = (doc: KnowledgeDocument) => ({
    project: project.id,
    pin: doc.pin ?? "",
    name: doc.name,
    scope: doc.scope as DocumentScope,
  });
  const passages = documents.reduce((sum, doc) => sum + (doc.passages ?? 0), 0);
  const shared = documents.filter((doc) => doc.scope === "shared");
  const organisation = documents.filter((doc) => doc.scope === "tenant");
  const own = documents.filter((doc) => doc.scope === "project");
  const edition = [project.methodology, project.edition].filter(Boolean).join(" · ");

  const rows = (docs: KnowledgeDocument[], empty: string) =>
    docs.length === 0 ? (
      <p className="rounded-lg border border-dashed border-line px-3 py-2 text-[11.5px] text-shale">{empty}</p>
    ) : (
      <ul className="grid min-w-0 gap-1.5">
        {docs.map((doc) => {
          const removal = removing[doc.key];
          const removable =
            doc.scope !== "shared" &&
            isSettled(doc.status) &&
            removal === undefined &&
            canRemove &&
            (doc.scope === "project" || canShare);
          const titled = doc.label?.checked ? labelTitle(doc.label) : "";
          const meta = [titled, pinName(doc.pin), TIME.format(new Date(doc.uploadedAt)), formatBytes(doc.size)]
            .filter(Boolean)
            .join(" · ");
          const advice =
            removal === undefined
              ? adviceFor(doc, { canUpload, canShare, placeOf: (key) => placeOfKey(key, project.name) })
              : null;
          return (
            <li key={doc.key} className="grid min-w-0 gap-1.5 rounded-lg border border-line bg-white px-2.5 py-2">
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5">
                <span className="grid size-7 place-items-center rounded-md bg-[#EEE9FD] text-[#5536B0]">
                  <FileText className="size-3.5" />
                </span>
                <span className="grid min-w-0">
                  <span className="truncate text-[12.5px] font-semibold text-rock" title={doc.name}>
                    {doc.name}
                  </span>
                  <span className="truncate text-[11px] text-mist" title={doc.label?.summary}>
                    {removal ? `Not removed: ${removal}` : meta}
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  {removal === "" ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-signal-sky">
                      <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                      Removing
                    </span>
                  ) : doc.status === "in_cortex" && doc.passages !== null ? (
                    <span className="tabular shrink-0 text-[11px] font-semibold text-carbon-400">
                      {doc.passages} passages
                    </span>
                  ) : (
                    <StatusChip status={doc.status} />
                  )}
                  {removable && (
                    <button
                      type="button"
                      onClick={() => setConfirm(doc.key)}
                      aria-label={`Remove ${doc.name} from Cortex`}
                      className="grid size-7 place-items-center rounded-md text-mist transition-colors hover:bg-ink-700 hover:text-rock focus-visible:outline-2 focus-visible:outline-rock"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </span>
              </div>
              {advice && (
                <DocumentAdvice
                  advice={advice}
                  acting={acting[doc.key]}
                  onKeep={() => void act(doc, request(doc), "keep")}
                  onStay={() => void act(doc, request(doc), "stay")}
                  onMove={() => advice.kind === "move" && void act(doc, request(doc), "move", advice.to)}
                  onRemove={removable ? () => setConfirm(doc.key) : undefined}
                  who={doc.scope === "tenant" ? "An organisation admin" : "Someone who can add to this project"}
                />
              )}
              {doc.status === "in_cortex" && doc.passages === 0 && (
                <p className="text-[11px] leading-snug text-signal-rose">
                  No text was found in this file, so search cannot use it. A scanned PDF needs a text layer.
                </p>
              )}
              {confirm === doc.key && (
                <div className="grid gap-2 border-t border-line pt-2" role="alertdialog">
                  <p className="text-[11.5px] leading-snug text-rock">
                    Remove {doc.name}
                    {doc.pin ? ` (${pinName(doc.pin)})` : ""} from Cortex
                    {doc.scope === "tenant" ? " for every project in your organisation" : ` for ${project.name}`}?
                    Search stops using it within a few minutes. The original is kept as a deleted version for audit.
                  </p>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => void remove(doc)}
                      className={`${BUTTON} bg-signal-rose text-white hover:bg-signal-rose/85`}
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirm(null)}
                      className={`${BUTTON} border border-line text-rock hover:bg-ink-700`}
                    >
                      Keep
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );

  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] text-shale">
          <span className="tabular font-semibold text-rock">{documents.length}</span> documents
          {passages > 0 && (
            <>
              {" "}
              · <span className="tabular font-semibold text-rock">{passages}</span> passages
            </>
          )}
          {moving && <span className="text-mist"> · updating…</span>}
        </p>
        <button
          type="button"
          onClick={() => setRefresh((value) => value + 1)}
          aria-label="Refresh what Cortex knows"
          className="grid size-7 place-items-center rounded-md text-mist transition-colors hover:bg-ink-700 hover:text-rock focus-visible:outline-2 focus-visible:outline-rock"
        >
          <RotateCw className="size-3.5" />
        </button>
      </div>

      {notes.map((note) => (
        <p
          key={note}
          className="flex items-start gap-1.5 rounded-lg bg-[#FBF0D9] px-2.5 py-2 text-[11.5px] leading-snug text-[#855300]"
        >
          <CircleAlert className="mt-px size-3.5 shrink-0" />
          <span>{note}</span>
        </p>
      ))}

      <Group title="Registry" note={edition ? `${edition}, for every organisation` : "for every organisation"}>
        {reply.gaps.includes("registry") ? (
          <p className="text-[11.5px] text-shale">
            Registry documents cannot be listed yet: this deployment needs the latest Cortex infra.
          </p>
        ) : (
          rows(shared, "No registry documents for this methodology yet.")
        )}
      </Group>
      <Group title="Your organisation" note="every project searches these">
        {rows(
          organisation,
          canShare
            ? "None yet. Add them on the Knowledge, Protocols or Reviewer pin with “Every project”."
            : "None yet. Organisation admins add these.",
        )}
      </Group>
      <Group title={project.name} note="this project only">
        {rows(own, "None yet. Drop documents on a pin to add them.")}
      </Group>
      {reply.gaps.includes("passages") && (
        <p className="text-[11px] text-mist">Passage counts need the latest Cortex infra on this deployment.</p>
      )}
    </div>
  );
}
