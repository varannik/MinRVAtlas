// node --import jiti/register --test src/lib/cortex/uploads.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DOCUMENT_PINS,
  MAX_UPLOAD_BYTES,
  allowedProjects,
  canShareAcrossOrganisation,
  canUploadAs,
  documentKey,
  documentPlace,
  documentStatus,
  duplicateNames,
  isSha256,
  organisationPrefix,
  pinAndName,
  safeFileName,
  sameDocument,
  searchesShared,
  sharedPlace,
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

describe("documents for the whole organisation", () => {
  it("go under the tenant, for method and rule pins only", () => {
    assert.equal(
      documentKey("fourfourone", "fujairah-mineral", "protocols", "Sampling SOP.pdf", "tenant"),
      "tenants/fourfourone/tenant/protocols/Sampling_SOP.pdf",
    );
    assert.equal(organisationPrefix("fourfourone", "knowledge"), "tenants/fourfourone/tenant/knowledge/");
    assert.throws(() => organisationPrefix("fourfourone", "evidence"), /only takes project documents/);
    assert.throws(() => organisationPrefix("../other", "knowledge"), /Unknown tenant/);
  });

  it("are added and removed by admins only", () => {
    assert.equal(canShareAcrossOrganisation("tenant_admin"), true);
    assert.equal(canShareAcrossOrganisation("platform_admin"), true);
    assert.equal(canShareAcrossOrganisation("quality_engineer"), false);
    assert.equal(canShareAcrossOrganisation("operator"), false);
  });
});

describe("what a project searches", () => {
  const project = { methodology: "puro-geologically-stored-carbon", edition: "2024-v5" };

  it("reads a registry document's place from its key", () => {
    assert.deepEqual(sharedPlace("shared/puro/puro-geologically-stored-carbon/2024-v5/GSC.pdf"), {
      registry: "puro",
      methodology: "puro-geologically-stored-carbon",
      edition: "2024-v5",
      name: "GSC.pdf",
    });
    assert.equal(sharedPlace("shared/puro/GSC.pdf"), null);
    assert.equal(sharedPlace("tenants/x/tenant/a.pdf"), null);
  });

  it("includes registry documents for its methodology and edition, or filed under any", () => {
    assert.equal(searchesShared(project, { methodology: "puro-geologically-stored-carbon", edition: "2024-v5" }), true);
    assert.equal(searchesShared(project, { methodology: "any", edition: "any" }), true);
    assert.equal(searchesShared(project, { methodology: "puro-geologically-stored-carbon", edition: "2023-v4" }), false);
    assert.equal(searchesShared(project, { methodology: "isometric-bioccs", edition: "any" }), false);
    assert.equal(searchesShared({}, { methodology: "isometric-bioccs", edition: "v1.5" }), true);
  });

  it("splits the pin from the file name", () => {
    assert.deepEqual(pinAndName("knowledge/General_Rules_4_4.pdf"), { pin: "knowledge", name: "General_Rules_4_4.pdf" });
    assert.deepEqual(pinAndName("Policy.pdf"), { pin: null, name: "Policy.pdf" });
  });

  it("finds a file given twice", () => {
    assert.deepEqual(
      [...duplicateNames(["General_Rules_4_4.pdf", "GSC.pdf", "general_rules_4_4.pdf"])],
      ["general_rules_4_4.pdf"],
    );
  });
});

describe("duplicates", () => {
  it("accepts only a base64 SHA-256", () => {
    assert.equal(isSha256("X8OrcflKmD6B52ogUUDXmQaZB9qpE8fM4HeKl9U+aUU="), true);
    assert.equal(isSha256("X8OrcflKmD6B52ogUUDXmQaZB9qpE8fM4HeKl9U+aUU"), false);
    assert.equal(isSha256("5fc3ab71f94a983e81e76a2051"), false);
    assert.equal(isSha256(undefined), false);
  });

  it("says where a document already is", () => {
    assert.equal(
      documentPlace({ scope: "project", pin: "protocols" }, "Fujairah"),
      "the Protocols pin of Fujairah",
    );
    assert.equal(documentPlace({ scope: "tenant", pin: "knowledge" }, "Fujairah"), "your organisation's Knowledge documents");
    assert.equal(
      documentPlace({ scope: "shared", pin: null, methodology: "puro-geologically-stored-carbon", edition: "2024-v5" }, "Fujairah"),
      "the registry documents (puro-geologically-stored-carbon 2024-v5)",
    );
  });
});
