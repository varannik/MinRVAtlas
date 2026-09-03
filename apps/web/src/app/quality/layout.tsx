import type { ReactNode } from "react";
import { QualityShell } from "@/components/quality/shell";

export const metadata = {
  title: "Quality Console — 3DMinRV",
  description:
    "Configure Data Sentinel DQA, anomaly, protocols and V&V. This is the only operator quality UI.",
};

export default function QualityLayout({ children }: { children: ReactNode }) {
  return <QualityShell>{children}</QualityShell>;
}
