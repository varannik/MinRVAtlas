/**
 * A site layout is a hand-written plan of one project site: the objects on it,
 * the flows between them and the sensors on each object.
 *
 * Positions are pixel coordinates on the site's reference photo (x to the right,
 * y down), so anyone can move an object by reading the photo in an image viewer.
 * `metresPerPixel` turns them into metres in the 3D scene.
 */

export type SiteZone =
  | "surface"
  | "subsurface"
  | "energy"
  | "ancillary"
  | "storage"
  | "legacy";

/** A point on the reference photo, in pixels. */
export type Px = [x: number, y: number];

export type SitePart =
  | {
      shape: "box";
      at: Px;
      /** Footprint in pixels: [width along x, depth along y]. */
      size: Px;
      heightM: number;
      color?: string;
      /** Rotation about the vertical axis, in degrees, clockwise on the photo. */
      rotateDeg?: number;
    }
  | {
      shape: "cylinder";
      at: Px;
      radiusPx: number;
      heightM: number;
      color?: string;
      /** Dark disc on top, for open water tanks. */
      water?: boolean;
    }
  | {
      shape: "solar";
      at: Px;
      size: Px;
      rows: number;
      rotateDeg?: number;
    }
  | {
      shape: "well";
      at: Px;
      /** Drilled depth in metres. Placeholder until the well records are on file. */
      depthM: number;
    };

export type SensorStatus = "ok" | "warn" | "alarm";

/**
 * How a value is obtained, as in the operator's block diagram:
 * continuous = metered stream, discrete = sample, ticket or count,
 * estimated = calculated rather than measured.
 */
export type MeasurementType = "continuous" | "discrete" | "estimated";

export type SiteSensor = {
  id: string;
  label: string;
  /** Stream column this sensor feeds, as it appears in operator CSVs. */
  metric: string;
  unit: string;
  /** Demo signal until live stream values are wired in. */
  demo: {
    base: number;
    jitter: number;
    /** Grows by this much per second instead of wobbling (totalisers). */
    risePerSec?: number;
    decimals?: number;
  };
  /** Column is suggested here and not in the stream schema yet. */
  proposed?: boolean;
  /** Defaults to continuous. */
  measurement?: MeasurementType;
  /** Process block the value belongs to, e.g. "Capture unit". */
  group?: string;
  /** Value bands for the status colour. Omit for counters. */
  warnAbove?: number;
  alarmAbove?: number;
  warnBelow?: number;
};

/** A reading to feature on a panel's preview card. */
export type Highlight = { host: string; sensor: string };

export type SiteObject = {
  id: string;
  name: string;
  /** Short code shown on the label, e.g. "HASA 4". */
  code?: string;
  zone: SiteZone;
  description: string;
  parts: SitePart[];
  /** Where the floating label and sensor card sit. Defaults to the first part. */
  labelAt?: Px;
  sensors?: SiteSensor[];
};

export type FlowKind = "co2" | "water" | "injectate" | "power" | "data";

export type SiteFlow = {
  id: string;
  kind: FlowKind;
  label: string;
  /** Waypoints on the photo. Data flows arc through the air; the rest run along the ground. */
  path: Px[];
  /** Flow continues into the sky towards the cloud (data uplink). */
  uplink?: boolean;
};

export type SitePad = {
  id: string;
  points: Px[];
  color: string;
};

export type SiteLayout = {
  projectId: string;
  name: string;
  photo: {
    src: string;
    width: number;
    height: number;
    metresPerPixel: number;
    /** How the scale was worked out, so it can be checked. */
    scaleNote: string;
  };
  pads: SitePad[];
  /** Perimeter fence, as a polyline on the photo. */
  fence?: Px[];
  objects: SiteObject[];
  flows: SiteFlow[];
  /** Anything in the layout that is guessed rather than known. */
  assumptions: string[];
  /** Readings on the storage site's preview card. */
  highlights?: Highlight[];
  /** Regional view of how captured CO₂ reaches the site. */
  feedstock?: SupplyLayout;
  /** Regional view of how injection water reaches the site. */
  water?: SupplyLayout;
  /** Geology, wells and fracture network below the site. */
  subsurface?: SubsurfaceModel;
};

