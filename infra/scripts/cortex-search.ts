/**
 * Knowledge check (blueprint phase 2): ask knowledge___search questions with
 * known answers, as a user working on a project, and check each answer comes
 * back from the right document with the expected wording.
 *
 *   CORTEX_TEST_EMAIL=you@4401.earth make cortex-search
 *   CORTEX_SEARCH="your own question" make cortex-search      # one question, no checks
 *   GOLDEN=lib/cortex/golden/<file>.json make cortex-search    # another question set
 *
 * The document must already be ingested: uploaded to the intake bucket under
 * shared/<registry>/<methodology>/<edition>/, scanned, admitted and indexed.
 * Indexing runs a few minutes after the upload is admitted.
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { assertAccount, stageFromApp } from "./cortex-common";
import {
  Gateway,
  credentials,
  describe,
  record,
  runChecks,
  signIn,
  toolPayload,
} from "./cortex-mcp";

interface Golden {
  methodology: string;
  edition: string;
  project_id: string;
  document: string;
  /** clause: the rule that answers; also: other rules that state the same answer. */
  questions: Array<{ clause: string; also?: string[]; page?: number; question: string; expect: string[] }>;
}

interface Passage {
  text?: string;
  score?: number;
  scope?: string;
  doc_id?: string;
  clause_ref?: string | null;
  section?: string | null;
  page?: number | null;
  source?: string;
}

function cite(hit: Passage): string {
  return `clause ${hit.clause_ref ?? "(none)"}${hit.page ? ` p.${hit.page}` : ""}${hit.section ? ` (${hit.section})` : ""}`;
}

const DEFAULT_GOLDEN = "lib/cortex/golden/puro-geologically-stored-carbon-2024-v5.json";

function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A short window of the passage around the first expected phrase. */
function around(text: string, phrase: string): string {
  const body = flat(text);
  const at = body.toLowerCase().indexOf(phrase.toLowerCase());
  if (at < 0) return body.slice(0, 160);
  const start = Math.max(0, at - 80);
  return `${start > 0 ? "…" : ""}${body.slice(start, at + phrase.length + 80)}…`;
}

async function search(gateway: Gateway, query: string, projectId: string): Promise<Passage[] | string> {
  const reply = await gateway.call("tools/call", {
    name: "knowledge___search",
    arguments: { query, project_id: projectId, top_k: 5 },
  });
  const payload = toolPayload(reply);
  if (reply.error || !payload) return describe(reply);
  if (payload.error) return String(payload.error);
  return (payload.results as Passage[] | undefined) ?? [];
}

async function main(): Promise<void> {
  await assertAccount();
  const stage = stageFromApp();
  const golden = JSON.parse(
    readFileSync(path.resolve(__dirname, "..", process.env.GOLDEN ?? DEFAULT_GOLDEN), "utf8"),
  ) as Golden;
  const { email, password } = await credentials();
  const gateway = await Gateway.forStage(stage, await signIn(stage, email, password));
  const init = await gateway.initialize();
  if (init.status >= 400 || init.error) {
    record("Gateway accepts the token", false, describe(init));
    return;
  }

  const adHoc = (process.env.CORTEX_SEARCH ?? "").trim();
  if (adHoc) {
    const results = await search(gateway, adHoc, golden.project_id);
    if (typeof results === "string") {
      record("Search", false, results);
      return;
    }
    console.log(`"${adHoc}" for ${golden.project_id}: ${results.length} passage(s)`);
    for (const [i, hit] of results.entries()) {
      console.log(
        `\n#${i + 1} score=${hit.score?.toFixed(3)} scope=${hit.scope} ${path.basename(hit.source ?? "")} ${cite(hit)}`,
      );
      console.log(`   ${flat(hit.text ?? "").slice(0, 400)}`);
    }
    return;
  }

  console.log(
    `${golden.questions.length} known-answer questions for ${golden.project_id} ` +
      `(${golden.methodology} ${golden.edition}, from ${golden.document})\n`,
  );
  let empty = 0;
  for (const q of golden.questions) {
    const label = `${q.clause}${q.page ? ` (p.${q.page})` : ""}: ${q.question}`;
    const results = await search(gateway, q.question, golden.project_id);
    if (typeof results === "string") {
      record(label, false, results);
      continue;
    }
    if (results.length === 0) empty += 1;
    const fromDoc = results.filter((hit) => (hit.source ?? "").endsWith(`/${golden.document}`));
    const worded = fromDoc
      .map((hit) => ({ hit, phrase: q.expect.find((p) => flat(hit.text ?? "").toLowerCase().includes(p.toLowerCase())) }))
      .filter((candidate) => candidate.phrase);
    // The answer must be the right wording, cited to a rule that states it.
    const clauses = [q.clause, ...(q.also ?? [])];
    const match = worded.find((candidate) => clauses.includes(candidate.hit.clause_ref ?? ""));
    if (match?.phrase) {
      const rank = results.indexOf(match.hit) + 1;
      record(label, true, `rank ${rank}/${results.length}, score ${match.hit.score?.toFixed(3)}, ${cite(match.hit)}`);
      console.log(`       "${around(match.hit.text ?? "", match.phrase)}"`);
      console.log(`       source ${match.hit.source}  doc ${match.hit.doc_id}`);
    } else {
      const reason =
        results.length === 0
          ? "no passages"
          : worded.length > 0
            ? `the wording comes back, but cited as ${worded.map((w) => cite(w.hit)).join("; ")}, not clause ${clauses.join(" or ")}`
            : `${results.length} passage(s), ${fromDoc.length} from ${golden.document}, none mention ${q.expect.join(" / ")}`;
      record(label, false, reason);
      for (const hit of results.slice(0, 2)) {
        console.log(`       ${cite(hit)}: ${flat(hit.text ?? "").slice(0, 160)}…`);
      }
    }
  }
  if (empty === golden.questions.length) {
    console.log(
      "\nNo passages at all: the document is probably not indexed yet (indexing starts after it is admitted and takes a few minutes), " +
        `or it was not uploaded under shared/<registry>/${golden.methodology}/${golden.edition}/.`,
    );
  }
}

runChecks(main);
