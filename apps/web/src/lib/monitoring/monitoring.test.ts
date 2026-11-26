// JITI_ALIAS='{"server-only": "<abs>/node_modules/server-only/empty.js"}' JITI_TSCONFIG_PATHS=true node --import jiti/register --import ./loaders/node-test.mjs --test src/lib/monitoring/monitoring.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deflateRawSync } from "node:zlib";

import { applyMapping, approvedFor, cleanEntries, tableRange, type TagMap } from "./mapping";
import { suggestMetric, suggestScale, monitoringMetric } from "./metrics";
import { mergeDay } from "./stream-write.server";
import { cellDay, readSheets, readTable, type Sheet, type SourceTable } from "./table";
import { readXlsx } from "./xlsx.server";

// Excel serials for 17, 18 and 19 Jul 2026.
const D17 = 46220;
const DAILY: Sheet = {
  name: "Holcim",
  rows: [
    ["Date", "Captured in t- FT_0209_Totalizer", "CCU_Energy_Consumed in kwh"],
    [D17, 50, 1000],
    [D17 + 1, 60, 1100],
    [D17 + 2, 55, 900],
    [null, 165, 3000],
  ],
};

function table(sheet: Sheet): SourceTable {
  const read = readTable(sheet);
  assert.ok(!("reason" in read));
  return read;
}

describe("reading a site's spreadsheet", () => {
  it("finds the dates, the header above them and the columns of numbers, and leaves out the total row", () => {
    const read = table(DAILY);
    assert.equal(read.dateHeader, "Date");
    assert.deepEqual(read.rows.map((row) => row.day), ["2026-07-17", "2026-07-18", "2026-07-19"]);
    assert.deepEqual(read.columns.map((column) => [column.header, column.tags]), [
      ["Captured in t- FT_0209_Totalizer", ["FT_0209_Totalizer"]],
      ["CCU_Energy_Consumed in kwh", ["CCU_Energy_Consumed"]],
    ]);
    assert.equal(read.undated, 1);
  });

  it("keeps group labels out, and leaves a summary sheet whose timestamps fall on one day", () => {
    const deliveries: Sheet = { name: "Filling+loading", rows: [["Date", "In Tonne"], ["Gulf"], [D17, 22.4], [D17 + 3, 21.9], [D17 + 9, 23.1]] };
    const summary: Sheet = { name: "ace", rows: [["Tag", "first_value", "first_value_timestamp"], ["FT_07", 1.2, D17], ["FT_03", 3.4, D17], ["FT_04", 5.6, D17]] };
    const { tables, skipped } = readSheets([deliveries, summary]);
    assert.deepEqual(tables.map((t) => [t.sheet, t.rows.length, t.labels]), [["Filling+loading", 3, ["Gulf"]]]);
    assert.deepEqual(skipped.map((s) => s.sheet), ["ace"]);
  });

  it("reads dates the way sites write them", () => {
    assert.equal(cellDay(D17), "2026-07-17");
    assert.equal(cellDay("2026-07-17T05:15:00"), "2026-07-17");
    assert.equal(cellDay("17/07/2026"), "2026-07-17");
    assert.equal(cellDay("31/02/2026"), null);
    assert.equal(cellDay(D17 + 0.5), null);
  });
});

describe("suggesting metrics from Fujairah's headers", () => {
  const cases: [string, string | null][] = [
    ["Captured in t- FT_0209_Totalizer", "CO2_CAPTURED_t"],
    ["Liquified in t- (TOT_FTM_ST_01 - TOT_FTM_CL_01)", "CO2_LIQUEFIED_t"],
    ["TOT_FTM_ST_01", null],
    ["Liqufied Energy in kwh- Energy_Consumed", "ENERGY_LIQUEFACTION_kWh"],
    ["CCU_Energy_Consumed in kwh", "ENERGY_CAPTURE_kWh"],
    ["Tracer in t - FT_07_Totalizer_Total", "TRACER_INJECTED_t"],
    ["water in t -FT_03_Totalizer_Total", "WATER_INJECTED_t"],
    ["Total CO2 Injected in t - (FT_04_Totalizer_Total + FT_05_Totalizer_Total)", "CO2_INJECTED_t"],
    ["Total_Energy_Consumption in kwh", "ENERGY_INJECTION_kWh"],
    ["In Tonne", "LCO2_DELIVERED_t"],
  ];
  for (const [header, metric] of cases) {
    it(`${header} → ${metric ?? "nothing"}`, () => assert.equal(suggestMetric(header)?.id ?? null, metric));
  }

  it("reads a kg column into tonnes", () => {
    assert.equal(suggestScale("Captured CO2 (kg)", monitoringMetric("CO2_CAPTURED_t")!), 0.001);
    assert.equal(suggestScale("Captured in t", monitoringMetric("CO2_CAPTURED_t")!), 1);
  });
});

