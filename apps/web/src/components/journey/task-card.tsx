"use client";

import { useId, useState, type ReactNode } from "react";
import {
  Check,
  FileText,
  MessageCircleQuestion,
  PenLine,
  RotateCcw,
  Sparkles,
  TriangleAlert,
  Upload,
} from "lucide-react";

import { formatAnswer, splitPeriod } from "@/lib/journey/cortex";
import { CHOICE_TASKS, choiceOptions } from "@/lib/journey/steps";
import type { CortexRole, JourneyTask, TaskKind, TaskState } from "@/lib/journey/types";
import { laterAnswers, usePlan, useJourney } from "@/store/journey-store";
import { LocationPicker } from "./location-picker";

export const KIND_ICON: Record<TaskKind, typeof FileText> = {
  question: MessageCircleQuestion,
  document: FileText,
  generate: Sparkles,
};

export const KIND_WORD: Record<TaskKind, string> = {
  question: "Question",
  document: "Document",
  generate: "Document",
};

/** Who does the work on a task, as shown in lists. */
export const HELP_WORD: Record<CortexRole, string> = {
  none: "You fill in",
  check: "Cortex checks",
  draft: "Cortex drafts",
};

export const INPUT =
  "h-9 w-full min-w-0 rounded-lg border border-white/15 bg-white/[0.06] px-2.5 text-[13px] text-white placeholder:text-white/35 outline-none transition-[border-color,box-shadow] [color-scheme:dark] focus:border-[#A99BFF] focus:shadow-[0_0_0_3px_rgba(169,155,255,0.25)] disabled:opacity-60";

