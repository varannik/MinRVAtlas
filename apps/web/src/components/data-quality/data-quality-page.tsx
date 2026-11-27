"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, Download, FileCheck2, LoaderCircle, RotateCw, Search, Sparkles, X } from "lucide-react";

import { useCortexProjects } from "@/components/cortex/cortex-projects";
import { Decide, QUALITY_TONE } from "@/components/stage/calc/calc-trend";
import { useQuality, type QualityState } from "@/hooks/use-quality";
import { useResolvedProject } from "@/hooks/use-visible-projects";
import { calcSpecFor } from "@/lib/mrv/calc/specs";
import { formatDay } from "@/lib/mrv/days";
import type { DateRange } from "@/lib/mrv/types";
import { termsFor, taskLabel } from "@/lib/quality/links";
import { KIND_LABEL, daysLabel, findingsCsv, periodState, periodsFor, subjectOf, type Period } from "@/lib/quality/page";
import { SEVERITY_LABEL, VERDICT_LABEL, touches, type QualityFinding, type QualitySeverity } from "@/lib/quality/types";
import { AppSwitcher } from "@/components/nav/app-switcher";
import { CoverageTab, DecisionsTab, RulesTab, RunsTab } from "./quality-tabs";
import { FIELD, PANEL, VERDICT_COLOR } from "./style";

/**
 * The data quality page (/quality): one project's whole record from the data quality
 * engine. A strip of periods with their verdicts; every finding, filtered, with the
 * engine's words, the decision and where it leads; which meter reported on which
 * day; the runs, and what changed between two; every decision with who and why;
 * and the thresholds and tag map in force. The calculation tree shows one term at a
 * time; this page shows the project at once.
 */

type Tab = "findings" | "coverage" | "runs" | "decisions" | "rules";
const TABS: { id: Tab; label: string }[] = [
  { id: "findings", label: "Findings" },
  { id: "coverage", label: "Coverage" },
  { id: "runs", label: "Runs" },
  { id: "decisions", label: "Decisions" },
  { id: "rules", label: "Rules and tag map" },
];

const BUTTON = "inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-45";

function SeverityChip({ severity }: { severity: QualitySeverity }) {
  const tone = QUALITY_TONE[severity];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] font-semibold" style={{ color: tone.color }}>
      <tone.Icon className="size-3.5" aria-hidden />
      {severity === "blocks" ? "Blocks" : severity === "look" ? "Look" : "Info"}
    </span>
  );
}

