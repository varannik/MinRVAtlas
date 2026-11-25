"use client";

import { useMemo, type ReactNode } from "react";
import { ArrowDown, ArrowRight, Check, CircleAlert, Info, TriangleAlert, X } from "lucide-react";

import type { Ledger } from "@/hooks/use-ledger";
import { evaluate, streamCoverage } from "@/lib/mrv/calc/evaluate";
import { runChecks } from "@/lib/mrv/checks";
import { contains, formatDay, formatRange, rangeDays } from "@/lib/mrv/days";
import { pipelineFor, stepIndex, STAGE_META } from "@/lib/mrv/registry-pipeline";
import type { IssueSeverity, LedgerBlock } from "@/lib/mrv/types";
import { isBlocking, verdictFor, VERDICT_LABEL, type QualityVerdict } from "@/lib/quality/types";
import { nextStep } from "@/lib/journey/steps";
import type { JourneyStep, JourneyTask } from "@/lib/journey/types";
import { firstOpenTask, stepProgress, taskState, usePlan, useJourney } from "@/store/journey-store";
import { formatPercent, formatTonnes } from "@/components/stage/format";
import { BLOCK_TONE } from "@/components/stage/theme";
import { SegmentBar } from "../step-panel";
import { CortexAvatar } from "../task-card";
import { goToFloor } from "./floor-anchors";
import { openFindings, useJourneyQuality } from "./journey-quality";
import { TRACK, type PeriodBox } from "./periods";

/**
 * What opens under a period's box: where it stands, what is wrong with it,
 * and what is left to do. A ledger block reads this from the registry's
 * process and its issues; the period the journey is on reads it from the
 * journey's own steps and Cortex's checks.
 */

/** Severity colours that hold up on the dark panel. */
const SEVERITY: Record<IssueSeverity, { color: string; icon: typeof TriangleAlert }> = {
  blocker: { color: "#E0A79D", icon: TriangleAlert },
  warning: { color: "#EACD9C", icon: CircleAlert },
  info: { color: "#DCDFCE", icon: Info },
};

const VERDICT_COLOR: Record<QualityVerdict, string> = { blocked: SEVERITY.blocker.color, needs_look: SEVERITY.warning.color, clear: "#B2BE8B" };

const SOURCE: Record<LedgerBlock["issues"][number]["source"], string> = {
  registry: "Registry",
  vvb: "Verifier",
  checks: "Data check",
  requirements: "Filing",
};

interface Issue {
  id: string;
  severity: IssueSeverity;
  title: string;
  detail?: string;
  source: string;
  onOpen?: () => void;
}

interface Next {
  title: string;
  detail: string;
  /** Who asks: Cortex, or nobody in particular. */
  cortex: boolean;
  action?: { label: string; run: () => void };
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[9.5px] font-semibold tracking-[0.16em] text-sand uppercase">{children}</p>;
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-calcite/8 px-2.5 py-1.5">
      <p className="truncate text-[9px] font-semibold tracking-[0.12em] text-sand uppercase">{label}</p>
      <p className="mt-0.5 font-mono text-[14px] leading-none font-semibold text-calcite">
        {value}
        {unit ? <span className="ml-1 font-sans text-[9.5px] font-normal text-calcite/60">{unit}</span> : null}
      </p>
    </div>
  );
}

