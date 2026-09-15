"use client";

import { ExternalLink, FileText, FlaskConical, Landmark, Lock, MapPinned, ScrollText, ShieldCheck } from "lucide-react";
import {
  DEFINITION_KIND_LABEL,
  type DefinitionArtifact,
  type DefinitionKind,
  type ProjectDefinition,
} from "@/lib/project-definition";
import { useProjectDefinition } from "@/hooks/use-project-definition";
import { useDashboard } from "@/store/dashboard-store";
import { LcaRecipeCard } from "./lca-recipe";
import type { Project } from "@/lib/types";

const KIND_ICON: Record<DefinitionKind, typeof ScrollText> = {
  pdd: ScrollText,
  lca: FlaskConical,
  validation: ShieldCheck,
  safeguards: Landmark,
  site: MapPinned,
  other: FileText,
};

const KIND_ORDER: DefinitionKind[] = [
  "site",
  "pdd",
  "lca",
  "validation",
  "safeguards",
  "other",
];

function stampLabel(definition: ProjectDefinition | null, loading: boolean): string {
  if (loading && !definition) return "Reading Certify…";
  if (!definition || definition.origin === "bundled") return "Charter not on file";
  if (definition.complete) return "Definition sealed";
  if (definition.flags.hasPdd || definition.flags.hasLca) return "Definition in progress";
  return "Definition incomplete";
}

function ArtifactCard({ artifact }: { artifact: DefinitionArtifact }) {
  const Icon = KIND_ICON[artifact.kind];
  const readOnly = artifact.kind === "lca" || artifact.kind === "validation";
  return (
    <article className="rounded-xl bg-white/70 px-3 py-2.5 ring-1 ring-line/60">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-3.5 shrink-0 text-carbon-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-[13px] leading-snug font-medium text-frost">
              {artifact.title}
            </h4>
            {readOnly ? (
              <Lock className="size-3 shrink-0 text-mist" aria-hidden />
            ) : null}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-mist">
            {artifact.kind === "lca" && artifact.recipe
              ? "Read-only copy of the Certify GHG entry template."
              : artifact.detail}
          </p>
          {artifact.submittedOn ? (
            <p className="mt-1 tabular text-[10px] text-mist">
              Filed {artifact.submittedOn}
            </p>
          ) : null}
          {artifact.recipe ? <LcaRecipeCard recipe={artifact.recipe} /> : null}
          {artifact.href ? (
            <a
              href={artifact.href}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-carbon-400 hover:underline"
            >
              Open published file
              <ExternalLink className="size-2.5" />
            </a>
          ) : artifact.kind !== "lca" ? (
            <p className="mt-2 text-[10px] tracking-wide text-mist uppercase">
              {artifact.submitted ? "On file · Certify" : "Not filed"}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function ProjectCharter({ project }: { project: Project }) {
  const { definition, loading } = useProjectDefinition(project);
  const openSetup = useDashboard((state) => state.openSetup);
  const grouped = KIND_ORDER.map((kind) => ({
    kind,
    items: (definition?.artifacts ?? []).filter((row) => row.kind === kind),
  })).filter((group) => group.items.length > 0);

  const sealed = Boolean(definition?.complete);

  return (
    <aside className="glass pointer-events-auto flex h-full w-full flex-col overflow-hidden rounded-2xl">
      <div className="relative overflow-hidden border-b border-line/70 px-4 py-3">
        <div
          className="absolute inset-y-0 left-0 w-1.5"
          style={{ background: sealed ? "#8B9C44" : "#BEB290" }}
        />
        <p className="text-[10px] font-semibold tracking-[0.16em] text-mist uppercase">
          Project charter
        </p>
        <p className="mt-1 text-sm font-semibold tracking-tight text-frost">
          {stampLabel(definition, loading)}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-mist">
          Summary of what Certify already holds. Open setup to fetch, edit and
          file design evidence, sites, feedstocks and field measurements.
          Reporting-period files stay on the board.
        </p>
        <button
          type="button"
          onClick={() => openSetup("design")}
          className="mt-2 rounded-lg bg-carbon-400/15 px-3 py-1.5 text-[11px] font-semibold text-carbon-400"
        >
          Open setup
        </button>
      </div>

      <div className="scroll-slim flex-1 space-y-4 overflow-y-auto p-3">
        {loading && !definition ? (
          <p className="px-1 py-6 text-sm text-mist">Fetching what Certify already holds…</p>
        ) : null}

        {!loading && grouped.length === 0 ? (
          <p className="px-1 py-6 text-sm text-mist">
            {definition?.warning ??
              "No project-design files came back from Certify for this project."}
          </p>
        ) : null}

        {grouped.map((group) => (
          <section key={group.kind}>
            <h3 className="mb-1.5 px-1 text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">
              {DEFINITION_KIND_LABEL[group.kind]}
            </h3>
            <div className="space-y-1.5">
              {group.items.map((artifact) => (
                <ArtifactCard key={artifact.id} artifact={artifact} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="border-t border-line/70 px-4 py-2.5 text-[10px] leading-relaxed text-mist">
        Defined in Isometric Certify with this organisation’s credentials.
        LCA templates stay read-only. Remi and Request validation remain in
        Certify.
        {definition?.warning ? ` ${definition.warning}` : ""}
      </div>
    </aside>
  );
}
