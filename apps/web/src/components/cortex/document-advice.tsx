"use client";

import { useEffect, useState } from "react";
import { CirclePause, FolderInput, LoaderCircle } from "lucide-react";

import { isHeld, type Advice, type CortexDocument, type DocumentScope } from "@/lib/cortex/uploads";
import { readJson } from "./cortex-projects";

/**
 * What Cortex suggests for one document, and the person's answer. Cortex labels every
 * document it admits (Claude reads the opening pages): a document that is not MRV
 * material, or is a copy of one already searched, is held out of search; one on the
 * wrong pin gets a move. Nothing changes until someone decides.
 */

const BUTTON =
  "h-7 rounded-md px-2.5 text-[11.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rock disabled:opacity-50";

export type Doing = "keep" | "stay" | "move";

const DOING: Record<Doing, string> = {
  keep: "Putting it into search…",
  stay: "Keeping it here…",
  move: "Moving it. It is scanned and read again at its new place…",
};

interface Acting {
  doing: Doing;
  error?: string;
}

/** Whether what was asked has shown up in the list: then the panel can go. */
function done(doing: Doing, doc: CortexDocument | undefined): boolean {
  if (!doc) return true;
  if (doing === "keep") return !isHeld(doc.label);
  if (doing === "stay") return Boolean(doc.label?.placementKept);
  return false; // a move ends when the document leaves this place
}

/**
 * Decisions and moves on the documents of one list. `pending` keeps the list polling
 * until each request has shown up in it.
 */
export function useDocumentActions(documents: readonly CortexDocument[] | null, onSent: () => void) {
  const [acting, setActing] = useState<Record<string, Acting>>({});

  useEffect(() => {
    if (!documents) return;
    setActing((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(
          ([key, entry]) => entry.error || !done(entry.doing, documents.find((doc) => doc.key === key)),
        ),
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [documents]);

  const act = async (
    doc: CortexDocument,
    request: { project: string; pin: string; name: string; scope: DocumentScope },
    doing: Doing,
    to?: { pin: string; scope: DocumentScope },
  ) => {
    setActing((current) => ({ ...current, [doc.key]: { doing } }));
    try {
      await readJson(
        await fetch("/api/cortex/documents", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...request, action: doing, toPin: to?.pin, toScope: to?.scope }),
        }),
      );
      onSent();
    } catch (failure) {
      setActing((current) => ({ ...current, [doc.key]: { doing, error: (failure as Error).message } }));
    }
  };

  const pending = Object.values(acting).some((entry) => !entry.error);
  return { acting, act, pending };
}

export function DocumentAdvice({
  advice,
  acting,
  onKeep,
  onStay,
  onMove,
  onRemove,
  who,
}: {
  advice: Advice;
  acting?: Acting;
  onKeep: () => void;
  onStay: () => void;
  onMove: () => void;
  /** Opens the removal confirmation; absent when the user may not remove it. */
  onRemove?: () => void;
  /** Who can decide, when this user cannot: "An organisation admin". */
  who: string;
}) {
  const held = advice.kind === "held";
  const Icon = held ? CirclePause : FolderInput;
  const busy = acting && !acting.error;
  return (
    <div
      className={`grid gap-2 rounded-md px-2.5 py-2 text-[11.5px] leading-snug ${
        held ? "bg-[#FBF0D9] text-[#5C3A00]" : "bg-[#EEE9FD] text-[#2B1F66]"
      }`}
      role="note"
    >
      <p className="flex items-start gap-1.5">
        <Icon className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>{advice.text}</span>
      </p>
      {busy ? (
        <p className="flex items-center gap-1.5 font-medium" role="status">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
          {DOING[acting.doing]}
        </p>
      ) : advice.canDecide ? (
        <div className="flex flex-wrap gap-1.5">
          {held ? (
            <>
              <button type="button" onClick={onKeep} className={`${BUTTON} bg-rock text-white hover:bg-rock/85`}>
                Keep in Cortex
              </button>
              {onRemove && (
                <button type="button" onClick={onRemove} className={`${BUTTON} border border-current/25 hover:bg-white/60`}>
                  Remove
                </button>
              )}
            </>
          ) : (
            <>
              <button type="button" onClick={onMove} className={`${BUTTON} bg-rock text-white hover:bg-rock/85`}>
                {advice.action}
              </button>
              <button type="button" onClick={onStay} className={`${BUTTON} border border-current/25 hover:bg-white/60`}>
                Keep here
              </button>
            </>
          )}
        </div>
      ) : (
        <p className="opacity-80">{who} can decide.</p>
      )}
      {acting?.error && (
        <p className="text-signal-rose" role="alert">
          Not done: {acting.error}
        </p>
      )}
    </div>
  );
}
