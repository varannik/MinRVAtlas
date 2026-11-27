"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, FileText, FolderUp, LoaderCircle, Search, ShieldCheck, Sparkles, Upload, X } from "lucide-react";

import { useCortexProjects } from "@/components/cortex/cortex-projects";
import { FIELD, PANEL } from "@/components/data-quality/style";
import { AppSwitcher } from "@/components/nav/app-switcher";
import { fileInCortex, postToStorage, sha256Of, type UploadForm } from "@/lib/cortex/upload-client";
import { uploadType } from "@/lib/cortex/uploads";
import { formatDay } from "@/lib/mrv/days";
import { suggestPiece } from "@/lib/verification/filing";
import { AUDIT_LABEL, type AuditKey, type EvidencePiece, type Filing, type SubmissionFile, type VerificationView } from "@/lib/verification/types";

/**
 * The mock verifier's page (/verification): one project's audit, laid out as Puro's
 * Audit Document Index. The supplier's side imports the Index, sends the submission
 * folder (kept as received; PDF and Word copies go to Cortex so Claude can read and
 * cite them) and files each document under its evidence piece. The verifier reads
 * every piece with what Puro asks, the clauses it answers and the files behind it.
 */

const AUDITS: AuditKey[] = ["facility", "output", "combined"];
const BUTTON = "inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-45";
const SKIP = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|~\$[^/]*)$|(^|\/)\.[^/]+$/;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `The server answered ${response.status}.`);
  return body;
}

function size(bytes: number): string {
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function pathOf(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

/** The submission folder in, file by file: kept as received, PDF and Word also given to Cortex. */
function useSubmissionUpload(base: string, projectId: string, onDone: () => void) {
  const [state, setState] = useState<{ total: number; done: number; current: string; errors: string[] } | null>(null);

  const send = useCallback(
    async (chosen: File[], known: SubmissionFile[]) => {
      // The folder itself, without the Index workbook's own copies or system files.
      const files = chosen.map((file) => ({ file, path: pathOf(file).split("/").slice(chosen.some((f) => pathOf(f).includes("/")) ? 1 : 0).join("/") || file.name }))
        .filter(({ path, file }) => !SKIP.test(path) && file.size > 0);
      setState({ total: files.length, done: 0, current: "", errors: [] });
      const errors: string[] = [];
      const queue = [...files];
      const worker = async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const { file, path } = next;
          setState((now) => (now ? { ...now, current: path } : now));
          try {
            const sha256 = await sha256Of(file);
            let record = known.find((entry) => entry.path === path && entry.sha256 === sha256 && entry.status === "stored");
            if (!record) {
              const { forms } = await call<{ forms: { file: SubmissionFile; form: UploadForm }[] }>(`${base}/files`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ files: [{ path, size: file.size, sha256 }] }),
              });
              await postToStorage(forms[0].form, file, () => undefined);
              record = (await call<{ file: SubmissionFile }>(`${base}/files/${forms[0].file.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sent: true }) })).file;
            }
            // A copy Claude can read and cite, for the types Cortex parses.
            if (uploadType(file.name) && !record.cortexKey) {
              let update: { cortexKey?: string; cortexNote?: string };
              try {
                const filed = await fileInCortex(file, { projectId, pin: "evidence" }, () => undefined);
                update = filed.key ? { cortexKey: filed.key } : { cortexNote: "Not a type Cortex reads." };
              } catch (error) {
                update = { cortexNote: (error as Error).message };
              }
              await call(`${base}/files/${record.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(update) });
            }
          } catch (error) {
            errors.push(`${path}: ${(error as Error).message}`);
          }
          setState((now) => (now ? { ...now, done: now.done + 1, errors: [...errors] } : now));
        }
      };
      await Promise.all(Array.from({ length: 3 }, worker));
      setState((now) => (now ? { ...now, current: "" } : now));
      onDone();
    },
    [base, onDone, projectId],
  );
  return { state, send };
}

