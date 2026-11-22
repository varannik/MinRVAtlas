// JITI_TSCONFIG_PATHS=true node --import jiti/register --import ./loaders/node-test.mjs --test src/lib/cortex/upload-client.test.ts
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { fileInCortex } from "./upload-client";

const TARGET = { projectId: "fujairah-mineral", pin: "evidence" };
const realFetch = globalThis.fetch;
let sent: { url: string; body: Record<string, unknown> }[] = [];

function answer(status: number, body: Record<string, unknown>) {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  sent = [];
});

describe("filing a journey document in Cortex", () => {
  it("keeps a spreadsheet by name and fingerprint, without asking Cortex", async () => {
    answer(500, {});
    const filed = await fileInCortex(new File(["a,b"], "tickets.xlsx"), TARGET, () => {});
    assert.equal(filed.key, undefined);
    assert.match(filed.sha256, /^[A-Za-z0-9+/]{43}=$/);
    assert.equal(sent.length, 0);
  });

  it("asks never to replace a document of the same name", async () => {
    answer(409, { error: "Evidence already has a different kyc.pdf.", reason: "name_taken", key: "k" });
    await assert.rejects(fileInCortex(new File(["%PDF"], "kyc.pdf"), TARGET, () => {}), /already has a different kyc\.pdf/);
    assert.equal(sent[0].url, "/api/cortex/uploads");
    assert.equal(sent[0].body.replace, false);
    assert.equal(sent[0].body.pin, "evidence");
  });

  it("files a document Cortex already has as that document", async () => {
    const key = "tenants/fourfourone/projects/fujairah-mineral/evidence/KYC_pack.pdf";
    answer(409, { error: "already in Cortex", reason: "duplicate", key, name: "KYC_pack.pdf" });
    const filed = await fileInCortex(new File(["%PDF"], "kyc.pdf"), TARGET, () => {});
    assert.deepEqual([filed.key, filed.alreadyAs, filed.name], [key, "KYC_pack.pdf", "kyc.pdf"]);
  });
});
