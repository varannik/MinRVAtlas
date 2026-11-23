"use client";

import { create } from "zustand";

import type { AskSource } from "@/lib/cortex/ask";
import type { CapabilityId, IntakeKind } from "@/lib/cortex/capabilities";

/** One question to Cortex and its answer as it streams in. */
export interface ChatTurn {
  id: string;
  question: string;
  answer: string;
  /** What Cortex is doing while it works ("Searching: …"). */
  status: string | null;
  sources: AskSource[];
  cited: string[];
  state: "asking" | "done" | "error";
  error?: string;
}

/** A conversation with Cortex about one project. Its history lives with the agent. */
export interface Chat {
  conversationId: string;
  turns: ChatTurn[];
}

/**
 * Data files and details the operator has given Cortex but not sent yet,
 * kept on the server per person (/api/cortex/staged, the Atlas table) until
 * their backend exists (documents are uploaded; see document-intake.tsx).
 * File contents are never stored, only their description.
 */
export interface StagedItem {
  id: string;
  capabilityId: CapabilityId;
  kind: IntakeKind;
  name: string;
  size?: number;
  mime?: string;
  fields?: Record<string, string>;
  addedAt: string;
}

type Focus = CapabilityId | "core" | null;

type CortexState = {
  selected: Focus;
  hovered: Focus;
  staged: StagedItem[];
  /** Whether the staged list has been read from the server yet. */
  stagedLoaded: boolean;
  /** Read the staged list from the server, once per page. */
  loadStaged: () => Promise<void>;
  /** Cortex project that documents are sent to (from the tenancy table); this page only, the first project otherwise. */
  projectId: string | null;
  select: (focus: Focus) => void;
  setProject: (projectId: string) => void;
  hover: (focus: Focus) => void;
  stageFiles: (capabilityId: CapabilityId, kind: IntakeKind, files: File[]) => void;
  stageMetadata: (
    capabilityId: CapabilityId,
    name: string,
    fields: Record<string, string>,
  ) => void;
  unstage: (id: string) => void;
  /** Conversations by project, for this page visit only (not stored in the browser). */
  chats: Record<string, Chat>;
  askStarted: (projectId: string, turn: ChatTurn) => void;
  askUpdated: (projectId: string, turnId: string, change: (turn: ChatTurn) => ChatTurn) => void;
  newChat: (projectId: string) => void;
};

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Sends one change of the staged list and takes the server's list back. */
async function sendStaged(body: { add: StagedItem[] } | { remove: string }): Promise<StagedItem[] | null> {
  try {
    const response = await fetch("/api/cortex/staged", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return ((await response.json()) as { items?: StagedItem[] }).items ?? null;
  } catch {
    return null;
  }
}

export const useCortex = create<CortexState>()(
  (set, get) => {
    /** Shows the change at once, then the list as the server holds it (or as it was, if the server refused). */
    const changeStaged = (next: StagedItem[], body: { add: StagedItem[] } | { remove: string }) => {
      const before = get().staged;
      set({ staged: next });
      void sendStaged(body).then((items) => set({ staged: items ?? before }));
    };
    return {
      selected: null,
      hovered: null,
      staged: [],
      stagedLoaded: false,
      loadStaged: async () => {
        if (get().stagedLoaded) return;
        set({ stagedLoaded: true });
        try {
          const response = await fetch("/api/cortex/staged", { cache: "no-store" });
          if (response.ok) set({ staged: ((await response.json()) as { items?: StagedItem[] }).items ?? [] });
        } catch {
          set({ stagedLoaded: false });
        }
      },
      projectId: null,
      select: (focus) => set({ selected: focus }),
      setProject: (projectId) => set({ projectId }),
      hover: (focus) => set({ hovered: focus }),
      stageFiles: (capabilityId, kind, files) => {
        const added: StagedItem[] = files.map((file) => ({
          id: newId(),
          capabilityId,
          kind,
          name: file.name,
          size: file.size,
          mime: file.type || undefined,
          addedAt: new Date().toISOString(),
        }));
        changeStaged([...added, ...get().staged], { add: added });
      },
      stageMetadata: (capabilityId, name, fields) => {
        const added: StagedItem[] = [{ id: newId(), capabilityId, kind: "metadata", name, fields, addedAt: new Date().toISOString() }];
        changeStaged([...added, ...get().staged], { add: added });
      },
      unstage: (id) => changeStaged(get().staged.filter((item) => item.id !== id), { remove: id }),
      chats: {},
      askStarted: (projectId, turn) =>
        set((state) => {
          const chat = state.chats[projectId] ?? { conversationId: newId(), turns: [] };
          return { chats: { ...state.chats, [projectId]: { ...chat, turns: [...chat.turns, turn] } } };
        }),
      askUpdated: (projectId, turnId, change) =>
        set((state) => {
          const chat = state.chats[projectId];
          if (!chat) return {};
          const turns = chat.turns.map((turn) => (turn.id === turnId ? change(turn) : turn));
          return { chats: { ...state.chats, [projectId]: { ...chat, turns } } };
        }),
      newChat: (projectId) =>
        set((state) => ({
          chats: { ...state.chats, [projectId]: { conversationId: newId(), turns: [] } },
        })),
    };
  },
);

export function stagedFor(staged: StagedItem[], capabilityId: CapabilityId): StagedItem[] {
  return staged.filter((item) => item.capabilityId === capabilityId);
}
