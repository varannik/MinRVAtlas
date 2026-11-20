"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, CircleAlert, LoaderCircle, RotateCcw } from "lucide-react";

import {
  SCOPE_LABEL,
  questionProblem,
  readEvents,
  sourceLabel,
  type AskEvent,
  type AskSource,
} from "@/lib/cortex/ask";
import { useCortex, type ChatTurn } from "@/store/cortex-store";
import { ProjectPicker, noProjectReason, useCortexProjects } from "./cortex-projects";

/**
 * Ask Cortex about a project: the agent searches the registry, organisation and
 * project documents Cortex holds and answers with the rules it relied on. The
 * answer streams in; the sources it cites are listed under it.
 */

const SUGGESTIONS = [
  "How long is the crediting period, and can it be renewed?",
  "How is the number of credits calculated for a monitoring period?",
  "What must the monitoring plan cover?",
];

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Answers are plain text; the one mark-up Claude still uses now and then is **bold**. */
function Answer({ text }: { text: string }) {
  const parts = text.split(/\*\*([^*\n]+)\*\*/g);
  return (
    <>
      {parts.map((part, index) => (index % 2 === 1 ? <strong key={index}>{part}</strong> : part))}
    </>
  );
}

function mergeSources(current: AskSource[], found: AskSource[]): AskSource[] {
  const seen = new Set(current.map((source) => source.id));
  return [...current, ...found.filter((source) => !seen.has(source.id))];
}

/** Apply one streamed event to a turn. */
function applyEvent(turn: ChatTurn, event: AskEvent): ChatTurn {
  switch (event.type) {
    case "status":
      return { ...turn, status: event.text };
    case "sources":
      return { ...turn, sources: mergeSources(turn.sources, event.sources) };
    case "text":
      return { ...turn, answer: turn.answer + event.text, status: null };
    case "reset":
      return { ...turn, answer: "" };
    case "done":
      return { ...turn, state: "done", status: null, cited: event.cited };
    case "error":
      return { ...turn, state: "error", status: null, error: event.message };
  }
}

function SourceItem({ source, cited }: { source: AskSource; cited: boolean }) {
  return (
    <li className="min-w-0">
      <details className="group min-w-0 rounded-lg border border-line bg-white/70 px-2.5 py-1.5">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[12px] text-rock marker:hidden">
          <span className={`min-w-0 truncate ${cited ? "font-semibold" : ""}`}>{sourceLabel(source)}</span>
          <span className="shrink-0 rounded-full bg-[#EEE9FD] px-1.5 py-0.5 text-[10px] font-semibold text-[#5536B0]">
            {SCOPE_LABEL[source.scope ?? ""] ?? "Document"}
          </span>
        </summary>
        <p className="mt-1.5 text-[11.5px] leading-snug wrap-anywhere text-shale">
          {source.section ? <span className="block font-medium text-rock">{source.section}</span> : null}
          {source.excerpt}
          {source.excerpt.length >= 280 ? "…" : ""}
        </p>
      </details>
    </li>
  );
}

