"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Check, CircleAlert, FileSpreadsheet, LoaderCircle, ShieldCheck, TriangleAlert, Upload } from "lucide-react";

import { useQuality } from "@/hooks/use-quality";
import { formatDay } from "@/lib/mrv/days";
import { approvedFor, type ColumnMap, type MapEntries, type TagMap } from "@/lib/monitoring/mapping";
import { MONITORING_METRICS, READS_LABEL, monitoringMetric, type Reads } from "@/lib/monitoring/metrics";
import type { UploadRecord } from "@/lib/monitoring/store.server";
import { VERDICT_LABEL } from "@/lib/quality/types";
import { useDashboard } from "@/store/dashboard-store";

/**
 * A project's monitoring data page, opened from its live dashboard: give the site's
 * spreadsheet, say which metric each column is (the project's tag map, approved by a
 * platform admin), check what would be written, and load it into the project's
 * stream. The data quality engine then checks exactly that data.
 */

interface Setup {
  project: { id: string; name: string; registry: string; folder: string };
  tagMap: TagMap | null;
  uploads: UploadRecord[];
  canPropose: boolean;
  canApprove: boolean;
}

interface PreviewColumn {
  key: string;
  header: string;
  tags: string[];
  numbers: number;
  mapped?: ColumnMap | null;
  suggested: ColumnMap | null;
}

interface Preview {
  fileName: string;
  bytes: number;
  tables: { sheet: string; dateHeader: string; rows: number; first: string | null; last: string | null; undated: number; labels: string[]; columns: PreviewColumn[] }[];
  skipped: { sheet: string; reason: string }[];
  range: { start: string; end: string } | null;
  check: Check | null;
}

interface Check {
  days: number;
  summary: { metric: string; days: number; first: string; last: string; total: number; reads: Reads }[];
  notes: string[];
}

interface Loaded {
  upload: UploadRecord;
  updatedDays: number;
  summary: Check["summary"];
  runError?: string;
}

const GROUPS = [...new Set(MONITORING_METRICS.map((metric) => metric.group))];

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `The server answered ${response.status}.`);
  return body;
}

function same(a: ColumnMap | null | undefined, b: ColumnMap | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.metric === b.metric && a.reads === b.reads && a.scale === b.scale;
}

function number(value: number): string {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2 }).format(value);
}

