/**
 * Answer check: ask the Cortex agent the known-answer questions, as a user
 * working on a project, and check each answer cites the rule that answers it
 * and says what the rule says. The agent is the deployed runtime, or a local
 * one with CORTEX_AGENT_URL.
 *
 *   CORTEX_TEST_EMAIL=you@4401.earth make cortex-ask
 *   CORTEX_ASK="your own question" make cortex-ask        # one question, printed, no checks
 *   GOLDEN=lib/cortex/golden/<file>.json make cortex-ask  # another question set
 *   CORTEX_AGENT_URL=http://127.0.0.1:8080/invocations make cortex-ask
 *
 * make cortex-search checks retrieval alone; this checks what the person reads.
 */
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { REGION } from "../lib/config";
import { assertAccount, requireOutput, stackOutputs, stageFromApp } from "./cortex-common";
import { credentials, record, runChecks, signIn } from "./cortex-mcp";

interface Golden {
  methodology: string;
  edition: string;
  project_id: string;
  document: string;
  questions: Array<{ clause: string; also?: string[]; question: string; expect: string[] }>;
}

interface Source {
  id: string;
  document: string;
  clause_ref: string | null;
  page: number | null;
}

interface Answer {
  text: string;
  sources: Source[];
  cited: string[];
  statuses: string[];
  error?: string;
  seconds: number;
}

const DEFAULT_GOLDEN = "lib/cortex/golden/puro-geologically-stored-carbon-2024-v5.json";

async function agentUrl(): Promise<string> {
  const local = process.env.CORTEX_AGENT_URL?.trim();
  if (local) return local;
  const agent = await stackOutputs(stageFromApp(), "cortex-agent");
  const arn = agent.RuntimeArn;
  if (!arn) {
    throw new Error(
      "cortex-agent has no RuntimeArn output: no agent image has been deployed. " +
        "Run make deploy CORTEX_AGENT_IMAGE_TAG=<commit sha>, or set CORTEX_AGENT_URL for a local agent.",
    );
  }
  requireOutput(agent, "RuntimeArn", "cortex-agent");
  return `https://bedrock-agentcore.${REGION}.amazonaws.com/runtimes/${encodeURIComponent(arn)}/invocations?qualifier=DEFAULT`;
}

async function ask(url: string, token: string, projectId: string, question: string): Promise<Answer> {
  const started = Date.now();
  const conversationId = crypto.randomUUID();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": crypto.createHash("sha256").update(conversationId).digest("hex"),
    },
    body: JSON.stringify({ question, project_id: projectId, conversation_id: conversationId }),
  });
  const answer: Answer = { text: "", sources: [], cited: [], statuses: [], seconds: 0 };
  if (!response.ok) {
    answer.error = `HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`;
    return answer;
  }
  const raw = await response.text();
  for (const block of raw.replace(/\r\n/g, "\n").split("\n\n")) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");
    if (!data) continue;
    const event = JSON.parse(data) as Record<string, unknown>;
    if (event.type === "text") answer.text += String(event.text ?? "");
    else if (event.type === "reset") answer.text = "";
    else if (event.type === "status") answer.statuses.push(String(event.text ?? ""));
    else if (event.type === "sources") answer.sources.push(...((event.sources as Source[]) ?? []));
    else if (event.type === "done") answer.cited = (event.cited as string[]) ?? [];
    else if (event.type === "error") answer.error = String(event.message ?? "error");
  }
  answer.seconds = (Date.now() - started) / 1000;
  return answer;
}

function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function print(answer: Answer): void {
  for (const status of answer.statuses) console.log(`       … ${status}`);
  console.log(`       ${flat(answer.text).slice(0, 600)}`);
  const cited = new Set(answer.cited);
  for (const source of answer.sources.filter((s) => cited.has(s.id))) {
    console.log(`       cites rule ${source.clause_ref ?? "(none)"} ${source.document}${source.page ? ` p.${source.page}` : ""}`);
  }
}

async function main(): Promise<void> {
  await assertAccount();
  const stage = stageFromApp();
  const golden = JSON.parse(
    readFileSync(path.resolve(__dirname, "..", process.env.GOLDEN ?? DEFAULT_GOLDEN), "utf8"),
  ) as Golden;
  const url = await agentUrl();
  const { email, password } = await credentials();
  const token = await signIn(stage, email, password);

  const adHoc = (process.env.CORTEX_ASK ?? "").trim();
  if (adHoc) {
    const answer = await ask(url, token, golden.project_id, adHoc);
    if (answer.error) record("Ask", false, answer.error);
    else console.log(`"${adHoc}" (${answer.seconds.toFixed(1)}s)`);
    print(answer);
    return;
  }

  console.log(
    `${golden.questions.length} known-answer questions to the Cortex agent for ${golden.project_id} ` +
      `(${golden.methodology} ${golden.edition})\n`,
  );
  for (const q of golden.questions) {
    const label = `${q.clause}: ${q.question}`;
    const answer = await ask(url, token, golden.project_id, q.question);
    if (answer.error) {
      record(label, false, answer.error);
      continue;
    }
    const clauses = new Set([q.clause, ...(q.also ?? [])]);
    const cited = new Set(answer.cited);
    const citesRule = answer.sources.some(
      (source) => cited.has(source.id) && clauses.has(source.clause_ref ?? "") && source.document === golden.document,
    );
    const phrase = q.expect.find((p) => flat(answer.text).toLowerCase().includes(p.toLowerCase()));
    const ok = citesRule && Boolean(phrase);
    const why = ok
      ? `cites rule ${[...clauses].join(" or ")} and says "${phrase}" (${answer.seconds.toFixed(1)}s)`
      : !citesRule
        ? `does not cite rule ${[...clauses].join(" or ")} of ${golden.document}`
        : `cites the rule but never says ${q.expect.join(" / ")}`;
    record(label, ok, why);
    print(answer);
  }
}

runChecks(main);
