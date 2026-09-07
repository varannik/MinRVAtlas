"use client";

import { humanizeKey, type LcaRecipe } from "@/lib/project-definition";

export function LcaRecipeCard({ recipe }: { recipe: LcaRecipe }) {
  const credit = humanizeKey(recipe.creditType.toLowerCase());
  const componentCount = recipe.groups.reduce(
    (sum, group) => sum + group.components.length,
    0,
  );
  return (
    <div className="mt-2 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[10px] font-semibold tracking-[0.12em] text-carbon-400 uppercase">
          {credit} recipe
        </p>
        <p className="text-[10px] text-mist">
          {recipe.groups.length} group{recipe.groups.length === 1 ? "" : "s"} ·{" "}
          {componentCount} component{componentCount === 1 ? "" : "s"}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className="rounded-full bg-carbon-400/15 px-1.5 py-0.5 text-[9px] font-medium text-carbon-400">
          Period — filled each reporting window
        </span>
        <span className="rounded-full bg-white px-1.5 py-0.5 text-[9px] font-medium text-mist ring-1 ring-line/70">
          Fixed — locked on the LCA
        </span>
      </div>
      {recipe.groups.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-mist">
          The template is on file in Certify, but no component groups were
          returned for this project.
        </p>
      ) : null}
      {recipe.groups.map((group) => (
        <section key={group.id} className="rounded-lg bg-off-white/80 px-2.5 py-2">
          <h5 className="text-[12px] font-semibold text-frost">{group.name}</h5>
          {group.description ? (
            <p className="mt-0.5 text-[10px] leading-relaxed text-mist">
              {group.description}
            </p>
          ) : null}
          <ol className="mt-2 space-y-2.5">
            {group.components.map((component, index) => (
              <li
                key={component.id}
                className="rounded-md bg-white/80 px-2 py-1.5 ring-1 ring-line/50"
              >
                <div className="flex items-baseline gap-1.5">
                  <span className="tabular text-[10px] text-mist">{index + 1}</span>
                  <p className="text-[12px] leading-snug font-medium text-frost">
                    {component.name}
                  </p>
                </div>
                {component.blueprint ? (
                  <p className="mt-0.5 text-[10px] text-mist">
                    Calculation: {humanizeKey(component.blueprint)}
                  </p>
                ) : null}
                {component.description ? (
                  <p className="mt-0.5 text-[10px] leading-relaxed text-mist">
                    {component.description}
                  </p>
                ) : null}
                {component.inputs.length > 0 ? (
                  <ul className="mt-1.5 flex flex-wrap gap-1">
                    {component.inputs.map((input) => {
                      const measured = (input.type ?? "").toLowerCase() === "monitored";
                      return (
                        <li
                          key={`${component.id}-${input.inputKey ?? input.name}`}
                          title={
                            input.quantityKind
                              ? humanizeKey(input.quantityKind)
                              : measured
                                ? "Filled each reporting period"
                                : "Fixed on the LCA"
                          }
                          className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                            measured
                              ? "bg-carbon-400/15 text-carbon-400"
                              : "bg-off-white text-mist ring-1 ring-line/70"
                          }`}
                        >
                          {humanizeKey(input.name)}
                          <span className="ml-1 opacity-70">
                            {measured ? "period" : "fixed"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