export const SEND =
  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 text-[12px] font-semibold text-[#1B1846] transition-colors hover:bg-[#E9E5FF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40";

const GHOST =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-[12px] font-semibold text-white/85 transition-colors hover:bg-white/10";

/** Cortex's avatar: the core's colours as a small sphere. */
export function CortexAvatar({ size = 26, busy = false }: { size?: number; busy?: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative inline-block shrink-0 rounded-full ${busy ? "animate-pulse" : ""}`}
      style={{
        width: size,
        height: size,
        background: "radial-gradient(circle at 35% 30%, #F2EDFF 0%, #C8BDFF 28%, #8F7DF7 58%, #23178F 100%)",
        boxShadow: "0 0 0 2px rgba(143,125,247,0.18), 0 0 14px rgba(143,125,247,0.45)",
      }}
    />
  );
}

type Tone = "cortex" | "ok" | "warn" | "note";

const TONE: Record<Tone, string> = {
  cortex: "bg-[#8F7DF7]/[0.16] text-white ring-1 ring-[#A99BFF]/20",
  ok: "bg-[#F5C766]/[0.12] text-[#FFF1D0] ring-1 ring-[#F5C766]/25",
  warn: "bg-[#FF8A3D]/[0.14] text-[#FFE0C7] ring-1 ring-[#FF8A3D]/30",
  note: "bg-white/[0.05] text-white/80 ring-1 ring-white/10",
};

export function CortexSays({ children, busy = false, tone = "cortex" }: { children: ReactNode; busy?: boolean; tone?: Tone }) {
  return (
    <div className="flex items-start gap-2">
      <CortexAvatar busy={busy} />
      <div className={`min-w-0 flex-1 rounded-2xl rounded-tl-sm px-3 py-2 text-[12.5px] leading-snug ${TONE[tone]}`}>
        {children}
      </div>
    </div>
  );
}

/** The answer as given, from the operator's side of the conversation. */
function Given({ task, state, indent }: { task: JourneyTask; state: TaskState; indent: string }) {
  if (task.input.type === "draft") {
    if (!state.draft?.length) return null;
    return (
      <div className={`${indent} rounded-xl border border-white/12 bg-white/[0.05] px-3 py-2.5`}>
        <p className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold tracking-[0.12em] text-white/55 uppercase">
          <Sparkles className="size-3" /> Draft
        </p>
        <ol className="grid gap-1 text-[12px] leading-snug text-white/90">
          {state.draft.map((line, index) => (
            <li key={index} className={index === 0 ? "font-semibold text-white" : ""}>
              {line}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  const text = formatAnswer(task, state);
  const files = state.files ?? [];
  if (!text && files.length === 0) {
    return state.status === "done" ? <p className={`${indent} text-[12px] text-white/50`}>Given earlier.</p> : null;
  }
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-white px-3 py-2 text-[12.5px] leading-snug text-[#141235]">
        {text ? <p>{text}</p> : null}
        {files.length > 0 ? (
          <ul className={`grid gap-0.5 ${text ? "mt-1" : ""}`}>
            {files.map((file) => (
              <li key={file.name} className="flex items-center gap-1.5 text-[12px]">
                <FileText className="size-3 shrink-0 opacity-70" />
                <span className="truncate">{file.name}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

// ── Inputs ──────────────────────────────────────────────────────────────────

function ChoiceInput({
  task,
  state,
  submitLabel,
  onAnswer,
}: {
  task: JourneyTask;
  state: TaskState;
  submitLabel: string;
  onAnswer: (value: string) => void;
}) {
  const tasks = useJourney((store) => store.tasks);
  const multi = task.input.type === "choice" && task.input.multi;
  const { options, hint } = choiceOptions(task, tasks);
  const [picked, setPicked] = useState<string[]>(state.value ? state.value.split(", ").filter(Boolean) : []);
  const ordered = options.filter((option) => picked.includes(option.value)).map((option) => option.value);
  const rich = options.some((option) => option.detail);
  // Step-2 answers decide every later requirement: say what a change clears.
  const clears =
    (CHOICE_TASKS as readonly string[]).includes(task.id) && state.value && ordered.length > 0 && ordered.join(", ") !== state.value
      ? laterAnswers(tasks)
      : 0;

  if (options.length === 0) return <p className="text-[12px] text-white/60">{hint}</p>;

  const toggle = (value: string) => {
    if (multi) setPicked((list) => (list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]));
    else setPicked([value]);
  };

  return (
    <div className="grid gap-2">
      <div
        className={rich ? "grid gap-1.5" : "flex flex-wrap gap-1.5"}
        role={multi ? "group" : "radiogroup"}
        aria-label={task.label}
      >
        {options.map((option) => {
          const on = picked.includes(option.value);
          if (!rich) {
            return (
              <button
                key={option.value}
                type="button"
                role={multi ? "checkbox" : "radio"}
                aria-checked={on}
                onClick={() => toggle(option.value)}
                className={`rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white ${
                  on ? "border-white bg-white text-[#1B1846]" : "border-white/20 bg-white/[0.04] text-white/85 hover:border-[#A99BFF]"
                }`}
              >
                {option.label}
              </button>
            );
          }
          return (
            <button
              key={option.value}
              type="button"
              role={multi ? "checkbox" : "radio"}
              aria-checked={on}
              aria-disabled={option.disabled}
              disabled={option.disabled}
              onClick={() => toggle(option.value)}
              className={`flex items-start gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white ${
                option.disabled
                  ? "cursor-not-allowed border-white/8 bg-transparent text-white/35"
                  : on
                    ? "border-[#A99BFF] bg-[#8F7DF7]/20 text-white"
                    : "border-white/15 bg-white/[0.04] text-white/90 hover:border-[#A99BFF]/70 hover:bg-white/[0.07]"
              }`}
            >
              <span
                className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${
                  on ? "border-white bg-white text-[#1B1846]" : "border-white/35"
                }`}
              >
                {on ? <Check className="size-2.5" strokeWidth={3} /> : null}
              </span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-semibold">{option.label}</span>
                {option.detail ? (
                  <span className={`block text-[11px] leading-snug ${option.disabled ? "" : "text-white/60"}`}>{option.detail}</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      {clears > 0 ? (
        <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-[#FFC48F]">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          Changing this rebuilds every later step and clears {clears} answer{clears === 1 ? "" : "s"} given there.
        </p>
      ) : null}
      <button type="button" className={`${SEND} justify-self-start`} disabled={ordered.length === 0} onClick={() => onAnswer(ordered.join(", "))}>
        {submitLabel}
      </button>
    </div>
  );
}

function AnswerInput({ task, state, onSent }: { task: JourneyTask; state: TaskState; onSent: () => void }) {
  const answer = (value: Pick<TaskState, "value" | "files">) => {
    useJourney.getState().answer(task.id, value);
    onSent();
  };
  const inputId = useId();
  const input = task.input;
  const submitLabel = task.cortex.role === "none" ? "Save" : "Send to Cortex";
  const [text, setText] = useState(state.value ?? "");
  const [start, setStart] = useState(splitPeriod(state.value)[0]);
  const [end, setEnd] = useState(splitPeriod(state.value)[1]);
  const [over, setOver] = useState(false);

  switch (input.type) {
    case "draft":
      return (
        <button
          type="button"
          className={`${SEND} justify-self-start`}
          onClick={() => {
            useJourney.getState().draft(task.id);
            onSent();
          }}
        >
          <Sparkles className="size-3.5" />
          {state.draft ? "Draft again" : "Draft it with Cortex"}
        </button>
      );

    case "location":
      return <LocationPicker value={state.value} submitLabel={submitLabel} onSubmit={(value) => answer({ value })} />;

    case "choice":
      return <ChoiceInput task={task} state={state} submitLabel={submitLabel} onAnswer={(value) => answer({ value })} />;

    case "file": {
      const take = (list: FileList | null) => {
        const files = Array.from(list ?? []).map((file) => ({ name: file.name, size: file.size }));
        if (files.length > 0) answer({ files });
      };
      return (
        <label
          htmlFor={inputId}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setOver(false);
            take(event.dataTransfer.files);
          }}
          className={`flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-3 py-2.5 transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-white ${
            over ? "border-[#A99BFF] bg-[#8F7DF7]/20" : "border-white/20 bg-white/[0.04] hover:bg-white/[0.08]"
          }`}
        >
          <input
            id={inputId}
            type="file"
            multiple
            accept={input.accept}
            className="sr-only"
            onChange={(event) => {
              take(event.target.files);
              event.target.value = "";
            }}
          />
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#8F7DF7]/25 text-[#D9D2FF]">
            <Upload className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-[12.5px] font-semibold text-white">Choose or drop files</span>
            <span className="block text-[11px] text-white/55">{input.formats} · only the name and size stay in this browser</span>
          </span>
        </label>
      );
    }

    case "period":
      return (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            answer({ value: `${start}|${end}` });
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-[11px] font-medium text-white/60">
              Starts
              <input type="date" className={INPUT} value={start} onChange={(event) => setStart(event.target.value)} />
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-white/60">
              Ends
              <input type="date" className={INPUT} value={end} onChange={(event) => setEnd(event.target.value)} />
            </label>
          </div>
          <button type="submit" className={`${SEND} justify-self-start`} disabled={!start || !end}>
            {submitLabel}
          </button>
        </form>
      );

    default: {
      const multiline = input.type === "text" && input.multiline;
      const type = input.type === "date" ? "date" : "text";
      return (
        <form
          className={multiline ? "grid gap-2" : "flex items-center gap-2"}
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim()) answer({ value: text.trim() });
          }}
        >
          <label htmlFor={inputId} className="sr-only">
            {task.label}
          </label>
          {multiline ? (
            <textarea
              id={inputId}
              rows={3}
              className={`${INPUT} h-auto resize-y py-2`}
              placeholder={"placeholder" in input ? input.placeholder : undefined}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          ) : (
            <div className="relative min-w-0 flex-1">
              <input
                id={inputId}
                type={type}
                inputMode={input.type === "number" ? "decimal" : undefined}
                className={`${INPUT} ${input.type === "number" ? "pr-24" : ""}`}
                placeholder={"placeholder" in input ? input.placeholder : undefined}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
              {input.type === "number" ? (
                <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[11px] text-white/50">
                  {input.unit}
                </span>
              ) : null}
            </div>
          )}
          <button type="submit" className={`${SEND} ${multiline ? "justify-self-start" : ""}`} disabled={!text.trim()}>
            {submitLabel}
          </button>
        </form>
      );
    }
  }
}

