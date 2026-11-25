import type { ReactNode } from "react";
import { QualityShell } from "@/components/quality/shell";

export const metadata = {
  title: "Quality Console — 3DMinRV",
  description:
    "Sentinel's document V&V and the protocols it scores against. Data quality checks are on each project's calculation tree.",
};

export default function QualityLayout({ children }: { children: ReactNode }) {
  return <QualityShell>{children}</QualityShell>;
}
