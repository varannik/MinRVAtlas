import { siteLayoutFor, type SiteLayout, type SiteSensor } from "../site-layouts";
import { leaves } from "./calc/tree";
import type { CalcSpec, SeriesAggregate } from "./calc/types";

/**
 * Readings shown on the Site Pulse panel. They come from the site's 3D model
 * when it has one, so the panel and the 3D chain name the same sensors; other
 * projects fall back to the stream inputs of their crediting tree.
 */

export interface PulseReading {
  id: string;
  label: string;
  /** Where on site, e.g. "HASA 4". */
  place?: string;
  metric: string;
  unit: string;
  aggregate: SeriesAggregate;
  decimals: number;
  warnAbove?: number;
  alarmAbove?: number;
  warnBelow?: number;
}

const MAX_READINGS = 8;

function fromSensor(sensor: SiteSensor, place: string): PulseReading {
  return {
    id: `${place}/${sensor.id}`,
    label: sensor.label,
    place,
    metric: sensor.metric,
    unit: sensor.unit,
    // Totalisers grow all day; their day total is the useful number.
    aggregate: sensor.demo.risePerSec ? "sum" : "mean",
    decimals: sensor.demo.decimals ?? 1,
    warnAbove: sensor.warnAbove,
    alarmAbove: sensor.alarmAbove,
    warnBelow: sensor.warnBelow,
  };
}

function fromLayout(layout: SiteLayout): PulseReading[] {
  const hosts = layout.objects.map((object) => ({ place: object.code ?? object.name, object }));
  const byKey = new Map<string, PulseReading>();
  const add = (place: string, sensor: SiteSensor) => {
    if (sensor.measurement === "discrete" || sensor.proposed) return;
    if (byKey.has(sensor.metric)) return;
    byKey.set(sensor.metric, fromSensor(sensor, place));
  };
  // The layout's featured readings first, then everything else on site.
  for (const highlight of layout.highlights ?? []) {
    const host = hosts.find((row) => row.object.id === highlight.host);
    const sensor = host?.object.sensors?.find((row) => row.id === highlight.sensor);
    if (host && sensor) add(host.place, sensor);
  }
  for (const { place, object } of hosts) {
    for (const sensor of object.sensors ?? []) add(place, sensor);
  }
  return [...byKey.values()];
}

function fromSpec(spec: CalcSpec): PulseReading[] {
  const seen = new Set<string>();
  return leaves(spec.root).flatMap((node) => {
    if (node.kind !== "input" || node.source.type !== "series") return [];
    // A term re-used in several equations is still one sensor.
    if (seen.has(node.source.metric)) return [];
    seen.add(node.source.metric);
    return [{
      id: node.id,
      label: node.label,
      metric: node.source.metric,
      unit: node.unit,
      aggregate: node.source.aggregate,
      decimals: 1,
    }];
  });
}

export function pulseReadingsFor(projectId: string, spec: CalcSpec): PulseReading[] {
  const layout = siteLayoutFor(projectId);
  const readings = layout ? fromLayout(layout) : fromSpec(spec);
  return readings.slice(0, MAX_READINGS);
}

export type PulseState = "ok" | "warn" | "alarm";

export function pulseState(reading: PulseReading, value: number): PulseState {
  if (reading.alarmAbove !== undefined && value > reading.alarmAbove) return "alarm";
  if (reading.warnAbove !== undefined && value > reading.warnAbove) return "warn";
  if (reading.warnBelow !== undefined && value < reading.warnBelow) return "warn";
  return "ok";
}
