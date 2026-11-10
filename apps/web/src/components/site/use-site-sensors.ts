"use client";

import { useEffect, useState } from "react";
import type { SensorStatus, SiteSensor } from "@/lib/site-layouts";

/** Anything that carries sensors: a site object or a supply node. */
export type SensorHost = { id: string; sensors?: SiteSensor[] };

export type SensorReading = {
  value: number;
  text: string;
  status: SensorStatus;
};

/** Readings keyed by `${objectId}/${sensorId}`. */
export type SensorReadings = Record<string, SensorReading>;

export function sensorKey(objectId: string, sensorId: string): string {
  return `${objectId}/${sensorId}`;
}

export function statusFor(sensor: SiteSensor, value: number): SensorStatus {
  if (sensor.alarmAbove !== undefined && value > sensor.alarmAbove) return "alarm";
  if (sensor.warnAbove !== undefined && value > sensor.warnAbove) return "warn";
  if (sensor.warnBelow !== undefined && value < sensor.warnBelow) return "warn";
  return "ok";
}

function format(value: number, decimals = 1): string {
  return value.toLocaleString("en-GB", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Smooth wobble in -1..1, different for each sensor. */
function wobble(seconds: number, seed: number): number {
  return (
    0.6 * Math.sin(seconds * 0.31 + seed) +
    0.3 * Math.sin(seconds * 0.97 + seed * 2.1) +
    0.1 * Math.sin(seconds * 2.3 + seed * 3.7)
  );
}

/** Same stream column, same demo signal, wherever it is shown. */
function seedFor(metric: string): number {
  let h = 7;
  for (let i = 0; i < metric.length; i += 1) h = (h * 31 + metric.charCodeAt(i)) % 9973;
  return h / 97;
}

function read(hosts: SensorHost[], seconds: number): SensorReadings {
  const readings: SensorReadings = {};
  for (const object of hosts) {
    for (const sensor of object.sensors ?? []) {
      const seed = seedFor(sensor.metric);
      const { base, jitter, risePerSec, decimals } = sensor.demo;
      const value = risePerSec
        ? base + risePerSec * seconds
        : base + jitter * wobble(seconds, seed);
      readings[sensorKey(object.id, sensor.id)] = {
        value,
        text: format(value, decimals),
        status: statusFor(sensor, value),
      };
    }
  }
  return readings;
}

/**
 * Demo readings for every sensor in the given objects, refreshed every 1.5 s.
 * Swap the body for a fetch of the latest stream rows (by `sensor.metric`)
 * when the site has a live feed; the scene only reads the returned map.
 */
export function useSiteSensors(hosts: SensorHost[]): SensorReadings {
  const [readings, setReadings] = useState<SensorReadings>(() => read(hosts, 0));

  useEffect(() => {
    const start = Date.now();
    const timer = window.setInterval(() => {
      setReadings(read(hosts, (Date.now() - start) / 1000));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [hosts]);

  return readings;
}
