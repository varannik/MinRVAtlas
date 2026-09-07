import { humanizeKey, type LcaRecipe } from "./project-definition";
import type {
  GhgEntry,
  GhgEntryTemplate,
  GhgStatement,
} from "./registries/isometric/api";

export type GroupRole =
  | "sequestrations"
  | "activities"
  | "counterfactuals"
  | "project-emissions"
  | "other";

export type AccountingInput = {
  key: string;
  name: string;
  type: string;
  quantityKind?: string;
  bound: boolean;
  datapointId?: string | null;
};

export type AccountingComponent = {
  id: string;
  name: string;
  description?: string | null;
  blueprint?: string;
  blueprintKey?: string;
  inputs: AccountingInput[];
};

export type AccountingGroup = {
  id: string;
  key: string;
  name: string;
  description?: string;
  role: GroupRole;
  components: AccountingComponent[];
};

export type AccountingTemplate = {
  id: string;
  name: string;
  creditType: string;
  groups: AccountingGroup[];
};

export type AccountingEntry = {
  id: string;
  startedOn: string | null;
  completedOn: string | null;
  statementId: string | null;
  netKg: number | null;
  netKgUndiscounted: number | null;
};

export type AccountingStatement = {
  id: string;
  status: string;
  periodStart: string | null;
  periodEnd: string | null;
  entryIds: string[];
  netKg: number | null;
};

export type AccountingSnapshot = {
  origin: "registry-api" | "bundled";
  warning?: string;
  templates: AccountingTemplate[];
  entries: AccountingEntry[];
  statements: AccountingStatement[];
};

export const ACCOUNTING_TABS = [
  "entries",
  "statements",
  "emissions",
  "lca",
] as const;

export type AccountingTab = (typeof ACCOUNTING_TABS)[number];

export const ACCOUNTING_TAB_LABEL: Record<AccountingTab, string> = {
  entries: "GHG entry data",
  statements: "GHG statements",
  emissions: "Project emissions",
  lca: "LCA",
};

export function groupRole(key: string, name: string): GroupRole {
  const hay = `${key} ${name}`.toLowerCase();
  if (
    /project.?emission|establishment|end.of.life|end of life|embodied|amortiz/.test(
      hay,
    )
  ) {
    return "project-emissions";
  }
  if (/sequest|stored|isolat|injection|storage/.test(hay)) return "sequestrations";
  if (/counterfactual/.test(hay)) return "counterfactuals";
  if (/activit|emission|operat|transport|electric|heat|fuel/.test(hay)) {
    return "activities";
  }
  return "other";
}

export function isMonitoredInput(input: Pick<AccountingInput, "type">): boolean {
  return (input.type ?? "").toLowerCase() === "monitored";
}

export function isExSituMineralizationBlueprint(blueprintKey?: string): boolean {
  return (blueprintKey ?? "").toLowerCase().includes("dac_mineralized_co2");
}

export function recipeFromTemplate(template: AccountingTemplate): LcaRecipe {
  return {
    creditType: template.creditType,
    groups: template.groups.map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description,
      components: group.components.map((component) => ({
        id: component.id,
        name: component.name,
        description: component.description,
        blueprint: component.blueprint,
        inputs: component.inputs.map((input) => ({
          name: input.name,
          inputKey: input.key,
          type: input.type,
          quantityKind: input.quantityKind,
          bound: input.bound,
          datapointId: input.datapointId,
        })),
      })),
    })),
  };
}

export function templateFromCertify(row: GhgEntryTemplate): AccountingTemplate {
  return {
    id: row.id,
    name: row.display_name || "GHG entry template",
    creditType: String(row.credit_type || "REMOVAL"),
    groups: (row.groups ?? []).map((group) => ({
      id: group.id,
      key: group.key,
      name: humanizeKey(group.display_name || group.key),
      description: group.description,
      role: groupRole(group.key, group.display_name || group.key),
      components: (group.components ?? []).map((component) => ({
        id: component.id,
        name: humanizeKey(component.display_name),
        description: component.description,
        blueprint: component.blueprint_key
          ? humanizeKey(component.blueprint_key)
          : undefined,
        blueprintKey: component.blueprint_key,
        inputs: (component.inputs ?? []).map((input) => ({
          key: input.input_key,
          name: humanizeKey(input.display_name || input.input_key),
          type: input.type ?? "monitored",
          quantityKind: input.quantity_kind,
          bound: Boolean(input.datapoint_id),
          datapointId: input.datapoint_id,
        })),
      })),
    })),
  };
}

