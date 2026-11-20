import assert from "node:assert/strict";
import { test } from "node:test";

import { questionProblem, readEvents, runtimeInvocationUrl, sourceLabel, type AskSource } from "./ask";

test("readEvents parses complete events and carries the unfinished tail", () => {
  const first = readEvents('data: {"type":"status","text":"Searching"}\n\ndata: {"type":"te');
  assert.deepEqual(first.events, [{ type: "status", text: "Searching" }]);
  const second = readEvents(`${first.rest}xt","text":"15 years"}\n\n`);
  assert.deepEqual(second.events, [{ type: "text", text: "15 years" }]);
  assert.equal(second.rest, "");
});

test("readEvents skips keep-alives, unknown types and broken JSON", () => {
  const { events } = readEvents(': keep-alive\n\ndata: {"type":"_usage"}\n\ndata: {oops\n\r\ndata: {"type":"reset"}\r\n\r\n');
  assert.deepEqual(events, [{ type: "reset" }]);
});

test("questionProblem refuses empty and very long questions", () => {
  assert.equal(questionProblem("  "), "Ask a question.");
  assert.match(questionProblem("q".repeat(4001)) ?? "", /under 4000/);
  assert.equal(questionProblem("How long is the crediting period?"), null);
});

test("runtimeInvocationUrl escapes the ARN and takes the region from it", () => {
  const url = runtimeInvocationUrl("arn:aws:bedrock-agentcore:eu-west-2:625239230739:runtime/minrv_ew2_sandbox_cortex-AbC123xyz0");
  assert.equal(
    url,
    "https://bedrock-agentcore.eu-west-2.amazonaws.com/runtimes/arn%3Aaws%3Abedrock-agentcore%3Aeu-west-2%3A625239230739%3Aruntime%2Fminrv_ew2_sandbox_cortex-AbC123xyz0/invocations?qualifier=DEFAULT",
  );
  assert.throws(() => runtimeInvocationUrl("https://example.com"));
});

test("sourceLabel names the rule, page and file", () => {
  const source: AskSource = {
    id: "d#2.2.2#13",
    document: "Geologically_Stored_Carbon_2024_5.pdf",
    clause_ref: "2.2.2",
    section: "2.2 Crediting period",
    page: 13,
    scope: "shared",
    excerpt: "",
  };
  assert.equal(sourceLabel(source), "Rule 2.2.2 · p. 13 · Geologically_Stored_Carbon_2024_5.pdf");
  assert.equal(sourceLabel({ ...source, clause_ref: null, page: null }), "2.2 Crediting period · Geologically_Stored_Carbon_2024_5.pdf");
});
