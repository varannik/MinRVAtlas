"use client";

import Link from "next/link";
import { Activity, Route } from "lucide-react";
import { journeyHref } from "@/lib/journey/atlas";
import { useDashboard } from "@/store/dashboard-store";
import type { Project } from "@/lib/types";

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olivine-500";

/** The two ways into a project from the Atlas, on any registry: its live dashboard and its journey. */
export function ProjectActions({
  project,
  size = "md",
}: {
  project: Project;
  size?: "sm" | "md";
}) {
  const selectProject = useDashboard((state) => state.selectProject);
  const height = size === "sm" ? "h-8 text-[11.5px]" : "h-9 text-[12px]";

  return (
    <div className="grid grid-cols-2 gap-1.5">
      <button
        type="button"
        onClick={() => selectProject(project.id)}
        className={`btn-primary flex items-center justify-center gap-1.5 rounded-full px-3 font-semibold ${height} ${FOCUS}`}
      >
        <Activity className="size-3.5 shrink-0" />
        Live dashboard
      </button>
      <Link
        href={journeyHref(project)}
        title="Where this project is on its journey"
        className={`btn-glass flex items-center justify-center gap-1.5 rounded-full px-3 font-semibold ${height} ${FOCUS}`}
      >
        <Route className="size-3.5 shrink-0 text-olivine-700" />
        Journey
      </Link>
    </div>
  );
}
