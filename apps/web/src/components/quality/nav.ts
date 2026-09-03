export type QualityNavItem = {
  href: string;
  label: string;
};

export type QualityNavSection = {
  id: string;
  label: string;
  items: QualityNavItem[];
};

export const QUALITY_NAV: QualityNavSection[] = [
  {
    id: "configure",
    label: "Configure",
    items: [
      { href: "/quality/rules", label: "Rule Manager" },
      { href: "/quality/corrections", label: "Correction Manager" },
      { href: "/quality/correction-rules", label: "Correction Rules" },
      { href: "/quality/protocols", label: "Protocol Manager" },
      { href: "/quality/models", label: "Models" },
      { href: "/quality/knowledge", label: "Knowledge Base" },
      { href: "/quality/vv", label: "V&V Projects" },
    ],
  },
  {
    id: "operate",
    label: "Operate",
    items: [
      { href: "/quality/datasets", label: "Datasets" },
      { href: "/quality/runs", label: "DQA Runs" },
      { href: "/quality/violations", label: "Violations" },
      { href: "/quality/workbench", label: "Workbench" },
      { href: "/quality/anomaly", label: "Anomaly" },
      { href: "/quality/schedules", label: "Schedules" },
    ],
  },
  {
    id: "compliance",
    label: "Compliance",
    items: [
      { href: "/quality/audit", label: "Audit Trail" },
      { href: "/quality/reports", label: "Reports" },
    ],
  },
];

export function isQualityNavActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/quality/vv") return pathname.startsWith("/quality/vv/");
  return false;
}
