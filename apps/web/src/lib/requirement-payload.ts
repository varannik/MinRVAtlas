import { ITEM_KIND_LABEL } from "./item-state";
import type { ItemKind, RequirementItem } from "./types";

/** What the operator must actually file, independent of registry wording. */
export type PayloadType = "data" | "document" | "both";

/** Data Sentinel / registry engines that must pass before Certify submit. */
export type QualityEngine = "dqa" | "anomaly" | "vv" | "registry-rules";

export type RequirementOrigin =
  | "operator-upload"
  | "isometric-source"
  | "isometric-datapoint"
  | "bundled-gap";

export interface RequirementClassification {
  payload: PayloadType;
  engines: QualityEngine[];
  origin: RequirementOrigin;
  accept: string;
  helper: string;
  intakeLabel: string;
}

const ENGINE_ORDER: QualityEngine[] = [
  "dqa",
  "anomaly",
  "vv",
  "registry-rules",
];

export const ENGINE_META: Record<
  QualityEngine,
  { step: string; label: string; short: string }
> = {
  dqa: { step: "Step-1", label: "Data quality", short: "DQA" },
  anomaly: { step: "Step-2", label: "Anomaly detection", short: "Anomaly" },
  vv: { step: "Step-4", label: "Document V&V", short: "V&V" },
  "registry-rules": {
    step: "Step-3",
    label: "Registry rules",
    short: "Registry",
  },
};

const DOCUMENT_ACCEPT =
  ".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tif,.tiff,.html,.pptx,.json";
const DATA_ACCEPT = ".csv,.xlsx,.xls,.parquet,.json,.geojson,.txt";
const SENSOR_ACCEPT = ".csv,.parquet,.json";

function uniqueAccept(...groups: string[]): string {
  const tokens = new Set<string>();
  for (const group of groups) {
    for (const token of group.split(",")) tokens.add(token.trim());
  }
  return [...tokens].join(",");
}

/**
 * Maps a board item onto the data / document / both split used by the
 * Sentinel pipeline. Live Certify rows already arrive as ItemKind via frequency.
 */
export function classifyRequirement(
  item: Pick<RequirementItem, "kind" | "label">,
): RequirementClassification {
  switch (item.kind) {
    case "sensor-stream":
      return {
        payload: "data",
        engines: ["dqa", "anomaly", "registry-rules"],
        origin: "operator-upload",
        accept: SENSOR_ACCEPT,
        intakeLabel: "Import time series",
        helper:
          "Continuous telemetry. Drop the operator CSV for this period. MinRV tags (WHP_*, INJ_RATE_*, CO2_TOTAL_*, WATER_CO2_RATIO) are mapped onto Sentinel CO₂ rules. DQA and anomaly run, then Step-3 MASIP / cadence. Certify write is a separate Submit after READY.",
      };
    case "dataset":
      return {
        payload: "both",
        engines: ["dqa", "vv", "registry-rules"],
        origin: "operator-upload",
        accept: uniqueAccept(DATA_ACCEPT, DOCUMENT_ACCEPT),
        intakeLabel: "Import structured data",
        helper:
          "Tabular values, often inside a workbook or lab file. Numbers go through DQA; the file itself is kept as evidence.",
      };
    case "attestation":
      return {
        payload: "document",
        engines: ["vv"],
        origin: "operator-upload",
        accept: DOCUMENT_ACCEPT,
        intakeLabel: "Attestation and evidence",
        helper:
          "A signed statement plus supporting files. Document V&V must pass before the batch can be submitted.",
      };
    case "document":
    default:
      return {
        payload: "document",
        engines: ["vv"],
        origin: "operator-upload",
        accept: DOCUMENT_ACCEPT,
        intakeLabel: "Upload documents",
        helper:
          "Narrative evidence a verifier must open: reports, permits, PDD sections, lab PDFs. V&V runs before registry submit.",
      };
  }
}

export function payloadLabel(payload: PayloadType): string {
  if (payload === "both") return "Data + documents";
  if (payload === "data") return "Data";
  return "Documents";
}

export function kindLabel(kind: ItemKind): string {
  return ITEM_KIND_LABEL[kind];
}

export function orderedEngines(engines: QualityEngine[]): QualityEngine[] {
  return ENGINE_ORDER.filter((engine) => engines.includes(engine));
}
