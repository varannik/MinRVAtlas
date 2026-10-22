import type { Metadata } from "next";

import { UserManual } from "@/components/manual/user-manual";

export const metadata: Metadata = {
  title: "User guide — MinRV",
  description:
    "How to open a project, file BioCCS and DAC evidence, and use Quality and the ledger in MinRV.",
};

export default function ManualPage() {
  return <UserManual />;
}
