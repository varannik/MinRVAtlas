"use client";

import { useCallback, useMemo, useState } from "react";
import {
  componentEdgeSign,
  evaluateComponent,
  formulaLabel,
  roleEdgeSign,
  type MeasuredValue,
} from "@/lib/blueprint-formula";
import {
  defaultUnit,
  type AccountingComponent,
  type AccountingGroup,
  type AccountingTemplate,
  type GroupRole,
} from "@/lib/accounting";
import { inputDraftKey, useAccountingDrafts } from "@/store/accounting-draft-store";
import {
  ComponentCard,
  FluxCard,
  OpBadge,
  TreeStem,
} from "./calc-tree-parts";

const ROLE_TITLE: Record<GroupRole, string> = {
  sequestrations: "Sequestrations",
  activities: "Activities",
  counterfactuals: "Counterfactuals",
  "project-emissions": "Project emissions",
  other: "Other fluxes",
};

function groupsFor(
  template: AccountingTemplate,
  role: GroupRole,
): AccountingGroup[] {
  if (role === "activities") {
    return template.groups.filter(
      (group) => group.role === "activities" || group.role === "other",
    );
  }
  return template.groups.filter((group) => group.role === role);
}

function flatten(groups: AccountingGroup[]): AccountingComponent[] {
  return groups.flatMap((group) => group.components);
}

export function CalculationTree({
  template,
  batchId,
  netKg,
  selectedComponentId,
  onSelectComponent,
}: {
  template: AccountingTemplate;
  batchId: string;
  netKg?: number | null;
  selectedComponentId: string | null;
  onSelectComponent: (id: string) => void;
}) {
  const byKey = useAccountingDrafts((state) => state.byKey);

  const roleOrder = useMemo(() => {
    const order: GroupRole[] = [];
    if (groupsFor(template, "sequestrations").length) order.push("sequestrations");
    if (groupsFor(template, "activities").length) order.push("activities");
    if (groupsFor(template, "counterfactuals").length) order.push("counterfactuals");
    if (groupsFor(template, "project-emissions").length) {
      order.push("project-emissions");
    }
    return order;
  }, [template]);

  const defaultOpen = useMemo(
    () => new Set<string>(["net", ...roleOrder.map((role) => `role:${role}`)]),
    [roleOrder],
  );
  const [openIds, setOpenIds] = useState<Set<string> | null>(null);
  const open = openIds ?? defaultOpen;

  const toggleOpen = useCallback(
    (id: string) => {
      setOpenIds((prev) => {
        const next = new Set(prev ?? defaultOpen);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [defaultOpen],
  );

  const readValue = useCallback(
    (componentId: string, inputKey: string, quantityKind?: string): MeasuredValue | null => {
      const draft = byKey[inputDraftKey(batchId, componentId, inputKey)];
      const unit = draft?.unit || defaultUnit(quantityKind);
      const magnitude = draft?.magnitude ? Number(draft.magnitude) : Number.NaN;
      if (!Number.isFinite(magnitude)) return null;
      return { magnitude, unit };
    },
    [batchId, byKey],
  );

  const scored = useMemo(() => {
    const map = new Map<
      string,
      { kg: number | null; missing: string[]; formula: string }
    >();
    for (const group of template.groups) {
      for (const component of group.components) {
        const result = evaluateComponent(component, (input) =>
          readValue(component.id, input.key, input.quantityKind),
        );
        map.set(component.id, {
          ...result,
          formula: formulaLabel(component),
        });
      }
    }
    return map;
  }, [readValue, template.groups]);

  const roleKg = useMemo(() => {
    const sums: Partial<Record<GroupRole, { kg: number | null; incomplete: boolean }>> = {};
    for (const role of roleOrder) {
      const components = flatten(groupsFor(template, role));
      let total = 0;
      let incomplete = false;
      for (const row of components) {
        const kg = scored.get(row.id)?.kg ?? null;
        if (kg == null) {
          incomplete = true;
          continue;
        }
        total += componentEdgeSign(row, role) === "−" ? -kg : kg;
      }
      sums[role] = { kg: components.length === 0 ? null : total, incomplete };
    }
    return sums;
  }, [roleOrder, scored, template]);

  const draftNet = useMemo(() => {
    const stored = roleKg.sequestrations?.kg;
    const activities = roleKg.activities?.kg;
    const counter = roleKg.counterfactuals?.kg;
    const project = roleKg["project-emissions"]?.kg;
    if (
      stored == null &&
      activities == null &&
      counter == null &&
      project == null
    ) {
      return netKg ?? null;
    }
    return (stored ?? 0) - (activities ?? 0) - (counter ?? 0) - (project ?? 0);
  }, [netKg, roleKg]);

  const netOpen = open.has("net");
  const netIncomplete = roleOrder.some((role) => roleKg[role]?.incomplete);

  return (
    <div data-testid="calc-tree" className="calc-tree scroll-slim">
      <div className="calc-tree__canvas">
        {/* Level 1 — net result */}
        <div className="calc-tree__level">
          <FluxCard
            title="Net CO₂e Removed"
            kg={draftNet}
            incomplete={netIncomplete}
            expanded={netOpen}
            onToggle={() => toggleOpen("net")}
          />
        </div>

        {netOpen ? (
          <>
            <TreeStem />

            {/* Level 2 — role fluxes in dashed zone */}
            <div className="calc-zone calc-zone--roles">
              <p className="calc-zone__label">Roll-up</p>
              <div className="calc-zone__row">
                {roleOrder.map((role, index) => {
                  const roleId = `role:${role}`;
                  const roleOpen = open.has(roleId);
                  return (
                    <div key={role} className="calc-zone__branch">
                      {index > 0 ? <OpBadge op={roleEdgeSign(role)} /> : null}
                      <FluxCard
                        title={ROLE_TITLE[role]}
                        kg={roleKg[role]?.kg ?? null}
                        incomplete={roleKg[role]?.incomplete}
                        expanded={roleOpen}
                        selected={false}
                        onToggle={() => toggleOpen(roleId)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Level 3 — one solid zone per role */}
            <div className="calc-tree__role-grid">
              {roleOrder.map((role) => {
                const roleId = `role:${role}`;
                if (!open.has(roleId)) return null;
                const components = flatten(groupsFor(template, role));
                if (components.length === 0) return null;

                return (
                  <div key={role} className="calc-tree__role-column">
                    <TreeStem tall />
                    <div className="calc-zone calc-zone--components">
                      <p className="calc-zone__label">{ROLE_TITLE[role]} components</p>
                      <div className="calc-zone__row calc-zone__row--wrap">
                        {components.map((component, index) => {
                          const score = scored.get(component.id);
                          const expanded = open.has(component.id);
                          return (
                            <div key={component.id} className="calc-zone__branch">
                              {index > 0 ? (
                                <OpBadge op={componentEdgeSign(component, role)} />
                              ) : null}
                              <ComponentCard
                                batchId={batchId}
                                component={component}
                                kg={score?.kg ?? null}
                                missing={score?.missing ?? []}
                                expanded={expanded}
                                selected={selectedComponentId === component.id}
                                onToggle={() => toggleOpen(component.id)}
                                onSelect={() => onSelectComponent(component.id)}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
