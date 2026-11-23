"use client";

import { useEffect, useState } from "react";
import type { SensorReadings } from "@/lib/site-layouts";

export { sensorKey, statusFor, type SensorHost, type SensorReading, type SensorReadings } from "@/lib/site-layouts";

const POLL_MS = 2000;

/**
 * Every sensor reading of a project's site, from the server
 * (/api/atlas/projects/<id>/readings), refreshed every two seconds while the
 * chain is open. The browser only shows what the server sends.
 */
export function useSiteSensors(projectId: string): SensorReadings {
  const [held, setHeld] = useState<{ projectId: string; readings: SensorReadings } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      try {
        const response = await fetch(`/api/atlas/projects/${encodeURIComponent(projectId)}/readings`, { cache: "no-store" });
        if (response.ok) {
          const payload = (await response.json()) as { readings?: SensorReadings };
          if (!cancelled) setHeld({ projectId, readings: payload.readings ?? {} });
        }
      } catch {
        // Keep the last readings; the next poll tries again.
      }
      if (!cancelled) timer = window.setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [projectId]);

  return held?.projectId === projectId ? held.readings : {};
}