// ---------------------------------------------------------------------------
// Regional supply view: where the injection water comes from and how it travels.

export type LatLng = [lat: number, lng: number];

/** Degrees: bearing clockwise from north, pitch from straight down. */
export type CameraAngle = { bearing: number; pitch: number };

export type SupplyRole = "capture" | "primary" | "backup" | "site";

export type SupplyNode = {
  id: string;
  name: string;
  role: SupplyRole;
  at: LatLng;
  description: string;
  address?: string;
  /** Position is read off a map rather than surveyed. */
  estimated?: boolean;
  sensors?: SiteSensor[];
};

export type SupplyRoute = {
  id: string;
  from: string;
  to: string;
  role: "primary" | "backup";
  distanceKm: number;
  durationMin: number;
  path: LatLng[];
  /** Shown when the route is selected. */
  name?: string;
  provider?: string;
  description?: string;
  sensors?: SiteSensor[];
};

export type SupplyLayout = {
  /** Sets route and tanker colours and the summary panel. */
  commodity: "co2" | "water";
  name: string;
  /** 3D map settings: satellite imagery draped over real terrain. */
  map: {
    /** Vertical exaggeration so the relief reads at regional scale. */
    exaggeration: number;
    /** Camera for wide panels (full screen) and tall ones (preview column). */
    wide: CameraAngle;
    tall: CameraAngle;
  };
  nodes: SupplyNode[];
  routes: SupplyRoute[];
  assumptions: string[];
  /** Readings on the chain's preview card. */
  highlights?: Highlight[];
};

// ---------------------------------------------------------------------------
// Subsurface model: geology, wells, fracture network and monitoring, tied to
// the site plan's wells. Every element says what kind of evidence it rests on.

/**
 * measured = direct observation (logs, cores, surveys, well data);
 * interpreted = inferred from measurements;
 * simulated = modelled fluid movement, reaction or precipitation.
 */
export type Evidence = "measured" | "interpreted" | "simulated";

export type SubsurfaceLayer = {
  id: string;
  name: string;
  /** Metres below surface. */
  top: number;
  base: number;
  color: string;
  evidence: Evidence;
  description: string;
};

export type WellInterval = {
  label: string;
  top: number;
  base: number;
  kind: "casing" | "perforated" | "screen" | "geophones";
};

export type WellSensorPoint = {
  label: string;
  depth: number;
  kind: "pressure-temperature" | "sampling" | "geophone";
};

export type SubsurfaceWell = {
  /** Site object this well belongs to (its plan position comes from there). */
  objectId: string;
  role: "injection" | "observation" | "shallow-aquifer" | "seismic";
  /** Evidence for the drilled depth (the depth itself is the site plan's). */
  evidence: Evidence;
  note: string;
  intervals: WellInterval[];
  sensors: WellSensorPoint[];
};

export type FractureSet = {
  name: string;
  /** Degrees from horizontal. */
  dip: [number, number];
  /** Dip direction, degrees clockwise from north. */
  azimuth: [number, number];
};

export type FractureZone = {
  layerId: string;
  count: number;
  /** Fractures fall within this distance (m) of the injection well. */
  radius: number;
  length: [number, number];
  /** Millimetres. */
  aperture: [number, number];
  /** Shares of open, partially filled and sealed fractures (sum to 1). */
  states: { open: number; partial: number; sealed: number };
  /** What fills partly or fully sealed fractures. */
  filling: string;
};

export type ParameterRow = { label: string; value: string; evidence: Evidence };

export type SubsurfaceModel = {
  /** Block footprint in metres (the surface TEM survey area). */
  block: { length: number; width: number; bottom: number };
  /** Site object the block and fracture network are centred on. */
  centreOn: string;
  reservoir: { top: number; base: number };
  layers: SubsurfaceLayer[];
  wells: SubsurfaceWell[];
  dfn: { seed: number; sets: FractureSet[]; zones: FractureZone[] };
  tem: { stationSpacing: number; evidence: Evidence };
  parameters: ParameterRow[];
  sources: string[];
  notes: string[];
};
