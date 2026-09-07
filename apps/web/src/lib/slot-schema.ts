import { canonicalFromHeader, normalizeHeader, splitCsvLine } from "./sentinel/column-map";
import type { ItemKind } from "./types";

export type SchemaColumn = {
  name: string;
  aliases: string[];
  role: string;
  required: boolean;
};

export type SlotSchema = {
  key: string;
  kind: "csv" | "document" | "both";
  columns: SchemaColumn[];
  derived: string[];
  documentHints: string[];
};

const PRESSURE: SlotSchema = {
  key: "injection-pressure",
  kind: "csv",
  columns: [
    {
      name: "timestamp_utc",
      aliases: ["TIMESTAMP_UTC", "TIMESTAMP", "TIME", "DATETIME"],
      role: "Sample time (UTC)",
      required: true,
    },
    {
      name: "WHP_WELL_A_bar",
      aliases: ["WELLHEAD_PRESSURE", "INJECTION_PRESSURE", "WHP", "WHP_A"],
      role: "Wellhead / injection pressure (bar)",
      required: true,
    },
    {
      name: "ANNULUS_PRESS_bar",
      aliases: ["ANNULUS_PRESSURE", "ANNULUS"],
      role: "Annulus pressure (bar)",
      required: true,
    },
    {
      name: "operational_state",
      aliases: ["OP_STATE", "STATE"],
      role: "Well state (active_injection, …)",
      required: false,
    },
    {
      name: "MASIP_bar",
      aliases: ["MASIP"],
      role: "Permit MASIP (bar). Defaults to 150 if omitted.",
      required: false,
    },
  ],
  derived: [],
  documentHints: [],
};

const STREAM: SlotSchema = {
  key: "stream-flow",
  kind: "csv",
  columns: [
    {
      name: "timestamp_utc",
      aliases: ["TIMESTAMP_UTC", "TIMESTAMP", "TIME"],
      role: "Sample time (UTC)",
      required: true,
    },
    {
      name: "INJ_RATE_FT01_m3h",
      aliases: ["INJECTION_RATE", "INJ_RATE", "CO2_FLOW", "FLOW_RATE"],
      role: "CO₂ injectate rate (m³/h). Not kg/hr.",
      required: true,
    },
    {
      name: "WATER_FLOW_m3h",
      aliases: ["WATER_FLOW_RATE", "WATER_FLOW"],
      role: "Water rate (m³/h)",
      required: true,
    },
    {
      name: "TEMP_SURF_01_degC",
      aliases: ["TEMPERATURE", "TEMP_SURF"],
      role: "Stream temperature (°C)",
      required: true,
    },
  ],
  derived: ["WATER_CO2_RATIO"],
  documentHints: [],
};

const BUBBLE: SlotSchema = {
  key: "bubble-point",
  kind: "both",
  columns: [
    {
      name: "timestamp_utc",
      aliases: ["DATE", "MONTH", "TIMESTAMP"],
      role: "Calculation date",
      required: true,
    },
    {
      name: "BUBBLE_POINT_bar",
      aliases: ["P_BUBBLE", "BUBBLE_POINT"],
      role: "Bubble-point pressure (bar)",
      required: true,
    },
    {
      name: "RESERVOIR_PRESSURE_bar",
      aliases: ["P_RES", "P_RESERVOIR", "RESERVOIR_PRESSURE"],
      role: "Reservoir pressure (bar)",
      required: true,
    },
  ],
  derived: [],
  documentHints: ["PHREEQC workbook or monthly solubility note"],
};

const COMPOSITION: SlotSchema = {
  key: "injectate-composition",
  kind: "both",
  columns: [
    {
      name: "timestamp_utc",
      aliases: ["DATE", "TIMESTAMP"],
      role: "Sample date",
      required: true,
    },
    {
      name: "pH",
      aliases: ["PH"],
      role: "Injectate pH",
      required: true,
    },
    {
      name: "TEMP_SURF_01_degC",
      aliases: ["TEMPERATURE", "TEMP"],
      role: "Sample temperature (°C)",
      required: false,
    },
    {
      name: "CO2_CONC",
      aliases: ["CO2_CONCENTRATION", "CO2_PURITY_PERCENTAGE"],
      role: "CO₂ concentration",
      required: false,
    },
    {
      name: "DENSITY",
      aliases: ["INJECTATE_DENSITY"],
      role: "Density",
      required: false,
    },
    {
      name: "MAJOR_IONS",
      aliases: ["IONS"],
      role: "Major ions (dissolved injection)",
      required: false,
    },
  ],
  derived: [],
  documentHints: ["Lab certificate PDF"],
};

