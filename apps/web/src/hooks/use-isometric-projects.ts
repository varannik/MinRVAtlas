"use client";

import { useEffect } from "react";
import { useDashboard } from "@/store/dashboard-store";
import { useLiveProjects } from "@/store/live-projects-store";

/** Load Certify org projects with platform credentials once per tenant. */
export function useIsometricProjects() {
  const tenantId = useDashboard((state) => state.tenantId);
  const load = useLiveProjects((state) => state.load);

  useEffect(() => {
    void load(tenantId);
  }, [load, tenantId]);
}