function StatusChip({ finding }: { finding: QualityFinding }) {
  const style = finding.status === "dismissed" ? "bg-calcite/8 text-calcite/50" : finding.status === "confirmed" ? "bg-[#963E32]/30 text-[#F2C4B8]" : "bg-calcite/10 text-calcite/80";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${style}`}>{finding.status}</span>;
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-[10.5px] font-semibold tracking-[0.1em] text-calcite/55 uppercase">
      {label}
      {children}
    </label>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** The engine's words for one finding, its decision, and where it leads. */
function Drawer({ finding, quality, projectId, onClose }: { finding: QualityFinding; quality: QualityState; projectId: string; onClose: () => void }) {
  const project = useResolvedProject(projectId);
  const spec = useMemo(() => (project ? calcSpecFor(project) : null), [project]);
  const terms = termsFor(spec, finding);
  const task = taskLabel(finding.task);
  const tone = QUALITY_TONE[finding.severity];
  const threshold = finding.rule.threshold;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      aria-label="Finding"
      className="scroll-slim fixed inset-x-3 bottom-3 z-50 max-h-[70vh] overflow-y-auto rounded-2xl border border-calcite/12 bg-[#1A2209] p-5 text-calcite shadow-[0_24px_70px_rgba(0,0,0,0.55)] lg:inset-x-auto lg:top-4 lg:right-4 lg:bottom-4 lg:max-h-none lg:w-[460px]"
    >
      <div className="flex items-start gap-3">
        <p className="flex-1 text-[11px] font-semibold tracking-[0.12em] uppercase" style={{ color: tone.color }}>
          {SEVERITY_LABEL[finding.severity]} · rule {finding.rule.id} v{finding.rule.version}
          {finding.advisory ? " · advisory" : ""}
        </p>
        <button type="button" onClick={onClose} aria-label="Close" className="-mt-1 -mr-1 rounded-md p-1 text-calcite/60 hover:bg-calcite/10 hover:text-calcite">
          <X className="size-4" />
        </button>
      </div>
      <h2 className="mt-1.5 text-[16px] leading-snug font-semibold">{finding.text.headline}</h2>
      <p className="mt-1 text-[12px] text-calcite/55">
        {subjectOf(finding)} · {daysLabel(finding.start, finding.end)} · <StatusChip finding={finding} />
      </p>
      <dl className="mt-4 grid gap-3 text-[13px] leading-relaxed">
        <div>
          <dt className="font-semibold text-calcite/90">What we saw</dt>
          <dd className="text-calcite/75">{finding.text.saw}</dd>
        </div>
        <div>
          <dt className="font-semibold text-calcite/90">Why it matters</dt>
          <dd className="text-calcite/75">{finding.text.matters}</dd>
        </div>
        <div>
          <dt className="font-semibold text-calcite/90">What to do</dt>
          <dd className="text-calcite/75">{finding.text.todo}</dd>
        </div>
        <div>
          <dt className="font-semibold text-calcite/90">How we found it</dt>
          <dd className="text-calcite/65">
            {finding.text.how}
            {threshold ? ` Threshold: ${threshold.value} ${threshold.unit}, ${threshold.source === "approved" ? "approved" : "a built-in default, not yet approved"}.` : ""}
          </dd>
        </div>
      </dl>

      {finding.review ? (
        <p className="mt-4 rounded-xl bg-calcite/6 px-3 py-2 text-[12px] text-calcite/75">
          {finding.review.decision === "dismissed" ? "Dismissed" : finding.review.decision === "confirmed" ? "Confirmed" : "Reopened"}
          {finding.review.by ? ` by ${finding.review.by}` : ""}
          {finding.review.at ? ` on ${formatDay(finding.review.at.slice(0, 10))}` : ""}
          {finding.review.reason ? `: “${finding.review.reason}”` : "."}
        </p>
      ) : null}
      {quality.view?.canDecide ? <Decide finding={finding} quality={quality} /> : null}

      <div className="mt-5 border-t border-calcite/10 pt-4">
        <p className="text-[10.5px] font-semibold tracking-[0.14em] text-calcite/50 uppercase">Linked</p>
        <ul className="mt-2 grid gap-1.5 text-[12.5px]">
          <li className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-calcite/55">Calculation term</span>
            {terms.length ? (
              <Link href={`/journey?project=${encodeURIComponent(projectId)}`} className="font-medium text-[#B2BE8B] hover:underline">
                {terms.map((term) => `${term.symbol} · ${term.label}`).join(", ")}, on the tree
              </Link>
            ) : (
              <span className="text-calcite/60">none reads it yet</span>
            )}
          </li>
          <li className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-calcite/55">Journey task</span>
            {task ? (
              <Link href={`/journey?project=${encodeURIComponent(projectId)}`} className="font-medium text-[#B2BE8B] hover:underline">
                {task}, where the records are filed
              </Link>
            ) : (
              <span className="text-calcite/60">none</span>
            )}
          </li>
          <li className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-calcite/55">Finding</span>
            <span className="font-mono text-[11.5px] text-calcite/60">{finding.id}</span>
          </li>
        </ul>
      </div>
    </aside>
  );
}

/** Claude's summary of the run, for operators; the cited findings open in the drawer. */
function SummaryCard({ quality, onOpen }: { quality: QualityState; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const summary = quality.view?.run?.summary;
  if (!quality.view?.showsSummary || summary?.status !== "written" || !summary.overview) return null;
  const byId = new Map(quality.view.findings.map((finding) => [finding.id, finding]));
  const cited = (ids: string[]) =>
    ids.map((id) => byId.get(id)).filter((finding): finding is QualityFinding => Boolean(finding)).map((finding) => (
      <li key={finding.id}>
        <button type="button" onClick={() => onOpen(finding.id)} className="flex items-start gap-1.5 text-left text-[12px] text-calcite/75 hover:text-calcite">
          <SeverityChip severity={finding.severity} />
          <span>{finding.text.headline}</span>
        </button>
      </li>
    ));
  return (
    <section className={`${PANEL} p-4`}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 text-left">
        <Sparkles className="size-4 text-[#B2BE8B]" />
        <span className="flex-1 text-[10.5px] font-semibold tracking-[0.14em] text-calcite/55 uppercase">Summary of the run · by Claude</span>
        <ChevronDown className={`size-4 text-calcite/50 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <p className="mt-2 text-[13.5px] leading-snug text-calcite/90">{summary.overview}</p>
      {open ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {summary.first?.finding_ids.length ? (
            <div>
              <p className="text-[12px] font-semibold text-calcite">Fix first</p>
              <p className="text-[12px] text-calcite/70">{summary.first.why}</p>
              <ul className="mt-1 grid gap-1">{cited(summary.first.finding_ids)}</ul>
            </div>
          ) : null}
          {summary.groups?.map((group) => (
            <div key={group.title}>
              <p className="text-[12px] font-semibold text-calcite">{group.title}</p>
              {group.cause ? <p className="text-[12px] text-calcite/70">{group.cause}</p> : null}
              <ul className="mt-1 grid gap-1">{cited(group.finding_ids)}</ul>
            </div>
          ))}
          <p className="text-[11px] text-calcite/45 sm:col-span-2">Written by Claude from the checks&apos; findings. The verdict is the checks&apos;, not Claude&apos;s.</p>
        </div>
      ) : null}
    </section>
  );
}