function ProjectPicker() {
  const { reply, error } = useCortexProjects();
  return (
    <section className={`${PANEL} mx-auto mt-10 w-full max-w-xl p-6`}>
      <h1 className="text-[20px] font-semibold">Verification</h1>
      <p className="mt-1 text-[13px] text-calcite/65">Choose a project to review its submission against Puro&apos;s Audit Document Index.</p>
      {error ? <p className="mt-4 text-[13px] text-[#F2C4B8]">{error}</p> : null}
      {!reply && !error ? <p className="mt-4 flex items-center gap-2 text-[13px] text-calcite/60"><LoaderCircle className="size-4 animate-spin" /> Reading your projects…</p> : null}
      <ul className="mt-4 grid gap-2">
        {reply?.projects.map((project) => (
          <li key={project.id}>
            <Link href={`/verification?project=${encodeURIComponent(project.id)}`} className="flex items-center gap-3 rounded-xl bg-calcite/6 px-4 py-3 text-[13.5px] font-semibold hover:bg-calcite/12">
              <span className="flex-1">{project.name}</span>
              <ArrowRight className="size-4 text-calcite/50" />
            </Link>
          </li>
        ))}
        {reply && !reply.projects.length ? <li className="text-[13px] text-calcite/60">No project has been shared with you yet.</li> : null}
      </ul>
    </section>
  );
}

