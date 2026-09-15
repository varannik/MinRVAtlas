import "server-only";

import {
  feedstockBatchPath,
  feedstockBatchesPath,
  feedstockTypePath,
  measurementLocationPath,
  measurementLocationsPath,
  measurementSamplePath,
  measurementSamplesPath,
  monitoringSubmissionsPath,
  storageLocationPath,
  storageLocationsPath,
  type FeedstockBatch,
  type FeedstockType,
  type MeasurementLocation,
  type MeasurementSample,
  type MonitoringSubmission,
  type StorageLocation,
} from "./api";
import {
  fieldSourcePrefix,
  pddSourcePrefix,
  feedstockSourcePrefix,
  siteSourcePrefix,
} from "./pdd-catalog";
import { fetchProjectSetup } from "./setup";
import type { SetupAction, SetupWriteResult } from "./setup-types";
import {
  mrvJson,
  referenceId,
  toDate,
  uploadCertifySource,
  SubmitBlockedError,
  type SubmitFile,
} from "./write";
import { classifyRegistryFailure, destroy } from "./server";
import type { OrgCredentials, RegistryCredentials, RegistryEnvironment } from "../types";

export type SetupWriteInput = {
  environment: RegistryEnvironment;
  credentials: RegistryCredentials;
  catalogProjectId: string;
  methodologyKey?: string;
  files: SubmitFile[];
  payload: SetupAction;
};

function emptyResult(): SetupWriteResult {
  return { ok: false, warnings: [], sourceIds: [], ids: [] };
}

async function snapshot(
  input: SetupWriteInput,
): Promise<ProjectSetupSnapshotOrNone> {
  return fetchProjectSetup({
    environment: input.environment,
    catalogProjectId: input.catalogProjectId,
    certifyProjectId: input.credentials.externalProjectId,
    methodologyKey: input.methodologyKey,
    credentials: input.credentials,
  });
}

type ProjectSetupSnapshotOrNone = Awaited<ReturnType<typeof fetchProjectSetup>>;

async function uploadTaggedSource(
  input: SetupWriteInput,
  displayName: string,
  description: string,
  supplierReferenceId: string,
): Promise<{ sourceIds: string[]; warnings: string[] }> {
  const sourceIds: string[] = [];
  const warnings: string[] = [];
  for (const file of input.files) {
    try {
      const source = await uploadCertifySource({
        environment: input.environment,
        credentials: input.credentials,
        file,
        displayName: `${displayName} · ${file.name}`,
        description,
        supplierReferenceId: referenceId([
          supplierReferenceId.replace(/:$/, ""),
          file.name,
          crypto.randomUUID(),
        ]),
      });
      sourceIds.push(source.id);
    } catch (error) {
      if (error instanceof SubmitBlockedError) throw error;
      const classified = classifyRegistryFailure(error);
      warnings.push(`Source skipped (${file.name}): ${classified.message}`);
    }
  }
  return { sourceIds, warnings };
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = (cells[index] ?? "").trim();
    });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

const META_COLUMNS = new Set([
  "supplier_reference_id",
  "measurement_location_id",
  "measurement_date",
  "measured_at",
  "measurement_type",
  "feedstock_batch_id",
  "storage_location_id",
  "production_batch_id",
  "project_id",
]);

function quantityKindFromHeader(header: string): { quantity_kind: string; unit: string } {
  const match = header.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const raw = (match?.[1] ?? header).trim();
  const unit = (match?.[2] ?? "1").trim() || "1";
  const quantity_kind = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return { quantity_kind: quantity_kind || "value", unit };
}