function IssueList({ issues }: { issues: Issue[] }) {
  if (!issues.length) {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-[#B2BE8B]">
        <Check className="size-3.5" />
        No issues raised
      </p>
    );
  }
  const shown = issues.slice(0, 4);
  return (
    <ul className="mt-1 space-y-0.5">
      {shown.map((issue) => {
        const tone = SEVERITY[issue.severity];
        const Icon = tone.icon;
        const body = (
          <>
            <Icon className="mt-0.5 size-3.5 shrink-0" style={{ color: tone.color }} />
            <span className="min-w-0 flex-1">
              <span className="block text-[11.5px] leading-snug font-medium text-calcite">{issue.title}</span>
              {issue.detail ? <span className="mt-0.5 line-clamp-3 text-[10.5px] leading-snug text-calcite/60">{issue.detail}</span> : null}
            </span>
            <span className="shrink-0 rounded bg-calcite/10 px-1.5 py-px text-[8.5px] font-semibold tracking-wide text-sand uppercase">{issue.source}</span>
          </>
        );
        return (
          <li key={issue.id}>
            {issue.onOpen ? (
              <button type="button" onClick={issue.onOpen} className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-calcite/8">
                {body}
              </button>
            ) : (
              <div className="flex items-start gap-2 px-1.5 py-1">{body}</div>
            )}
          </li>
        );
      })}
      {issues.length > shown.length ? <li className="px-1.5 text-[10.5px] text-calcite/55">+{issues.length - shown.length} more</li> : null}
    </ul>
  );
}

/** The data checks' findings for the period's days, worst first. */
function useFindings(ledger: Ledger | null, box: PeriodBox): Issue[] {
  const spec = ledger?.spec;
  const index = ledger?.index;
  const daily = ledger?.daily;
  const blockResults = ledger?.blockResults;
  const status = ledger?.status;
  const range = box.range;
  return useMemo(() => {
    if (status !== "ready" || !spec || !index || !daily || !range) return [];
    const evaluation = (box.block ? blockResults?.get(box.block.id) : undefined) ?? evaluate(spec, index, range);
    return runChecks({ spec, range, evaluation, daily: daily.filter((point) => contains(range, point.day)) })
      .filter((finding) => finding.severity !== "info")
      .map((finding) => ({ id: finding.id, severity: finding.severity, title: finding.title, detail: finding.detail, source: finding.check }));
  }, [blockResults, box.block, daily, index, range, spec, status]);
}

/** The latest answer Cortex accepted in these steps. */
function lastDone(steps: JourneyStep[], tasks: Record<string, { status: string; at?: string } | undefined>): { task: JourneyTask; at: string } | null {
  let best: { task: JourneyTask; at: string } | null = null;
  for (const step of steps) {
    for (const task of step.tasks) {
      const state = tasks[task.id];
      if (state?.status === "done" && state.at && (!best || state.at > best.at)) best = { task, at: state.at };
    }
  }
  return best;
}

/** What is left for a ledger block, from where it is in the registry's process. */
function blockNext(block: LedgerBlock, registry: string, findings: Issue[]): Next {
  const pipeline = pipelineFor(registry);
  const at = stepIndex(pipeline, block.stage);
  const here = pipeline.steps[at];
  const next = pipeline.steps[at + 1];
  const blockers = block.issues.filter((issue) => issue.severity === "blocker");
  const dataBlockers = findings.filter((finding) => finding.severity === "blocker");
  switch (block.stage) {
    case "issued":
      return {
        title: "Nothing left to do",
        detail: `${block.issuedT != null ? `${formatTonnes(block.issuedT)} t` : pipeline.creditName} issued${block.updatedOn ? ` on ${formatDay(block.updatedOn)}` : ""}. The period is closed.`,
        cortex: false,
      };
    case "issues": {
      const first = blockers[0] ?? block.issues[0];
      return {
        title: `Resolve ${plural(blockers.length || block.issues.length, blockers.length ? "blocker" : "issue")}`,
        detail: `${first ? `${first.title}. ` : ""}Then send it back to ${block.verifier ?? here.actor}.`,
        cortex: false,
      };
    }
    case "draft":
      return {
        title: dataBlockers.length ? `Clear ${plural(dataBlockers.length, "data blocker")}, then send it on` : "Finish the draft and send it on",
        detail: next ? `Next is ${next.label}, with ${next.actor}. ${next.detail}` : here.detail,
        cortex: false,
      };
    default:
      return {
        title: `Waiting on ${block.stage === "verification" && block.verifier ? block.verifier : here.actor}`,
        detail: `${here.detail} Answer their questions as they come.${next ? ` Next is ${next.label}.` : ""}`,
        cortex: false,
      };
  }
}

