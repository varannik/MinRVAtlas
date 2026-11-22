"use client";

import { useEffect, useState } from "react";
import { CircleCheck, CircleHelp, LoaderCircle, Sparkles } from "lucide-react";

import { formatRequirement, type RequirementScope, type RequirementUnit } from "@/lib/requirements/catalog";
import { useCortex } from "@/store/cortex-store";
import { readJson, useCortexProjects } from "./cortex-projects";

/**
 * The registry values the journey's checks decide with (lib/requirements), for the
 * selected project's methodology edition: what the checks use now, and what Cortex
 * proposes from the registry's own documents, quoted with its clause and page.
 * Platform admins ask for proposals and approve or reject them; everyone sees them.
 */

const POLL_MS = 8000;
const BUTTON =
  "h-7 rounded-md px-2.5 text-[11.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-olivine-500 disabled:opacity-50";
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

interface Evidence {
  value?: number;
  unit?: string;
  clauseRef?: string;
  document?: string;
  page?: number;
  quote?: string;
}

interface Value {
  id: string;
  label: string;
  unit: RequirementUnit;
  builtIn: number;
  builtInSource: string;
  approved?: Evidence & { value: number; approvedBy: string; approvedAt: string };
  proposal?: Evidence & { sk: string; status: string; confidence?: string; note?: string; proposedAt: string; decidedBy?: string };
}

interface Reply {
  scope: RequirementScope | null;
  requirements: Value[];
  proposing: boolean;
  canDecide: boolean;
  canPropose?: boolean;
  message?: string;
}

function where(evidence: Evidence): string {
  const parts = [evidence.clauseRef, evidence.document, evidence.page != null ? `p. ${evidence.page}` : null];
  return parts.filter(Boolean).join(" · ");
}

function ValueRow({ value, canDecide, busy, onDecide }: { value: Value; canDecide: boolean; busy: boolean; onDecide: (action: "approve" | "reject") => void }) {
  const proposal = value.proposal;
  const open = proposal?.status === "proposed" && proposal.value !== undefined;
  const differs = open && proposal.value !== (value.approved?.value ?? value.builtIn);
  return (
    <li className="grid gap-1.5 rounded-lg border border-strata-300/80 bg-white/75 px-3 py-2.5">
      <p className="flex items-baseline justify-between gap-2 text-[12.5px]">
        <span className="font-semibold text-earth">{value.label}</span>
        <span className="shrink-0 font-mono text-[12px] text-earth">{formatRequirement(value.approved?.value ?? value.builtIn, value.unit)}</span>
      </p>
      {value.approved ? (
        <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-strata-700">
          <CircleCheck className="mt-px size-3.5 shrink-0 text-olivine-700" aria-hidden />
          <span>
            Approved by {value.approved.approvedBy}
            {value.approved.approvedAt ? `, ${DATE.format(new Date(value.approved.approvedAt))}` : ""}. {where(value.approved)}
          </span>
        </p>
      ) : (
        <p className="text-[11.5px] leading-snug text-strata-700">Built-in until a value is approved ({value.builtInSource}).</p>
      )}
      {open ? (
        <div className="grid gap-1.5 rounded-md bg-serpentine-50 px-2.5 py-2 text-[11.5px] leading-snug text-serpentine-800">
          <p className="flex items-start gap-1.5">
            <Sparkles className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>
              Cortex proposes <strong>{formatRequirement(proposal.value!, value.unit)}</strong>
              {differs ? "" : " (the same as now)"}
              {proposal.confidence ? `, ${proposal.confidence} confidence` : ""}. {where(proposal)}
            </span>
          </p>
          {proposal.quote ? <blockquote className="border-l-2 border-current/30 pl-2 italic">“{proposal.quote}”</blockquote> : null}
          {proposal.note ? <p className="opacity-80">{proposal.note}</p> : null}
          {canDecide ? (
            <div className="flex gap-1.5">
              <button type="button" disabled={busy} onClick={() => onDecide("approve")} className={`${BUTTON} bg-olivine-800 text-white hover:bg-olivine-900`}>
                Approve
              </button>
              <button type="button" disabled={busy} onClick={() => onDecide("reject")} className={`${BUTTON} border border-current/25 hover:bg-white/60`}>
                Reject
              </button>
            </div>
          ) : (
            <p className="opacity-80">A platform admin decides.</p>
          )}
        </div>
      ) : proposal?.status === "not_found" ? (
        <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-strata-700">
          <CircleHelp className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>Cortex found no value in the documents{proposal.note ? `: ${proposal.note}` : "."}</span>
        </p>
      ) : proposal?.status === "rejected" ? (
        <p className="text-[11.5px] text-strata-700">
          Cortex&rsquo;s last proposal ({formatRequirement(proposal.value ?? 0, value.unit)}) was rejected{proposal.decidedBy ? ` by ${proposal.decidedBy}` : ""}.
        </p>
      ) : null}
    </li>
  );
}

export function RegistryValues() {
  const { reply: projects } = useCortexProjects();
  const stored = useCortex((state) => state.projectId);
  const project = projects?.projects.find((item) => item.id === stored) ?? projects?.projects[0];
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!project) return;
    const controller = new AbortController();
    fetch(`/api/cortex/requirements?${new URLSearchParams({ project: project.id })}`, { signal: controller.signal })
      .then((response) => readJson<Reply>(response))
      .then((body) => {
        setReply(body);
        setError(null);
      })
      .catch((failure: Error) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [project, refresh]);

  const proposing = reply?.proposing ?? false;
  useEffect(() => {
    if (!proposing) return;
    const timer = window.setTimeout(() => setRefresh((value) => value + 1), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [proposing, refresh]);

  const send = async (body: Record<string, string>) => {
    if (!project) return;
    setBusy(true);
    try {
      await readJson(
        await fetch("/api/cortex/requirements", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ project: project.id, ...body }),
        }),
      );
      setError(null);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
      setRefresh((value) => value + 1);
    }
  };

  if (!project) return null;
  if (!reply) return <p className="text-[12px] text-strata-700">{error ?? "Loading the registry values…"}</p>;
  if (!reply.scope) return <p className="text-[12px] text-strata-700">{reply.message}</p>;

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11.5px] text-strata-700">
          {project.name}: {reply.scope.registry} · {reply.scope.methodology} · {reply.scope.edition}
        </p>
        {reply.canDecide && reply.canPropose ? (
          <button
            type="button"
            disabled={busy || reply.proposing}
            onClick={() => void send({ action: "propose" })}
            className={`${BUTTON} inline-flex items-center gap-1.5 border border-strata-300/80 bg-white/75 text-earth hover:border-olivine-500`}
          >
            {reply.proposing ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
            {reply.proposing ? "Cortex is reading the rules…" : "Ask Cortex to propose values"}
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-[11.5px] text-signal-rose">
          {error}
        </p>
      ) : null}
      <ul className="grid gap-1.5">
        {reply.requirements.map((value) => (
          <ValueRow
            key={value.id}
            value={value}
            canDecide={reply.canDecide}
            busy={busy}
            onDecide={(action) => void send({ action, requirement: value.id, proposal: value.proposal!.sk })}
          />
        ))}
      </ul>
      <p className="text-[11px] leading-snug text-strata-700">
        Journey checks use these values for every project on this edition. Cortex only proposes; a platform admin approves.
      </p>
    </div>
  );
}