// ── Card ────────────────────────────────────────────────────────────────────

/**
 * One task. Where Cortex helps it reads as a short conversation: Cortex
 * asks, you answer, Cortex checks or drafts and says what it found. Where it
 * doesn't, it's a plain field you fill in and save.
 */
export function TaskCard({
  task,
  state,
  locked,
  lockedReason,
}: {
  task: JourneyTask;
  state: TaskState;
  locked: boolean;
  lockedReason: string;
}) {
  const accept = useJourney((store) => store.accept);
  const registry = usePlan().registry;
  const [editing, setEditing] = useState(false);
  const answered = state.status === "done" || state.status === "flagged";
  const showInput = !locked && (state.status === "open" || editing);
  const withCortex = task.cortex.role !== "none";
  const indent = withCortex ? "ml-8" : "";

  const why = (
    <p className={`mt-1 text-[11.5px] ${withCortex ? "text-white/70" : "text-white/60"}`}>
      {task.why}
      {task.rule ? <span className="ml-1 font-mono text-[10.5px] text-white/45">· {task.rule}</span> : null}
    </p>
  );

  return (
    <div className="grid gap-2.5">
      {withCortex ? (
        <>
          <CortexSays>
            <p className="font-medium">{task.ask}</p>
            {why}
          </CortexSays>
        </>
      ) : (
        <div>
          <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.14em] text-white/50 uppercase">
            <PenLine className="size-3" /> You fill this in · no Cortex needed
          </p>
          <p className="mt-1 text-[13px] font-medium text-white">{task.ask}</p>
          {why}
        </div>
      )}

      {/* What Cortex already knows, before anything is answered. */}
      {withCortex && state.status === "open" && state.note ? (
        <CortexSays tone="note">
          <span className="font-semibold text-white">What I can see: </span>
          {state.note}
        </CortexSays>
      ) : null}

      {locked ? (
        <p className={`${indent} rounded-lg bg-white/[0.06] px-3 py-2 text-[12px] text-white/70`}>{lockedReason}</p>
      ) : null}

      {(answered || state.status === "checking") && !editing ? <Given task={task} state={state} indent={indent} /> : null}

      {state.status === "checking" ? (
        <CortexSays busy>
          <span className="inline-flex items-center gap-1.5">
            {task.input.type === "draft" ? "Drafting from your answers" : `Checking against the ${registry?.label ?? "registry"} rules`}
            <span className="inline-flex gap-0.5">
              <span className="size-1 animate-bounce rounded-full bg-white [animation-delay:-0.2s]" />
              <span className="size-1 animate-bounce rounded-full bg-white [animation-delay:-0.1s]" />
              <span className="size-1 animate-bounce rounded-full bg-white" />
            </span>
          </span>
        </CortexSays>
      ) : null}

      {answered && !editing && state.note ? (
        withCortex ? (
          <CortexSays tone={state.status === "flagged" ? "warn" : "ok"}>
            <span className="font-semibold">{state.status === "flagged" ? "Check this: " : "Looks right. "}</span>
            {state.note}
          </CortexSays>
        ) : (
          <p className="flex items-start gap-1.5 text-[12px] text-[#FFC48F]">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            {state.note}
          </p>
        )
      ) : null}

      {answered && !editing && !locked ? (
        <div className={`${indent} flex flex-wrap gap-2`}>
          {state.status === "flagged" && withCortex ? (
            <button
              type="button"
              onClick={() => accept(task.id)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[12px] font-semibold text-[#1B1846] hover:bg-[#E9E5FF]"
            >
              <Check className="size-3.5" />
              Accept as it is
            </button>
          ) : null}
          <button type="button" onClick={() => setEditing(true)} className={GHOST}>
            <RotateCcw className="size-3.5" />
            {task.input.type === "draft" ? "Draft again" : task.input.type === "file" ? "Replace files" : "Change answer"}
          </button>
        </div>
      ) : null}

      {showInput ? (
        <div className={`${indent} grid gap-2`}>
          <AnswerInput task={task} state={state} onSent={() => setEditing(false)} />
          {editing ? (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="justify-self-start text-[11.5px] font-semibold text-white/55 hover:text-white"
            >
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
