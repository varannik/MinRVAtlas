"use client";

import type { ReactNode } from "react";
import { Check, CircleAlert, FileStack, GitBranch, Info, Layers, Trash2, TriangleAlert, X } from "lucide-react";
import type { Finding } from "@/lib/mrv/checks";
import type { Evaluation } from "@/lib/mrv/calc/types";
import { formatDay, formatRange, rangeDays } from "@/lib/mrv/days";
import { pipelineFor, stepIndex, STAGE_META } from "@/lib/mrv/registry-pipeline";
import type { BlockIssue, DateRange, IssueSeverity, LedgerBlock } from "@/lib/mrv/types";
import { formatPercent, formatTonnes } from "../format";
import { BLOCK_TONE, PROPOSAL, SEVERITY_TONE } from "../theme";

const SEVERITY_ICON: Record<IssueSeverity, typeof TriangleAlert> = {
  blocker: TriangleAlert,
  warning: CircleAlert,
  info: Info,
};

const SOURCE_LABEL: Record<BlockIssue["source"], string> = {
  registry: "Registry",
  vvb: "Verifier",
  checks: "Data check",
  requirements: "Filing",
};

/** Where the block is in the registry's process. */
function StageTrack({ registry, block }: { registry: string; block: LedgerBlock | null }) {
  const pipeline = pipelineFor(registry);
  const reached = block ? stepIndex(pipeline, block.stage) : -1;
  const blocked = block?.stage === "issues";
  return (
    <ol className="flex items-start">
      {pipeline.steps.map((step, index) => {
        const done = index < reached || (index === reached && block?.stage === "issued");
        const current = index === reached && !done;
        const color = blocked && current ? BLOCK_TONE.issues.face : done ? BLOCK_TONE.issued.face : current ? "#070808" : "#D2C8B0";
        return (
          <li key={step.label} className="relative flex flex-1 flex-col items-center text-center" title={`${step.actor} — ${step.detail}`}>
            {index > 0 ? (
              <span
                aria-hidden
                className="absolute top-[9px] right-1/2 left-[-50%] h-px"
                style={{ background: index <= reached ? BLOCK_TONE.issued.face : "#D2C8B0" }}
              />
            ) : null}
            <span
              className="relative z-10 grid size-[18px] place-items-center rounded-full ring-4 ring-white"
              style={{ background: current || done ? color : "#FFFFFF", boxShadow: `inset 0 0 0 1.5px ${color}` }}
            >
              {done ? <Check className="size-2.5 text-white" strokeWidth={3} /> : null}
              {blocked && current ? <TriangleAlert className="size-2.5 text-white" /> : null}
              {current && !blocked ? <span className="size-1.5 rounded-full bg-white" /> : null}
            </span>
            <span className={`mt-1 text-[10px] leading-tight font-semibold ${current || done ? "text-frost" : "text-mist"}`}>{step.label}</span>
            <span className="mt-px text-[9px] leading-tight text-mist">{step.actor}</span>
          </li>
        );
      })}
    </ol>
  );
}

function IssueRow({ severity, title, detail, source, onOpen }: { severity: IssueSeverity; title: string; detail?: string; source: string; onOpen?: () => void }) {
  const Icon = SEVERITY_ICON[severity];
  const tone = SEVERITY_TONE[severity];
  const body = (
    <>
      <Icon className="mt-0.5 size-3.5 shrink-0" style={{ color: tone.color }} />
      <span className="min-w-0 flex-1">
        <span className="block text-[11.5px] leading-snug font-medium text-frost">{title}</span>
        {detail ? <span className="mt-0.5 block text-[10.5px] leading-snug text-mist">{detail}</span> : null}
      </span>
      <span className="shrink-0 rounded bg-ink-700 px-1.5 py-px text-[9px] font-semibold tracking-wide text-mist uppercase">{source}</span>
    </>
  );
  return (
    <li>
      {onOpen ? (
        <button type="button" onClick={onOpen} className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-off-white">
          {body}
        </button>
      ) : (
        <div className="flex items-start gap-2 px-2 py-1.5">{body}</div>
      )}
    </li>
  );
}