export function PeriodDetails({
  box,
  net,
  ledger,
  notch,
  onClose,
}: {
  box: PeriodBox;
  net: number | null;
  ledger: Ledger | null;
  /** Where, from the panel's left edge, the box it opens from sits. */
  notch: number;
  onClose: () => void;
}) {
  const plan = usePlan();
  const tasks = useJourney((state) => state.tasks);
  const current = useJourney((state) => state.current);
  const selectTask = useJourney((state) => state.selectTask);
  const selectStep = useJourney((state) => state.selectStep);
  const findings = useFindings(ledger, box);
  const quality = useJourneyQuality();
  const engineFindings = useMemo(() => openFindings(quality?.view?.findings, box.range), [box.range, quality?.view?.findings]);
  const engineVerdict = quality?.view?.run && box.range ? verdictFor(quality.view.findings, box.range) : null;
  const registry = ledger?.spec.registry ?? plan.registry?.label ?? "";
  const tone = BLOCK_TONE[box.tone];
  const coverage = ledger?.index && box.range ? streamCoverage(ledger.index, box.range) : null;

  // The journey's steps that speak for this box: the loop for the live period, the step it is on before that.
  const journeySteps = box.live ? TRACK.map((id) => plan.stepById[id]) : box.locked ? [plan.stepById[current]] : [];
  const step = plan.stepById[current];
  const progress = stepProgress(step, tasks);
  const last = journeySteps.length ? lastDone(journeySteps, tasks) : null;

  const flaggedTasks: Issue[] = journeySteps.flatMap((s) =>
    s.tasks
      .filter((task) => taskState(tasks, task.id).status === "flagged")
      .map((task) => ({
        id: task.id,
        severity: "warning" as const,
        title: task.label,
        detail: tasks[task.id]?.note,
        source: "Cortex",
        onOpen: () => selectTask(task.id),
      })),
  );
  const blockIssues: Issue[] = (box.block?.issues ?? []).map((issue) => ({
    id: issue.id,
    severity: issue.severity,
    title: issue.title,
    detail: issue.detail,
    source: SOURCE[issue.source],
  }));
  // The data quality engine's open findings on these days. In the period in progress a
  // finding opens the Monitor task its records are filed on; otherwise the calculation tree.
  const qualityIssues: Issue[] = engineFindings.map((finding) => {
    const task = box.live && finding.task ? plan.taskById[finding.task] : undefined;
    return {
      id: `quality:${finding.id}`,
      severity: isBlocking(finding) ? "blocker" : "warning",
      title: finding.text.headline,
      detail: finding.text.todo,
      source: "Data quality",
      onOpen: task ? () => selectTask(task.id) : () => goToFloor(3),
    };
  });
  const severityRank: Record<IssueSeverity, number> = { blocker: 0, warning: 1, info: 2 };
  const issues = [...blockIssues, ...flaggedTasks, ...qualityIssues, ...findings].sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  let next: Next;
  if (box.live || box.locked) {
    const open = progress.complete ? null : step.tasks.find((task) => task.id === firstOpenTask(step, tasks));
    next = open
      ? {
          title: open.cortex.role === "none" ? `${step.label}: next for you` : `${step.label}: Cortex asks`,
          detail: open.ask,
          cortex: true,
          action: { label: "Answer it", run: () => selectTask(open.id) },
        }
      : {
          title: "Cortex is satisfied",
          detail: current === "issued" ? "Close this period and open the next." : `Ready to move to ${plan.stepById[nextStep(current)].label}.`,
          cortex: true,
          action: { label: `Open ${step.label}`, run: () => selectStep(current) },
        };
    if (box.locked) next = { ...next, title: `Validate the facility first · ${next.title}` };
  } else if (box.block) {
    next = blockNext(box.block, registry, [...qualityIssues, ...findings]);
  } else {
    next = { title: "Give this period its dates", detail: "The Monitor step holds them.", cortex: true, action: { label: "Open Monitor", run: () => selectStep("monitor") } };
  }

  const eyebrow = box.live
    ? `#${box.sequence} · this period`
    : box.locked
      ? `#${box.sequence} · not open yet`
      : `#${box.sequence} · ${box.block?.origin === "registry" ? "registry" : box.block?.origin === "draft" ? "local draft" : "sample history"}`;
  const pill = box.live ? step.label : box.locked ? "Locked" : box.block ? STAGE_META[box.block.stage].label : "";

  return (
    <section aria-label={`${box.label}: details`} className="relative">
      <span
        aria-hidden
        className="absolute -top-[7px] size-3.5 rotate-45 rounded-[2px] bg-[#1D250A]"
        style={{ left: Math.max(18, notch - 7) }}
      />
      <div className="journey-panel journey-panel--solid relative rounded-2xl p-4 shadow-[0_24px_48px_-20px_rgba(13,24,2,0.6)]">
        <header className="flex items-start gap-3">
          <span className="mt-0.5 h-10 w-1.5 shrink-0 rounded-full" style={{ background: tone.face }} />
          <div className="min-w-0 flex-1">
            <p className="text-[9.5px] font-semibold tracking-[0.16em] text-sand uppercase">{eyebrow}</p>
            <h3 className="text-[16px] leading-tight font-semibold text-calcite">
              {box.label}
              {box.range ? (
                <span className="font-normal text-calcite/60">
                  {" "}
                  · {formatRange(box.range)} · {rangeDays(box.range)} days
                </span>
              ) : null}
            </h3>
          </div>
          {pill ? (
            <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: tone.face, color: tone.ink }}>
              {pill}
            </span>
          ) : null}
          <button type="button" onClick={onClose} aria-label="Close the details" className="-mt-1 -mr-1 shrink-0 rounded-md p-1 text-sand hover:bg-calcite/10 hover:text-calcite">
            <X className="size-4" />
          </button>
        </header>

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <section>
            <Eyebrow>Where it stands</Eyebrow>
            {box.live || box.locked ? (
              <>
                <p className="mt-1 text-[13.5px] font-semibold text-calcite">{box.locked ? `Facility validation · ${step.label}` : step.label}</p>
                <p className="text-[11px] leading-snug text-calcite/65">{box.locked ? "The first monitoring period opens once the facility is validated." : step.sub}</p>
                <div className="mt-2 flex items-center gap-2.5">
                  <SegmentBar step={step} className="flex-1" />
                  <span className="font-mono text-[11px] font-semibold text-calcite">
                    {progress.done}/{progress.total}
                  </span>
                </div>
                <p className="mt-1 text-[10.5px] text-calcite/60">
                  {progress.complete
                    ? "All in."
                    : [`${progress.total - progress.done} to go`, progress.flagged ? `${progress.flagged} to check` : null].filter(Boolean).join(" · ")}
                </p>
              </>
            ) : box.block ? (
              <BlockStatus block={box.block} registry={registry} />
            ) : null}
            <p className="mt-2 text-[10.5px] text-calcite/60">
              <span className="font-semibold text-sand">Last done </span>
              {last
                ? `${last.task.label} · ${formatDay(last.at.slice(0, 10))}`
                : box.block?.updatedOn
                  ? `${STAGE_META[box.block.stage].label} · ${formatDay(box.block.updatedOn)}`
                  : "Nothing yet"}
            </p>
            {engineVerdict ? (
              <p className="mt-1 text-[10.5px] text-calcite/60">
                <span className="font-semibold text-sand">Data quality </span>
                <span className="font-semibold" style={{ color: VERDICT_COLOR[engineVerdict] }}>
                  {VERDICT_LABEL[engineVerdict]}
                </span>
                {engineFindings.length ? ` · ${plural(engineFindings.length, "finding")} open` : ""}
              </p>
            ) : null}
            {box.range ? (
              <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                <Stat label="Net" value={formatTonnes(net)} unit="t CO₂" />
                <Stat label="Stream days" value={coverage == null ? "—" : formatPercent(coverage)} />
                <Stat label={box.block?.issuedT != null ? "Issued" : "Days"} value={box.block?.issuedT != null ? formatTonnes(box.block.issuedT) : String(rangeDays(box.range))} unit={box.block?.issuedT != null ? "t" : undefined} />
              </div>
            ) : null}
          </section>

          <section>
            <Eyebrow>Issues{issues.length ? ` · ${issues.length}` : ""}</Eyebrow>
            <IssueList issues={issues} />
          </section>
        </div>

        <div className={`mt-3.5 flex items-start gap-2.5 rounded-xl px-3 py-2.5 ${next.cortex ? "bg-calcite/10" : "bg-[#8B9C44]/18"}`}>
          {next.cortex ? <CortexAvatar size={22} /> : <ArrowRight className="mt-0.5 size-4 shrink-0 text-[#B2BE8B]" />}
          <div className="min-w-0 flex-1">
            <p className="text-[9.5px] font-semibold tracking-[0.16em] text-sand uppercase">Next to do</p>
            <p className="text-[12.5px] leading-snug font-semibold text-calcite">{next.title}</p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-calcite/75">{next.detail}</p>
          </div>
        </div>

        <footer className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {next.action ? (
            <button
              type="button"
              onClick={next.action.run}
              className="rounded-lg bg-calcite px-3 py-1.5 text-[11.5px] font-semibold text-earth transition-colors hover:bg-off-white"
            >
              {next.action.label}
            </button>
          ) : null}
          {box.range ? (
            <button
              type="button"
              onClick={() => goToFloor(3)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold text-calcite ring-1 ring-calcite/25 transition-colors hover:bg-calcite/10"
            >
              How its CO₂ is calculated
              <ArrowDown className="size-3.5" />
            </button>
          ) : null}
        </footer>
      </div>
    </section>
  );
}

