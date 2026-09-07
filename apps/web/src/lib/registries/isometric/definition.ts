import {
  classifyDefinitionTitle,
  type DefinitionArtifact,
  type LcaRecipe,
  type ProjectDefinition,
} from "@/lib/project-definition";
import type {
  GhgEntryTemplate,
  ProjectDocument,
  ProjectMonitoringRequirement,
  StorageLocation,
} from "./api";
import type { LiveRequirement } from "./transform";

function formatDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value.slice(0, 10);
}

function templateRecipe(template: GhgEntryTemplate): LcaRecipe {
  const groups = template.groups ?? [];
  return {
    creditType: String(template.credit_type || "REMOVAL"),
    groups: groups.map((group) => ({
      id: group.id,
      name: humanizeLabel(group.display_name || group.key),
      description: group.description,
      components: (group.components ?? []).map((component) => ({
        id: component.id,
        name: humanizeLabel(component.display_name),
        description: component.description,
        blueprint: component.blueprint_key
          ? humanizeLabel(component.blueprint_key)
          : undefined,
        inputs: (component.inputs ?? []).map((input) => ({
          name: humanizeLabel(input.display_name || input.input_key),
          inputKey: input.input_key,
          type: input.type,
          quantityKind: input.quantity_kind,
          bound: Boolean(input.datapoint_id),
          datapointId: input.datapoint_id,
        })),
      })),
    })),
  };
}

function humanizeLabel(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function assembleDefinition(input: {
  projectId: string;
  certifyProjectId: string;
  origin: ProjectDefinition["origin"];
  description?: string | null;
  createdOn?: string | null;
  documents: ProjectDocument[];
  templates: GhgEntryTemplate[];
  storageLocations: StorageLocation[];
  preOp: LiveRequirement[];
  warnings: string[];
}): ProjectDefinition {
  const artifacts: DefinitionArtifact[] = [];

  if (input.description?.trim()) {
    artifacts.push({
      id: `${input.certifyProjectId}-site-brief`,
      kind: "site",
      title: "Project description",
      detail: input.description.trim(),
      submitted: true,
      reference: input.certifyProjectId,
    });
  }

  for (const site of input.storageLocations) {
    const coords =
      site.latitude != null && site.longitude != null
        ? `${site.latitude.toFixed(4)}, ${site.longitude.toFixed(4)}`
        : "coordinates not published";
    artifacts.push({
      id: site.id,
      kind: "site",
      title: site.name,
      detail: [site.storage_method, site.description, coords]
        .filter(Boolean)
        .join(" · "),
      submitted: true,
      reference: site.id,
    });
  }

  for (const doc of input.documents) {
    artifacts.push({
      id: doc.id,
      kind: classifyDefinitionTitle(doc.display_name),
      title: doc.display_name,
      detail: `Published on the Isometric Registry on ${formatDate(doc.submission_date) ?? "an unknown date"}.`,
      submitted: true,
      submittedOn: formatDate(doc.submission_date),
      href: doc.url,
      reference: doc.id,
    });
  }

  for (const template of input.templates) {
    artifacts.push({
      id: template.id,
      kind: "lca",
      title: template.display_name || "GHG entry template",
      detail: "Frozen GHG recipe from the project life-cycle assessment. Inputs marked period are filled each reporting window; fixed values stay on the LCA.",
      submitted: true,
      reference: template.id,
      recipe: templateRecipe(template),
    });
  }

  for (const entry of input.preOp) {
    const req: ProjectMonitoringRequirement = entry.requirement;
    const count = entry.submissions.length;
    artifacts.push({
      id: req.id,
      kind: "site",
      title: req.display_name,
      detail:
        count === 0
          ? "Pre-operational characterisation — nothing on file in Certify yet."
          : `Pre-operational characterisation with ${count} submission${count === 1 ? "" : "s"} already in Certify.`,
      submitted: count > 0,
      submittedOn: formatDate(entry.submissions[0]?.valid_to),
      reference: req.id,
    });
  }

  const hasPdd = artifacts.some((row) => row.kind === "pdd" && row.submitted);
  const hasLca = artifacts.some((row) => row.kind === "lca" && row.submitted);
  const hasValidation = artifacts.some(
    (row) => row.kind === "validation" && row.submitted,
  );
  const complete = hasPdd && hasLca;
  const earliestDoc = artifacts
    .map((row) => row.submittedOn)
    .filter((value): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}/.test(value)))
    .map((value) => value.slice(0, 10))
    .sort()[0];

  return {
    projectId: input.projectId,
    certifyProjectId: input.certifyProjectId,
    origin: input.origin,
    complete,
    createdOn: input.createdOn ?? earliestDoc,
    warning: input.warnings.length > 0 ? input.warnings.join(" · ") : undefined,
    artifacts,
    flags: { hasPdd, hasLca, hasValidation },
  };
}

export function bundledDefinition(
  projectId: string,
  certifyProjectId: string,
  warning: string,
): ProjectDefinition {
  return {
    projectId,
    certifyProjectId,
    origin: "bundled",
    complete: false,
    warning,
    artifacts: [],
    flags: { hasPdd: false, hasLca: false, hasValidation: false },
  };
}
