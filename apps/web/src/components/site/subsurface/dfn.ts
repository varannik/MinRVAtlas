import type { FractureZone, SubsurfaceModel } from "@/lib/site-layouts";

/**
 * Discrete fracture network (DFN) for the subsurface view.
 *
 * Fractures are generated from the model's assumed statistics with a fixed
 * seed, so the same network appears every time. Connectivity is worked out
 * from the perforated injection interval through open and partly filled
 * fractures; arrival order along those paths drives the fluid, reaction and
 * carbonate stages. This is an illustration of fracture-controlled flow, not a
 * flow or reactive-transport solver.
 */

export type FractureState = "open" | "partial" | "sealed";

export type Fracture = {
  index: number;
  layerId: string;
  set: string;
  /** Scene metres; y is negative below surface. */
  x: number;
  y: number;
  z: number;
  depth: number;
  dip: number;
  azimuth: number;
  length: number;
  height: number;
  /** Millimetres. */
  aperture: number;
  /** m², parallel-plate (cubic law) estimate: aperture² / 12. */
  permeability: number;
  state: FractureState;
  filling: string;
  /** Unit normal of the fracture plane. */
  normal: [number, number, number];
  /** Hydraulically connected to the injection interval. */
  connected: boolean;
  /** Steps from the injection well along connected fractures. */
  hops: number;
  /** Flow-path length from the well, metres (Infinity if not connected). */
  pathM: number;
  /** 0..1 order of arrival along connected paths (Infinity if not connected). */
  arrival: number;
};

export type Speck = { x: number; y: number; z: number; arrival: number };
export type SeismicEvent = { x: number; y: number; z: number; arrival: number; fracture: number };

export type Dfn = {
  fractures: Fracture[];
  /** Carbonate precipitation points, sorted by arrival. */
  specks: Speck[];
  events: SeismicEvent[];
  maxPathM: number;
  connectedCount: number;
  /** Earliest arrival at the observation well's sampling interval, if reached. */
  observationArrival: number | null;
  /** True if any connected fracture lies above the serpentinised layer. */
  reachesShallow: boolean;
};

/** Deterministic random numbers (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Plane normal from dip (from horizontal) and dip direction (from north, scene −z). */
function normalOf(dip: number, azimuth: number): [number, number, number] {
  const d = toRad(dip);
  const a = toRad(azimuth);
  return [Math.sin(d) * Math.sin(a), Math.cos(d), -Math.sin(d) * Math.cos(a)];
}

function pickState(random: number, states: FractureZone["states"]): FractureState {
  if (random < states.open) return "open";
  if (random < states.open + states.partial) return "partial";
  return "sealed";
}

export type DfnFrame = {
  /** Injection well axis, scene metres. */
  well: { x: number; z: number };
  /** Observation well axis, if the plan has one. */
  observation?: { x: number; z: number };
  /** Block footprint centre and half sizes. */
  centre: { x: number; z: number };
  halfLength: number;
  halfWidth: number;
};

