import type { Tenant } from "./types";

export const TENANTS: Tenant[] = [
  {
    id: "verdant",
    name: "Verdant Carbon Partners",
    short: "VCP",
    plan: "Enterprise",
    seats: 48,
    accent: "#34e0a1",
  },
  {
    id: "helios",
    name: "Helios Climate Fund",
    short: "HCF",
    plan: "Growth",
    seats: 12,
    accent: "#4cc4ff",
  },
  {
    id: "terrafix",
    name: "TerraFix Removals",
    short: "TFR",
    plan: "Enterprise",
    seats: 26,
    accent: "#9b8cff",
  },
  {
    id: "fourfourone",
    name: "44.01",
    short: "4401",
    plan: "Enterprise",
    seats: 34,
    accent: "#5ce1e6",
  },
];

export const DEFAULT_TENANT_ID = "fourfourone";

export function getTenant(id: string): Tenant {
  return TENANTS.find((tenant) => tenant.id === id) ?? TENANTS[0];
}
