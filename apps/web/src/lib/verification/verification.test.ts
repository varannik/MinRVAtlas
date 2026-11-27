// JITI_TSCONFIG_PATHS=true node --import jiti/register --import ./loaders/node-test.mjs --test src/lib/verification/verification.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Sheet } from "@/lib/monitoring/table";
import { moduleOfPath, suggestPiece } from "./filing";
import { clausesIn, importIndex, moduleNumber } from "./index-import";

const HEADER = ["Audit type", "Module", "Evidence piece", "Description", "Instructions", "Associated requirements", "Remarks about evidence (from Supplier to Puro) - Submission #1", "Feedback about evidence (from Puro to Supplier) - Review #1"];

const FACILITY: Sheet = {
  name: "Facility Audit",
  rows: [
    HEADER,
    ["Facility Audit", "01. Administrative documents", "Trade registry extract of the CO2 Removal Supplier", "A certified extract.", "Provide a PDF.", "['2.1.1', '3.3.1', '3.3.5']", "Provided as Trade_Registry_Extract_2026.pdf", null],
    ["Facility Audit", null, "Host country authorisation", "The authorisation.", "", "['3.6.2']", "", null],
    ["Facility Audit", "06. Storage site", "Storage site description", "Describe the site.", "", "['3.2.6', '3.2.7', '3.2.11']", "", null],
    ["Facility Audit", null, "Legal framework governing storage site", "The legal framework.", "", "['3.2.11']", "", null],
    ["Facility Audit", "09. Life cycle assessment", "Life cycle assessment for Facility Audit", "The LCA.", "", "['4.5.1']", "", null],
  ],
};

const README: Sheet = { name: "README", rows: [["puro.earth — Audit Document Index"], [], ["Methodology — Geologically Stored Carbon, Edition 2024, Version 1"]] };

describe("importing Puro's Audit Document Index", () => {
  const { methodology, pieces } = importIndex([README, FACILITY, { name: "Output Audit", rows: [HEADER, ["Output Audit", "01. CORC Report", "CORC Report Summary", "", "", "['2.2.2']", "", null]] }]);

  it("reads every piece, carrying each module down, with its clauses and the supplier's remark", () => {
    assert.equal(methodology, "Geologically Stored Carbon, Edition 2024, Version 1");
    const facility = pieces.filter((piece) => piece.audit === "facility");
    assert.deepEqual(
      facility.map((piece) => [piece.moduleNumber, piece.name, piece.clauses.join(" ")]),
      [
        ["01", "Trade registry extract of the CO2 Removal Supplier", "2.1.1 3.3.1 3.3.5"],
        ["01", "Host country authorisation", "3.6.2"],
        ["06", "Storage site description", "3.2.6 3.2.7 3.2.11"],
        ["06", "Legal framework governing storage site", "3.2.11"],
        ["09", "Life cycle assessment for Facility Audit", "4.5.1"],
      ],
    );
    assert.equal(facility[0].supplierRemark, "Provided as Trade_Registry_Extract_2026.pdf");
    assert.equal(facility[2].id, "facility-06-storage-site-description");
    assert.deepEqual(pieces.filter((piece) => piece.audit === "output").map((piece) => piece.id), ["output-01-corc-report-summary"]);
  });

  it("reads clause lists and module numbers as the Index writes them", () => {
    assert.deepEqual(clausesIn("['3.2.8', '3.2.9', '7.5.1', '3.9']"), ["3.2.8", "3.2.9", "7.5.1", "3.9"]);
    assert.equal(moduleNumber("04.1 Biomass sourcing"), "04.1");
    assert.equal(moduleNumber("06. Storage site"), "06");
  });

  it("suggests where a submitted file belongs, and says why", () => {
    const facility = pieces.filter((piece) => piece.audit === "facility");
    assert.deepEqual(suggestPiece({ path: "01. Administrative documents/Trade_Registry_Extract_2026.pdf", name: "Trade_Registry_Extract_2026.pdf" }, facility), {
      pieceId: "facility-01-trade-registry-extract-of-the-co2-removal-supplier",
      why: "named in the supplier's remark",
    });
    assert.equal(suggestPiece({ path: "09. Life cycle assessment/model.xlsm", name: "model.xlsm" }, facility)?.why, "only piece in its module");
    assert.deepEqual(suggestPiece({ path: "06. Storage Site/Legal framework/permit decree.pdf", name: "permit decree.pdf" }, facility), {
      pieceId: "facility-06-legal-framework-governing-storage-site",
      why: "best match in its module",
    });
    assert.equal(suggestPiece({ path: "README.pdf", name: "README.pdf" }, facility), null);
    assert.equal(moduleOfPath("04. Capture site/4.1 Biomass/forms.pdf"), "04");
    assert.equal(moduleOfPath("6. Storage/x.pdf"), "06");
  });
});
