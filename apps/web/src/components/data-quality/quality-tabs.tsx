"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

import { formatDay } from "@/lib/mrv/days";
import type { DateRange } from "@/lib/mrv/types";
import type { TagMap } from "@/lib/monitoring/mapping";
import { READS_LABEL, monitoringMetric } from "@/lib/monitoring/metrics";
import { KIND_LABEL, RULE_LABEL, daysLabel, daysOf, ruleValue, subjectOf, type Period } from "@/lib/quality/page";
import { VERDICT_LABEL, type DecisionRecord, type QualityFinding, type QualityRun } from "@/lib/quality/types";
import { PANEL, VERDICT_COLOR } from "./style";

/** The data quality page's other tabs: coverage, runs, decisions, rules and tag map. Each reads its own route. */

function useJson<T>(url: string | null): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ url: string | null; data: T | null; error: string | null }>({ url: null, data: null, error: null });
  useEffect(() => {
    if (!url) return;
    let live = true;
    fetch(url, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as T & { error?: string };
        if (!response.ok) throw new Error(body.error ?? `The server answered ${response.status}.`);
        if (live) setState({ url, data: body, error: null });
      })
      .catch((error: Error) => live && setState({ url, data: null, error: error.message }));
    return () => {
      live = false;
    };
  }, [url]);
  return state.url === url ? { data: state.data, error: state.error } : { data: null, error: null };
}

function Loading({ error, children }: { error: string | null; children?: ReactNode }) {
  if (error) return <p className="rounded-xl bg-[#963E32]/25 px-4 py-3 text-[13px] text-[#F2C4B8]">{error}</p>;
  return (
    <p className="flex items-center gap-2 px-1 text-[13px] text-calcite/60">
      <LoaderCircle className="size-4 animate-spin" /> {children ?? "Reading…"}
    </p>
  );
}