function Drawer({
  piece,
  files,
  filed,
  base,
  canFile,
  onSave,
  onClose,
}: {
  piece: EvidencePiece;
  files: SubmissionFile[];
  filed: string[];
  base: string;
  canFile: boolean;
  onSave: (fileIds: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const byId = new Map(files.map((file) => [file.id, file]));
  const stored = files.filter((file) => file.status === "stored");
  const shown = stored.filter((file) => !filed.includes(file.id) && (!search.trim() || file.path.toLowerCase().includes(search.trim().toLowerCase()))).slice(0, 60);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save(next: string[]) {
    setBusy(true);
    try {
      await onSave(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside aria-label="Evidence piece" className="scroll-slim fixed inset-x-3 bottom-3 z-50 max-h-[72vh] overflow-y-auto rounded-2xl border border-calcite/12 bg-[#1A2209] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.55)] lg:inset-x-auto lg:top-4 lg:right-4 lg:bottom-4 lg:max-h-none lg:w-[480px]">
      <div className="flex items-start gap-3">
        <p className="flex-1 text-[11px] font-semibold tracking-[0.12em] text-sand uppercase">{piece.module}</p>
        <button type="button" onClick={onClose} aria-label="Close" className="-mt-1 -mr-1 rounded-md p-1 text-calcite/60 hover:bg-calcite/10 hover:text-calcite">
          <X className="size-4" />
        </button>
      </div>
      <h2 className="mt-1 text-[17px] leading-snug font-semibold">{piece.name}</h2>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {piece.clauses.map((clause) => (
          <span key={clause} className="rounded-md bg-calcite/10 px-1.5 py-0.5 font-mono text-[11px] text-calcite/80">
            {clause}
          </span>
        ))}
      </div>
      <dl className="mt-4 grid gap-3 text-[13px] leading-relaxed">
        <div>
          <dt className="font-semibold text-calcite/90">What Puro asks for</dt>
          <dd className="text-calcite/75">{piece.description || "—"}</dd>
        </div>
        {piece.instructions ? (
          <div>
            <dt className="font-semibold text-calcite/90">Instructions</dt>
            <dd className="text-calcite/75">{piece.instructions}</dd>
          </div>
        ) : null}
        {piece.supplierRemark ? (
          <div>
            <dt className="font-semibold text-calcite/90">The supplier&apos;s remark</dt>
            <dd className="text-calcite/75">{piece.supplierRemark}</dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-5 border-t border-calcite/10 pt-4">
        <p className="text-[10.5px] font-semibold tracking-[0.14em] text-calcite/50 uppercase">Evidence filed · {filed.length}</p>
        <ul className="mt-2 grid gap-1">
          {filed.map((id) => {
            const file = byId.get(id);
            if (!file) return null;
            return (
              <li key={id} className="flex items-start gap-2 rounded-lg bg-calcite/5 px-2.5 py-1.5 text-[12.5px]">
                <FileText className="mt-0.5 size-3.5 shrink-0 text-calcite/50" />
                <a href={`${base}/files/${id}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 break-words text-calcite hover:underline">
                  {file.path}
                </a>
                <span className="shrink-0 text-[11px] text-calcite/45">{file.cortexKey ? "in Cortex" : size(file.size)}</span>
                {canFile ? (
                  <button type="button" disabled={busy} aria-label={`Take ${file.name} off this piece`} onClick={() => void save(filed.filter((entry) => entry !== id))} className="shrink-0 rounded p-0.5 text-calcite/45 hover:bg-calcite/10 hover:text-calcite">
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </li>
            );
          })}
          {!filed.length ? <li className="text-[12.5px] text-calcite/55">Nothing filed under this piece yet.</li> : null}
        </ul>
        {canFile ? (
          adding ? (
            <div className="mt-3 grid gap-2">
              <label className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-calcite/40" />
                <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a file of the submission…" aria-label="Find a file" className={`${FIELD} w-full pl-8`} />
              </label>
              <ul className="scroll-slim grid max-h-64 gap-0.5 overflow-y-auto">
                {shown.map((file) => (
                  <li key={file.id}>
                    <button type="button" disabled={busy} onClick={() => void save([...filed, file.id])} className="w-full rounded-md px-2 py-1 text-left text-[12px] text-calcite/80 hover:bg-calcite/8 hover:text-calcite">
                      {file.path}
                    </button>
                  </li>
                ))}
                {!shown.length ? <li className="px-2 text-[12px] text-calcite/50">No file matches.</li> : null}
              </ul>
              <button type="button" onClick={() => setAdding(false)} className="justify-self-start text-[12px] font-semibold text-calcite/60 hover:text-calcite">
                Done
              </button>
            </div>
          ) : (
            <button type="button" disabled={!stored.length} onClick={() => setAdding(true)} className={`${BUTTON} mt-3 bg-calcite/10 text-calcite hover:bg-calcite/16`}>
              File a document here
            </button>
          )
        ) : null}
      </div>
    </aside>
  );
}

export function VerificationPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const projectId = params.get("project");
  const audit = (AUDITS.includes(params.get("audit") as AuditKey) ? params.get("audit") : "facility") as AuditKey;
  const base = projectId ? `/api/verification/${encodeURIComponent(projectId)}` : "";
  const [view, setView] = useState<VerificationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moduleId, setModuleId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "index" | "filing">(null);

  const refresh = useCallback(async () => {
    if (!base) return;
    try {
      setView(await call<VerificationView>(base));
      setError(null);
    } catch (failure) {
      setError((failure as Error).message);
    }
  }, [base]);

  useEffect(() => {
    if (!base) return;
    let live = true;
    call<VerificationView>(base)
      .then((payload) => live && setView(payload))
      .catch((failure: Error) => live && setError(failure.message));
    return () => {
      live = false;
    };
  }, [base]);

  const upload = useSubmissionUpload(base, projectId ?? "", () => void refresh());
  const pieces = useMemo(() => (view?.pieces ?? []).filter((piece) => piece.audit === audit), [audit, view?.pieces]);
  const filings = useMemo(() => new Map((view?.filings ?? []).filter((filing) => filing.audit === audit).map((filing) => [filing.pieceId, filing])), [audit, view?.filings]);
  const modules = useMemo(() => {
    const out: { id: string; name: string; pieces: EvidencePiece[] }[] = [];
    for (const piece of pieces) {
      const last = out[out.length - 1];
      if (last && last.name === piece.module) last.pieces.push(piece);
      else out.push({ id: piece.moduleNumber || piece.module, name: piece.module, pieces: [piece] });
    }
    return out;
  }, [pieces]);
  const files = useMemo(() => view?.files ?? [], [view?.files]);
  const stored = useMemo(() => files.filter((file) => file.status === "stored"), [files]);
  const suggestions = useMemo(() => {
    const filedIds = new Set([...filings.values()].flatMap((filing) => filing.fileIds));
    const out = new Map<string, string[]>();
    for (const file of stored) {
      if (filedIds.has(file.id)) continue;
      const suggestion = suggestPiece(file, pieces);
      if (suggestion) out.set(suggestion.pieceId, [...(out.get(suggestion.pieceId) ?? []), file.id]);
    }
    return out;
  }, [filings, pieces, stored]);
  const suggestedCount = [...suggestions.values()].reduce((sum, ids) => sum + ids.length, 0);
  const shownModule = modules.find((entry) => entry.id === moduleId) ?? modules[0] ?? null;
  const opened = pieces.find((piece) => piece.id === openId) ?? null;
  const withEvidence = pieces.filter((piece) => (filings.get(piece.id)?.fileIds.length ?? 0) > 0).length;

  function go(next: Record<string, string>) {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) query.set(key, value);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
    setModuleId(null);
    setOpenId(null);
  }

  async function importIndex(file: File) {
    setBusy("index");
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      setView(await call<VerificationView>(`${base}/index`, { method: "POST", body: form }));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function saveFilings(next: { pieceId: string; fileIds: string[] }[]) {
    setBusy("filing");
    setError(null);
    try {
      const { filings: saved } = await call<{ filings: Filing[] }>(`${base}/filings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ audit, filings: next }),
      });
      setView((current) =>
        current && {
          ...current,
          filings: [...current.filings.filter((filing) => !(filing.audit === audit && saved.some((entry) => entry.pieceId === filing.pieceId))), ...saved],
        },
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const fileSuggested = () =>
    saveFilings([...suggestions].map(([pieceId, ids]) => ({ pieceId, fileIds: [...(filings.get(pieceId)?.fileIds ?? []), ...ids] })));

  return (
    <main className="journey-strata scroll-slim fixed inset-0 overflow-y-auto">
      <div className="mx-auto grid max-w-[1240px] gap-4 px-4 pt-5 pb-28 text-calcite sm:px-6">
        <header className="journey-panel flex flex-wrap items-center gap-3 rounded-2xl py-1.5 pr-3 pl-1.5">
          <Link href="/" className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-calcite/10 px-2.5 text-[11.5px] font-semibold hover:bg-calcite/16">
            <ArrowLeft className="size-4" /> Atlas
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] font-semibold tracking-[0.16em] text-sand uppercase">Verification{view?.index?.methodology ? ` · ${view.index.methodology}` : ""}</p>
            <p className="truncate text-[14px] font-semibold tracking-tight">{view?.project?.name ?? projectId ?? "Choose a project"}</p>
          </div>
          {projectId && view?.index ? (
            <div role="tablist" aria-label="Audit" className="flex gap-1">
              {AUDITS.map((entry) => (
                <button key={entry} type="button" role="tab" aria-selected={audit === entry} onClick={() => go({ audit: entry })} className={`rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold ${audit === entry ? "bg-calcite text-earth" : "text-calcite/70 hover:bg-calcite/10"}`}>
                  {AUDIT_LABEL[entry]}
                </button>
              ))}
            </div>
          ) : null}
        </header>

        {!projectId ? (
          <ProjectPicker />
        ) : error && !view ? (
          <p className="rounded-xl bg-[#963E32]/25 px-4 py-3 text-[13px] text-[#F2C4B8]">{error}</p>
        ) : !view ? (
          <p className="flex items-center gap-2 px-1 text-[13px] text-calcite/60"><LoaderCircle className="size-4 animate-spin" /> Reading the verification record…</p>
        ) : !view.available ? (
          <p className="rounded-xl bg-calcite/8 px-4 py-3 text-[13px] text-calcite/75">{view.reason}</p>
        ) : (
          <>
            {error ? <p className="rounded-xl bg-[#963E32]/25 px-4 py-3 text-[13px] text-[#F2C4B8]">{error}</p> : null}
            <section className="grid gap-3 md:grid-cols-3">
              <div className={`${PANEL} p-4`}>
                <p className="text-[10.5px] font-semibold tracking-[0.14em] text-calcite/50 uppercase">Audit Document Index</p>
                {view.index ? (
                  <p className="mt-1 text-[13px] text-calcite/80">
                    {view.index.counts.facility} facility, {view.index.counts.output} output and {view.index.counts.combined} combined pieces · imported {formatDay(view.index.importedAt.slice(0, 10))}
                  </p>
                ) : (
                  <p className="mt-1 text-[13px] text-calcite/70">Import Puro&apos;s Index (.xlsx) for this project: it is the checklist.</p>
                )}
                {view.canFile ? (
                  <label className={`${BUTTON} mt-3 cursor-pointer bg-calcite/10 text-calcite hover:bg-calcite/16`}>
                    {busy === "index" ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}
                    {view.index ? "Import again" : "Import the Index"}
                    <input type="file" accept=".xlsx" className="sr-only" disabled={busy !== null} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importIndex(file); event.target.value = ""; }} />
                  </label>
                ) : null}
              </div>
              <div className={`${PANEL} p-4`}>
                <p className="text-[10.5px] font-semibold tracking-[0.14em] text-calcite/50 uppercase">Submission as received</p>
                <p className="mt-1 text-[13px] text-calcite/80">
                  {stored.length} files · {stored.filter((file) => file.cortexKey).length} readable by Cortex
                </p>
                {upload.state && (upload.state.done < upload.state.total || upload.state.errors.length) ? (
                  <div className="mt-2 grid gap-1">
                    <div className="h-1.5 overflow-hidden rounded-full bg-calcite/10"><div className="h-full bg-[#B2BE8B]" style={{ width: `${(upload.state.done / Math.max(1, upload.state.total)) * 100}%` }} /></div>
                    <p className="truncate text-[11.5px] text-calcite/55">{upload.state.done} of {upload.state.total}{upload.state.current ? ` · ${upload.state.current}` : ""}</p>
                    {upload.state.errors.slice(0, 3).map((line) => <p key={line} className="text-[11.5px] text-[#F2C4B8]">{line}</p>)}
                  </div>
                ) : null}
                {view.canFile ? (
                  <label className={`${BUTTON} mt-3 cursor-pointer bg-calcite/10 text-calcite hover:bg-calcite/16`}>
                    <FolderUp className="size-4" /> Send the submission folder
                    <input
                      type="file"
                      multiple
                      className="sr-only"
                      disabled={Boolean(upload.state && upload.state.done < upload.state.total)}
                      ref={(input) => input?.setAttribute("webkitdirectory", "")}
                      onChange={(event) => { const chosen = [...(event.target.files ?? [])]; if (chosen.length) void upload.send(chosen, files); event.target.value = ""; }}
                    />
                  </label>
                ) : null}
              </div>
              <div className={`${PANEL} p-4`}>
                <p className="text-[10.5px] font-semibold tracking-[0.14em] text-calcite/50 uppercase">{AUDIT_LABEL[audit]}</p>
                <p className="mt-1 text-[13px] text-calcite/80">
                  {withEvidence} of {pieces.length} pieces have evidence filed
                </p>
                {view.canFile && suggestedCount ? (
                  <button type="button" disabled={busy !== null} onClick={() => void fileSuggested()} className={`${BUTTON} mt-3 bg-calcite text-earth hover:bg-white`}>
                    {busy === "filing" ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />} File {suggestedCount} suggested
                  </button>
                ) : view.canReview ? (
                  <p className="mt-3 flex items-center gap-1.5 text-[12px] text-[#B2BE8B]"><ShieldCheck className="size-4" /> You review this project&apos;s evidence.</p>
                ) : null}
              </div>
            </section>

            {pieces.length ? (
              <section className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
                <nav aria-label="Modules" className={`${PANEL} grid content-start gap-0.5 p-2`}>
                  {modules.map((entry) => {
                    const done = entry.pieces.filter((piece) => (filings.get(piece.id)?.fileIds.length ?? 0) > 0).length;
                    const selected = entry.id === shownModule?.id;
                    return (
                      <button key={entry.id} type="button" aria-pressed={selected} onClick={() => setModuleId(entry.id)} className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 rounded-lg px-2.5 py-2 text-left text-[12.5px] ${selected ? "bg-calcite/12" : "hover:bg-calcite/6"}`}>
                        <span className="truncate">{entry.name}</span>
                        <span className="font-mono text-[11px] text-calcite/50">{done}/{entry.pieces.length}</span>
                        <span className="col-span-2 h-1 overflow-hidden rounded bg-calcite/10"><span className="block h-full bg-[#9EAD69]" style={{ width: `${(done / entry.pieces.length) * 100}%` }} /></span>
                      </button>
                    );
                  })}
                </nav>
                <div className={`${PANEL} min-w-0 p-3`}>
                  <p className="px-1 pb-2 text-[13px] font-semibold">{shownModule?.name}</p>
                  <div className="overflow-x-auto rounded-xl ring-1 ring-calcite/10">
                    <table className="w-full min-w-[620px] text-left text-[12.5px]">
                      <thead className="bg-calcite/6 text-[10px] tracking-[0.12em] text-calcite/55 uppercase">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Evidence piece</th>
                          <th className="px-3 py-2 font-semibold">Clauses</th>
                          <th className="px-3 py-2 font-semibold">Evidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shownModule?.pieces.map((piece) => {
                          const count = filings.get(piece.id)?.fileIds.length ?? 0;
                          const waiting = suggestions.get(piece.id)?.length ?? 0;
                          return (
                            <tr key={piece.id} tabIndex={0} onClick={() => setOpenId(piece.id)} onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && (event.preventDefault(), setOpenId(piece.id))} className={`cursor-pointer border-t border-calcite/8 align-top outline-none hover:bg-calcite/5 focus-visible:bg-calcite/8 ${piece.id === openId ? "bg-calcite/8" : ""}`}>
                              <td className="px-3 py-2 font-medium">{piece.name}</td>
                              <td className="px-3 py-2 font-mono text-[11px] text-calcite/55">{piece.clauses.join(" · ")}</td>
                              <td className="px-3 py-2 whitespace-nowrap">
                                {count ? (
                                  <span className="inline-flex items-center gap-1 text-[#9EAD69]"><Check className="size-3.5" /> {count} filed</span>
                                ) : (
                                  <span className="text-calcite/50">None yet</span>
                                )}
                                {waiting ? <span className="ml-2 text-[11px] text-[#F2B33D]">+{waiting} suggested</span> : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            ) : view.index ? (
              <p className={`${PANEL} p-4 text-[13px] text-calcite/65`}>The Index has no pieces for the {AUDIT_LABEL[audit].toLowerCase()}.</p>
            ) : null}
            {opened ? (
              <Drawer
                key={opened.id}
                piece={opened}
                files={files}
                filed={filings.get(opened.id)?.fileIds ?? []}
                base={base}
                canFile={view.canFile}
                onSave={(fileIds) => saveFilings([{ pieceId: opened.id, fileIds }])}
                onClose={() => setOpenId(null)}
              />
            ) : null}
          </>
        )}
      </div>
      <AppSwitcher active="verify" />
    </main>
  );
}