async function createSamplesFromCsv(
  input: SetupWriteInput,
  csvText: string,
): Promise<{ ids: string[]; warnings: string[] }> {
  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    return { ids: [], warnings: ["CSV needs a header row and at least one sample."] };
  }
  const ids: string[] = [];
  const warnings: string[] = [];
  for (const row of rows) {
    const supplier =
      row.supplier_reference_id ||
      referenceId(["minrv-mlc", crypto.randomUUID()]);
    const measuredAt = row.measured_at || row.measurement_date;
    const locationId = row.measurement_location_id || null;
    const measurementType = row.measurement_type;
    if (!measuredAt || !measurementType) {
      warnings.push(
        `Skipped ${supplier}: measurement_type and measurement_date (or measured_at) are required.`,
      );
      continue;
    }
    const values: {
      measurement_property: { quantity_kind: string; qualifier: null };
      value: { magnitude: number; unit: string };
    }[] = [];
    for (const [header, raw] of Object.entries(row)) {
      if (META_COLUMNS.has(header) || raw === "") continue;
      const magnitude = Number(raw);
      if (!Number.isFinite(magnitude)) continue;
      const mapped = quantityKindFromHeader(header);
      values.push({
        measurement_property: { quantity_kind: mapped.quantity_kind, qualifier: null },
        value: { magnitude, unit: mapped.unit },
      });
    }
    try {
      const sample = await mrvJson<MeasurementSample>(
        input.environment,
        measurementSamplesPath(),
        input.credentials,
        {
          body: {
            supplier_reference_id: supplier.slice(0, 200),
            measured_at: toDate(measuredAt, false),
            project_id: input.credentials.externalProjectId,
            measurement_location_id: locationId,
            measurement_type: measurementType,
            feedstock_batch_id: row.feedstock_batch_id || null,
            storage_location_id: row.storage_location_id || null,
            production_batch_id: row.production_batch_id || null,
            values,
          },
        },
      );
      ids.push(sample.id);
    } catch (error) {
      const classified = classifyRegistryFailure(error);
      warnings.push(`Sample ${supplier} skipped: ${classified.message}`);
    }
  }
  return { ids, warnings };
}