export function generateDfn(model: SubsurfaceModel, frame: DfnFrame): Dfn {
  const random = rng(model.dfn.seed);
  const layers = new Map(model.layers.map((layer) => [layer.id, layer]));
  const fractures: Fracture[] = [];

  for (const zone of model.dfn.zones) {
    const layer = layers.get(zone.layerId);
    if (!layer) continue;
    let made = 0;
    let guard = 0;
    while (made < zone.count && guard < zone.count * 20) {
      guard += 1;
      // Uniform point in a disc around the well, kept inside the block.
      const r = zone.radius * Math.sqrt(random());
      const theta = random() * Math.PI * 2;
      const x = frame.well.x + r * Math.cos(theta);
      const z = frame.well.z + r * Math.sin(theta);
      if (Math.abs(x - frame.centre.x) > frame.halfLength - 5) continue;
      if (Math.abs(z - frame.centre.z) > frame.halfWidth - 5) continue;
      const depth = layer.top + 2 + random() * (layer.base - layer.top - 4);
      const set = model.dfn.sets[Math.floor(random() * model.dfn.sets.length)];
      const dip = set.dip[0] + random() * (set.dip[1] - set.dip[0]);
      const azimuth = (set.azimuth[0] + random() * (set.azimuth[1] - set.azimuth[0])) % 360;
      // Lengths skew short, as in natural fracture populations.
      const length = zone.length[0] + Math.pow(random(), 2) * (zone.length[1] - zone.length[0]);
      const aperture = zone.aperture[0] * Math.pow(zone.aperture[1] / zone.aperture[0], random());
      const state = pickState(random(), zone.states);
      const apertureM = aperture / 1000;
      fractures.push({
        index: fractures.length,
        layerId: zone.layerId,
        set: set.name,
        x,
        y: -depth,
        z,
        depth,
        dip,
        azimuth,
        length,
        height: length * (0.45 + random() * 0.3),
        aperture,
        permeability: (apertureM * apertureM) / 12,
        state,
        filling: state === "open" ? "none" : zone.filling,
        normal: normalOf(dip, azimuth),
        connected: false,
        hops: Infinity,
        pathM: Infinity,
        arrival: Infinity,
      });
      made += 1;
    }
  }

  // Flow paths: shortest weighted path from the perforated interval through
  // open and partly filled fractures that overlap (Dijkstra over ~400 nodes).
  const n = fractures.length;
  const path = new Float64Array(n).fill(Infinity);
  const hops = new Float64Array(n).fill(Infinity);
  const done = new Uint8Array(n);
  const flowing = (f: Fracture) => f.state !== "sealed";
  const cost = (f: Fracture) => (f.state === "partial" ? 1.8 : 1);

  for (const f of fractures) {
    if (!flowing(f)) continue;
    if (f.depth < model.reservoir.top || f.depth > model.reservoir.base) continue;
    const offset = Math.hypot(f.x - frame.well.x, f.z - frame.well.z);
    if (offset < f.length / 2 + 4) {
      path[f.index] = offset * cost(f);
      hops[f.index] = 0;
    }
  }

  for (;;) {
    let best = -1;
    for (let i = 0; i < n; i += 1) {
      if (!done[i] && path[i] < Infinity && (best < 0 || path[i] < path[best])) best = i;
    }
    if (best < 0) break;
    done[best] = 1;
    const a = fractures[best];
    for (let j = 0; j < n; j += 1) {
      if (done[j]) continue;
      const b = fractures[j];
      if (!flowing(b)) continue;
      const gap = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (gap > 0.42 * (a.length + b.length)) continue;
      const next = path[best] + gap * cost(b);
      if (next < path[j]) {
        path[j] = next;
        hops[j] = hops[best] + 1;
      }
    }
  }

  let maxPathM = 0;
  for (const f of fractures) {
    if (path[f.index] < Infinity) maxPathM = Math.max(maxPathM, path[f.index]);
  }
  let connectedCount = 0;
  let reachesShallow = false;
  const shallowBase = model.layers.find((layer) => layer.id === "serpentinised")?.top ?? 400;
  for (const f of fractures) {
    if (path[f.index] === Infinity) continue;
    f.connected = true;
    f.pathM = path[f.index];
    f.hops = hops[f.index];
    f.arrival = maxPathM > 0 ? path[f.index] / maxPathM : 0;
    connectedCount += 1;
    if (f.depth < shallowBase) reachesShallow = true;
  }

  // Carbonate precipitation points on the walls of connected fractures.
  const specks: Speck[] = [];
  const events: SeismicEvent[] = [];
  for (const f of fractures) {
    if (!f.connected) continue;
    const [nx, ny, nz] = f.normal;
    // Two in-plane axes.
    const ux = Math.abs(ny) < 0.95 ? [-nz, 0, nx] : [1, 0, 0];
    const uLen = Math.hypot(ux[0], ux[1], ux[2]);
    const u = [ux[0] / uLen, ux[1] / uLen, ux[2] / uLen];
    const v = [ny * u[2] - nz * u[1], nz * u[0] - nx * u[2], nx * u[1] - ny * u[0]];
    const count = 4 + Math.floor(f.length / 8);
    for (let k = 0; k < count; k += 1) {
      const s = (random() - 0.5) * f.length;
      const t = (random() - 0.5) * f.height;
      specks.push({
        x: f.x + u[0] * s + v[0] * t,
        y: f.y + u[1] * s + v[1] * t,
        z: f.z + u[2] * s + v[2] * t,
        arrival: f.arrival + random() * 0.08,
      });
    }
    if (f.state === "open" && f.index % 4 === 0) {
      events.push({ x: f.x, y: f.y, z: f.z, arrival: f.arrival, fracture: f.index });
    }
  }
  specks.sort((a, b) => a.arrival - b.arrival);

  let observationArrival: number | null = null;
  if (frame.observation) {
    for (const f of fractures) {
      if (!f.connected) continue;
      if (f.depth < model.reservoir.top || f.depth > model.reservoir.base) continue;
      const offset = Math.hypot(f.x - frame.observation.x, f.z - frame.observation.z);
      if (offset < f.length / 2 + 4) {
        observationArrival = Math.min(observationArrival ?? Infinity, f.arrival);
      }
    }
  }

  return { fractures, specks, events, maxPathM, connectedCount, observationArrival, reachesShallow };
}

// ---------------------------------------------------------------------------
// Timeline: T0 baseline … T6 verification, as one continuous value t in 0..6.

export const STAGES = [
  { id: "T0", name: "Baseline", text: "Original geology and fracture network before injection." },
  { id: "T1", name: "Injection", text: "Carbonated water enters the reservoir through the perforated interval of HASA 4." },
  { id: "T2", name: "Fluid migration", text: "Injected water follows open, connected fractures. Sealed fractures stay dry." },
  { id: "T3", name: "Rock dissolution", text: "Acidic fluid reacts with peridotite; Mg, Ca and other ions enter solution." },
  { id: "T4", name: "Carbonate precipitation", text: "Dissolved carbon precipitates as carbonate on fracture walls." },
  { id: "T5", name: "Post-injection", text: "Injection stops; remaining fluid disperses and mineralised zones remain." },
  { id: "T6", name: "Verification", text: "Monitoring evidence is compared with the model: TEM anomaly, tracer arrival, chemistry." },
] as const;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** How far each process has progressed at time t (0..6), as arrival thresholds 0..1. */
export function phasesAt(t: number) {
  return {
    injecting: t >= 1 && t < 5,
    front: clamp01((t - 1.1) / 2.4),
    reaction: clamp01((t - 2.6) / 2),
    carbonate: clamp01((t - 3.5) / 2),
    /** Visibility of free fluid: fades after injection stops. */
    fluid: t < 5 ? 1 : 1 - 0.65 * clamp01(t - 5),
    verification: t >= 5.6,
  };
}