export function entryFromCertify(row: GhgEntry): AccountingEntry {
  return {
    id: row.id,
    startedOn: row.started_on?.slice(0, 10) ?? null,
    completedOn: row.completed_on?.slice(0, 10) ?? null,
    statementId: row.ghg_statement_id ?? null,
    netKg: row.co2e_net_removed_kg ?? null,
    netKgUndiscounted: row.co2e_net_removed_without_discount_kg ?? null,
  };
}

function dayOf(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  return value.slice(0, 10);
}

export function statementWindow(row: GhgStatement): {
  start: string;
  end: string;
} | null {
  const start =
    dayOf(row.reporting_period_start_at) ??
    dayOf(row.start_on) ??
    dayOf(row.started_on) ??
    dayOf(row.start_date);
  const end =
    dayOf(row.reporting_period_end_at) ??
    dayOf(row.end_on) ??
    dayOf(row.ended_on) ??
    dayOf(row.end_date);
  if (!start || !end) return null;
  return { start, end };
}

export function statementFromCertify(row: GhgStatement): AccountingStatement {
  const span = statementWindow(row);
  return {
    id: row.id,
    status: row.status ?? "draft",
    periodStart: span?.start ?? null,
    periodEnd: span?.end ?? null,
    entryIds: row.ghg_entry_ids ?? [],
    netKg: row.co2e_net_removed_kg ?? null,
  };
}

export function inPeriod(
  day: string | null,
  periodStart: string,
  periodEnd: string,
): boolean {
  if (!day) return false;
  return day >= periodStart && day <= periodEnd;
}

export function monitoredInputs(template: AccountingTemplate): AccountingInput[] {
  return template.groups.flatMap((group) =>
    group.components.flatMap((component) =>
      component.inputs.filter((input) => isMonitoredInput(input) && !input.bound),
    ),
  );
}

export function kgToTonnes(kg: number | null | undefined): number {
  if (kg == null || !Number.isFinite(kg)) return 0;
  return kg / 1000;
}

export function formatKgCo2e(kg: number | null | undefined): string {
  if (kg == null || !Number.isFinite(kg)) return "0 kgCO₂e";
  const abs = Math.abs(kg);
  if (abs >= 1000) return `${(kg / 1000).toFixed(abs >= 10_000 ? 0 : 1)} tCO₂e`;
  return `${kg.toFixed(abs >= 10 ? 0 : 1)} kgCO₂e`;
}

export function defaultUnit(quantityKind?: string): string {
  const kind = (quantityKind ?? "").toLowerCase();
  if (kind.includes("mass") || kind.includes("carbon")) return "kg";
  if (kind.includes("energy")) return "kWh";
  if (kind.includes("distance") || kind === "length") return "km";
  if (kind.includes("volume")) return "m3";
  if (kind.includes("dimensionless") || kind.includes("ratio") || kind.includes("fraction")) {
    return "1";
  }
  if (kind.includes("time")) return "h";
  if (kind.includes("area")) return "m2";
  return "kg";
}

export function unitChoices(quantityKind?: string): string[] {
  const kind = (quantityKind ?? "").toLowerCase();
  if (kind.includes("mass") || kind.includes("carbon")) return ["kg", "t", "g"];
  if (kind.includes("energy")) return ["kWh", "MWh", "MJ", "GJ"];
  if (kind.includes("distance")) return ["km", "m"];
  if (kind.includes("volume")) return ["m3", "L"];
  if (kind.includes("dimensionless") || kind.includes("ratio") || kind.includes("fraction")) {
    return ["1", "%"];
  }
  return [defaultUnit(quantityKind), "kg", "t", "kWh", "km"];
}

export function emptyAccounting(warning?: string): AccountingSnapshot {
  return {
    origin: "bundled",
    warning,
    templates: [],
    entries: [],
    statements: [],
  };
}