function Table({ head, children, min = 640 }: { head: string[]; children: ReactNode; min?: number }) {
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-calcite/10">
      <table className="w-full text-left text-[12.5px]" style={{ minWidth: min }}>
        <thead className="bg-calcite/6 text-[10px] tracking-[0.12em] text-calcite/55 uppercase">
          <tr>
            {head.map((label) => (
              <th key={label} className="px-3 py-2 font-semibold">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function who(by: string | undefined, me?: string): string {
  if (!by) return "—";
  if (me && by === me) return "You";
  if (by === "system") return "Started by itself";
  if (by === "make quality-run") return "make quality-run";
  if (by.startsWith("dev:")) return by.slice(4);
  return by.includes("@") ? by : "A person on the project";
}

function metricName(id: string): string {
  return monitoringMetric(id)?.name ?? id;
}

// ── Coverage ────────────────────────────────────────────────────────────────

interface Coverage {
  range: DateRange | null;
  origin: string;
  metrics: { id: string; days: string }[];
}

export function CoverageTab({ projectId, period }: { projectId: string; period: Period | null }) {
  const { data, error } = useJson<Coverage>(`/api/data-quality/${encodeURIComponent(projectId)}/coverage`);
  if (!data) return <Loading error={error}>Reading which meters reported…</Loading>;
  if (!data.range || !data.metrics.length) return <p className={`${PANEL} p-4 text-[13px] text-calcite/65`}>No monitoring data for this project yet.</p>;
  const all = daysOf(data.range);
  const range = period?.range ?? data.range;
  const from = Math.max(0, all.indexOf(range.start));
  const to = all.indexOf(range.end) >= 0 ? all.indexOf(range.end) : all.length - 1;
  // Long spans are shown a month to a column, as the share of days reported.
  const daily = to - from + 1 <= 124;
  const days = all.slice(from, to + 1);
  const months = [...new Set(days.map((day) => day.slice(0, 7)))];

  return (
    <section className={`${PANEL} p-4`}>
      <p className="text-[12.5px] text-calcite/65">
        {data.origin === "stream" ? "Loaded data" : "Sample data"} · {formatDay(range.start)} to {formatDay(range.end)} ·{" "}
        {daily ? "filled: the meter reported that day; outlined: nothing that day." : "each column is a month: how many of its days the meter reported."}
      </p>
      <div className="scroll-slim mt-3 overflow-x-auto">
        <table className="border-separate border-spacing-y-1 text-[12px]">
          <tbody>
            {data.metrics.map((metric) => {
              const bits = metric.days.slice(from, to + 1);
              const reported = [...bits].filter((bit) => bit === "1").length;
              return (
                <tr key={metric.id}>
                  <th scope="row" className="sticky left-0 z-[1] bg-[#141E06] pr-3 text-left font-medium whitespace-nowrap text-calcite/85">
                    {metricName(metric.id)}
                    <span className="ml-2 font-mono text-[10.5px] text-calcite/45">
                      {reported}/{bits.length}
                    </span>
                  </th>
                  {daily
                    ? [...bits].map((bit, index) => (
                        <td key={days[index]} title={`${formatDay(days[index])}: ${bit === "1" ? "reported" : "nothing"}`} className="p-0">
                          <span className={`block size-[11px] rounded-[3px] ${bit === "1" ? "bg-[#B2BE8B]" : "border border-calcite/30"}`} />
                        </td>
                      ))
                    : months.map((month) => {
                        const inMonth = days.map((day, index) => (day.startsWith(month) ? bits[index] : null)).filter((bit) => bit !== null);
                        const share = inMonth.filter((bit) => bit === "1").length / inMonth.length;
                        return (
                          <td key={month} title={`${month}: ${Math.round(share * 100)}% of days reported`} className="p-0">
                            <span className="block h-[11px] w-6 rounded-[3px] border border-calcite/25" style={{ background: share ? `rgba(178,190,139,${0.15 + 0.85 * share})` : undefined }} />
                          </td>
                        );
                      })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Runs ────────────────────────────────────────────────────────────────────

export function RunsTab({ projectId, current }: { projectId: string; current: QualityRun }) {
  const base = `/api/data-quality/${encodeURIComponent(projectId)}/runs`;
  const { data, error } = useJson<{ runs: QualityRun[] }>(`${base}?at=${current.id}`);
  const [picked, setPicked] = useState<string[]>([]);
  const [earlier, later] = [...picked].sort();
  const left = useJson<{ findings: QualityFinding[] }>(picked.length === 2 ? `${base}?findings=${earlier}` : null);
  const right = useJson<{ findings: QualityFinding[] }>(picked.length === 2 ? `${base}?findings=${later}` : null);

  const change = useMemo(() => {
    if (!left.data || !right.data) return null;
    const before = new Map(left.data.findings.map((finding) => [finding.id, finding]));
    const after = new Map(right.data.findings.map((finding) => [finding.id, finding]));
    return {
      added: right.data.findings.filter((finding) => !before.has(finding.id)),
      resolved: left.data.findings.filter((finding) => !after.has(finding.id)),
      same: right.data.findings.filter((finding) => before.has(finding.id)).length,
    };
  }, [left.data, right.data]);

  if (!data) return <Loading error={error}>Reading the runs…</Loading>;
  const toggle = (id: string) => setPicked((now) => (now.includes(id) ? now.filter((entry) => entry !== id) : [...now, id].slice(-2)));

  return (
    <div className="grid gap-4">
      <section className={`${PANEL} p-4`}>
        <p className="mb-3 text-[12.5px] text-calcite/65">Each run is replayable: the data it read, the engine and rule versions. Tick two to see what changed between them.</p>
        <Table head={["", "Started", "By", "Data", "Versions", "Verdict"]} min={760}>
          {data.runs.map((run) => (
            <tr key={run.id} className="border-t border-calcite/8">
              <td className="px-3 py-2">
                <input type="checkbox" aria-label={`Compare run ${run.id}`} checked={picked.includes(run.id)} disabled={run.status !== "done"} onChange={() => toggle(run.id)} />
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-calcite/85">
                {formatDay(run.startedAt.slice(0, 10))} {run.startedAt.slice(11, 16)}
                {run.id === current.id ? <span className="ml-2 rounded-full bg-calcite/12 px-1.5 text-[10.5px] text-calcite/70">shown</span> : null}
              </td>
              <td className="px-3 py-2 text-calcite/70">{who(run.requestedBy)}</td>
              <td className="px-3 py-2 text-calcite/70">
                {run.source === "stream" ? "loaded data" : run.source === "seeded" ? "sample data" : run.source ?? "—"}
                {run.dataHash ? <span className="ml-1.5 font-mono text-[10.5px] text-calcite/45">{run.dataHash.slice(0, 8)}</span> : null}
              </td>
              <td className="px-3 py-2 font-mono text-[11.5px] text-calcite/60">
                {run.versions ? `${run.versions.engine} · rules ${run.versions.rules}` : "—"}
              </td>
              <td className="px-3 py-2">
                {run.status === "done" && run.verdict ? (
                  <span style={{ color: VERDICT_COLOR[run.verdict] }} className="font-semibold">
                    {VERDICT_LABEL[run.verdict]}
                    {run.counts ? <span className="font-normal text-calcite/55"> · {run.counts.blocks ?? 0} block, {run.counts.look ?? 0} look</span> : null}
                  </span>
                ) : run.status === "running" ? (
                  <span className="text-calcite/60">Running…</span>
                ) : (
                  <span className="text-[#F2C4B8]">Failed{run.error ? `: ${run.error}` : ""}</span>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </section>

      {picked.length === 2 ? (
        <section className={`${PANEL} p-4`}>
          {!change ? (
            <Loading error={left.error ?? right.error}>Comparing…</Loading>
          ) : (
            <>
              <p className="text-[13px] text-calcite/80">
                From the run of {formatDay(earlier.slice(0, 4) + "-" + earlier.slice(4, 6) + "-" + earlier.slice(6, 8))} to the run of{" "}
                {formatDay(later.slice(0, 4) + "-" + later.slice(4, 6) + "-" + later.slice(6, 8))}: {change.added.length} new, {change.resolved.length} gone, {change.same} in both.
              </p>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                {(
                  [
                    ["New in the later run", change.added],
                    ["Gone by the later run", change.resolved],
                  ] as const
                ).map(([title, list]) => (
                  <div key={title}>
                    <p className="text-[12px] font-semibold text-calcite">{title}</p>
                    <ul className="mt-1.5 grid gap-1 text-[12px] text-calcite/70">
                      {list.length ? list.map((finding) => <li key={finding.id}>{finding.text.headline}</li>) : <li className="text-calcite/45">None.</li>}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

// ── Decisions ───────────────────────────────────────────────────────────────

export function DecisionsTab({ projectId, findings }: { projectId: string; findings: QualityFinding[] }) {
  const { data, error } = useJson<{ decisions: DecisionRecord[]; me?: string }>(`/api/data-quality/${encodeURIComponent(projectId)}/decisions`);
  if (!data) return <Loading error={error}>Reading the decisions…</Loading>;
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  return (
    <section className={`${PANEL} p-4`}>
      <p className="mb-3 text-[12.5px] text-calcite/65">Every confirm, dismiss and reopen, with who, when and why. Decisions are never deleted, and the next run applies them.</p>
      {data.decisions.length ? (
        <Table head={["When", "Who", "Finding", "Decision and reason"]} min={760}>
          {data.decisions.map((decision) => {
            const finding = byId.get(decision.findingId);
            return (
              <tr key={`${decision.findingId}-${decision.at}`} className="border-t border-calcite/8 align-top">
                <td className="px-3 py-2 whitespace-nowrap text-calcite/80">{decision.at ? formatDay(decision.at.slice(0, 10)) : "—"}</td>
                <td className="px-3 py-2 text-calcite/70">{who(decision.by, data.me)}</td>
                <td className="px-3 py-2 text-calcite/85">
                  {finding?.text.headline ?? `${KIND_LABEL[decision.kind ?? ""] ?? decision.kind ?? "Finding"} · ${subjectOf({ metric: decision.metric ?? null, fixedKey: null })}`}
                  {decision.start && decision.end ? <span className="block text-[11.5px] text-calcite/50">{daysLabel(decision.start, decision.end)}</span> : null}
                </td>
                <td className="px-3 py-2 text-calcite/80">
                  <span className="font-semibold">{decision.decision === "dismissed" ? "Dismissed" : decision.decision === "confirmed" ? "Confirmed" : "Reopened"}</span>
                  {decision.reason ? `: “${decision.reason}”` : ""}
                </td>
              </tr>
            );
          })}
        </Table>
      ) : (
        <p className="text-[13px] text-calcite/60">No decision yet. Confirm or dismiss a finding from its drawer on the Findings tab.</p>
      )}
    </section>
  );
}

// ── Rules and tag map ───────────────────────────────────────────────────────

export function RulesTab({ projectId, run }: { projectId: string; run: QualityRun }) {
  const monitoring = useJson<{ tagMap: TagMap | null }>(`/api/monitoring/${encodeURIComponent(projectId)}`);
  const rules = run.rules ? Object.entries(run.rules) : [];
  const approved = run.versions?.rules_source === "approved";
  return (
    <div className="grid gap-4">
      <section className={`${PANEL} p-4`}>
        <p className="text-[13px] font-semibold text-calcite">Thresholds in force</p>
        <p className="mt-0.5 mb-3 text-[12.5px] text-calcite/65">
          As the latest run used them (rules v{run.versions?.rules ?? "?"}). {approved ? "Approved by a platform admin." : "Built-in defaults: nobody has approved them yet, and every finding says so."}
        </p>
        {rules.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {(["check", "detector"] as const).map((group) => (
              <div key={group}>
                <p className="mb-1.5 text-[10.5px] font-semibold tracking-[0.14em] text-calcite/50 uppercase">{group === "check" ? "Checks · can block" : "Detectors · advise only"}</p>
                <ul className="grid gap-1 text-[12.5px]">
                  {rules
                    .filter(([name]) => (RULE_LABEL[name]?.group ?? "check") === group)
                    .map(([name, value]) => (
                      <li key={name} className="flex items-baseline gap-3 rounded-lg bg-calcite/5 px-3 py-1.5">
                        <span className="flex-1 text-calcite/80">{RULE_LABEL[name]?.label ?? name}</span>
                        <span className="font-mono text-calcite">{ruleValue(name, value)}</span>
                        <span className="w-32 text-[11px] text-calcite/50">{RULE_LABEL[name]?.unit ?? ""}</span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-calcite/60">This run did not record its thresholds. Run the checks again to see them.</p>
        )}
      </section>

      <section className={`${PANEL} p-4`}>
        <div className="flex flex-wrap items-baseline gap-3">
          <p className="flex-1 text-[13px] font-semibold text-calcite">The project&apos;s tag map</p>
          <Link href={`/projects/${encodeURIComponent(projectId)}/data`} className="text-[12.5px] font-semibold text-[#B2BE8B] hover:underline">
            Change it on the data page
          </Link>
        </div>
        {!monitoring.data ? (
          <Loading error={monitoring.error}>Reading the tag map…</Loading>
        ) : !monitoring.data.tagMap ? (
          <p className="mt-2 text-[13px] text-calcite/60">No tag map yet: nothing has been loaded from the site&apos;s spreadsheets.</p>
        ) : (
          <>
            <p className="mt-0.5 mb-3 text-[12.5px] text-calcite/65">
              Version {monitoring.data.tagMap.version} ·{" "}
              {monitoring.data.tagMap.status === "approved"
                ? `approved by ${monitoring.data.tagMap.approvedBy ?? "a platform admin"}${monitoring.data.tagMap.approvedAt ? ` on ${formatDay(monitoring.data.tagMap.approvedAt.slice(0, 10))}` : ""}`
                : "proposed, waiting for a platform admin"}
            </p>
            <Table head={["Column in the site's sheet", "Loads as", "Reads as", "Factor"]} min={680}>
              {Object.entries(monitoring.data.tagMap.entries).map(([column, entry]) => (
                <tr key={column} className="border-t border-calcite/8">
                  <td className="px-3 py-1.5 text-calcite/85">{column}</td>
                  <td className="px-3 py-1.5 text-calcite/80">{entry ? `${metricName(entry.metric)} (${monitoringMetric(entry.metric)?.unit ?? ""})` : "Not loaded"}</td>
                  <td className="px-3 py-1.5 text-calcite/70">{entry ? READS_LABEL[entry.reads] : "—"}</td>
                  <td className="px-3 py-1.5 font-mono text-calcite/70">{entry ? `× ${entry.scale}` : "—"}</td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </section>
    </div>
  );
}
