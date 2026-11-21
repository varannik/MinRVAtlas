"use client";

import { useEffect, useId, useState } from "react";

/**
 * The Cortex projects the signed-in user may work on (from the tenancy table),
 * shared by the document pins and Ask Cortex. One request per page load.
 */

export interface CortexProjectOption {
  id: string;
  name: string;
  registry?: string;
  methodology?: string;
  edition?: string;
}

export interface ProjectsReply {
  configured: boolean;
  tenantStatus: string;
  projects: CortexProjectOption[];
  canUpload: boolean;
  canRemove: boolean;
  /** May add and remove documents every project in the organisation searches (admins). */
  canShare: boolean;
}

export async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`);
  return body;
}

let projectsRequest: Promise<ProjectsReply> | null = null;

function loadProjects(): Promise<ProjectsReply> {
  if (!projectsRequest) {
    projectsRequest = fetch("/api/cortex/projects").then((response) => readJson<ProjectsReply>(response));
    projectsRequest.catch(() => {
      projectsRequest = null;
    });
  }
  return projectsRequest;
}

export function useCortexProjects(): { reply: ProjectsReply | null; error: string | null } {
  const [reply, setReply] = useState<ProjectsReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadProjects()
      .then((value) => live && setReply(value))
      .catch((failure: Error) => live && setError(failure.message));
    return () => {
      live = false;
    };
  }, []);
  return { reply, error };
}

/** Why there is no project to work on, or null when there is one. */
export function noProjectReason(reply: ProjectsReply, project: CortexProjectOption | undefined): string | null {
  if (!reply.configured) return "Cortex is not set up on this deployment.";
  if (reply.tenantStatus !== "active") return "Your organisation is not active on Cortex yet.";
  if (!project) return "You have no Cortex project yet. An admin grants projects.";
  return null;
}

export function ProjectPicker({
  projects,
  value,
  onChange,
  disabled = false,
}: {
  projects: CortexProjectOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const selectId = useId();
  const current = projects.find((project) => project.id === value);
  return (
    <div className="grid gap-1">
      <label htmlFor={selectId} className="text-[11.5px] font-medium text-shale">
        Project
      </label>
      <select
        id={selectId}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full min-w-0 rounded-lg border border-line bg-white px-2.5 text-[13px] text-rock outline-none focus:border-rock/60 focus:shadow-[0_0_0_3px_rgba(7,8,8,0.08)] disabled:opacity-60"
      >
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      {current?.methodology && (
        <span className="font-mono text-[10.5px] text-mist">
          {current.methodology}
          {current.edition ? ` · ${current.edition}` : ""}
        </span>
      )}
    </div>
  );
}
