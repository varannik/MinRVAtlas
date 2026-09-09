#!/usr/bin/env node
/**
 * Build GHG entry test CSVs: Sentinel telemetry + EW accounting columns.
 * Usage: node apps/web/test-data/ghg-entry/generate.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../../..");
const SAMPLE = path.join(ROOT, "apps/sentinel/data/sample_data");

const GHG_HEADERS = [
  "FEEDSTOCK_MASS_t",
  "MINING_EQUIPMENT_ENERGY_kWh_per_kg",
  "PRIMARY_CRUSHER_ENERGY_kWh_per_kg",
  "HANDLING_EQUIPMENT_ENERGY_kWh_per_kg",
  "GRID_EMISSION_FACTOR_kg_per_kWh",
  "NATURAL_GAS_EF_kg_per_m3",
  "DIESEL_EF_kg_per_L",
  "TRUCK_EF_kg_per_tkm",
  "HANDLING_NG_m3_per_kg",
  "HANDLING_DIESEL_L_per_kg",
  "LOADER_DIESEL_L_per_kg",
  "DRYING_ELECTRICITY_kWh",
  "LAB_ELECTRICITY_kWh",
  "TRUCK_DISTANCE_km",
  "CHAR_DISTANCE_km",
  "STAFF_DISTANCE_km",
  "SPREADING_DIESEL_L",
  "TILLING_DIESEL_L",
  "SAMPLING_MASS_kg",
];

const PASS_VALUES = {
  FEEDSTOCK_MASS_t: 12500,
  MINING_EQUIPMENT_ENERGY_kWh_per_kg: 0.042,
  PRIMARY_CRUSHER_ENERGY_kWh_per_kg: 0.028,
  HANDLING_EQUIPMENT_ENERGY_kWh_per_kg: 0.015,
  GRID_EMISSION_FACTOR_kg_per_kWh: 0.42,
  NATURAL_GAS_EF_kg_per_m3: 1.96,
  DIESEL_EF_kg_per_L: 2.68,
  TRUCK_EF_kg_per_tkm: 0.089,
  HANDLING_NG_m3_per_kg: 0.012,
  HANDLING_DIESEL_L_per_kg: 0.0008,
  LOADER_DIESEL_L_per_kg: 0.0012,
  DRYING_ELECTRICITY_kWh: 184000,
  LAB_ELECTRICITY_kWh: 4200,
  TRUCK_DISTANCE_km: 48,
  CHAR_DISTANCE_km: 120,
  STAFF_DISTANCE_km: 2400,
  SPREADING_DIESEL_L: 8200,
  TILLING_DIESEL_L: 3500,
  SAMPLING_MASS_kg: 12.5,
};

const FAIL_VALUES = {
  ...PASS_VALUES,
  FEEDSTOCK_MASS_t: 8200,
  MINING_EQUIPMENT_ENERGY_kWh_per_kg: 0.95,
  GRID_EMISSION_FACTOR_kg_per_kWh: 1.85,
  DRYING_ELECTRICITY_kWh: 420000,
};

const TELEMETRY_HEADER_MAP = {
  timestamp_utc: "TIMESTAMP_UTC",
  batch_id: "BATCH_ID",
  operational_state: "STATE",
  WHP_WELL_A_bar: "WELLHEAD_PRESSURE",
  WHP_WELL_B_bar: "WELLHEAD_PRESSURE_B",
  ANNULUS_PRESS_bar: "ANNULUS_PRESSURE",
  INJ_RATE_FT01_m3h: "INJECTION_RATE",
  INJ_RATE_FT02_m3h: "INJ_RATE_2",
  CO2_TOTAL_SENSOR_m3: "CO2_TOTALIZER",
  CO2_TOTAL_CALC_m3: "CO2_TOTAL_CALC",
  TEMP_SURF_01_degC: "TEMP_SURF",
  TEMP_SURF_02_degC: "TEMP_SURF_02",
  CO2_TRACER_01_ppm: "CO2_TRACER",
  WATER_FLOW_m3h: "WATER_FLOW",
  ENERGY_PER_TONNE_kWht: "ENERGY_PER_TONNE",
  INGESTION_LATENCY_sec: "INGESTION_LATENCY",
};

function shiftDates(text, fromDate, toDate, batchFrom, batchTo) {
  return text.replaceAll(batchFrom, batchTo).replaceAll(fromDate, toDate);
}

function remapTelemetryHeaders(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const canon = lines[0].split(",");
  const operator = canon.map((h) => TELEMETRY_HEADER_MAP[h.trim()] ?? h.trim());
  return [operator.join(","), ...lines.slice(1)].join("\n");
}

function appendAccounting(text, values) {
  const lines = text.trim().split("\n");
  const header = `${lines[0]},${GHG_HEADERS.join(",")}`;
  const body = lines.slice(1).map((line) => {
    const accounting = GHG_HEADERS.map((key) => values[key]).join(",");
    return `${line},${accounting}`;
  });
  return `${header}\n${body.join("\n")}\n`;
}

function build(srcName, dstName, batchId, values) {
  let text = fs.readFileSync(path.join(SAMPLE, srcName), "utf8");
  text = shiftDates(text, "2024-03-15", "2026-09-01", srcName.includes("PASS") ? "STR1-PASS-2024-03-15" : "STR1-FAIL-2024-03-15", batchId);
  text = remapTelemetryHeaders(text);
  text = appendAccounting(text, values);
  fs.writeFileSync(path.join(__dirname, dstName), text);
  const rows = text.trim().split("\n").length - 1;
  console.log(`${dstName}: ${rows} rows, ${GHG_HEADERS.length} accounting columns`);
}

build("STR1_PASS_2024-03-15.csv", "GHG_ENTRY_PASS_2026-09.csv", "GHG-ENTRY-PASS-2026-09", PASS_VALUES);
build("STR1_FAIL_2024-03-15.csv", "GHG_ENTRY_FAIL_2026-09.csv", "GHG-ENTRY-FAIL-2026-09", FAIL_VALUES);
