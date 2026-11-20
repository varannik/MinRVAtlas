/**
 * Asking Cortex: what the browser sends, and the events the answer streams back.
 *
 * Pure functions, used by the browser and by /api/cortex/ask. The answer comes
 * from the Cortex agent (apps/cortex-agent) as server-sent events, one JSON
 * object each; the route passes them through unchanged.
 */

export const MAX_QUESTION_CHARS = 4000;
/** Same rule as the agent (cortex_agent/main.py). A browser UUID fits it. */
export const CONVERSATION_ID = /^[A-Za-z0-9-]{16,64}$/;

/** A passage Cortex read, with where it comes from. */
export interface AskSource {
  id: string;
  document: string;
  clause_ref: string | null;
  section: string | null;
  page: number | null;
  scope: string | null;
  excerpt: string;
}

export type AskEvent =
  | { type: "status"; text: string }
  | { type: "sources"; query?: string; sources: AskSource[] }
  | { type: "text"; text: string }
  | { type: "reset" }
  | { type: "done"; turn: number; cited: string[] }
  | { type: "error"; message: string };

const TYPES = new Set(["status", "sources", "text", "reset", "done", "error"]);

export function questionProblem(question: string): string | null {
  const text = question.trim();
  if (!text) return "Ask a question.";
  if (text.length > MAX_QUESTION_CHARS) return `Keep the question under ${MAX_QUESTION_CHARS} characters.`;
  return null;
}

/**
 * Events in a block of server-sent-event text, and the unfinished tail to carry
 * into the next block. Comment lines (keep-alives) and unknown events are skipped.
 */
export function readEvents(buffer: string): { events: AskEvent[]; rest: string } {
  const normalised = buffer.replace(/\r\n?/g, "\n");
  const blocks = normalised.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: AskEvent[] = [];
  for (const block of blocks) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    try {
      const event = JSON.parse(data) as AskEvent;
      if (event && typeof event === "object" && TYPES.has(event.type)) events.push(event);
    } catch {
      // Not JSON: not one of ours.
    }
  }
  return { events, rest };
}

/** Where to call an AgentCore runtime with a user's access token. */
export function runtimeInvocationUrl(runtimeArn: string): string {
  const match = /^arn:aws:bedrock-agentcore:([a-z0-9-]+):\d{12}:runtime\/[A-Za-z0-9_-]+$/.exec(runtimeArn);
  if (!match) throw new Error("Not an AgentCore runtime ARN.");
  return `https://bedrock-agentcore.${match[1]}.amazonaws.com/runtimes/${encodeURIComponent(runtimeArn)}/invocations?qualifier=DEFAULT`;
}

/** "Rule 2.2.2 · p. 13 · Geologically_Stored_Carbon_2024_5.pdf" (a long file name is what gets cut short). */
export function sourceLabel(source: AskSource): string {
  const rule = source.clause_ref ? `Rule ${source.clause_ref}` : (source.section ?? "Passage");
  return `${rule}${source.page ? ` · p. ${source.page}` : ""} · ${source.document}`;
}

export const SCOPE_LABEL: Record<string, string> = {
  shared: "Registry",
  tenant: "Organisation",
  project: "Project",
};
