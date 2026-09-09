/**
 * GHG entry accounting columns — appended to operator telemetry CSVs.
 * Values are period constants (repeated on each row or read from the last row).
 */

export const GHG_ACCOUNTING_HEADERS = [
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
] as const;

export type GhgAccountingRow = Record<(typeof GHG_ACCOUNTING_HEADERS)[number], number>;

/** Period totals and LCA factors for Air Liquide EW — PASS pack. */
export const GHG_ACCOUNTING_PASS: GhgAccountingRow = {
  FEEDSTOCK_MASS_t: 12_500,
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
  DRYING_ELECTRICITY_kWh: 184_000,
  LAB_ELECTRICITY_kWh: 4_200,
  TRUCK_DISTANCE_km: 48,
  CHAR_DISTANCE_km: 120,
  STAFF_DISTANCE_km: 2_400,
  SPREADING_DIESEL_L: 8_200,
  TILLING_DIESEL_L: 3_500,
  SAMPLING_MASS_kg: 12.5,
};

/** Same shape as PASS but with implausible LCA factors for negative testing. */
export const GHG_ACCOUNTING_FAIL: GhgAccountingRow = {
  ...GHG_ACCOUNTING_PASS,
  FEEDSTOCK_MASS_t: 8_200,
  MINING_EQUIPMENT_ENERGY_kWh_per_kg: 0.95,
  GRID_EMISSION_FACTOR_kg_per_kWh: 1.85,
  DRYING_ELECTRICITY_kWh: 420_000,
};

/** Map CSV header → internal metric key. */
export const GHG_COLUMN_METRICS: Record<string, { key: string; unit: string; label: string }> = {
  FEEDSTOCK_MASS_t: { key: "feedstock_mass_t", unit: "t", label: "Feedstock mass" },
  FEEDSTOCK_MASS_kg: { key: "feedstock_mass_kg", unit: "kg", label: "Feedstock mass" },
  MINING_EQUIPMENT_ENERGY_kWh_per_kg: {
    key: "mining_energy_density",
    unit: "kWh/kg",
    label: "Mining equipment energy density",
  },
  PRIMARY_CRUSHER_ENERGY_kWh_per_kg: {
    key: "crusher_energy_density",
    unit: "kWh/kg",
    label: "Primary crusher energy density",
  },
  HANDLING_EQUIPMENT_ENERGY_kWh_per_kg: {
    key: "handling_energy_density",
    unit: "kWh/kg",
    label: "Handling equipment energy density",
  },
  GRID_EMISSION_FACTOR_kg_per_kWh: {
    key: "grid_carbon_intensity",
    unit: "kg/kWh",
    label: "Grid emission factor",
  },
  NATURAL_GAS_EF_kg_per_m3: {
    key: "ng_emission_factor",
    unit: "kg/m3",
    label: "Natural gas emission factor",
  },
  DIESEL_EF_kg_per_L: {
    key: "diesel_emission_factor",
    unit: "kg/L",
    label: "Diesel emission factor",
  },
  TRUCK_EF_kg_per_tkm: {
    key: "truck_emission_factor",
    unit: "kg/t·km",
    label: "Truck emission factor",
  },
  HANDLING_NG_m3_per_kg: {
    key: "handling_ng_specific_volume",
    unit: "m3/kg",
    label: "Handling natural gas intensity",
  },
  HANDLING_DIESEL_L_per_kg: {
    key: "handling_diesel_specific_volume",
    unit: "L/kg",
    label: "Handling diesel intensity",
  },
  LOADER_DIESEL_L_per_kg: {
    key: "loader_diesel_specific_volume",
    unit: "L/kg",
    label: "Loader diesel intensity",
  },
  DRYING_ELECTRICITY_kWh: {
    key: "drying_electricity_kwh",
    unit: "kWh",
    label: "Drying electricity",
  },
  LAB_ELECTRICITY_kWh: {
    key: "lab_electricity_kwh",
    unit: "kWh",
    label: "Laboratory electricity",
  },
  TRUCK_DISTANCE_km: { key: "truck_distance_km", unit: "km", label: "Truck distance" },
  CHAR_DISTANCE_km: { key: "char_distance_km", unit: "km", label: "Characterization distance" },
  STAFF_DISTANCE_km: { key: "staff_distance_km", unit: "km", label: "Staff travel distance" },
  SPREADING_DIESEL_L: { key: "spreading_diesel_l", unit: "L", label: "Spreading diesel" },
  TILLING_DIESEL_L: { key: "tilling_diesel_l", unit: "L", label: "Tilling diesel" },
  SAMPLING_MASS_kg: { key: "sampling_mass_kg", unit: "kg", label: "Sampling consumables mass" },
};

/** Telemetry series shown on the GHG quality chart. */
export const GHG_SERIES_LABELS: Record<string, { label: string; unit: string }> = {
  WHP_WELL_A_bar: { label: "Wellhead pressure A", unit: "bar" },
  WHP_WELL_B_bar: { label: "Wellhead pressure B", unit: "bar" },
  WELLHEAD_PRESSURE: { label: "Wellhead pressure A", unit: "bar" },
  WELLHEAD_PRESSURE_B: { label: "Wellhead pressure B", unit: "bar" },
  ANNULUS_PRESS_bar: { label: "Annulus pressure", unit: "bar" },
  ANNULUS_PRESSURE: { label: "Annulus pressure", unit: "bar" },
  INJ_RATE_FT01_m3h: { label: "Injection rate 1", unit: "m³/h" },
  INJ_RATE_FT02_m3h: { label: "Injection rate 2", unit: "m³/h" },
  INJECTION_RATE: { label: "Injection rate 1", unit: "m³/h" },
  INJ_RATE_2: { label: "Injection rate 2", unit: "m³/h" },
  CO2_TOTAL_SENSOR_m3: { label: "CO₂ totalizer", unit: "m³" },
  CO2_TOTALIZER: { label: "CO₂ totalizer", unit: "m³" },
  CO2_TOTAL_CALC_m3: { label: "CO₂ total (calc)", unit: "m³" },
  CO2_TOTAL_CALC: { label: "CO₂ total (calc)", unit: "m³" },
  TEMP_SURF_01_degC: { label: "Surface temperature 1", unit: "°C" },
  TEMP_SURF: { label: "Surface temperature 1", unit: "°C" },
  TEMP_SURF_02_degC: { label: "Surface temperature 2", unit: "°C" },
  TEMP_SURF_02: { label: "Surface temperature 2", unit: "°C" },
  CO2_TRACER_01_ppm: { label: "CO₂ tracer", unit: "ppm" },
  CO2_TRACER: { label: "CO₂ tracer", unit: "ppm" },
  WATER_FLOW_m3h: { label: "Water flow", unit: "m³/h" },
  WATER_FLOW: { label: "Water flow", unit: "m³/h" },
  ENERGY_PER_TONNE_kWht: { label: "Energy per tonne", unit: "kWh/t" },
  ENERGY_PER_TONNE: { label: "Energy per tonne", unit: "kWh/t" },
  INGESTION_LATENCY_sec: { label: "Ingestion latency", unit: "s" },
  INGESTION_LATENCY: { label: "Ingestion latency", unit: "s" },
};