function Sources({ turn }: { turn: ChatTurn }) {
  if (turn.sources.length === 0) return null;
  const cited = new Set(turn.cited);
  const used = turn.sources.filter((source) => cited.has(source.id));
  const read = turn.sources.filter((source) => !cited.has(source.id));
  return (
    <div className="grid min-w-0 gap-1.5">
      {used.length > 0 && (
        <>
          <p className="text-[10.5px] font-semibold tracking-[0.12em] text-mist uppercase">Cited</p>
          <ul className="grid min-w-0 gap-1">
            {used.map((source) => (
              <SourceItem key={source.id} source={source} cited />
            ))}
          </ul>
        </>
      )}
      {read.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-[11.5px] font-medium text-shale hover:text-rock">
            {used.length > 0 ? "Also read" : "Read"} ({read.length})
          </summary>
          <ul className="mt-1 grid min-w-0 gap-1">
            {read.map((source) => (
              <SourceItem key={source.id} source={source} cited={false} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Turn({ turn }: { turn: ChatTurn }) {
  return (
    <li className="grid min-w-0 gap-2">
      <p className="ml-8 justify-self-end rounded-2xl rounded-br-md bg-[#EEE9FD] px-3 py-2 text-[13px] leading-snug wrap-anywhere whitespace-pre-wrap text-[#2B1F66]">
        {turn.question}
      </p>
      {turn.answer && (
        <p className="text-[13.5px] leading-relaxed wrap-anywhere whitespace-pre-wrap text-rock" aria-live="polite">
          <Answer text={turn.answer} />
        </p>
      )}
      {turn.state === "asking" && (
        <p className="flex items-center gap-1.5 text-[12px] text-shale" role="status">
          <LoaderCircle className="size-3.5 animate-spin" />
          {turn.status ?? (turn.answer ? "Writing…" : "Thinking…")}
        </p>
      )}
      {turn.state === "error" && (
        <p className="flex items-start gap-1.5 text-[12px] text-[#8E2A1E]" role="alert">
          <CircleAlert className="mt-px size-3.5 shrink-0" />
          {turn.error}
        </p>
      )}
      <Sources turn={turn} />
    </li>
  );
}

function Conversation({ projectId, projectName }: { projectId: string; projectName: string }) {
  const chat = useCortex((state) => state.chats[projectId]);
  const askStarted = useCortex((state) => state.askStarted);
  const askUpdated = useCortex((state) => state.askUpdated);
  const newChat = useCortex((state) => state.newChat);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const turns = chat?.turns ?? [];
  const asking = turns.some((turn) => turn.state === "asking");
  const last = turns.at(-1);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length, last?.answer.length, last?.state]);

  async function ask(question: string) {
    const turn: ChatTurn = {
      id: newId(),
      question,
      answer: "",
      status: null,
      sources: [],
      cited: [],
      state: "asking",
    };
    askStarted(projectId, turn);
    const conversationId = useCortex.getState().chats[projectId]?.conversationId ?? "";
    const update = (change: (current: ChatTurn) => ChatTurn) => askUpdated(projectId, turn.id, change);
    try {
      const response = await fetch("/api/cortex/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, question, conversationId }),
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Cortex could not answer (${response.status}).`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = readEvents(buffer);
        buffer = rest;
        for (const event of events) update((current) => applyEvent(current, event));
      }
      update((current) =>
        current.state === "asking"
          ? { ...current, state: "error", status: null, error: "The answer stopped early. Ask again." }
          : current,
      );
    } catch (failure) {
      update((current) => ({
        ...current,
        state: "error",
        status: null,
        error: failure instanceof Error ? failure.message : "Cortex could not answer.",
      }));
    }
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (asking) return;
    const question = draft.trim();
    const why = questionProblem(question);
    setProblem(why);
    if (why) return;
    setDraft("");
    void ask(question);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  }

  return (
    <div className="grid min-w-0 gap-3">
      {turns.length === 0 ? (
        <div className="grid gap-1.5">
          <p className="text-[12px] text-shale">Try one of these, or ask your own:</p>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => void ask(suggestion)}
                className="rounded-full border border-line bg-white px-2.5 py-1 text-left text-[12px] text-rock transition-colors hover:border-rock/40 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rock"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ul className="grid min-w-0 gap-5">
          {turns.map((turn) => (
            <Turn key={turn.id} turn={turn} />
          ))}
        </ul>
      )}
      <div ref={endRef} />

      <form onSubmit={submit} className="grid gap-1.5">
        <div className="flex items-end gap-2 rounded-xl border border-line bg-white p-1.5 focus-within:border-rock/60 focus-within:shadow-[0_0_0_3px_rgba(7,8,8,0.08)]">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            aria-label={`Ask Cortex about ${projectName}`}
            placeholder={`Ask about ${projectName}'s rules and documents`}
            className="min-h-10 flex-1 resize-none bg-transparent px-1.5 py-1 text-[13px] text-rock outline-none placeholder:text-mist"
          />
          <button
            type="submit"
            disabled={asking || !draft.trim()}
            aria-label="Ask"
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-rock text-white transition-opacity disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rock"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] text-mist">
          <span>{problem ?? "Answers come from the documents Cortex holds, with the rule and page."}</span>
          {turns.length > 0 && (
            <button
              type="button"
              disabled={asking}
              onClick={() => newChat(projectId)}
              className="inline-flex shrink-0 items-center gap-1 font-medium text-shale hover:text-rock disabled:opacity-40"
            >
              <RotateCcw className="size-3" />
              New conversation
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

export function AskCortex() {
  const { reply, error } = useCortexProjects();
  const stored = useCortex((state) => state.projectId);
  const setProject = useCortex((state) => state.setProject);
  const chats = useCortex((state) => state.chats);

  if (!reply) {
    return <p className="text-[12px] text-mist">{error ? `Cortex is unavailable (${error}).` : "Connecting to Cortex…"}</p>;
  }
  const project = reply.projects.find((item) => item.id === stored) ?? reply.projects[0];
  const why = noProjectReason(reply, project);
  if (why || !project) return <p className="text-[12px] text-mist">{why}</p>;
  const asking = Object.values(chats).some((chat) => chat.turns.some((turn) => turn.state === "asking"));

  return (
    <div className="grid min-w-0 gap-3">
      <ProjectPicker projects={reply.projects} value={project.id} onChange={setProject} disabled={asking} />
      <Conversation key={project.id} projectId={project.id} projectName={project.name} />
    </div>
  );
}
