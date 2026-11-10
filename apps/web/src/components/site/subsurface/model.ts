import type { SiteLayout, SiteObject, SubsurfaceModel, SubsurfaceWell } from "@/lib/site-layouts";
import { projector } from "../site-geometry";
import { generateDfn, type Dfn, type DfnFrame, type SectionMode } from "./dfn";

export type PlacedWell = {
  well: SubsurfaceWell;
  object: SiteObject;
  /** Scene metres on the site plan. */
  x: number;
  z: number;
  /** Drilled depth from the site plan. */
  depth: number;
};

export type Subsurface = {
  model: SubsurfaceModel;
  frame: DfnFrame;
  dfn: Dfn;
  wells: PlacedWell[];
};

/** Places the subsurface model under the site plan and builds its fracture network. */
export function buildSubsurface(layout: SiteLayout): Subsurface | null {
  const model = layout.subsurface;
  if (!model) return null;
  const p = projector(layout);

  const wells: PlacedWell[] = [];
  for (const well of model.wells) {
    const object = layout.objects.find((entry) => entry.id === well.objectId);
    const part = object?.parts.find((entry) => entry.shape === "well");
    if (!object || !part || part.shape !== "well") continue;
    const [x, z] = p.xz(part.at);
    wells.push({ well, object, x, z, depth: part.depthM });
  }

  const centre = wells.find((entry) => entry.object.id === model.centreOn);
  if (!centre) return null;
  const observation = wells.find((entry) => entry.well.role === "observation");

  const frame: DfnFrame = {
    well: { x: centre.x, z: centre.z },
    observation: observation ? { x: observation.x, z: observation.z } : undefined,
    centre: { x: centre.x, z: centre.z },
    halfLength: model.block.length / 2,
    halfWidth: model.block.width / 2,
  };

  return { model, frame, dfn: generateDfn(model, frame), wells };
}

/** What the subsurface view shows, owned by the panel and read by the scene. */
export type SubsurfaceView = {
  /** Timeline position, 0 (T0 baseline) … 6 (T6 verification). */
  t: number;
  /** Layer ids plus overlay keys (fractures, reaction, wells, tem, seismic). */
  visible: Record<string, boolean>;
  section: SectionMode;
  selectedFracture: number | null;
};

export const OVERLAYS = ["fractures", "reaction", "wells", "tem", "seismic"] as const;

export function initialView(model: SubsurfaceModel): SubsurfaceView {
  const visible: Record<string, boolean> = {};
  for (const layer of model.layers) visible[layer.id] = true;
  for (const key of OVERLAYS) visible[key] = true;
  return { t: 0, visible, section: "off", selectedFracture: null };
}
