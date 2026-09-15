import "server-only";

import { bundledDefinition } from "./definition";
import {
  feedstockTypeBatchesPath,
  feedstockTypesPath,
  measurementLocationsPath,
  measurementSamplesPath,
  monitoringSubmissionsPath,
  sourcesPath,
  storageLocationMonitoringPath,
  storageLocationsPath,
  type FeedstockBatch,
  type FeedstockType,
  type MeasurementLocation,
  type MeasurementSample,
  type MonitoringSubmission,
  type ProjectMonitoringRequirement,
  type Source,
  type StorageLocation,
} from "./api";
import { fetchProjectDefinition, mapWithLimit, softCollect } from "./server";
import { inferValidationStage, setupIsLocked } from "./setup-stage";
import type {
  ProjectSetupSnapshot,
  SetupSite,
  SetupTabId,
} from "./setup-types";
import type { OrgCredentials, RegistryEnvironment } from "../types";

const SUBMISSION_CONCURRENCY = 4;

function visibleTabs(): SetupTabId[] {
  return ["design", "sites", "feedstocks", "measurements"];
}

export async function fetchProjectSetup(input: {
  environment: RegistryEnvironment;
  catalogProjectId: string;
  certifyProjectId: string;
  methodologyKey?: string;
  credentials: OrgCredentials;
}): Promise<ProjectSetupSnapshot> {
  const { environment, catalogProjectId, certifyProjectId, credentials } = input;

  const [definition, sources, locations, feedstockTypes, measurementLocations, measurementSamples] =
    await Promise.all([
      fetchProjectDefinition(environment, catalogProjectId, certifyProjectId, credentials),
      softCollect<Source>("mrv", environment, sourcesPath(), credentials, {
        project_id: certifyProjectId,
      }),
      softCollect<StorageLocation>(
        "mrv",
        environment,
        storageLocationsPath(certifyProjectId),
        credentials,
      ),
      softCollect<FeedstockType>("mrv", environment, feedstockTypesPath(), credentials),
      softCollect<MeasurementLocation>(
        "mrv",
        environment,
        measurementLocationsPath(),
        credentials,
        { project_id: certifyProjectId },
      ),
      softCollect<MeasurementSample>(
        "mrv",
        environment,
        measurementSamplesPath(),
        credentials,
        { project_id: certifyProjectId },
      ),
    ]);

  const batchLists = await mapWithLimit(
    feedstockTypes.nodes,
    SUBMISSION_CONCURRENCY,
    async (type) =>
      softCollect<FeedstockBatch>(
        "mrv",
        environment,
        feedstockTypeBatchesPath(type.id),
        credentials,
      ),
  );
  const feedstockBatches = {
    nodes: batchLists.flatMap((row) => row.nodes),
    warning: batchLists.map((row) => row.warning).find(Boolean),
  };

  const sites: SetupSite[] = await mapWithLimit(
    locations.nodes,
    SUBMISSION_CONCURRENCY,
    async (location) => {
      const requirements = await softCollect<ProjectMonitoringRequirement>(
        "mrv",
        environment,
        storageLocationMonitoringPath(certifyProjectId, location.id),
        credentials,
      );
      const submissionsNested = await mapWithLimit(
        requirements.nodes,
        SUBMISSION_CONCURRENCY,
        async (requirement) =>
          softCollect<MonitoringSubmission>(
            "mrv",
            environment,
            monitoringSubmissionsPath(certifyProjectId, requirement.id),
            credentials,
          ),
      );
      return {
        location,
        requirements: requirements.nodes,
        submissions: submissionsNested.flatMap((row) => row.nodes),
      };
    },
  );

  const stage = inferValidationStage(definition, sources.nodes);
  const warnings = [
    definition.warning,
    sources.warning,
    locations.warning,
    feedstockTypes.warning,
    feedstockBatches.warning,
    measurementLocations.warning,
    measurementSamples.warning,
  ].filter((row): row is string => Boolean(row));

  return {
    projectId: catalogProjectId,
    certifyProjectId,
    origin: definition.origin,
    stage,
    locked: setupIsLocked(stage),
    tabs: visibleTabs(),
    definition,
    sources: sources.nodes,
    sites,
    feedstockTypes: feedstockTypes.nodes,
    feedstockBatches: feedstockBatches.nodes,
    measurementLocations: measurementLocations.nodes,
    measurementSamples: measurementSamples.nodes,
    warning: warnings.length > 0 ? warnings.join(" · ") : undefined,
  };
}

export function bundledSetup(
  catalogProjectId: string,
  certifyProjectId: string,
  warning: string,
): ProjectSetupSnapshot {
  const definition = bundledDefinition(catalogProjectId, certifyProjectId, warning);
  return {
    projectId: catalogProjectId,
    certifyProjectId,
    origin: "bundled",
    stage: "draft",
    locked: false,
    tabs: ["design", "sites", "feedstocks", "measurements"],
    definition,
    sources: [],
    sites: [],
    feedstockTypes: [],
    feedstockBatches: [],
    measurementLocations: [],
    measurementSamples: [],
    warning,
  };
}