describe("applying a tag map", () => {
  const captured = "captured in t- ft_0209_totalizer";
  const energy = "ccu_energy_consumed in kwh";
  const JULY = { start: "2026-07-17", end: "2026-07-31" };

  it("loads daily amounts, scaled, inside the period only", () => {
    const applied = applyMapping([table(DAILY)], { [captured]: { metric: "CO2_CAPTURED_t", reads: "daily_total", scale: 1 }, [energy]: null }, { start: "2026-07-18", end: "2026-07-31" });
    assert.deepEqual(Object.keys(applied.days), ["2026-07-18", "2026-07-19"]);
    assert.deepEqual(applied.days["2026-07-18"], [{ metric: "CO2_CAPTURED_t", value: 60, unit: "t" }]);
    assert.deepEqual(applied.summary, [{ metric: "CO2_CAPTURED_t", days: 2, first: "2026-07-18", last: "2026-07-19", total: 115, reads: "daily_total" }]);
    assert.match(applied.notes.join(" "), /1 value outside/);
  });

  it("adds two columns that make one metric, as FT-04 and FT-05 make the CO₂ injected", () => {
    const sheet: Sheet = { name: "Ace", rows: [["Date", "FT_04 in t", "FT_05 in t"], [D17, 10, 5], [D17 + 1, 12, 4], [D17 + 2, 11, 6]] };
    const both = { metric: "CO2_INJECTED_t", reads: "daily_total" as const, scale: 1 };
    const applied = applyMapping([table(sheet)], { "ft_04 in t": both, "ft_05 in t": both }, JULY);
    assert.deepEqual(applied.summary[0], { metric: "CO2_INJECTED_t", days: 3, first: "2026-07-17", last: "2026-07-19", total: 48, reads: "daily_total" });
  });

  it("turns a running totaliser into each day's amount, and leaves out a reset", () => {
    const sheet: Sheet = { name: "Raw", rows: [["Date", "FT_0209_Totalizer (kg)"], [D17, 1000], [D17 + 1, 51000], [D17 + 2, 99000], [D17 + 3, 2000]] };
    const applied = applyMapping([table(sheet)], { "ft_0209_totalizer (kg)": { metric: "CO2_CAPTURED_t", reads: "totaliser", scale: 0.001 } }, JULY);
    assert.deepEqual(Object.fromEntries(Object.entries(applied.days).map(([day, rows]) => [day, rows[0].value])), { "2026-07-18": 50, "2026-07-19": 48 });
    assert.match(applied.notes.join(" "), /first reading/);
    assert.match(applied.notes.join(" "), /fell on 2026-07-20/);
  });

  it("offers the period of the daily sheets, not of a short delivery list", () => {
    const deliveries: Sheet = { name: "Deliveries", rows: [["Date", "In Tonne"], [D17 - 100, 20], [D17 + 30, 22], [D17 + 31, 21]] };
    const long: Sheet = { ...DAILY, rows: [...DAILY.rows.slice(0, 4), [D17 + 3, 1, 1], [D17 + 4, 1, 1], [D17 + 5, 1, 1], [D17 + 6, 1, 1]] };
    assert.deepEqual(tableRange(readSheets([long, deliveries]).tables), { start: "2026-07-17", end: "2026-07-23" });
  });

  it("loads only what the approved map says, exactly", () => {
    const entry = { metric: "CO2_CAPTURED_t", reads: "daily_total" as const, scale: 1 };
    const map: TagMap = { entries: { [captured]: entry }, status: "approved", version: 2 };
    assert.equal(approvedFor(map, { [captured]: entry, [energy]: null }), true);
    assert.equal(approvedFor(map, { [captured]: { ...entry, scale: 0.001 } }), false);
    assert.equal(approvedFor({ ...map, status: "proposed" }, { [captured]: entry }), false);
    assert.equal(approvedFor(map, { [energy]: { metric: "ENERGY_CAPTURE_kWh", reads: "daily_total", scale: 1 } }), false);
  });

  it("drops entries that name no known metric or a factor that is not positive", () => {
    assert.deepEqual(cleanEntries({ a: { metric: "NOPE", reads: "daily_total", scale: 1 }, b: { metric: "CO2_CAPTURED_t", reads: "daily_total", scale: -1 }, c: null }), { c: null });
  });
});

describe("writing a day to the stream", () => {
  it("replaces the loaded metrics' rows and keeps the others", () => {
    const existing = "timestamp_utc,metric,value,unit,quality\n2026-07-17T00:00:00Z,CO2_CAPTURED_t,1,t,ok\n2026-07-17T10:00:00Z,LCO2_DELIVERED_t,22.4,t,ok\n";
    const merged = mergeDay(existing, "2026-07-17", [{ metric: "CO2_CAPTURED_t", value: 50, unit: "t" }], "20261126T090000Z-abc123");
    assert.equal(
      merged,
      "timestamp_utc,metric,value,unit,quality,source\n2026-07-17T10:00:00Z,LCO2_DELIVERED_t,22.4,t,ok,\n2026-07-17T00:00:00Z,CO2_CAPTURED_t,50,t,ok,20261126T090000Z-abc123\n",
    );
  });
});

/** A minimal .xlsx: deflated zip entries with a central directory (no checksums; the reader does not check them). */
function xlsx(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(text, "utf8"));
    const size = Buffer.byteLength(text, "utf8");
    const nameBytes = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

describe("reading an .xlsx workbook", () => {
  it("reads shared and inline strings, numbers and the sheet order", () => {
    const book = xlsx({
      "xl/workbook.xml": `<workbook xmlns:r="r"><workbookPr/><sheets><sheet name="Ace &amp; site" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
      "xl/sharedStrings.xml": `<sst><si><t>Date</t></si><si><r><t>water in t</t></r><r><t xml:space="preserve"> -FT_03</t></r></si></sst>`,
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" s="1"><v>${D17}</v></c><c r="B2"><v>120.5</v></c><c r="C2" t="inlineStr"><is><t>note</t></is></c></row><row r="3"><c r="A3"><v>${D17 + 1}</v></c><c r="B3"/></row></sheetData></worksheet>`,
    });
    const [sheet] = readXlsx(book);
    assert.equal(sheet.name, "Ace & site");
    assert.deepEqual(sheet.rows, [
      ["Date", "water in t -FT_03"],
      [D17, 120.5, "note"],
      [D17 + 1, null],
    ]);
  });

  it("refuses a file that is not a workbook", () => {
    assert.throws(() => readXlsx(Buffer.from("timestamp,value\n")), /not an \.xlsx/);
  });
});
