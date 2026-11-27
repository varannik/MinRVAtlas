export type QualityNavItem = {
  href: string;
  label: string;
};

export type QualityNavSection = {
  id: string;
  label: string;
  items: QualityNavItem[];
};

/**
 * Sentinel's console keeps document V&V and the protocols it scores against. Data
 * quality is the quality engine's (apps/quality-engine): on the calculation tree,
 * the journey and the registry submit rule.
 */
export const QUALITY_NAV: QualityNavSection[] = [
  {
    id: "data",
    label: "Data",
    items: [{ href: "/quality", label: "Data quality" }],
  },
  {
    id: "vv",
    label: "Document V&V",
    items: [
      { href: "/quality/vv", label: "V&V Projects" },
      { href: "/quality/protocols", label: "Protocol Manager" },
    ],
  },
];

export function isQualityNavActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/quality/vv") return pathname.startsWith("/quality/vv/");
  return false;
}
