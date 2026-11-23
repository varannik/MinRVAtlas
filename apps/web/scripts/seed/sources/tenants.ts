import { ACCENT } from "@/lib/brand";
import type { Tenant } from "@/lib/types";

/** The demo tenants. Seeded to the Atlas table. */
export const TENANTS: Tenant[] = [
  {
    id: "verdant",
    name: "Verdant Carbon Partners",
    short: "VCP",
    plan: "Enterprise",
    seats: 48,
    accent: ACCENT.land,
  },
  {
    id: "helios",
    name: "Helios Climate Fund",
    short: "HCF",
    plan: "Growth",
    seats: 12,
    accent: ACCENT.tech,
  },
  {
    id: "terrafix",
    name: "TerraFix Removals",
    short: "TFR",
    plan: "Enterprise",
    seats: 26,
    accent: ACCENT.storage,
  },
  {
    id: "fourfourone",
    name: "44.01",
    short: "4401",
    plan: "Enterprise",
    seats: 34,
    accent: ACCENT.alert,
  },
];
