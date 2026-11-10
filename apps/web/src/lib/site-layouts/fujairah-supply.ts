import type { SupplyLayout } from "./types";

/**
 * Water for injection is trucked from two sewage treatment plants (STPs).
 * Plant coordinates are from the "Water Transport for Injection" slide.
 * Routes are road routes from OSRM (router.project-osrm.org), fetched once
 * on 2 November 2026 and simplified.
 */
export const FUJAIRAH_WATER: SupplyLayout = {
  commodity: "water",
  name: "Water supply for injection",
  // Wide: looking east-north-east, coast and Gulf of Oman along the horizon.
  // Tall: looking north, so the coastal route runs up the column.
  map: {
    exaggeration: 1.6,
    wide: { bearing: 70, pitch: 52 },
    tall: { bearing: 0, pitch: 55 },
  },
  nodes: [
    {
      id: "stp-al-hayl",
      name: "Al Hayl Treatment Plant",
      role: "primary",
      at: [25.084561, 56.278517],
      address: "Sewage Treatment Plant (STP), Fujairah, 37MH+PFV",
      description: "Primary water supply. Treated wastewater is loaded onto tankers here.",
      sensors: [
        {
          id: "dispatched",
          label: "Dispatched today",
          metric: "WATER_DISPATCHED_m3",
          unit: "m³",
          proposed: true,
          demo: { base: 286, jitter: 0, risePerSec: 0.02, decimals: 0 },
        },
        {
          id: "trips",
          label: "Tanker trips today",
          metric: "TANKER_TRIPS",
          unit: "trips",
          proposed: true,
          demo: { base: 11, jitter: 0, decimals: 0 },
        },
      ],
    },
    {
      id: "stp-tawain",
      name: "Tawain Treatment Plant",
      role: "backup",
      at: [25.547348, 56.03343],
      address: "Sewage Treatment Plant Tawain, Fujairah, G2WM+W9M",
      description: "Back-up water supply, used when Al Hayl cannot meet demand.",
      sensors: [
        {
          id: "dispatched",
          label: "Dispatched today",
          metric: "WATER_DISPATCHED_m3",
          unit: "m³",
          proposed: true,
          demo: { base: 26, jitter: 0, decimals: 0 },
        },
        {
          id: "trips",
          label: "Tanker trips today",
          metric: "TANKER_TRIPS",
          unit: "trips",
          proposed: true,
          demo: { base: 1, jitter: 0, decimals: 0 },
        },
      ],
    },
    {
      id: "site",
      name: "CO₂ Storage Site",
      role: "site",
      // ACE2.5, Adgat (F8P5+CMQ), from the logistic chain slide.
      at: [25.4860833, 56.30925],
      description: "Receives the water into the site tank for the injection system. Each delivery records its source plant.",
      sensors: [
        {
          id: "received",
          label: "Received today",
          metric: "WATER_RECEIVED_m3",
          unit: "m³",
          proposed: true,
          demo: { base: 304, jitter: 0, risePerSec: 0.02, decimals: 0 },
        },
        {
          id: "tank-level",
          label: "Water tank level",
          metric: "WATER_TANK_LEVEL_pct",
          unit: "%",
          proposed: true,
          demo: { base: 71, jitter: 4, decimals: 0 },
          warnBelow: 30,
        },
        {
          id: "water-flow",
          label: "Water to injection",
          metric: "WATER_FLOW_m3h",
          unit: "m³/h",
          demo: { base: 31, jitter: 1.4, decimals: 1 },
          warnBelow: 24,
        },
      ],
    },
  ],
  routes: [
    {
      id: "route-al-hayl",
      from: "stp-al-hayl",
      to: "site",
      role: "primary",
      distanceKm: 66.5,
      durationMin: 81,
      path: [
        [25.08448, 56.27846], [25.08864, 56.28144], [25.10091, 56.27152], [25.12017, 56.2981],
        [25.12995, 56.30194], [25.12985, 56.31719], [25.16018, 56.35139], [25.19803, 56.35158],
        [25.2446, 56.36029], [25.266, 56.36102], [25.28108, 56.34817], [25.30202, 56.35292],
        [25.3189, 56.34149], [25.35391, 56.35219], [25.36316, 56.34797], [25.41482, 56.35015],
        [25.45651, 56.36115], [25.47241, 56.36271], [25.49061, 56.35655], [25.51176, 56.36285],
        [25.5134, 56.35597], [25.52178, 56.35479], [25.51169, 56.32372], [25.51804, 56.31522],
        [25.51715, 56.30619], [25.49896, 56.31209], [25.48732, 56.30923],
      ],
    },
    {
      id: "route-tawain",
      from: "stp-tawain",
      to: "site",
      role: "backup",
      distanceKm: 69.3,
      durationMin: 84,
      path: [
        [25.54779, 56.03274], [25.53052, 56.01264], [25.52208, 56.00721], [25.51705, 56.01132],
        [25.51206, 56.01538], [25.50907, 56.02007], [25.50016, 56.02513], [25.49261, 56.03674],
        [25.49178, 56.05252], [25.50039, 56.07202], [25.51388, 56.07749], [25.5242, 56.11324],
        [25.53376, 56.1238], [25.52968, 56.14162], [25.53078, 56.14953], [25.54796, 56.16786],
        [25.55922, 56.18844], [25.5572, 56.1977], [25.55818, 56.21028], [25.54958, 56.21962],
        [25.54307, 56.23311], [25.55382, 56.23747], [25.59676, 56.27788], [25.60163, 56.29804],
        [25.59881, 56.32586], [25.60185, 56.33022], [25.60184, 56.33686], [25.59278, 56.3509],
        [25.58548, 56.35202], [25.57095, 56.34803], [25.55789, 56.35386], [25.52609, 56.35522],
        [25.52332, 56.32326], [25.52004, 56.32332], [25.51709, 56.30606], [25.51216, 56.30672],
        [25.50967, 56.31051], [25.50588, 56.30914], [25.49896, 56.31209], [25.48732, 56.30923],
      ],
    },
  ],
  highlights: [
    { host: "site", sensor: "received" },
    { host: "stp-al-hayl", sensor: "trips" },
    { host: "site", sensor: "tank-level" },
  ],
  assumptions: [
    "Plant coordinates are from the water transport slide.",
    "The storage site position is from the logistic chain slide (ACE2.5, Adgat).",
    "Routes are the fastest road routes from OSRM, not recorded tanker tracks.",
    "Satellite imagery: Sentinel-2 cloudless 2016 by EOX (CC BY 4.0). Terrain: AWS Terrain Tiles, heights exaggerated ×1.6.",
    "Columns marked 'proposed' are not in the stream schema yet; values are a demo signal.",
  ],
};