const VOLUME: SlotSchema = {
  key: "injected-volume",
  kind: "csv",
  columns: [
    {
      name: "timestamp_utc",
      aliases: ["DATE", "TIMESTAMP"],
      role: "Period or sample date",
      required: true,
    },
    {
      name: "CO2_TOTAL_SENSOR_m3",
      aliases: ["CO2_TOTAL", "CO2_TOTALIZER", "CO2_TOTAL_CALC_m3"],
      role: "Cumulative / period injected volume",
      required: true,
    },
    {
      name: "WATER_CO2_RATIO",
      aliases: ["WATER_TO_CO2", "CO2_WATER_RATIO"],
      role: "Water / CO₂ ratio",
      required: false,
    },
    {
      name: "INJ_RATE_FT01_m3h",
      aliases: ["INJECTION_RATE"],
      role: "Used with water flow if ratio is derived",
      required: false,
    },
    {
      name: "WATER_FLOW_m3h",
      aliases: ["WATER_FLOW_RATE"],
      role: "Used to derive WATER_CO2_RATIO",
      required: false,
    },
  ],
  derived: ["WATER_CO2_RATIO"],
  documentHints: [],
};

const USDW: SlotSchema = {
  key: "usdw",
  kind: "both",
  columns: [
    {
      name: "timestamp_utc",
      aliases: ["DATE", "TIMESTAMP"],
      role: "Sample date",
      required: true,
    },
    {
      name: "pH",
      aliases: ["PH"],
      role: "USDW pH",
      required: true,
    },
    {
      name: "TEMP_SURF_01_degC",
      aliases: ["TEMPERATURE"],
      role: "Temperature",
      required: false,
    },
  ],
  derived: [],
  documentHints: ["Lab pack for conductivity and major ions"],
};

const DOCUMENT: SlotSchema = {
  key: "document",
  kind: "document",
  columns: [],
  derived: [],
  documentHints: ["PDF or signed report covering this period"],
};

const SCHEMAS: Record<string, SlotSchema> = {
  "injection-pressure": PRESSURE,
  "stream-flow": STREAM,
  "bubble-point": BUBBLE,
  "injectate-composition": COMPOSITION,
  "injected-volume": VOLUME,
  usdw: USDW,
  "near-surface": {
    ...PRESSURE,
    key: "near-surface",
    columns: [
      {
        name: "timestamp_utc",
        aliases: ["TIMESTAMP", "TIME"],
        role: "Sample time (UTC)",
        required: true,
      },
      {
        name: "CO2_TRACER_01_ppm",
        aliases: ["CO2_TRACER", "CO2_PPM", "SURFACE_CO2"],
        role: "Near-surface CO₂ (ppm)",
        required: true,
      },
    ],
  },
  seismicity: {
    key: "seismicity",
    kind: "csv",
    columns: [
      {
        name: "timestamp_utc",
        aliases: ["TIMESTAMP", "TIME"],
        role: "Event or sample time",
        required: true,
      },
    ],
    derived: [],
    documentHints: [],
  },
  "internal-integrity": {
    ...DOCUMENT,
    key: "internal-integrity",
    documentHints: ["Six-month internal MIT / corrosion report"],
  },
  "external-integrity": {
    ...DOCUMENT,
    key: "external-integrity",
    documentHints: ["Annual external integrity + pressure fall-off"],
  },
  "reservoir-model": {
    ...DOCUMENT,
    key: "reservoir-model",
    documentHints: ["Five-year model review vs measured plume"],
  },
};

const LABEL_HINTS: { key: string; pattern: RegExp }[] = [
  { key: "injection-pressure", pattern: /injection|annulus|wellhead|whp|pressure telemetry/i },
  { key: "stream-flow", pattern: /stream flow|water stream|injectate rate|flow and temperature/i },
  { key: "bubble-point", pattern: /bubble|solubility/i },
  { key: "injectate-composition", pattern: /injectate composition|composition analysis/i },
  { key: "injected-volume", pattern: /injected (mass|volume)|cumulative|co2-water|co₂-water/i },
  { key: "internal-integrity", pattern: /internal.*(integrity|mechanical)/i },
  { key: "external-integrity", pattern: /external integrity|fall-off|falloff/i },
  { key: "near-surface", pattern: /near-surface|soil gas|surface.*(co2|flux)/i },
  { key: "usdw", pattern: /usdw|groundwater|drinking water|aquifer/i },
  { key: "reservoir-model", pattern: /reservoir model|plume/i },
  { key: "seismicity", pattern: /seismic/i },
];

export function bindMethodologySlot(slotId: string, label?: string): string | null {
  const suffix = slotId.split(".").pop() ?? slotId;
  if (SCHEMAS[suffix]) return suffix;
  if (label) {
    for (const hint of LABEL_HINTS) {
      if (hint.pattern.test(label)) return hint.key;
    }
  }
  return null;
}

