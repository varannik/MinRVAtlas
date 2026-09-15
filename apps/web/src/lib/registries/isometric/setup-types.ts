import type { ProjectDefinition } from "@/lib/project-definition";
import type {
  FeedstockBatch,
  FeedstockType,
  MeasurementLocation,
  MeasurementSample,
  MonitoringSubmission,
  ProjectMonitoringRequirement,
  Source,
  StorageLocation,
  StorageMethod,
} from "./api";
import type { PddSectionId, PddSourceCategory } from "./pdd-catalog";

export type SetupTabId = "design" | "sites" | "feedstocks" | "measurements";

export type ValidationStage = "draft" | "pre-screen" | "vvb" | "validated";

export type SetupSite = {
  location: StorageLocation;
  requirements: ProjectMonitoringRequirement[];
  submissions: MonitoringSubmission[];
};

export type ProjectSetupSnapshot = {
  projectId: string;
  certifyProjectId: string;
  origin: "registry-api" | "bundled";
  stage: ValidationStage;
  locked: boolean;
  tabs: SetupTabId[];
  definition: ProjectDefinition;
  sources: Source[];
  sites: SetupSite[];
  feedstockTypes: FeedstockType[];
  feedstockBatches: FeedstockBatch[];
  measurementLocations: MeasurementLocation[];
  measurementSamples: MeasurementSample[];
  warning?: string;
};

export type SetupWriteResult = {
  ok: boolean;
  blocked?: string;
  error?: string;
  warnings: string[];
  sourceIds: string[];
  ids: string[];
  snapshot?: ProjectSetupSnapshot;
};

export type SetupAction =
  | {
      action: "uploadDesignSource";
      section: PddSectionId;
      requirementKey: string;
      category: PddSourceCategory;
      reason: string;
      pages: string;
      notes: string;
    }
  | {
      action: "createStorageLocation";
      name: string;
      latitude: number;
      longitude: number;
      storageMethod: StorageMethod;
      description?: string;
      supplierReferenceId?: string;
    }
  | {
      action: "patchStorageLocation";
      locationId: string;
      name?: string;
      latitude?: number;
      longitude?: number;
      storageMethod?: StorageMethod;
      description?: string;
      supplierReferenceId?: string;
    }
  | {
      action: "submitSiteMonitoring";
      locationId: string;
      requirementIds: string[];
      notes: string;
      periodStart?: string;
      periodEnd?: string;
    }
  | {
      action: "uploadSiteSource";
      locationId: string;
      notes: string;
    }
  | {
      action: "patchFeedstockType";
      feedstockTypeId: string;
      name?: string;
      supplierReferenceId?: string;
    }
  | {
      action: "createFeedstockBatch";
      feedstockTypeId: string;
      displayName: string;
      deliveryDate: string;
      magnitude: number;
      unit: string;
      supplierReferenceId?: string;
    }
  | {
      action: "deleteFeedstockBatch";
      batchId: string;
    }
  | {
      action: "uploadFeedstockSource";
      feedstockTypeId: string;
      notes: string;
    }
  | {
      action: "createMeasurementLocation";
      latitude: number;
      longitude: number;
      supplierReferenceId: string;
    }
  | {
      action: "deleteMeasurementLocation";
      locationId: string;
    }
  | {
      action: "createMeasurementSamples";
      csvText: string;
    }
  | {
      action: "deleteMeasurementSample";
      sampleId: string;
    }
  | {
      action: "uploadFieldGeojson";
      notes: string;
    };
