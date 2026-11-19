// node --import jiti/register --test src/lib/cortex/uploads.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DOCUMENT_PINS,
  MAX_UPLOAD_BYTES,
  allowedProjects,
  canUploadAs,
  documentKey,
  documentStatus,
  safeFileName,
  sameDocument,
  uploadProblem,
  uploadType,
} from "./uploads";

describe("which files Cortex takes", () => {
  it("takes PDF and Word documents up to the size limit", () => {
    assert.equal(uploadProblem({ name: "Monitoring Plan.PDF", size: 2_000_000 }), null);
    assert.equal(uploadType("plan.docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    assert.match(uploadProblem({ name: "readings.csv", size: 10 }) ?? "", /PDF, DOCX, DOC/);
    assert.match(uploadProblem({ name: "big.pdf", size: MAX_UPLOAD_BYTES + 1 }) ?? "", /Larger than 100 MB/);
    assert.match(uploadProblem({ name: "empty.pdf", size: 0 }) ?? "", /empty/);
  });

  it("only pins with a document intake take documents", () => {
    assert.ok(DOCUMENT_PINS.has("evidence"));
    assert.ok(DOCUMENT_PINS.has("knowledge"));
    assert.ok(!DOCUMENT_PINS.has("anomaly"));
  });

  it("viewers read Cortex but do not add to it", () => {
    assert.ok(canUploadAs("operator"));
    assert.ok(!canUploadAs("viewer"));
    assert.ok(!canUploadAs("anyone"));
  });
});

describe("where an upload goes", () => {
  it("keeps the project's documents under its own prefix, by pin", () => {
    assert.equal(
      documentKey("fourfourone", "fujairah-mineral", "evidence", "Q3 CO₂ purity certificate (SGS).pdf"),
      "tenants/fourfourone/projects/fujairah-mineral/evidence/Q3_CO2_purity_certificate_(SGS).pdf",
    );
  });

  it("a file with the same name once made safe replaces the existing document", () => {
    const documents = [{ name: "Monitoring_Plan_v2.pdf" }, { name: "Lab.pdf" }];
    assert.equal(sameDocument("Monitoring Plan v2.pdf", documents)?.name, "Monitoring_Plan_v2.pdf");
    assert.equal(sameDocument("Monitoring_Plan_v3.pdf", documents), undefined);
  });

  it("drops folders and anything that could change the key", () => {
    assert.equal(safeFileName("../../shared/puro/x/2024/evil.pdf"), "evil.pdf");
    assert.equal(safeFileName("C:\\Users\\me\\Plan v2.docx"), "Plan_v2.docx");
    assert.equal(safeFileName("Café ñ report.pdf"), "Cafe_n_report.pdf");
    assert.equal(safeFileName("....pdf"), "document.pdf");
  });

  it("refuses ids that are not tenancy ids and pins without documents", () => {
    assert.throws(() => documentKey("Four/One", "fujairah-mineral", "evidence", "a.pdf"));
    assert.throws(() => documentKey("fourfourone", "../other", "evidence", "a.pdf"));
    assert.throws(() => documentKey("fourfourone", "fujairah-mineral", "anomaly", "a.pdf"));
  });
});

describe("who may work on which project", () => {
  it("tenant-wide roles see every project, others only their grants", () => {
    const tenant = ["fujairah-mineral", "oman-basalt"];
    assert.deepEqual(allowedProjects("tenant_admin", tenant, []), ["fujairah-mineral", "oman-basalt"]);
    assert.deepEqual(allowedProjects("operator", tenant, ["oman-basalt"]), ["oman-basalt"]);
    // A grant for a project the tenant no longer has does not count.
    assert.deepEqual(allowedProjects("operator", tenant, ["gone"]), []);
  });
});

describe("how far an upload has got", () => {
  const now = new Date("2026-11-19T10:00:00Z");
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  it("is being scanned until GuardDuty tags it", () => {
    assert.equal(documentStatus({ intakeAt: minutesAgo(1), now }).status, "scanning");
    assert.equal(documentStatus({ intakeAt: minutesAgo(1), scan: "NO_THREATS_FOUND", now }).status, "admitting");
  });

  it("is in Cortex once admitted, unless a newer upload is waiting", () => {
    assert.equal(documentStatus({ intakeAt: minutesAgo(5), admittedAt: minutesAgo(4), now }).status, "in_cortex");
    assert.equal(documentStatus({ admittedAt: minutesAgo(60 * 24 * 40), now }).status, "in_cortex");
    assert.equal(documentStatus({ intakeAt: minutesAgo(1), admittedAt: minutesAgo(60), now }).status, "scanning");
  });

  it("says why it was not admitted", () => {
    assert.match(documentStatus({ intakeAt: minutesAgo(2), scan: "THREATS_FOUND", now }).detail, /threat/);
    assert.equal(documentStatus({ intakeAt: minutesAgo(2), scan: "UNSUPPORTED", now }).status, "rejected");
    assert.equal(documentStatus({ intakeAt: minutesAgo(20), scan: "NO_THREATS_FOUND", now }).status, "rejected");
    assert.equal(documentStatus({ intakeAt: minutesAgo(45), now }).status, "rejected");
  });
});