function Stat({ label, value, unit, hint }: { label: string; value: string; unit?: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-off-white/80 px-2.5 py-2">
      <p className="text-[9.5px] font-semibold tracking-[0.12em] text-mist uppercase">{label}</p>
      <p className="mt-0.5 flex items-baseline gap-1">
        <span className="font-mono text-[17px] leading-none font-semibold text-frost tabular-nums">{value}</span>
        {unit ? <span className="text-[10px] text-mist">{unit}</span> : null}
      </p>
      {hint ? <p className="mt-0.5 truncate text-[10px] text-mist">{hint}</p> : null}
    </div>
  );
}

function ActionButton({ children, onClick, primary, disabled, title }: { children: ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
        primary ? "bg-rock text-white hover:bg-earth" : "bg-white text-frost ring-1 ring-line hover:bg-off-white"
      }`}
    >
      {children}
    </button>
  );
}

function FindingsList({ findings, onOpenNode }: { findings: Finding[]; onOpenNode: (nodeId: string) => void }) {
  if (!findings.length) {
    return <p className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-carbon-400"><Check className="size-3.5" /> No problems found by the data checks.</p>;
  }
  return (
    <ul className="space-y-0.5">
      {findings.slice(0, 6).map((finding) => (
        <IssueRow
          key={finding.id}
          severity={finding.severity}
          title={finding.title}
          detail={finding.detail}
          source={finding.check}
          onOpen={finding.nodeId ? () => onOpenNode(finding.nodeId!) : undefined}
        />
      ))}
      {findings.length > 6 ? <li className="px-2 text-[10.5px] text-mist">+{findings.length - 6} more in the calculation view</li> : null}
    </ul>
  );
}

export function BlockDetail({
  registry,
  creditUnit,
  block,
  coverage,
  evaluation,
  findings,
  canOpenDesk,
  onCalc,
  onDesk,
  onDiscard,
  onClose,
}: {
  registry: string;
  creditUnit: string;
  block: LedgerBlock;
  /** Share of the window's days with stream rows. */
  coverage: number | null;
  evaluation: Evaluation | null;
  findings: Finding[];
  canOpenDesk: boolean;
  onCalc: (nodeId?: string) => void;
  onDesk: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  const tone = BLOCK_TONE[block.stage];
  const root = evaluation?.root;
  return (
    <section className="space-y-3">
      <header className="flex items-start gap-3">
        <span className="mt-0.5 h-9 w-1.5 shrink-0 rounded-full" style={{ background: tone.face }} />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">
            Block #{block.sequence} · {block.origin === "registry" ? "Registry" : block.origin === "draft" ? "Local draft" : "Sample history"}
          </p>
          <h3 className="text-[15px] leading-tight font-semibold text-frost">
            {block.label} <span className="font-normal text-mist">· {formatRange(block.range)}</span>
          </h3>
          <p className="mt-0.5 truncate font-mono text-[10px] text-mist">
            {block.hash}
            {block.registryRef ? ` · ${block.registryRef}` : ""}
            {block.updatedOn ? ` · updated ${formatDay(block.updatedOn)}` : ""}
          </p>
        </div>
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: tone.face, color: tone.ink }}>
          {STAGE_META[block.stage].label}
        </span>
        <button type="button" onClick={onClose} aria-label="Close block" className="shrink-0 rounded-md p-1 text-mist hover:bg-off-white">
          <X className="size-3.5" />
        </button>
      </header>

      <StageTrack registry={registry} block={block} />

      <div className="grid grid-cols-3 gap-2">
        <Stat label={`Net ${creditUnit}s`} value={formatTonnes(root?.value ?? null)} unit="t" hint={root?.status === "missing" ? "Inputs missing" : root?.status === "partial" ? "Partly covered" : "From data"} />
        <Stat label="Stream days" value={coverage == null ? "—" : formatPercent(coverage)} hint={`of ${rangeDays(block.range)} days`} />
        <Stat label="Issues" value={String(block.issues.length + findings.filter((f) => f.severity !== "info").length)} hint={block.verifier ?? pipelineFor(registry).steps[2]?.actor} />
      </div>

      {block.issues.length ? (
        <div>
          <p className="mb-1 text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">Registry & verifier</p>
          <ul className="space-y-0.5">
            {block.issues.map((issue) => (
              <IssueRow key={issue.id} severity={issue.severity} title={issue.title} detail={issue.detail} source={SOURCE_LABEL[issue.source]} />
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="mb-1 text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">Data checks</p>
        <FindingsList findings={findings} onOpenNode={(id) => onCalc(id)} />
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <ActionButton primary onClick={() => onCalc()}>
          <GitBranch className="size-3.5" />
          Calculation tree
        </ActionButton>
        <ActionButton
          onClick={onDesk}
          disabled={!canOpenDesk}
          title={canOpenDesk ? "Requirements, GHG entries and statement for this period" : "Sample blocks have no filing desk"}
        >
          <FileStack className="size-3.5" />
          Filing desk
        </ActionButton>
        {block.origin === "draft" ? (
          <ActionButton onClick={onDiscard}>
            <Trash2 className="size-3.5" />
            Discard draft
          </ActionButton>
        ) : null}
      </div>
    </section>
  );
}

export function ProposalDetail({
  creditUnit,
  selection,
  coverage,
  evaluation,
  findings,
  error,
  onCalc,
  onCreate,
  onClear,
}: {
  creditUnit: string;
  selection: DateRange;
  coverage: number | null;
  evaluation: Evaluation | null;
  findings: Finding[];
  error: string | null;
  onCalc: (nodeId?: string) => void;
  onCreate: () => void;
  onClear: () => void;
}) {
  const root = evaluation?.root;
  const blockers = findings.filter((finding) => finding.severity === "blocker").length;
  return (
    <section className="space-y-3">
      <header className="flex items-start gap-3">
        <span className="mt-0.5 h-9 w-1.5 shrink-0 rounded-full" style={{ background: PROPOSAL.stroke }} />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold tracking-[0.14em] uppercase" style={{ color: PROPOSAL.ink }}>
            Proposed block
          </p>
          <h3 className="text-[15px] leading-tight font-semibold text-frost">
            {formatRange(selection)} <span className="font-normal text-mist">· {rangeDays(selection)} days</span>
          </h3>
          <p className="mt-0.5 text-[10.5px] text-mist">Drag the handles to adjust. A block cannot overlap another one.</p>
        </div>
        <button type="button" onClick={onClear} aria-label="Clear selection" className="shrink-0 rounded-md p-1 text-mist hover:bg-off-white">
          <X className="size-3.5" />
        </button>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <Stat label={`Net ${creditUnit}s`} value={formatTonnes(root?.value ?? null)} unit="t" hint={root?.status === "missing" ? "Inputs missing" : root?.status === "partial" ? "Partly covered" : "From data"} />
        <Stat label="Stream days" value={coverage == null ? "—" : formatPercent(coverage)} hint={`of ${rangeDays(selection)} days`} />
        <Stat label="Blockers" value={String(blockers)} hint={`${findings.length} findings`} />
      </div>

      <div>
        <p className="mb-1 text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">Data checks</p>
        <FindingsList findings={findings} onOpenNode={(id) => onCalc(id)} />
      </div>

      {error ? <p className="rounded-lg bg-signal-rose/10 px-2.5 py-1.5 text-[11px] text-signal-rose">{error}</p> : null}

      <div className="flex flex-wrap gap-2 pt-1">
        <ActionButton onClick={() => onCalc()}>
          <GitBranch className="size-3.5" />
          Calculation tree
        </ActionButton>
        <ActionButton primary onClick={onCreate} title={blockers ? "You can create the draft now and fix the blockers before submitting" : undefined}>
          <Layers className="size-3.5" />
          Create draft block
        </ActionButton>
      </div>
    </section>
  );
}
