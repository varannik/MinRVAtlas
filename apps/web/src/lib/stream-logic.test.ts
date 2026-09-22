import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assembleWideCsv, buildCoverage, parseObservationsCsv } from "./stream-coverage";
import {
  assertKeyInPrefix,
  catalogProject,
  dtFromKey,
  eachUtcDay,
  registrySlug,
  sourcePrefix,
} from "./stream-schema";

describe("stream prefix", () => {
  it("scopes tenant, registry, and project", () => {
    const fujairah = catalogProject("fourfourone", "Isometric", "fujairah-mineral");
    assert.ok(fujairah);
    assert.equal(registrySlug("Isometric"), "isometric");
    assert.equal(
      sourcePrefix("fourfourone", "Isometric", "fujairah-mineral"),
      "fourfourone/isometric/fujairah-mineral/",
    );
    assert.equal(
      catalogProject("terrafix", "Isometric", "fujairah-mineral"),
      null,
    );
    assert.equal(catalogProject("fourfourone", "Isometric", "north-sea-dac"), null);
  });

  it("rejects keys outside the prefix", () => {
    const prefix = sourcePrefix("fourfourone", "Isometric", "fujairah-mineral");
    assert.equal(dtFromKey(`${prefix}dt=2026-09-01/observations.csv`), "2026-09-01");
    assert.throws(() =>
      assertKeyInPrefix("terrafix/isometric/north-sea-dac/dt=2026-09-01/observations.csv", prefix),
    );
  });
});

describe("coverage and assemble", () => {
  it("lists missing days, series, and attributes", () => {
    const csv = [
      "timestamp_utc,metric,value,unit,quality",
      "2026-09-01T00:00:00Z,WHP_WELL_A_bar,10,bar,ok",
    ].join("\n");
    const observations = parseObservationsCsv(csv);
    const coverage = buildCoverage({
      contract: {
        schemaVersion: 1,
        kind: "timeseries",
        timezone: "UTC",
        cadence: "PT2M",
        registry: "Isometric",
        methodologyKey: "isometric-insitu-mineralization",
        requiredSeries: ["WHP_WELL_A_bar", "INJ_RATE_FT01_m3h"],
        requiredAttributes: ["FEEDSTOCK_MASS_t"],
      },
      daysPresent: ["2026-09-01"],
      observations,
      attributes: { schemaVersion: 1, values: {} },
      from: "2026-09-01",
      to: "2026-09-02",
    });
    assert.deepEqual(eachUtcDay("2026-09-01", "2026-09-02"), ["2026-09-01", "2026-09-02"]);
    assert.deepEqual(coverage.daysMissing, ["2026-09-02"]);
    assert.ok(coverage.seriesMissing.includes("INJ_RATE_FT01_m3h"));
    assert.ok(coverage.attributesMissing.includes("FEEDSTOCK_MASS_t"));
    assert.equal(coverage.complete, false);
  });

  it("pivots two days into one wide csv", () => {
    const observations = parseObservationsCsv(
      [
        "timestamp_utc,metric,value,unit,quality",
        "2026-09-01T00:00:00Z,WHP_WELL_A_bar,10,bar,ok",
        "2026-09-02T00:00:00Z,WHP_WELL_A_bar,11,bar,ok",
        "2026-09-03T00:00:00Z,WHP_WELL_A_bar,12,bar,ok",
      ].join("\n"),
    );
    const csv = assembleWideCsv(
      observations,
      { schemaVersion: 1, values: { FEEDSTOCK_MASS_t: 1 } },
      "2026-09-01",
      "2026-09-02",
    );
    assert.ok(csv.includes("WHP_WELL_A_bar"));
    assert.ok(csv.includes("2026-09-01T00:00:00Z"));
    assert.ok(csv.includes("2026-09-02T00:00:00Z"));
    assert.equal(csv.includes("2026-09-03T00:00:00Z"), false);
  });
});
