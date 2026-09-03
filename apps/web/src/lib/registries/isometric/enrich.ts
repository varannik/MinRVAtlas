import type { SpecEvidence, SpecGroup, SpecItem } from "../../types";
import type {
  Datapoint,
  ProjectDocument,
  Source,
  SourceUrlInfo,
} from "./api";

const DOC_ACCENT = "#9b8cff";
const DATA_ACCENT = "#4cc4ff";

export function sourceFetchability(source: Source | undefined): {
  fetchable: boolean;
  fetchNote: string;
} {
  if (!source) {
    return { fetchable: false, fetchNote: "Source metadata not returned" };
  }
  const info: SourceUrlInfo | null = source.url_info;
  if (!info) return { fetchable: false, fetchNote: "Metadata only" };
  if (info.__typename === "SourcePublicUrlInfo") {
    return { fetchable: true, fetchNote: "Public URL (bytes not pulled for DQA)" };
  }
  if (info.__typename === "SourcePrivateUrlInfo") {
    return info.is_accessible
      ? {
          fetchable: true,
          fetchNote: "Private file accessible to this token (bytes not pulled)",
        }
      : { fetchable: false, fetchNote: "Private file — not accessible" };
  }
  if ("url" in info && typeof (info as { url?: unknown }).url === "string") {
    return { fetchable: true, fetchNote: "Public URL (bytes not pulled for DQA)" };
  }
  if ("is_accessible" in info && (info as { is_accessible?: unknown }).is_accessible === true) {
    return {
      fetchable: true,
      fetchNote: "Private file accessible to this token (bytes not pulled)",
    };
  }
  return { fetchable: false, fetchNote: "Metadata only" };
}

export function sourceLabel(source: Source | undefined, fallback: string): string {
  return (
    source?.original_filename?.trim() ||
    source?.display_name?.trim() ||
    fallback
  );
}

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((word) => word.length >= 4),
  );
}

export function namesOverlap(a: string, b: string): boolean {
  const left = tokens(a);
  const right = tokens(b);
  for (const word of left) {
    if (right.has(word)) return true;
  }
  return false;
}

export function datapointEvidence(point: Datapoint): SpecEvidence {
  const quantity = `${point.quantity.magnitude} ${point.quantity.unit}`;
  return {
    id: point.id,
    kind: "datapoint",
    sourceId: point.source_ids[0],
    filename: point.display_name,
    quantity,
    validFrom: point.measured_at,
    validTo: point.measured_at ?? "",
    note: point.description ?? undefined,
    fetchable: false,
    fetchNote: "Numeric datapoint — DQA still needs an operator CSV",
  };
}

export function attachDatapoints(
  items: SpecItem[],
  datapoints: Datapoint[],
): { items: SpecItem[]; leftover: Datapoint[] } {
  if (datapoints.length === 0) return { items, leftover: [] };

  const used = new Set<string>();
  const next = items.map((item) => {
    const sourceIds = new Set(
      (item.evidence ?? [])
        .map((entry) => entry.sourceId)
        .filter((id): id is string => Boolean(id)),
    );
    const matches = datapoints.filter((point) => {
      if (used.has(point.id)) return false;
      if (point.source_ids.some((id) => sourceIds.has(id))) return true;
      return namesOverlap(item.label, point.display_name);
    });
    if (matches.length === 0) return item;
    for (const point of matches) used.add(point.id);
    return {
      ...item,
      evidence: [
        ...(item.evidence ?? []),
        ...matches.map(datapointEvidence),
      ],
    };
  });

  return {
    items: next,
    leftover: datapoints.filter((point) => !used.has(point.id)),
  };
}

export function leftoverDatapointGroup(datapoints: Datapoint[]): SpecGroup | null {
  if (datapoints.length === 0) return null;
  return {
    id: "iso-datapoints",
    code: "DP",
    title: "Certify datapoints on file",
    accent: DATA_ACCENT,
    items: datapoints.map((point) => ({
      id: point.id,
      label: point.display_name,
      kind: "dataset" as const,
      detail: `${point.quantity.magnitude} ${point.quantity.unit}. Listed from Certify; DQA still uses an operator CSV.`,
      reference: `Certify ${point.id}`,
      mandatory: false,
      evidence: [datapointEvidence(point)],
    })),
  };
}

export function publishedDocumentsGroup(
  documents: ProjectDocument[],
): SpecGroup | null {
  if (documents.length === 0) return null;
  return {
    id: "iso-published",
    code: "REG",
    title: "Published registry documents",
    accent: DOC_ACCENT,
    items: documents.map((doc) => ({
      id: doc.id,
      label: doc.display_name,
      kind: "document" as const,
      detail: `Published on the Isometric Registry (${doc.submission_date}).`,
      reference: `Registry ${doc.id}`,
      mandatory: false,
      evidence: [
        {
          id: doc.id,
          kind: "registry-document" as const,
          filename: doc.display_name,
          href: doc.url,
          fetchable: true,
          fetchNote: "Published on the public registry",
          validFrom: doc.submission_date,
          validTo: doc.submission_date,
        },
      ],
    })),
  };
}
