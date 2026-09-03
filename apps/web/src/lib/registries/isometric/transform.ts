import { ACCENT } from "@/lib/brand";
import type {
  ItemKind,
  Project,
  RequirementSpec,
  SpecEvidence,
  SpecGroup,
  SpecItem,
} from "../../types";
import {
  DISCRETIONARY_FREQUENCIES,
  FREQUENCY_LABEL,
  PHASE_META,
  type Datapoint,
  type Frequency,
  type MonitoringSubmission,
  type ProjectDocument,
  type ProjectMonitoringRequirement,
  type Source,
} from "./api";
import {
  attachDatapoints,
  leftoverDatapointGroup,
  publishedDocumentsGroup,
  sourceFetchability,
  sourceLabel,
} from "./enrich";

export interface LiveRequirement {
  requirement: ProjectMonitoringRequirement;
  submissions: MonitoringSubmission[];
}

export type LiveEnrichment = {
  sources?: Map<string, Source>;
  datapoints?: Datapoint[];
  documents?: ProjectDocument[];
};

const UNKNOWN_PHASE = {
  code: "OTH",
  title: "Other monitoring",
  accent: ACCENT.neutral,
  order: 99,
};

function phaseMeta(phase: string) {
  return PHASE_META[phase as keyof typeof PHASE_META] ?? {
    ...UNKNOWN_PHASE,
    title: phase,
  };
}

function toEvidence(
  submission: MonitoringSubmission,
  source: Source | undefined,
): SpecEvidence {
  const fetch = sourceFetchability(source);
  return {
    id: submission.id,
    kind: "submission",
    sourceId: submission.source_id,
    filename: sourceLabel(source, submission.source_id),
    validFrom: submission.valid_from,
    validTo: submission.valid_to,
    note: submission.notes ?? submission.supplier_reference_id ?? undefined,
    fetchable: fetch.fetchable,
    fetchNote: fetch.fetchNote,
  };
}

function toItem(
  { requirement, submissions }: LiveRequirement,
  sources: Map<string, Source>,
): SpecItem {
  return {
    id: requirement.id,
    label: requirement.display_name,
    kind: itemKind(requirement.frequency),
    detail: itemDetail(requirement, submissions.length),
    reference: reference(requirement),
    mandatory: requirement.frequency
      ? !DISCRETIONARY_FREQUENCIES.has(requirement.frequency)
      : true,
    cadence: requirement.frequency
      ? FREQUENCY_LABEL[requirement.frequency]
      : undefined,
    evidence: submissions.map((submission) =>
      toEvidence(submission, sources.get(submission.source_id)),
    ),
  };
}

function itemKind(frequency: Frequency | null): ItemKind {
  switch (frequency) {
    case "continuous":
    case "every_1_days":
      return "sensor-stream";
    case "once":
    case "if_needed":
    case "optional":
    case "na":
    case null:
      return "document";
    default:
      return "dataset";
  }
}

function itemDetail(
  requirement: ProjectMonitoringRequirement,
  submissionCount: number,
): string {
  const notes = requirement.notes?.trim();
  if (notes) return notes;

  const held =
    submissionCount === 0
      ? "Nothing submitted yet."
      : `${submissionCount} submission${submissionCount === 1 ? "" : "s"} on file.`;

  const frequency = requirement.frequency;
  if (!frequency || DISCRETIONARY_FREQUENCIES.has(frequency)) {
    return `Discretionary requirement in Isometric Certify — submitted when the registry or verifier asks for it. ${held}`;
  }

  return `Monitoring requirement tracked by Isometric Certify on a ${FREQUENCY_LABEL[frequency].toLowerCase()} cadence. ${held}`;
}

function reference(requirement: ProjectMonitoringRequirement): string {
  const scope = requirement.storage_unit_id
    ? `unit ${requirement.storage_unit_id}`
    : requirement.storage_location_id
      ? `site ${requirement.storage_location_id}`
      : "project scope";
  return `Certify ${requirement.id} · ${scope}`;
}

/**
 * Fold the registry's own monitoring requirements into the shape the board
 * renders. Grouping follows the registry's monitoring phases so the board
 * mirrors how Certify itself organises the project.
 */
export function toRequirementSpec(
  project: Project,
  live: LiveRequirement[],
  extras: LiveEnrichment = {},
): RequirementSpec {
  const sources = extras.sources ?? new Map<string, Source>();
  const datapoints = extras.datapoints ?? [];
  const documents = extras.documents ?? [];

  const byPhase = new Map<string, LiveRequirement[]>();
  for (const entry of live) {
    const phase = entry.requirement.monitoring_phase;
    const bucket = byPhase.get(phase);
    if (bucket) bucket.push(entry);
    else byPhase.set(phase, [entry]);
  }

  const groups: SpecGroup[] = [...byPhase.entries()]
    .sort(([a], [b]) => phaseMeta(a).order - phaseMeta(b).order)
    .map(([phase, entries]) => {
      const meta = phaseMeta(phase);
      return {
        id: `iso-${phase}`,
        code: meta.code,
        title: meta.title,
        accent: meta.accent,
        items: entries.map((entry) => toItem(entry, sources)),
      };
    });

  const attached = attachDatapoints(
    groups.flatMap((group) => group.items),
    datapoints,
  );
  const byId = new Map(attached.items.map((item) => [item.id, item]));
  for (const group of groups) {
    group.items = group.items.map((item) => byId.get(item.id) ?? item);
  }

  const leftover = leftoverDatapointGroup(attached.leftover);
  if (leftover) groups.push(leftover);

  const published = publishedDocumentsGroup(documents);
  if (published) groups.push(published);

  return {
    registry: "Isometric",
    methodology: project.methodology,
    specVersion: `Certify MRV v0 · ${project.methodology}`,
    sources: [
      "Isometric Certify API v0 — GET /projects/{id}/monitoring_requirements",
      "Isometric Certify API v0 — GET /projects/{id}/monitoring_requirements/{id}/submissions",
      "Isometric Certify API v0 — GET /sources and GET /datapoints",
      "Isometric Registry API v0 — GET /projects/{id}/documents",
    ],
    groups,
  };
}

export function evidenceCount(
  live: LiveRequirement[],
  extras: LiveEnrichment = {},
): number {
  const submissions = live.reduce((sum, entry) => sum + entry.submissions.length, 0);
  return submissions + (extras.datapoints?.length ?? 0) + (extras.documents?.length ?? 0);
}
