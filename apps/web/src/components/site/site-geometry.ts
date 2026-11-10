import type { FlowKind, Px, SiteLayout, SiteObject, SitePart, SiteZone } from "@/lib/site-layouts";

/** Zone colours, taken from the dashed outlines on the site photo. */
export const ZONE_COLOR: Record<SiteZone, string> = {
  surface: "#E0A526",
  subsurface: "#7B4FB3",
  energy: "#C6362B",
  ancillary: "#3E9B4F",
  storage: "#3A8FD6",
  legacy: "#2A2A2A",
};

export const ZONE_LABEL: Record<SiteZone, string> = {
  surface: "44.01 surface equipment",
  subsurface: "44.01 subsurface reservoir equipment",
  energy: "Renewable energy facility",
  ancillary: "Ancillary stations",
  storage: "Storage space",
  legacy: "Previous surface equipment",
};

export const FLOW_COLOR: Record<FlowKind, string> = {
  co2: "#DF7626",
  water: "#3A8FD6",
  injectate: "#2A9D8F",
  power: "#C6362B",
  data: "#55632A",
};

export const FLOW_LABEL: Record<FlowKind, string> = {
  co2: "CO₂",
  water: "Water",
  injectate: "Carbonated water",
  power: "Power",
  data: "Data",
};

export const FLOW_KINDS: FlowKind[] = ["co2", "water", "injectate", "power", "data"];

/** Turns photo pixels into scene metres, centred on the photo. */
export function projector(layout: SiteLayout) {
  const { width, height, metresPerPixel: s } = layout.photo;
  return {
    /** [x, z] in metres. */
    xz: ([x, y]: Px): [number, number] => [(x - width / 2) * s, (y - height / 2) * s],
    len: (px: number) => px * s,
    widthM: width * s,
    depthM: height * s,
  };
}

/** Photo rotation (degrees, clockwise) to a rotation about the scene's up axis. */
export function yaw(rotateDeg = 0): number {
  return (-rotateDeg * Math.PI) / 180;
}

export function partHeight(part: SitePart): number {
  if (part.shape === "solar") return 2.4;
  if (part.shape === "well") return 3.2;
  return part.heightM;
}

export function objectTop(object: SiteObject): number {
  return Math.max(...object.parts.map(partHeight));
}

/** Footprint of an object on the photo, padded, as [minX, minY, maxX, maxY]. */
export function footprint(object: SiteObject, pad = 12): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const part of object.parts) {
    const [x, y] = part.at;
    let hx = 10;
    let hy = 10;
    if (part.shape === "box" || part.shape === "solar") {
      // Bounding box of the rotated rectangle.
      const r = Math.abs(((part.rotateDeg ?? 0) * Math.PI) / 180);
      const [w, d] = part.size;
      hx = (w * Math.cos(r) + d * Math.sin(r)) / 2;
      hy = (w * Math.sin(r) + d * Math.cos(r)) / 2;
    } else if (part.shape === "cylinder") {
      hx = part.radiusPx;
      hy = part.radiusPx;
    }
    minX = Math.min(minX, x - hx);
    minY = Math.min(minY, y - hy);
    maxX = Math.max(maxX, x + hx);
    maxY = Math.max(maxY, y + hy);
  }
  return [minX - pad, minY - pad, maxX + pad, maxY + pad];
}

export function labelPoint(object: SiteObject): Px {
  return object.labelAt ?? object.parts[0].at;
}

export function deepestWell(layout: SiteLayout): number {
  let depth = 0;
  for (const object of layout.objects) {
    for (const part of object.parts) {
      if (part.shape === "well") depth = Math.max(depth, part.depthM);
    }
  }
  return depth;
}