function Section({ step, title, sub, children, aside }: { step: number; title: string; sub?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="journey-panel journey-panel--solid rounded-[22px] p-5 sm:p-6">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-calcite/12 font-mono text-[12px] font-semibold text-calcite">{step}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] leading-tight font-semibold text-calcite">{title}</h2>
          {sub ? <p className="mt-0.5 text-[12.5px] leading-snug text-calcite/65">{sub}</p> : null}
        </div>
        {aside}
      </header>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Note({ tone, children }: { tone: "warn" | "ok" | "info" | "error"; children: ReactNode }) {
  const style = {
    warn: "bg-[#A77618]/20 text-[#EACD9C] ring-[#A77618]/40",
    ok: "bg-[#8B9C44]/18 text-[#DCDFCE] ring-[#8B9C44]/35",
    info: "bg-calcite/8 text-calcite/80 ring-calcite/12",
    error: "bg-[#963E32]/25 text-[#F2C4B8] ring-[#963E32]/45",
  }[tone];
  const Icon = tone === "ok" ? Check : tone === "info" ? CircleAlert : TriangleAlert;
  return (
    <p className={`flex items-start gap-2 rounded-xl px-3 py-2 text-[12.5px] leading-snug ring-1 ${style}`}>
      <Icon className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

const FIELD = "rounded-lg border border-calcite/15 bg-[#141E06] px-2 py-1.5 text-[12.5px] text-calcite focus-visible:outline-2 focus-visible:outline-[#B2BE8B]";
const BUTTON = "inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-45";
const PRIMARY = `${BUTTON} bg-calcite text-earth hover:bg-white`;
const SECONDARY = `${BUTTON} bg-calcite/10 text-calcite hover:bg-calcite/16`;

function MapState({ tagMap }: { tagMap: TagMap | null }) {
  if (!tagMap) return <span className="rounded-full bg-calcite/10 px-2.5 py-1 text-[11px] font-semibold text-calcite/75">No tag map yet</span>;
  return tagMap.status === "approved" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#8B9C44]/25 px-2.5 py-1 text-[11px] font-semibold text-[#DCDFCE]">
      <ShieldCheck className="size-3.5" /> Tag map approved · v{tagMap.version}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#A77618]/25 px-2.5 py-1 text-[11px] font-semibold text-[#EACD9C]">
      <CircleAlert className="size-3.5" /> Tag map waiting for approval · v{tagMap.version}
    </span>
  );
}

/** Where a column's choice stands against the project's tag map. */
function ColumnState({ column, choice, tagMap }: { column: PreviewColumn; choice: ColumnMap | null; tagMap: TagMap | null }) {
  const inMap = column.mapped !== undefined;
  let label: string;
  let tone: string;
  if (inMap && same(column.mapped, choice)) {
    label = tagMap?.status === "approved" ? "As approved" : "As proposed";
    tone = tagMap?.status === "approved" ? "text-[#B2BE8B]" : "text-[#EACD9C]";
  } else if (inMap) {
    label = "Changed from the map";
    tone = "text-[#EACD9C]";
  } else if (choice && same(column.suggested, choice)) {
    label = `Suggested${column.tags[0] ? ` from ${column.tags[0]}` : ""}`;
    tone = "text-calcite/60";
  } else {
    label = choice ? "New in the map" : "Not loaded";
    tone = "text-calcite/50";
  }
  return <span className={`text-[11px] ${tone}`}>{label}</span>;
}

function LoadCheck({ projectId, loaded }: { projectId: string; loaded: Loaded }) {
  const quality = useQuality(projectId);
  const view = quality.view;
  const run = view?.run;
  const ours = run && loaded.upload.runId ? run.id >= loaded.upload.runId : false;
  const checking = !ours && (view?.running || quality.status === "loading");
  return (
    <div className="mt-4 grid gap-2">
      <Note tone="ok">
        Loaded {loaded.upload.days} day{loaded.upload.days === 1 ? "" : "s"} of {loaded.upload.metrics.length} metric{loaded.upload.metrics.length === 1 ? "" : "s"} from {loaded.upload.fileName}
        {loaded.updatedDays ? `; ${loaded.updatedDays} of those days already had data, and only the loaded metrics were replaced` : ""}. The original file is kept with the upload.
      </Note>
      {loaded.runError ? <Note tone="error">{loaded.runError}</Note> : null}
      {checking ? (
        <p className="flex items-center gap-2 text-[12.5px] text-calcite/75">
          <LoaderCircle className="size-4 animate-spin" /> The data quality engine is checking the loaded data…
        </p>
      ) : ours && run?.verdict ? (
        <Note tone={run.verdict === "clear" ? "ok" : run.verdict === "blocked" ? "error" : "warn"}>
          Data quality: <span className="font-semibold">{VERDICT_LABEL[run.verdict]}</span>
          {run.counts ? ` · ${run.counts.blocks ?? 0} block, ${run.counts.look ?? 0} to look at` : ""}. Each finding is on the calculation tree, on the term it touches.
        </Note>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Link href={`/journey?project=${encodeURIComponent(projectId)}`} className={SECONDARY}>
          Open the journey and its calculation tree
        </Link>
      </div>
    </div>
  );
}

/**
 * One earlier load, and taking it back out: only its rows leave the stream, with
 * a reason on its record; the data quality engine then runs on what is left.
 */
function UploadRow({ upload, base, canRemove, onRemoved }: { upload: UploadRecord; base: string; canRemove: boolean; onRemoved: () => void }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await call(`${base}/uploads/${encodeURIComponent(upload.id)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      setAsking(false);
      onRemoved();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`rounded-xl px-3 py-2 text-[12.5px] ${upload.removed ? "bg-calcite/[0.03]" : "bg-calcite/5"}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className={`font-semibold ${upload.removed ? "text-calcite/50 line-through" : "text-calcite"}`}>{upload.fileName}</span>
        <span className="text-calcite/70">
          {formatDay(upload.period.start)} to {formatDay(upload.period.end)} · {upload.days} days · {upload.metrics.length} metrics
        </span>
        <span className="text-calcite/50">
          {upload.by} · {formatDay(upload.at.slice(0, 10))} · map v{upload.tagMapVersion}
        </span>
        {!upload.removed && canRemove && !asking ? (
          <button type="button" onClick={() => setAsking(true)} className="ml-auto rounded-lg px-2 py-0.5 text-[11.5px] font-semibold text-[#F2C4B8] hover:bg-[#963E32]/25">
            Remove…
          </button>
        ) : null}
      </div>
      {upload.removed ? (
        <p className="mt-1 text-[11.5px] text-calcite/55">
          Removed by {upload.removed.by} on {formatDay(upload.removed.at.slice(0, 10))}: “{upload.removed.reason}”. {upload.removed.days} days changed; the original file is kept.
        </p>
      ) : null}
      {asking ? (
        <div className="mt-2 grid gap-2">
          <p className="text-[11.5px] leading-snug text-calcite/70">
            Takes this load&apos;s rows out of the stream for {formatDay(upload.period.start)} to {formatDay(upload.period.end)}; other loads&apos; rows stay. What it replaced
            is not brought back. The data quality checks run again afterwards.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              placeholder="Why it is removed, e.g. test load"
              aria-label="Why the load is removed"
              className={`${FIELD} min-w-[240px] flex-1`}
            />
            <button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void remove()} className={`${BUTTON} bg-[#963E32] text-white hover:bg-[#A9483A]`}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : null} Remove the load
            </button>
            <button type="button" disabled={busy} onClick={() => setAsking(false)} className={SECONDARY}>
              Keep it
            </button>
          </div>
          {error ? <Note tone="error">{error}</Note> : null}
        </div>
      ) : null}
    </li>
  );
}

export function MonitoringDataPage({ projectId }: { projectId: string }) {
  const selectProject = useDashboard((state) => state.selectProject);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<MapEntries>({});
  const [period, setPeriod] = useState<{ start: string; end: string } | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState<null | "reading" | "saving" | "approving" | "checking" | "loading">(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/monitoring/${encodeURIComponent(projectId)}`;

  const refresh = useCallback(async () => {
    try {
      setSetup(await call<Setup>(base));
      setSetupError(null);
    } catch (failure) {
      setSetupError((failure as Error).message);
    }
  }, [base]);

  useEffect(() => {
    let live = true;
    call<Setup>(base)
      .then((payload) => live && setSetup(payload))
      .catch((failure: Error) => live && setSetupError(failure.message));
    return () => {
      live = false;
    };
  }, [base]);

  const columns = useMemo(() => preview?.tables.flatMap((table) => table.columns) ?? [], [preview]);
  const fileEntries = useMemo(() => Object.fromEntries(columns.map((column) => [column.key, choices[column.key] ?? null])), [choices, columns]);
  const changed = columns.some((column) => column.mapped === undefined ? Boolean(fileEntries[column.key]) : !same(column.mapped, fileEntries[column.key]));
  const tagMap = setup?.tagMap ?? null;
  const approved = approvedFor(tagMap, fileEntries) && !changed;
  const anyMapped = Object.values(fileEntries).some(Boolean);

  async function read(chosen: File) {
    setFile(chosen);
    setPreview(null);
    setCheck(null);
    setLoaded(null);
    setError(null);
    setBusy("reading");
    try {
      const form = new FormData();
      form.set("file", chosen);
      const result = await call<Preview>(`${base}/preview`, { method: "POST", body: form });
      setPreview(result);
      setPeriod(result.range);
      setChoices(Object.fromEntries(result.tables.flatMap((table) => table.columns).map((column) => [column.key, column.mapped !== undefined ? column.mapped : column.suggested])));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function choose(key: string, next: ColumnMap | null) {
    setChoices((current) => ({ ...current, [key]: next }));
    setCheck(null);
  }

  async function propose(andApprove: boolean) {
    setBusy("saving");
    setError(null);
    try {
      const saved = await call<{ tagMap: TagMap }>(`${base}/tag-map`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries: fileEntries, version: tagMap?.version ?? null }),
      });
      let map = saved.tagMap;
      if (andApprove && map.status !== "approved") {
        setBusy("approving");
        map = (await call<{ tagMap: TagMap }>(`${base}/tag-map`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: map.version }) })).tagMap;
      }
      setSetup((current) => (current ? { ...current, tagMap: map } : current));
      setPreview((current) =>
        current && {
          ...current,
          tables: current.tables.map((table) => ({ ...table, columns: table.columns.map((column) => ({ ...column, mapped: column.key in map.entries ? map.entries[column.key] : undefined })) })),
        },
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (!tagMap) return;
    setBusy("approving");
    setError(null);
    try {
      const result = await call<{ tagMap: TagMap }>(`${base}/tag-map`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: tagMap.version }) });
      setSetup((current) => (current ? { ...current, tagMap: result.tagMap } : current));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function form(): FormData | null {
    if (!file || !period) return null;
    const body = new FormData();
    body.set("file", file);
    body.set("entries", JSON.stringify(fileEntries));
    body.set("start", period.start);
    body.set("end", period.end);
    return body;
  }

  async function dryRun() {
    const body = form();
    if (!body) return;
    setBusy("checking");
    setError(null);
    try {
      setCheck((await call<Preview>(`${base}/preview`, { method: "POST", body })).check);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function load() {
    const body = form();
    if (!body) return;
    setBusy("loading");
    setError(null);
    try {
      setLoaded(await call<Loaded>(`${base}/load`, { method: "POST", body }));
      await refresh();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const project = setup?.project;
  const firstLoad = setup ? !setup.uploads.some((upload) => !upload.removed) : false;

  return (
    <main className="journey-strata scroll-slim fixed inset-0 overflow-y-auto">
      <div className="journey-floor journey-floor--calc min-h-full px-4 pt-5 pb-16 sm:px-6">
        <div className="relative z-[2] mx-auto grid max-w-[1080px] gap-4">
          <header className="journey-panel flex flex-wrap items-center gap-3 rounded-2xl py-1.5 pr-4 pl-1.5">
            <Link
              href="/"
              onClick={() => selectProject(projectId)}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-calcite/10 px-2.5 text-[11.5px] font-semibold text-calcite hover:bg-calcite/16"
            >
              <ArrowLeft className="size-4" /> Live dashboard
            </Link>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] font-semibold tracking-[0.16em] text-sand uppercase">Monitoring data · {project?.registry ?? "…"}</p>
              <h1 className="truncate text-[14px] font-semibold tracking-tight text-calcite">{project?.name ?? (setupError ? projectId : "Reading the project…")}</h1>
            </div>
            <MapState tagMap={tagMap} />
          </header>

          {setupError ? <Note tone="error">{setupError}</Note> : null}
          {error ? <Note tone="error">{error}</Note> : null}

          <Section step={1} title="The site's spreadsheet" sub="An .xlsx workbook or a .csv file with a column of dates and a column per meter, a row per day. Summary sheets are left out and listed.">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-calcite/20 px-4 py-7 text-center text-calcite/75 hover:border-calcite/35 hover:bg-calcite/5">
              {busy === "reading" ? <LoaderCircle className="size-6 animate-spin" /> : <Upload className="size-6" />}
              <span className="text-[13px] font-semibold text-calcite">{file ? file.name : "Choose a file"}</span>
              <span className="text-[11.5px]">Up to 20 MB. Nothing is written until you load it.</span>
              <input
                type="file"
                accept=".xlsx,.csv"
                className="sr-only"
                disabled={!setup || busy !== null}
                onChange={(event) => {
                  const chosen = event.target.files?.[0];
                  if (chosen) void read(chosen);
                  event.target.value = "";
                }}
              />
            </label>
            {preview ? (
              <ul className="mt-3 grid gap-1.5 text-[12.5px] text-calcite/80">
                {preview.tables.map((table) => (
                  <li key={table.sheet} className="flex flex-wrap items-baseline gap-x-2">
                    <FileSpreadsheet className="size-3.5 shrink-0 self-center text-[#B2BE8B]" />
                    <span className="font-semibold text-calcite">{table.sheet}</span>
                    <span>
                      {table.rows} dated rows
                      {table.first && table.last ? `, ${formatDay(table.first)} to ${formatDay(table.last)}` : ""} · {table.columns.length} columns of numbers
                      {table.undated ? ` · ${table.undated} row${table.undated === 1 ? "" : "s"} without a date left out (a total?)` : ""}
                      {table.labels.length ? ` · labels left out: ${table.labels.join(", ")}` : ""}
                    </span>
                  </li>
                ))}
                {preview.skipped.map((sheet) => (
                  <li key={sheet.sheet} className="text-calcite/55">
                    {sheet.sheet}: {sheet.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </Section>

          {preview ? (
            <Section step={2} title="What each column is" sub="The metric each column loads as, how it reads, and the factor into the metric's unit. Suggestions come from the plant tags in the headers; the project's tag map keeps your choices for the next file.">
              <div className="grid gap-5">
                {preview.tables.map((table) => (
                  <div key={table.sheet}>
                    <p className="mb-2 text-[10.5px] font-semibold tracking-[0.14em] text-sand uppercase">{table.sheet}</p>
                    <div className="overflow-x-auto rounded-xl ring-1 ring-calcite/10">
                      <table className="w-full min-w-[760px] text-left text-[12.5px]">
                        <thead className="bg-calcite/6 text-[10px] tracking-[0.12em] text-calcite/55 uppercase">
                          <tr>
                            <th className="px-3 py-2 font-semibold">Column</th>
                            <th className="px-3 py-2 font-semibold">Loads as</th>
                            <th className="px-3 py-2 font-semibold">Reads as</th>
                            <th className="px-3 py-2 font-semibold">Factor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {table.columns.map((column) => {
                            const choice = choices[column.key] ?? null;
                            const metric = choice ? monitoringMetric(choice.metric) : undefined;
                            return (
                              <tr key={column.key} className="border-t border-calcite/8 align-top">
                                <td className="px-3 py-2">
                                  <p className="font-medium text-calcite">{column.header}</p>
                                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2">
                                    <span className="text-[11px] text-calcite/50">{column.numbers} values</span>
                                    <ColumnState column={column} choice={choice} tagMap={tagMap} />
                                  </p>
                                </td>
                                <td className="px-3 py-2">
                                  <select
                                    aria-label={`${column.header}: loads as`}
                                    className={`${FIELD} w-full max-w-[240px]`}
                                    value={choice?.metric ?? ""}
                                    disabled={!setup?.canPropose}
                                    onChange={(event) => {
                                      const next = monitoringMetric(event.target.value);
                                      choose(column.key, next ? { metric: next.id, reads: next.reads, scale: choice?.scale ?? 1 } : null);
                                    }}
                                  >
                                    <option value="">Not loaded</option>
                                    {GROUPS.map((group) => (
                                      <optgroup key={group} label={group}>
                                        {MONITORING_METRICS.filter((item) => item.group === group).map((item) => (
                                          <option key={item.id} value={item.id}>
                                            {item.name} ({item.unit})
                                          </option>
                                        ))}
                                      </optgroup>
                                    ))}
                                  </select>
                                </td>
                                <td className="px-3 py-2">
                                  <select
                                    aria-label={`${column.header}: reads as`}
                                    className={FIELD}
                                    value={choice?.reads ?? "daily_total"}
                                    disabled={!choice || !setup?.canPropose}
                                    onChange={(event) => choice && choose(column.key, { ...choice, reads: event.target.value as Reads })}
                                  >
                                    {(Object.keys(READS_LABEL) as Reads[]).map((reads) => (
                                      <option key={reads} value={reads}>
                                        {READS_LABEL[reads]}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="px-3 py-2">
                                  <label className="flex items-center gap-1.5 text-[11.5px] text-calcite/60">
                                    ×
                                    <input
                                      type="number"
                                      step="any"
                                      min="0"
                                      aria-label={`${column.header}: factor into ${metric?.unit ?? "the metric's unit"}`}
                                      className={`${FIELD} w-24`}
                                      value={choice?.scale ?? 1}
                                      disabled={!choice || !setup?.canPropose}
                                      onChange={(event) => {
                                        const scale = Number(event.target.value);
                                        if (choice && Number.isFinite(scale) && scale > 0) choose(column.key, { ...choice, scale });
                                      }}
                                    />
                                    {metric ? <span>→ {metric.unit}</span> : null}
                                  </label>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          {preview ? (
            <Section
              step={3}
              title="The project's tag map"
              sub="A wrong line here changes the credited number, so a platform admin approves the map before any data is loaded with it."
              aside={<MapState tagMap={tagMap} />}
            >
              <div className="grid gap-3">
                {tagMap?.status === "approved" && tagMap.approvedBy ? (
                  <p className="text-[12px] text-calcite/65">
                    Approved by {tagMap.approvedBy}
                    {tagMap.approvedAt ? ` on ${formatDay(tagMap.approvedAt.slice(0, 10))}` : ""}.
                  </p>
                ) : tagMap?.proposedBy ? (
                  <p className="text-[12px] text-calcite/65">
                    Proposed by {tagMap.proposedBy}
                    {tagMap.proposedAt ? ` on ${formatDay(tagMap.proposedAt.slice(0, 10))}` : ""}; waiting for a platform admin.
                  </p>
                ) : null}
                {approved ? (
                  <Note tone="ok">Every column you load has the approved mapping.</Note>
                ) : changed ? (
                  <Note tone="warn">These choices differ from the project&apos;s tag map. Save them as a proposal{setup?.canApprove ? ", or save and approve them" : ""}.</Note>
                ) : tagMap?.status === "proposed" ? (
                  <Note tone="warn">The map is proposed but not approved yet{setup?.canApprove ? "" : ". A platform admin approves it"}.</Note>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {changed ? (
                    <>
                      <button type="button" className={SECONDARY} disabled={!setup?.canPropose || !anyMapped || busy !== null} onClick={() => void propose(false)}>
                        {busy === "saving" ? <LoaderCircle className="size-4 animate-spin" /> : null} Propose these mappings
                      </button>
                      {setup?.canApprove ? (
                        <button type="button" className={PRIMARY} disabled={!anyMapped || busy !== null} onClick={() => void propose(true)}>
                          {busy === "approving" ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} Save and approve
                        </button>
                      ) : null}
                    </>
                  ) : tagMap?.status === "proposed" && setup?.canApprove ? (
                    <button type="button" className={PRIMARY} disabled={busy !== null} onClick={() => void approve()}>
                      {busy === "approving" ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} Approve the map
                    </button>
                  ) : null}
                </div>
              </div>
            </Section>
          ) : null}

          {preview ? (
            <Section step={4} title="Check and load" sub="The days to load, what they would write, then the load itself. The calculation tree and the data quality engine both read what is loaded.">
              <div className="grid gap-3">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="grid gap-1 text-[11.5px] text-calcite/65">
                    First day
                    <input type="date" className={FIELD} value={period?.start ?? ""} onChange={(event) => { setPeriod((current) => ({ start: event.target.value, end: current?.end ?? event.target.value })); setCheck(null); }} />
                  </label>
                  <label className="grid gap-1 text-[11.5px] text-calcite/65">
                    Last day
                    <input type="date" className={FIELD} value={period?.end ?? ""} onChange={(event) => { setPeriod((current) => ({ start: current?.start ?? event.target.value, end: event.target.value })); setCheck(null); }} />
                  </label>
                  <button type="button" className={SECONDARY} disabled={!anyMapped || !period || busy !== null} onClick={() => void dryRun()}>
                    {busy === "checking" ? <LoaderCircle className="size-4 animate-spin" /> : null} Check what would load
                  </button>
                </div>

                {check ? (
                  <div className="grid gap-2">
                    <div className="overflow-x-auto rounded-xl ring-1 ring-calcite/10">
                      <table className="w-full min-w-[560px] text-left text-[12.5px]">
                        <thead className="bg-calcite/6 text-[10px] tracking-[0.12em] text-calcite/55 uppercase">
                          <tr>
                            <th className="px-3 py-2 font-semibold">Metric</th>
                            <th className="px-3 py-2 font-semibold">Days</th>
                            <th className="px-3 py-2 font-semibold">From</th>
                            <th className="px-3 py-2 font-semibold">To</th>
                            <th className="px-3 py-2 text-right font-semibold">Total or mean</th>
                          </tr>
                        </thead>
                        <tbody>
                          {check.summary.map((row) => {
                            const metric = monitoringMetric(row.metric);
                            return (
                              <tr key={row.metric} className="border-t border-calcite/8">
                                <td className="px-3 py-1.5 text-calcite">{metric?.name ?? row.metric}</td>
                                <td className="px-3 py-1.5 font-mono text-calcite/80">{row.days}</td>
                                <td className="px-3 py-1.5 text-calcite/70">{formatDay(row.first)}</td>
                                <td className="px-3 py-1.5 text-calcite/70">{formatDay(row.last)}</td>
                                <td className="px-3 py-1.5 text-right font-mono text-calcite/80">
                                  {number(row.total)} {metric?.unit}
                                  {row.reads === "reading" ? " mean" : ""}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {check.notes.map((note) => (
                      <Note key={note} tone="info">
                        {note}
                      </Note>
                    ))}
                    {firstLoad ? (
                      <Note tone="warn">
                        This is the project&apos;s first load. From its first day on, the ledger and calculation tree read this data; the sample history before
                        it stays, labelled sample. The data quality engine checks only loaded data.
                      </Note>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className={PRIMARY} disabled={!approved || !anyMapped || !period || !check || busy !== null || !setup?.canPropose} onClick={() => void load()}>
                    {busy === "loading" ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}
                    {check ? `Load ${check.days} day${check.days === 1 ? "" : "s"}` : "Load"}
                  </button>
                  <span className="text-[11.5px] text-calcite/55">
                    {!approved ? "Needs the approved tag map." : !check ? "Check what would load first." : `Into ${project?.folder ?? "the project's stream"}.`}
                  </span>
                </div>
                {loaded ? <LoadCheck key={loaded.upload.id} projectId={projectId} loaded={loaded} /> : null}
              </div>
            </Section>
          ) : null}

          <Section step={preview ? 5 : 2} title="Loaded before" sub="Each load: the file, the days and metrics, who loaded it and the quality run that checked it.">
            {setup?.uploads.length ? (
              <ul className="grid gap-1.5">
                {setup.uploads.map((upload) => (
                  <UploadRow key={upload.id} upload={upload} base={base} canRemove={Boolean(setup.canPropose)} onRemoved={() => void refresh()} />
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-calcite/60">{setup ? "Nothing loaded yet: the ledger and calculation tree show the sample history." : setupError ? "Not available here." : "…"}</p>
            )}
          </Section>
        </div>
      </div>
    </main>
  );
}
