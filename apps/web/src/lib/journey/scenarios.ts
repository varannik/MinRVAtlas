import { planFor } from "./steps";
import type { JourneyScenario, ScenarioId, StepId, TaskState } from "./types";

/**
 * Two starting points for review: a listed Puro facility part-way through its
 * first monitoring period, and a project created today. Fujairah's period-1
 * figures and gaps come from docs/Fujairah_Puro_Monitoring_Period_Data_Requirements.xlsx;
 * its package gaps from reports/Puro and Isometric supplier onboarding.md.
 */

/** Every task of the Puro GSC plan, done, up to and including `last`. */
function doneThrough(last: StepId): Record<string, TaskState> {
  const seed: Record<string, TaskState> = {};
  for (const step of planFor("puro", "puro-gsc").steps) {
    for (const task of step.tasks) if (!task.optional) seed[task.id] = { status: "done" };
    if (step.id === last) break;
  }
  return seed;
}

const FUJAIRAH: JourneyScenario = {
  id: "fujairah-mineral",
  name: "Fujairah Peridotite Mineralisation",
  place: "Adgat storage site (ACE2.5), Fujairah, UAE",
  tag: "Listed · period 1",
  current: "monitor",
  laps: 0,
  seed: {
    ...doneThrough("listed"),
    "setup.name": { status: "done", value: "Fujairah Peridotite Mineralisation" },
    // ACE2.5 storage site, Adgat (see src/lib/projects.ts).
    "setup.location": { status: "done", value: "25.4860833, 56.30925" },
    "methodology.category": { status: "done", value: "technology" },
    "methodology.registry": { status: "done", value: "puro" },
    "methodology.pick": { status: "done", value: "puro-gsc" },
    "onboarding.other-schemes": { status: "done", value: "Never registered or assessed elsewhere" },
    "package.lca": {
      status: "done",
      files: [{ name: "puro_4401_LCA_2.xlsm", size: 0 }],
      note: "Uses forecasts for 1 May – 31 Oct 2026; the output report replaces them with metered values. Re-check it against GSC v5's amortisation and mass-balance rules.",
    },
    "package.index": { status: "done", files: [{ name: "Audit Document Index - GSC_Final.xlsx", size: 0 }] },
    "validation.combined": { status: "done", value: "Combined with validation" },
    "listed.crediting": { status: "done", value: "2026-07-17" },
    "listed.forecast": { status: "done", value: "24000" },

    "monitor.period": {
      status: "done",
      value: "2026-07-17|2026-08-17",
      note: "00:00 17 Jul to 23:59 17 Aug, Gulf time (UTC+4). In S3 (UTC) that is 16 Jul 20:00 to 17 Aug 19:59.",
    },
    "monitor.injected": {
      status: "flagged",
      value: "142.32",
      note: "FT_04 + FT_05 give 142.32 t. FT_14 reads 4.6% lower (135.84 t). The site must confirm which meter is the last point of measurement.",
    },
    "monitor.chain": {
      status: "flagged",
      files: [
        { name: "Totalizers_17Jul_17Aug (2).xlsx", size: 0 },
        { name: "Holcim CDR July 17th to Aug 17th (1).xlsx", size: 0 },
      ],
      note: "Captured ≈63.8 t, liquefied ≈47.9 t, loaded 70.70 t, received 136.20 t; matches S3. Capture-site totalisers reset at 13:03 UTC on 17 Jul, so the extract leaves out ≈2.9 t captured that morning. 6.12 t more was injected than received and 22.8 t more loaded than liquefied: both come from tank stock. Use one start time for every stream.",
    },
    "monitor.energy": {
      status: "flagged",
      files: [{ name: "Totalizers_17Jul_17Aug (2).xlsx", size: 0 }],
      note: "Capture site ≈111.7 MWh, storage site 4,039 kWh, water 4,153 t. Storage-site power isn't split into solar and generator: both incomer meters read 0 all period. No I-REC retirement statements for the period.",
    },
    "monitor.biogenic": { status: "open", note: "No radiocarbon results for the period yet." },
    "monitor.feedstock": {
      status: "open",
      note: "Only 2025 weighbridge reports are in the pack, some suppliers have no licence on file, and tyre-derived fuel has no Puro category.",
    },
    "monitor.calibration": { status: "open", note: "No calibration certificates in the pack." },
    "monitor.storage": { status: "open", note: "Monitoring results are offline." },
    "monitor.reversal": { status: "open", note: "No reversal register yet." },
  },
};

const NEW_PROJECT: JourneyScenario = {
  id: "new",
  name: "New project",
  place: "Location not set",
  tag: "Setup",
  current: "setup",
  laps: 0,
  seed: {},
};

export const SCENARIOS: JourneyScenario[] = [FUJAIRAH, NEW_PROJECT];

export const SCENARIO_BY_ID = Object.fromEntries(SCENARIOS.map((entry) => [entry.id, entry])) as Record<
  ScenarioId,
  JourneyScenario
>;

export function isScenarioId(value: string | null | undefined): value is ScenarioId {
  return value === "fujairah-mineral" || value === "new";
}