/** A ledger block's place in the registry's process, in words. */
function BlockStatus({ block, registry }: { block: LedgerBlock; registry: string }) {
  const pipeline = pipelineFor(registry);
  const at = stepIndex(pipeline, block.stage);
  const here = pipeline.steps[at];
  const done = block.stage === "issued";
  return (
    <>
      <p className="mt-1 text-[13.5px] font-semibold text-calcite">
        {STAGE_META[block.stage].label}
        <span className="font-normal text-calcite/60"> · {here.label}</span>
      </p>
      <p className="text-[11px] leading-snug text-calcite/65">
        {done ? here.detail : `${block.stage === "verification" && block.verifier ? block.verifier : here.actor}. ${here.detail}`}
      </p>
      <ol className="mt-2 flex items-center gap-1" aria-label={`${pipeline.registry} process`}>
        {pipeline.steps.map((step, index) => {
          const reached = index < at || done;
          const now = index === at && !done;
          return (
            <li key={step.label} title={`${step.label} · ${step.actor}`} className="flex min-w-0 flex-1 flex-col gap-1">
              <span
                className="h-1.5 rounded-full"
                style={{ background: reached ? "#8B9C44" : now ? (block.stage === "issues" ? "#963E32" : "#BEB290") : "rgba(234,218,199,0.18)" }}
              />
              <span className={`truncate text-[9px] ${reached || now ? "text-calcite/80" : "text-calcite/40"}`}>{step.label}</span>
            </li>
          );
        })}
      </ol>
      {block.registryRef ? <p className="mt-1 truncate font-mono text-[9.5px] text-calcite/45">{block.registryRef}</p> : null}
    </>
  );
}
