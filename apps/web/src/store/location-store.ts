"use client";

import { create } from "zustand";
import type { LocationOverlay, SiteLocation } from "@/lib/project-locations";

interface LocationState {
  byId: LocationOverlay;
  loadedForTenant: string | null;
  load: (tenantId: string) => Promise<void>;
  save: (
    tenantId: string,
    projectId: string,
    lat: number,
    lng: number,
  ) => Promise<SiteLocation>;
}

let loadSeq = 0;

export const useLocationStore = create<LocationState>((set, get) => ({
  byId: {},
  loadedForTenant: null,
  load: async (tenantId) => {
    const seq = ++loadSeq;
    try {
      const response = await fetch("/api/projects/locations", {
        headers: { "x-tenant-id": tenantId },
        cache: "no-store",
      });
      if (!response.ok || seq !== loadSeq) return;
      const payload = (await response.json()) as {
        locations?: LocationOverlay;
      };
      if (seq !== loadSeq) return;
      set({
        byId: payload.locations ?? {},
        loadedForTenant: tenantId,
      });
    } catch {
      // Catalog pins remain on screen if the overlay cannot be read.
    }
  },
  save: async (tenantId, projectId, lat, lng) => {
    const response = await fetch("/api/projects/locations", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": tenantId,
      },
      body: JSON.stringify({ projectId, lat, lng }),
    });
    const payload = (await response.json()) as {
      error?: string;
      location?: SiteLocation;
      locations?: LocationOverlay;
    };
    if (!response.ok || !payload.location) {
      throw new Error(payload.error ?? "Could not save site location");
    }
    set({
      byId: payload.locations
        ? { ...get().byId, ...payload.locations }
        : { ...get().byId, [projectId]: payload.location },
      loadedForTenant: tenantId,
    });
    return payload.location;
  },
}));