export function schemaForSlot(
  slotId: string,
  kind: ItemKind,
  label?: string,
): SlotSchema {
  if (slotId.startsWith("ghg-entry")) {
    return {
      key: "ghg-entry",
      kind: "both",
      columns: [],
      derived: [],
      documentHints: [
        "Energy invoice or meter export",
        "Calibrated injected-mass record",
        "Lab certificate or citation",
      ],
    };
  }
  const key = bindMethodologySlot(slotId, label);
  if (key && SCHEMAS[key]) return SCHEMAS[key];
  if (kind === "document" || kind === "attestation") return { ...DOCUMENT, key: suffixOr(slotId) };
  return {
    key: suffixOr(slotId),
    kind: "csv",
    columns: [
      {
        name: "timestamp_utc",
        aliases: ["TIMESTAMP", "TIME"],
        role: "Sample time",
        required: true,
      },
    ],
    derived: [],
    documentHints: [],
  };
}

function suffixOr(slotId: string): string {
  return slotId.split(".").pop() ?? slotId;
}

export type SchemaRowStatus = "exact" | "aliased" | "bound" | "missing" | "unknown";

export type SchemaPreviewRow = {
  header?: string;
  canonical: string;
  status: SchemaRowStatus;
  role?: string;
  required: boolean;
};

export type SchemaPreview = {
  headers: string[];
  rows: SchemaPreviewRow[];
  missingRequired: string[];
  unknown: string[];
  blocked: boolean;
};

export function parseCsvHeaders(text: string): string[] {
  const line = text.replace(/^\uFEFF/, "").split(/\r?\n/)[0] ?? "";
  return splitCsvLine(line)
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function resolveCanonical(
  header: string,
  schema: SlotSchema,
  bindings?: Record<string, string>,
): string | null {
  if (bindings?.[header]) return bindings[header];
  const fromAlias = canonicalFromHeader(header);
  if (fromAlias) return fromAlias;
  const key = normalizeHeader(header);
  for (const column of schema.columns) {
    if (normalizeHeader(column.name) === key) return column.name;
    if (column.aliases.some((alias) => normalizeHeader(alias) === key)) {
      return column.name;
    }
  }
  return null;
}

export function previewSchema(
  headers: string[],
  schema: SlotSchema,
  bindings?: Record<string, string>,
): SchemaPreview {
  const claimed = new Map<string, SchemaPreviewRow>();
  const unknown: string[] = [];

  for (const header of headers) {
    const bound = bindings?.[header];
    const canonical = resolveCanonical(header, schema, bindings);
    if (!canonical) {
      unknown.push(header);
      continue;
    }
    if (claimed.has(canonical)) continue;
    const column = schema.columns.find((entry) => entry.name === canonical);
    claimed.set(canonical, {
      header,
      canonical,
      status: bound ? "bound" : header === canonical ? "exact" : "aliased",
      role: column?.role,
      required: column?.required ?? false,
    });
  }

  const rows: SchemaPreviewRow[] = [];
  for (const column of schema.columns) {
    const found = claimed.get(column.name);
    if (found) {
      rows.push({ ...found, role: column.role, required: column.required });
    } else {
      rows.push({
        canonical: column.name,
        status: "missing",
        role: column.role,
        required: column.required,
      });
    }
  }
  for (const header of unknown) {
    rows.push({
      header,
      canonical: header,
      status: "unknown",
      required: false,
    });
  }

  const missingRequired = schema.columns
    .filter((column) => column.required && !claimed.has(column.name))
    .map((column) => column.name);

  return {
    headers,
    rows,
    missingRequired,
    unknown,
    blocked: schema.kind !== "document" && missingRequired.length > 0,
  };
}

export function templateCsv(schema: SlotSchema): string {
  const names = schema.columns.map((column) => column.name);
  return `${names.join(",")}\n`;
}

export function refineHint(
  engine: "schema" | "dqa" | "anomaly" | "vv" | "registry-rules" | "submit",
): string {
  switch (engine) {
    case "schema":
      return "Bind the unknown header to a required name, or replace the file.";
    case "dqa":
      return "Replace the CSV or fix the flagged rows, then run again. Hard-gate fails are not auto-applied.";
    case "anomaly":
      return "Acknowledge or replace the series. Anomaly hits are never silently rewritten.";
    case "vv":
      return "Replace the document so it covers this period, then run again.";
    case "registry-rules":
      return "Fix the measured values (pressure, bubble-point, ratio) — not the methodology rule.";
    case "submit":
      return "Read the Certify warning, then submit again after the slot is READY.";
  }
}