export type Phases = ReturnType<typeof phasesAt>;

// ---------------------------------------------------------------------------
// TEM resistivity section through the injection well (illustrative).

/** log10(Ω·m) by depth for the baseline, smoothed between zones. */
function baselineLog10(depth: number, model: SubsurfaceModel): number {
  const byLayer: Record<string, number> = {
    surface: 1.9,
    aquifer: 1.5,
    upper: 2.2,
    serpentinised: 2.9,
    reservoir: 3.05,
    below: 3.2,
  };
  let value = 2.5;
  for (const layer of model.layers) {
    const mid = (layer.top + layer.base) / 2;
    const half = (layer.base - layer.top) / 2 + 25;
    const w = Math.max(0, 1 - Math.abs(depth - mid) / half);
    if (w > 0) value = value * (1 - w) + (byLayer[layer.id] ?? 2.5) * w;
  }
  return value;
}

function ramp(stops: [number, [number, number, number]][], value: number): [number, number, number] {
  if (value <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i += 1) {
    if (value <= stops[i][0]) {
      const [v0, c0] = stops[i - 1];
      const [v1, c1] = stops[i];
      const k = (value - v0) / (v1 - v0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return stops[stops.length - 1][1];
}

// Low resistivity warm, high resistivity cool, as in published TEM sections.
const RESISTIVITY: [number, [number, number, number]][] = [
  [1.4, [214, 48, 39]],
  [1.9, [244, 140, 50]],
  [2.4, [250, 214, 84]],
  [2.8, [126, 190, 120]],
  [3.3, [52, 102, 196]],
];

export type SectionMode = "off" | "baseline" | "change";

/**
 * RGBA pixels for a vertical section along the block's length at depth 0..bottom.
 * baseline: resistivity; change: relative decrease caused by conductive fluid.
 */
export function resistivitySection(
  model: SubsurfaceModel,
  dfn: Dfn,
  frame: DfnFrame,
  phases: Phases,
  mode: Exclude<SectionMode, "off">,
  width: number,
  height: number,
): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  const x0 = frame.centre.x - frame.halfLength;
  const dx = (frame.halfLength * 2) / width;
  const dy = model.block.bottom / height;
  const decrease = new Float32Array(width * height);
  const amplitude = 0.55 * phases.fluid;

  for (const f of dfn.fractures) {
    if (!f.connected || f.arrival > phases.front) continue;
    const offPlane = Math.abs(f.z - frame.well.z);
    if (offPlane > f.length) continue;
    const across = Math.exp(-(offPlane * offPlane) / (2 * Math.pow(f.length / 2, 2)));
    const sigma = Math.max(12, f.length * 0.6);
    const cx = (f.x - x0) / dx;
    const cy = f.depth / dy;
    const rx = Math.ceil((sigma * 3) / dx);
    const ry = Math.ceil((sigma * 3) / dy);
    for (let j = Math.max(0, Math.floor(cy - ry)); j < Math.min(height, Math.ceil(cy + ry)); j += 1) {
      for (let i = Math.max(0, Math.floor(cx - rx)); i < Math.min(width, Math.ceil(cx + rx)); i += 1) {
        const ddx = (i - cx) * dx;
        const ddy = (j - cy) * dy;
        decrease[j * width + i] += amplitude * across * Math.exp(-(ddx * ddx + ddy * ddy) / (2 * sigma * sigma));
      }
    }
  }

  for (let j = 0; j < height; j += 1) {
    const depth = (j + 0.5) * dy;
    const base = baselineLog10(depth, model);
    for (let i = 0; i < width; i += 1) {
      // Row 0 of a texture is drawn at the bottom of the plane.
      const k = ((height - 1 - j) * width + i) * 4;
      const wobble = 0.06 * Math.sin(i * 0.21 + j * 0.13) * Math.cos(i * 0.07 - j * 0.11);
      const drop = Math.min(1, decrease[j * width + i]);
      if (mode === "baseline") {
        const [r, g, b] = ramp(RESISTIVITY, base + wobble);
        data.set([r, g, b, 150], k);
      } else {
        // Relative change: transparent where nothing changed.
        const alpha = Math.min(1, drop / 0.35);
        const [r, g, b] = ramp(RESISTIVITY, 2.4 - drop * 1.6);
        data.set([r, g, b, Math.round(25 + alpha * 200)], k);
      }
    }
  }
  return data;
}