export async function submitSetupWrite(input: SetupWriteInput): Promise<SetupWriteResult> {
  const projectId = input.credentials.externalProjectId;
  const org: OrgCredentials = {
    accessToken: input.credentials.accessToken,
    clientSecret: input.credentials.clientSecret,
  };
  try {
    const payload = input.payload;
    if (payload.action === "uploadDesignSource") {
      if (input.files.length === 0) {
        return { ...emptyResult(), blocked: "Upload a file before submitting to Certify" };
      }
      const description = [
        `category=${payload.category}`,
        payload.reason ? `reason=${payload.reason}` : "",
        payload.pages ? `pages=${payload.pages}` : "",
        payload.notes,
      ]
        .filter(Boolean)
        .join(" · ");
      const uploaded = await uploadTaggedSource(
        input,
        payload.requirementKey,
        description,
        pddSourcePrefix(payload.section, payload.requirementKey),
      );
      return {
        ok: uploaded.sourceIds.length > 0,
        warnings: uploaded.warnings,
        sourceIds: uploaded.sourceIds,
        ids: uploaded.sourceIds,
        snapshot: await snapshot(input),
        error:
          uploaded.sourceIds.length === 0
            ? uploaded.warnings[0] ?? "Source upload failed"
            : undefined,
      };
    }

    if (payload.action === "createStorageLocation") {
      const location = await mrvJson<StorageLocation>(
        input.environment,
        storageLocationsPath(projectId),
        input.credentials,
        {
          body: {
            project_id: projectId,
            name: payload.name.slice(0, 100),
            latitude: payload.latitude,
            longitude: payload.longitude,
            storage_method: payload.storageMethod,
            description: payload.description?.slice(0, 2000) || undefined,
            supplier_reference_id:
              payload.supplierReferenceId?.slice(0, 200) ||
              referenceId(["minrv-slc", payload.name, crypto.randomUUID()]),
          },
        },
      );
      return {
        ok: true,
        warnings: [],
        sourceIds: [],
        ids: [location.id],
        snapshot: await snapshot(input),
      };
    }

    if (payload.action === "patchStorageLocation") {
      const body: Record<string, unknown> = {};
      if (payload.name) body.name = payload.name.slice(0, 100);
      if (payload.latitude != null) body.latitude = payload.latitude;
      if (payload.longitude != null) body.longitude = payload.longitude;
      if (payload.storageMethod) body.storage_method = payload.storageMethod;
      if (payload.description != null) body.description = payload.description.slice(0, 2000);
      if (payload.supplierReferenceId != null) {
        body.supplier_reference_id = payload.supplierReferenceId.slice(0, 200);
      }
      const location = await mrvJson<StorageLocation>(
        input.environment,
        storageLocationPath(projectId, payload.locationId),
        input.credentials,
        { method: "PATCH", body },
      );
      return {
        ok: true,
        warnings: [],
        sourceIds: [],
        ids: [location.id],
        snapshot: await snapshot(input),
      };
    }

    if (payload.action === "uploadSiteSource") {
      if (input.files.length === 0) {
        return { ...emptyResult(), blocked: "Upload a file before submitting to Certify" };
      }
      const uploaded = await uploadTaggedSource(
        input,
        "Storage site",
        payload.notes ||
          "Polygon or site file. Native GeoJSON geometry still has to be uploaded in Certify.",
        siteSourcePrefix(payload.locationId),
      );
      return {
        ok: uploaded.sourceIds.length > 0,
        warnings: uploaded.warnings,
        sourceIds: uploaded.sourceIds,
        ids: uploaded.sourceIds,
        snapshot: await snapshot(input),
        error:
          uploaded.sourceIds.length === 0
            ? uploaded.warnings[0] ?? "Source upload failed"
            : undefined,
      };
    }

    if (payload.action === "submitSiteMonitoring") {
      if (input.files.length === 0) {
        return { ...emptyResult(), blocked: "Upload a file before submitting to Certify" };
      }
      if (payload.requirementIds.length === 0) {
        return { ...emptyResult(), blocked: "Select at least one monitoring requirement" };
      }
      const uploaded = await uploadTaggedSource(
        input,
        "Site monitoring",
        payload.notes,
        siteSourcePrefix(payload.locationId),
      );
      const ids: string[] = [];
      const warnings = [...uploaded.warnings];
      for (const sourceId of uploaded.sourceIds) {
        for (const requirementId of payload.requirementIds) {
          try {
            const row = await mrvJson<MonitoringSubmission>(
              input.environment,
              monitoringSubmissionsPath(projectId, requirementId),
              input.credentials,
              {
                body: {
                  source_id: sourceId,
                  valid_from: toDate(payload.periodStart, false),
                  valid_to: toDate(payload.periodEnd, true),
                  notes: payload.notes.slice(0, 300) || null,
                  supplier_reference_id: referenceId([
                    "minrv-mns",
                    payload.locationId,
                    requirementId,
                    sourceId,
                  ]),
                },
              },
            );
            ids.push(row.id);
          } catch (error) {
            const classified = classifyRegistryFailure(error);
            warnings.push(`Monitoring submission skipped: ${classified.message}`);
          }
        }
      }
      return {
        ok: ids.length > 0,
        warnings,
        sourceIds: uploaded.sourceIds,
        ids,
        snapshot: await snapshot(input),
        error: ids.length === 0 ? warnings[0] ?? "Monitoring submission failed" : undefined,
      };
    }

    if (payload.action === "patchFeedstockType") {
      const body: Record<string, unknown> = {};
      if (payload.name) body.name = payload.name.slice(0, 500);
      if (payload.supplierReferenceId != null) {
        body.supplier_reference_id = payload.supplierReferenceId.slice(0, 200);
      }
      const row = await mrvJson<FeedstockType>(
        input.environment,
        feedstockTypePath(payload.feedstockTypeId),
        input.credentials,
        { method: "PATCH", body },
      );
      return {
        ok: true,
        warnings: [],
        sourceIds: [],
        ids: [row.id],
        snapshot: await snapshot(input),
      };
    }

    if (payload.action === "createFeedstockBatch") {
      const row = await mrvJson<FeedstockBatch>(
        input.environment,
        feedstockBatchesPath(),
        input.credentials,
        {
          body: {
            feedstock_type_id: payload.feedstockTypeId,
            display_name: payload.displayName.slice(0, 150),
            delivery_date: payload.deliveryDate.slice(0, 10),
            mass: { magnitude: payload.magnitude, unit: payload.unit },
            supplier_reference_id:
              payload.supplierReferenceId?.slice(0, 200) ||
              referenceId(["minrv-ftb", payload.displayName, crypto.randomUUID()]),
          },
        },
      );
      return {
        ok: true,
        warnings: [],
        sourceIds: [],
        ids: [row.id],
        snapshot: await snapshot(input),
      };
    }

    if (payload.action === "deleteFeedstockBatch") {
      await destroy("mrv", input.environment, feedstockBatchPath(payload.batchId), org);
      return {
        ok: true,
        warnings: [],
        sourceIds: [],
        ids: [payload.batchId],
        snapshot: await snapshot(input),
      };
    }

    if (payload.action === "uploadFeedstockSource") {
      if (input.files.length === 0) {
        return { ...emptyResult(), blocked: "Upload a file before submitting to Certify" };
      }
      const uploaded = await uploadTaggedSource(
        input,
        "Feedstock evidence",
        payload.notes,
        feedstockSourcePrefix(payload.feedstockTypeId),
      );
      return {
        ok: uploaded.sourceIds.length > 0,
        warnings: uploaded.warnings,
        sourceIds: uploaded.sourceIds,
        ids: uploaded.sourceIds,
        snapshot: await snapshot(input),
        error:
          uploaded.sourceIds.length === 0
            ? uploaded.warnings[0] ?? "Source upload failed"
            : undefined,
      };
    }

    if (payload.action === "createMeasurementLocation") {
      const row = await mrvJson<MeasurementLocation>(
        input.environment,
        measurementLocationsPath(),
        input.credentials,
        {
          body: {
            project_id: projectId,
            latitude: payload.latitude,
            longitude: payload.longitude,
            supplier_reference_id: payload.supplierReferenceId.slice(0, 200),
          },
        },
      );
      return {
        ok: true,
        warnings: [],
        sourceIds: [],
        ids: [row.id],
        snapshot: await snapshot(input),
      };
    }

    if (payload.action === "deleteMeasurementLocation") {
      await destroy(
        "mrv",
        input.environment,
        measurementLocationPath(payload.locationId),
        org,
      );
      return {
        ok: true,
        warnings: [],
        sourceIds: [],
        ids: [payload.locationId],
        snapshot: await snapshot(input),
      };
    }

    if (payload.action === "createMeasurementSamples") {
      const created = await createSamplesFromCsv(input, payload.csvText);
      let sourceIds: string[] = [];
      const warnings = [...created.warnings];
      if (input.files.length > 0) {
        const uploaded = await uploadTaggedSource(
          input,
          "Field samples",
          "Sample CSV attached as a Certify source.",
          fieldSourcePrefix(),
        );
        sourceIds = uploaded.sourceIds;
        warnings.push(...uploaded.warnings);
      }
      return {
        ok: created.ids.length > 0,
        warnings,
        sourceIds,
        ids: created.ids,
        snapshot: await snapshot(input),
        error:
          created.ids.length === 0
            ? created.warnings[0] ?? "No samples were created"
            : undefined,
      };
    }

    if (payload.action === "deleteMeasurementSample") {
      await destroy("mrv", input.environment, measurementSamplePath(payload.sampleId), org);
      return {
        ok: true,
        warnings: [],
        sourceIds: [],
        ids: [payload.sampleId],
        snapshot: await snapshot(input),
      };
    }

    if (payload.action === "uploadFieldGeojson") {
      if (input.files.length === 0) {
        return { ...emptyResult(), blocked: "Upload a GeoJSON file" };
      }
      const uploaded = await uploadTaggedSource(
        input,
        "Removal area",
        payload.notes ||
          "Removal-area / project-area GeoJSON. Native Certify polygons are still uploaded in the Certify UI.",
        fieldSourcePrefix(),
      );
      return {
        ok: uploaded.sourceIds.length > 0,
        warnings: uploaded.warnings,
        sourceIds: uploaded.sourceIds,
        ids: uploaded.sourceIds,
        snapshot: await snapshot(input),
        error:
          uploaded.sourceIds.length === 0
            ? uploaded.warnings[0] ?? "Upload failed"
            : undefined,
      };
    }

    return { ...emptyResult(), error: "Unknown setup action" };
  } catch (error) {
    if (error instanceof SubmitBlockedError) {
      return { ...emptyResult(), blocked: error.message };
    }
    const classified = classifyRegistryFailure(error);
    const locked = /lock|immutable|cannot be edited|not editable/i.test(classified.message);
    return {
      ...emptyResult(),
      ok: false,
      error: classified.message,
      blocked: locked ? classified.message : undefined,
    };
  }
}

export function parseSetupAction(raw: unknown): SetupAction | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { action?: string };
  if (typeof row.action !== "string") return null;
  return raw as SetupAction;
}
