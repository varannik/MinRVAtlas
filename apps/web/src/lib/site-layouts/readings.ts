import type { SensorStatus, SiteLayout, SiteSensor, SupplyLayout } from "./types";

/**
 * A site's sensor readings, worked out on the server from the sensors its
 * stored model carries. Until a site sends its own feed, each sensor follows
 * the demo profile in its model (`sensor.demo`); every viewer sees the same
 * value at the same moment because time runs from the start of the UTC day.
 */

/** Anything that carries sensors: a site object, a supply node or a route. */
export type SensorHost = { id: string; sensors?: SiteSensor[] };

export type SensorReading = {
  value: number;
  text: string;
  status: SensorStatus;
};

/** Readings keyed by `${hostId}/${sensorId}`. */
export type SensorReadings = Record<string, SensorReading>;

export function sensorKey(hostId: string, sensorId: string): string {
  return `${hostId}/${sensorId}`;
}

export function statusFor(sensor: SiteSensor, value: number): SensorStatus {
  if (sensor.alarmAbove !== undefined && value > sensor.alarmAbove) return "alarm";
  if (sensor.warnAbove !== undefined && value > sensor.warnAbove) return "warn";
  if (sensor.warnBelow !== undefined && value < sensor.warnBelow) return "warn";
  return "ok";
}

/** Every object, plant, site and route that carries sensors, in one list. */
export function sensorHosts(layout: SiteLayout): SensorHost[] {
  const chains = [layout.feedstock, layout.water].filter(Boolean) as SupplyLayout[];
  return [...layout.objects, ...chains.flatMap((chain) => [...chain.nodes, ...chain.routes])];
}

function format(value: number, decimals = 1): string {
  return value.toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Smooth wobble in -1..1, different for each sensor. */
function wobble(seconds: number, seed: number): number {
  return 0.6 * Math.sin(seconds * 0.31 + seed) + 0.3 * Math.sin(seconds * 0.97 + seed * 2.1) + 0.1 * Math.sin(seconds * 2.3 + seed * 3.7);
}

/** Same stream column, same signal, wherever it is shown. */
function seedFor(metric: string): number {
  let h = 7;
  for (let i = 0; i < metric.length; i += 1) h = (h * 31 + metric.charCodeAt(i)) % 9973;
  return h / 97;
}

/** Every sensor's reading `seconds` into the day. */
export function readSensors(hosts: SensorHost[], seconds: number): SensorReadings {
  const readings: SensorReadings = {};
  for (const host of hosts) {
    for (const sensor of host.sensors ?? []) {
      const { base, jitter, risePerSec, decimals } = sensor.demo;
      const value = risePerSec ? base + risePerSec * seconds : base + jitter * wobble(seconds, seedFor(sensor.metric));
      readings[sensorKey(host.id, sensor.id)] = { value, text: format(value, decimals), status: statusFor(sensor, value) };
    }
  }
  return readings;
}