function FindingsTab({ quality, findings, projectId, period }: { quality: QualityState; findings: QualityFinding[]; projectId: string; period: Period | null }) {
  const [severity, setSeverity] = useState<"all" | QualitySeverity>("all");
  const [status, setStatus] = useState<"open" | "confirmed" | "dismissed" | "all">("open");
  const [meter, setMeter] = useState("all");
  const [kind, setKind] = useState("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const meters = useMemo(() => [...new Set(findings.map(subjectOf))].sort(), [findings]);
  const kinds = useMemo(() => [...new Set(findings.map((finding) => finding.kind))].sort(), [findings]);
  const shown = findings.filter((finding) => {
    if (period && !touches(finding, period.range)) return false;
    if (severity !== "all" && finding.severity !== severity) return false;
    if (status !== "all" && finding.status !== status) return false;
    if (meter !== "all" && subjectOf(finding) !== meter) return false;
    if (kind !== "all" && finding.kind !== kind) return false;
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      if (![finding.text.headline, finding.text.saw, subjectOf(finding)].some((text) => text.toLowerCase().includes(needle))) return false;
    }
    return true;
  });
  const opened = findings.find((finding) => finding.id === openId) ?? null;

  return (
    <div className="grid gap-4">
      <SummaryCard quality={quality} onOpen={setOpenId} />
      <section className={`${PANEL} p-4`}>
        <div className="flex flex-wrap items-end gap-3">
          <Labelled label="Severity">
            <select className={FIELD} value={severity} onChange={(event) => setSeverity(event.target.value as typeof severity)}>
              <option value="all">All</option>
              <option value="blocks">Blocks submission</option>
              <option value="look">Needs a look</option>
              <option value="info">For information</option>
            </select>
          </Labelled>
          <Labelled label="Status">
            <select className={FIELD} value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
              <option value="open">Open</option>
              <option value="confirmed">Confirmed</option>
              <option value="dismissed">Dismissed</option>
              <option value="all">All</option>
            </select>
          </Labelled>
          <Labelled label="About">
            <select className={FIELD} value={meter} onChange={(event) => setMeter(event.target.value)}>
              <option value="all">All</option>
              {meters.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </Labelled>
          <Labelled label="Kind">
            <select className={FIELD} value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="all">All</option>
              {kinds.map((name) => (
                <option key={name} value={name}>
                  {KIND_LABEL[name] ?? name}
                </option>
              ))}
            </select>
          </Labelled>
          <label className="relative ml-auto min-w-[200px] flex-1 sm:max-w-[280px]">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-calcite/40" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search findings…" aria-label="Search findings" className={`${FIELD} w-full pl-8`} />
          </label>
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl ring-1 ring-calcite/10">
          <table className="w-full min-w-[760px] text-left text-[12.5px]">
            <thead className="bg-calcite/6 text-[10px] tracking-[0.12em] text-calcite/55 uppercase">
              <tr>
                <th className="px-3 py-2 font-semibold">Severity</th>
                <th className="px-3 py-2 font-semibold">Days</th>
                <th className="px-3 py-2 font-semibold">About</th>
                <th className="px-3 py-2 font-semibold">What&apos;s wrong</th>
                <th className="px-3 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((finding) => (
                <tr
                  key={finding.id}
                  tabIndex={0}
                  onClick={() => setOpenId(finding.id)}
                  onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && (event.preventDefault(), setOpenId(finding.id))}
                  className={`cursor-pointer border-t border-calcite/8 align-top outline-none hover:bg-calcite/5 focus-visible:bg-calcite/8 ${finding.id === openId ? "bg-calcite/8" : ""}`}
                >
                  <td className="px-3 py-2">
                    <SeverityChip severity={finding.severity} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-calcite/75">{daysLabel(finding.start, finding.end)}</td>
                  <td className="px-3 py-2 text-calcite/75">{subjectOf(finding)}</td>
                  <td className="px-3 py-2 text-calcite">{finding.text.headline}</td>
                  <td className="px-3 py-2">
                    <StatusChip finding={finding} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!shown.length ? <p className="px-3 py-6 text-center text-[12.5px] text-calcite/55">No finding matches.</p> : null}
        </div>
        <p className="mt-2 text-[11.5px] text-calcite/45">
          {shown.length} of {findings.length} findings{period ? ` · ${period.label}` : ""}. Click one for the engine&apos;s words, the decision and where it leads.
        </p>
      </section>
      {opened ? <Drawer finding={opened} quality={quality} projectId={projectId} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

function ProjectPicker() {
  const { reply, error } = useCortexProjects();
  return (
    <section className={`${PANEL} mx-auto mt-10 w-full max-w-xl p-6`}>
      <h1 className="text-[20px] font-semibold text-calcite">Data quality</h1>
      <p className="mt-1 text-[13px] text-calcite/65">Choose a project to see its checks: every finding, its decisions, coverage and runs.</p>
      {error ? <p className="mt-4 text-[13px] text-[#F2C4B8]">{error}</p> : null}
      {!reply && !error ? <p className="mt-4 flex items-center gap-2 text-[13px] text-calcite/60"><LoaderCircle className="size-4 animate-spin" /> Reading your projects…</p> : null}
      <ul className="mt-4 grid gap-2">
        {reply?.projects.map((project) => (
          <li key={project.id}>
            <Link href={`/quality?project=${encodeURIComponent(project.id)}`} className="flex items-center gap-3 rounded-xl bg-calcite/6 px-4 py-3 text-[13.5px] font-semibold text-calcite hover:bg-calcite/12">
              <span className="flex-1">{project.name}</span>
              <ArrowRight className="size-4 text-calcite/50" />
            </Link>
          </li>
        ))}
        {reply && !reply.projects.length ? <li className="text-[13px] text-calcite/60">No project of yours is set up on Cortex yet.</li> : null}
      </ul>
    </section>
  );
}

export function DataQualityPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const projectId = params.get("project");
  const tab = (TABS.some((entry) => entry.id === params.get("tab")) ? params.get("tab") : "findings") as Tab;
  const [periodId, setPeriodId] = useState<string | null>(null);

  const quality = useQuality(projectId);
  const project = useResolvedProject(projectId);
  const view = quality.view;
  const findings = useMemo(() => view?.findings ?? [], [view?.findings]);
  const periods = useMemo(() => periodsFor(view?.run?.range ?? null), [view?.run?.range]);
  const period = periods.find((entry) => entry.id === periodId) ?? null;

  function go(next: Partial<{ tab: Tab; project: string }>) {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) query.set(key, value);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  }

  return (
    <main className="journey-strata scroll-slim fixed inset-0 overflow-y-auto text-calcite">
      <div className="mx-auto grid max-w-[1240px] gap-4 px-4 pt-5 pb-28 text-calcite sm:px-6">
        <header className="journey-panel flex flex-wrap items-center gap-3 rounded-2xl py-1.5 pr-3 pl-1.5">
          <Link href="/" className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-calcite/10 px-2.5 text-[11.5px] font-semibold hover:bg-calcite/16">
            <ArrowLeft className="size-4" /> Atlas
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] font-semibold tracking-[0.16em] text-sand uppercase">Data quality</p>
            <p className="truncate text-[14px] font-semibold tracking-tight">{project?.name ?? projectId ?? "Choose a project"}</p>
          </div>
          <Link href="/quality/vv" className="flex h-9 items-center gap-1.5 rounded-xl px-3 text-[11.5px] font-semibold text-calcite/75 hover:bg-calcite/10 hover:text-calcite">
            <FileCheck2 className="size-4" /> Document V&amp;V
          </Link>
        </header>

        {!projectId ? (
          <ProjectPicker />
        ) : (
          <>
            <section className="flex flex-wrap items-end gap-x-6 gap-y-3 px-1">
              <div className="min-w-0 flex-1">
                <h1 className="text-[26px] leading-tight font-semibold tracking-tight">{project?.name ?? projectId}</h1>
                <p className="mt-1 text-[13px] text-calcite/60">
                  {[
                    project?.registry,
                    project?.methodology,
                    view?.run?.finishedAt ? `Checked ${formatDay(view.run.finishedAt.slice(0, 10))} ${view.run.finishedAt.slice(11, 16)} UTC` : null,
                    view?.run?.source === "stream" ? "loaded data" : view?.run?.source === "seeded" ? "sample data" : view?.run ? "no data" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  {view?.running ? " · checking again…" : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!findings.length}
                  onClick={() => download(`data-quality-${projectId}-${period?.id ?? "all"}.csv`, findingsCsv(findings, period?.range ?? null))}
                  className={`${BUTTON} bg-calcite/10 text-calcite hover:bg-calcite/16`}
                >
                  <Download className="size-4" /> Export {period ? period.label : "all"}
                </button>
                {view?.canDecide ? (
                  <button type="button" disabled={Boolean(view.running)} onClick={() => void quality.rerun()} className={`${BUTTON} bg-calcite text-earth hover:bg-white`}>
                    <RotateCw className={`size-4 ${view.running ? "animate-spin" : ""}`} /> Run checks again
                  </button>
                ) : null}
              </div>
            </section>

            {quality.status === "loading" ? (
              <p className="flex items-center gap-2 px-1 text-[13px] text-calcite/60">
                <LoaderCircle className="size-4 animate-spin" /> Reading the checks…
              </p>
            ) : quality.status === "error" ? (
              <p className="rounded-xl bg-[#963E32]/25 px-4 py-3 text-[13px] text-[#F2C4B8]">{quality.error}</p>
            ) : !view?.available ? (
              <p className="rounded-xl bg-calcite/8 px-4 py-3 text-[13px] text-calcite/75">{view?.reason ?? "The data quality engine is not available."}</p>
            ) : !view.run ? (
              <p className="flex items-center gap-2 rounded-xl bg-calcite/8 px-4 py-3 text-[13px] text-calcite/75">
                {view.running ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {view.running ? "Checking the data for the first time…" : "No run yet."}
              </p>
            ) : (
              <>
                <nav aria-label="Periods" className="scroll-slim flex gap-2 overflow-x-auto pb-1">
                  {[null, ...periods].map((entry) => {
                    const state = entry ? periodState(findings, entry.range) : periodState(findings, view.run!.range as DateRange);
                    const selected = (entry?.id ?? null) === periodId;
                    return (
                      <button
                        key={entry?.id ?? "all"}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setPeriodId(entry?.id ?? null)}
                        className={`min-w-[132px] shrink-0 rounded-xl border px-3 py-2 text-left transition-colors ${selected ? "border-calcite/50 bg-calcite/12" : "border-calcite/10 bg-[#141E06] hover:bg-calcite/8"}`}
                      >
                        <span className="block text-[12.5px] font-semibold">{entry?.label ?? "All days"}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px]" style={{ color: VERDICT_COLOR[state.verdict] }}>
                          <span className="size-2 rounded-full" style={{ background: VERDICT_COLOR[state.verdict] }} />
                          {VERDICT_LABEL[state.verdict]}
                          {state.open ? ` · ${state.open}` : ""}
                        </span>
                      </button>
                    );
                  })}
                </nav>

                <div role="tablist" aria-label="Data quality" className="flex flex-wrap gap-1 border-b border-calcite/10">
                  {TABS.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      role="tab"
                      aria-selected={tab === entry.id}
                      onClick={() => go({ tab: entry.id })}
                      className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold ${tab === entry.id ? "border-calcite text-calcite" : "border-transparent text-calcite/55 hover:text-calcite"}`}
                    >
                      {entry.label}
                      {entry.id === "findings" ? <span className="ml-1.5 text-calcite/45">{findings.filter((finding) => !period || touches(finding, period.range)).length}</span> : null}
                    </button>
                  ))}
                </div>

                {tab === "findings" ? <FindingsTab quality={quality} findings={findings} projectId={projectId} period={period} /> : null}
                {tab === "coverage" ? <CoverageTab projectId={projectId} period={period} /> : null}
                {tab === "runs" ? <RunsTab projectId={projectId} current={view.run} /> : null}
                {tab === "decisions" ? <DecisionsTab projectId={projectId} findings={findings} /> : null}
                {tab === "rules" ? <RulesTab projectId={projectId} run={view.run} /> : null}
              </>
            )}
          </>
        )}
      </div>
      <AppSwitcher active="quality" />
    </main>
  );
}
