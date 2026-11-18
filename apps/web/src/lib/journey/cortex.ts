import { STEP_DEFS } from "./definition";
import { answerLabel, planFor, type Plan } from "./steps";
import type { JourneyTask, TaskState } from "./types";

/**
 * Cortex's checks in this preview: plain rules from the registry texts in
 * reports/Puro and Isometric supplier onboarding.md, run in the browser. A
 * task names its rule in journey.yaml (`cortex.check`); otherwise the input
 * type's own check runs. The Cortex backend will replace these with reading
 * the documents themselves.
 */

export interface Verdict {
  ok: boolean;
  note: string;
}

type Answers = Record<string, TaskState | undefined>;

export interface CheckContext {
  plan: Plan;
  /** Monitoring periods already closed. */
  laps: number;
  now?: number;
}

const DAY = 86_400_000;

const LONG = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const SHORT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// ── Formatting ──────────────────────────────────────────────────────────────

function parseDay(value: string | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

export function formatDay(value: string | undefined): string {
  const ms = parseDay(value);
  return ms == null ? (value ?? "") : LONG.format(ms);
}

export function splitPeriod(value: string | undefined): [string, string] {
  const [start = "", end = ""] = (value ?? "").split("|");
  return [start, end];
}

export function formatPeriod(value: string | undefined): string {
  const [start, end] = splitPeriod(value);
  const a = parseDay(start);
  const b = parseDay(end);
  if (a == null || b == null) return "";
  const sameYear = new Date(a).getUTCFullYear() === new Date(b).getUTCFullYear();
  return `${sameYear ? SHORT.format(a) : LONG.format(a)} – ${LONG.format(b)}`;
}

/** "25.4861, 56.3093" → coordinates, if both are in range. */
export function parseLocation(value: string | undefined): { lat: number; lng: number } | null {
  const raw = (value ?? "").split(",").map((part) => part.trim());
  // Empty fields are not zero.
  if (raw.length !== 2 || raw.some((part) => part === "")) return null;
  const [lat, lng] = raw.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function formatLocation(value: string | undefined): string {
  const at = parseLocation(value);
  if (!at) return value ?? "";
  const ns = at.lat >= 0 ? "N" : "S";
  const ew = at.lng >= 0 ? "E" : "W";
  return `${Math.abs(at.lat).toFixed(4)}° ${ns}, ${Math.abs(at.lng).toFixed(4)}° ${ew}`;
}

/** An answer as it reads in a sentence. */
export function formatAnswer(task: JourneyTask, state: TaskState | undefined): string {
  const value = state?.value ?? "";
  switch (task.input.type) {
    case "period":
      return formatPeriod(value);
    case "date":
      return formatDay(value);
    case "location":
      return formatLocation(value);
    case "number":
      return value ? `${Number(value).toLocaleString("en-GB")} ${task.input.unit}` : "";
    case "choice":
      return answerLabel(task, value);
    default:
      return value;
  }
}

function addMonths(ms: number, months: number): number {
  const date = new Date(ms);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.getTime();
}

function extensionOk(name: string, accept: string): boolean {
  const lower = name.toLowerCase();
  return accept.split(",").some((entry) => lower.endsWith(entry.trim().toLowerCase()));
}

const CADENCE: Record<string, number> = {
  "Once a year": 1,
  "Twice a year": 2,
  "Four times a year": 4,
  "Every month": 12,
};

/** Output reports a year Puro allows at this volume (fee schedule tiers). */
export function reportsAllowed(corcsPerYear: number): number {
  if (corcsPerYear >= 60_000) return 12;
  if (corcsPerYear >= 30_000) return 6;
  if (corcsPerYear >= 20_000) return 4;
  if (corcsPerYear >= 10_000) return 2;
  return 1;
}

// ── Checks ──────────────────────────────────────────────────────────────────

type Check = (input: {
  task: JourneyTask;
  value: string;
  state: TaskState;
  answers: Answers;
  plan: Plan;
  laps: number;
  now: number;
  pass: (note?: string) => Verdict;
  flag: (note: string) => Verdict;
}) => Verdict;

const isPuro = (plan: Plan) => plan.registry?.id === "puro";

const CHECKS: Record<string, Check> = {
  "registry-gate": ({ value, pass }) => {
    const registry = planFor(value, null).registry;
    if (!registry) return pass();
    return pass(`${registry.label}'s hard gate: ${registry.gate ?? "none recorded."} ${registry.clocks ?? ""}`.trim());
  },

  "methodology-fit": ({ value, plan, pass, flag }) => {
    const next = planFor(plan.registry?.id ?? null, value);
    if (!next.methodology) return flag("That methodology's requirements aren't mapped yet, so I can't build the next steps from it.");
    const count = next.steps
      .filter((step) => step.id !== "setup" && step.id !== "methodology")
      .reduce((sum, step) => sum + step.tasks.length, 0);
    return pass(`${next.methodology.lock ?? ""} I've built the next steps from it: ${count} items from onboarding to issuance.`.trim());
  },

  "other-schemes": ({ value, plan, pass, flag }) => {
    if (value.startsWith("Failed")) {
      return isPuro(plan)
        ? flag("Puro refuses a project that failed another scheme's audit in the past three years (CP 9.8.21). Settle it with Puro in writing before you spend on an audit.")
        : flag("Disclose it in the PDD (R-Q3JN-0). Isometric will weigh it at the eligibility review.");
    }
    if (value.startsWith("Registered")) {
      return flag("Both registries ban double registration. Say so in the concept note and make sure no credit can be issued twice.");
    }
    return pass("I'll declare it in the concept note.");
  },

  offtake: ({ value, pass, flag }) => {
    if (value === "No buyer yet") {
      return flag("Isometric typically takes on an operating project only with offtakes in place or above a minimum tonnage. A signed buyer is the entry ticket.");
    }
    return pass(value === "Signed offtake" ? "Good: that's what Isometric looks for in a late-entry project." : "Tell Isometric's team about it early; they weigh offtakes at onboarding.");
  },

  "fossil-share": ({ value, pass, flag }) => {
    const share = Number(value);
    if (share > 5) {
      return flag(`${share}% is above BioCCS's 5% line, so the PDD needs a justification (R-YJJC-0). With RDF in the mix, F_B must come from Method A sampling.`);
    }
    return pass("Under 5%: no justification needed.");
  },

  "review-status": ({ value, plan, pass, flag }) => {
    if (value === "Passed") return pass("Then the registry appoints the VVB.");
    if (value === "Changes requested") {
      return flag(
        isPuro(plan)
          ? "Puro can deregister a project still insufficient after several rounds (CP 5.2.1–5.2.4). Tell me what they asked for and I'll match it to the package."
          : "Close every issue the reviewers raised; they approve in rounds.",
      );
    }
    return flag("Waiting on the registry. Change this answer when the review passes.");
  },

  "remi-issues": ({ value, pass, flag }) => {
    const open = Number(value);
    if (open > 0) return flag(`${open} issue${open === 1 ? "" : "s"} still open. Request validation stays disabled until each is resolved or disputed.`);
    return pass("Request validation is open.");
  },

  "public-comment": ({ value, pass, flag }) => {
    const [start, end] = splitPeriod(value);
    const a = parseDay(start);
    const b = parseDay(end);
    if (a == null || b == null || b <= a) return flag("Both dates are needed, the end after the start.");
    const days = Math.round((b - a) / DAY);
    if (days < 10) return flag(`${days} days is short of the 10-day public comment period.`);
    return pass(`${days} days. If material comments arrive, Isometric extends it to 30.`);
  },

  "validation-window": ({ value, answers, pass, flag }) => {
    const audit = parseDay(value);
    const committed = parseDay(answers["setup.commitment"]?.value);
    if (audit == null) return flag("That isn't a date.");
    if (committed == null) return flag("I need the Commitment Date from Project setup to check the window.");
    const three = addMonths(committed, 36);
    const five = addMonths(committed, 60);
    if (audit <= three) return pass(`Inside the 3-year window, which closes ${LONG.format(three)}.`);
    if (audit <= five) {
      return flag(`Past the 3-year window of GR 2.2.3 (closed ${LONG.format(three)}) but inside CP 5.3.9's 5 years for geological storage (${LONG.format(five)}). The two rules conflict: get Puro's ruling in writing before booking.`);
    }
    return flag(`Past both windows: 3 years closed ${LONG.format(three)} and 5 years ${LONG.format(five)}.`);
  },

  findings: ({ task, value, plan, pass, flag }) => {
    const atValidation = task.step === "validation";
    const serious = value === "Major findings" || value === "Critical findings";
    if (serious) {
      if (isPuro(plan)) {
        return flag(
          atValidation
            ? "A major or critical non-conformity at validation rejects the project, and it can re-apply only after 12 months (CP section 6)."
            : "Major findings suspend the Certificate of Compliance. Fix them within 90 days or the project is withdrawn.",
        );
      }
      return flag("Every issue must close before Isometric moves on, except Forward Action Requests. Where a requirement doesn't fit, ask for an Explanatory Note.");
    }
    if (value === "Minor findings only") return pass("Answer each one; I'll pair findings with your responses.");
    return pass("Clean audit.");
  },

  "crediting-start": ({ value, plan, now, pass, flag }) => {
    const start = parseDay(value);
    if (start == null) return flag("That isn't a date.");
    const end = addMonths(start, 180);
    if (!isPuro(plan) && start < addMonths(now, -60)) {
      return flag("Isometric lets the crediting period start at most 5 years before the first registry submission.");
    }
    return pass(`The crediting period runs to ${LONG.format(end)}.`);
  },

  cadence: ({ value, answers, plan, pass, flag }) => {
    if (!isPuro(plan)) return pass("Verify at least once a year.");
    const forecast = Number(answers["listed.forecast"]?.value);
    const asked = CADENCE[value] ?? 1;
    if (Number.isFinite(forecast) && forecast > 0) {
      const allowed = reportsAllowed(forecast);
      if (asked > allowed) {
        return flag(`At about ${forecast.toLocaleString("en-GB")} CORCs a year Puro allows ${allowed} output report${allowed === 1 ? "" : "s"} a year, not ${asked}. More often needs Issuance Plus.`);
      }
    }
    return pass();
  },

  buffer: ({ value, pass }) =>
    pass(value.startsWith("Recognised") ? "No buffer deduction. Isometric must accept the regime as equivalent." : "1% of each issuance goes to the buffer."),

  "period-length": ({ value, plan, laps, pass, flag }) => {
    const [start, end] = splitPeriod(value);
    const a = parseDay(start);
    const b = parseDay(end);
    if (a == null || b == null) return flag("Both dates are needed.");
    if (b <= a) return flag("The end date is before the start date.");
    const days = Math.round((b - a) / DAY) + 1;
    const first = laps === 0;
    if (isPuro(plan) && first) {
      if (b > addMonths(a, 18)) return flag(`${days} days is longer than the 18 months GR 2.4.2 allows for a first period (CP 5.4.5 says 24; ask Puro which applies).`);
      if (b > addMonths(a, 12)) return pass(`${days} days. Longer than a year is allowed only for the first period.`);
    } else if (b > addMonths(a, 12)) {
      return flag(`${days} days is more than a year. ${isPuro(plan) ? "An output report is due at least every 12 months." : "Verify at least once a year."} Split it into two periods.`);
    }
    return pass(`${days} days.`);
  },

  "bubble-point": ({ value, plan, pass, flag }) => {
    const margin = Number(value);
    if (margin <= 5) {
      return flag(
        isPuro(plan)
          ? `${margin} bar is not more than 5 bar above the bubble point. CO₂ injected while the margin was breached counts as a reversal.`
          : `${margin} bar is not more than 5 bar above the bubble point the module requires.`,
      );
    }
    return pass(`${margin} bar of margin.`);
  },

  "reversal-notice": ({ value, plan, pass, flag }) => {
    if (value === "Reversal not yet reported") {
      return flag(isPuro(plan) ? "Report it to Puro within 5 days." : "Report it to Isometric within 1 business day (3 at most).");
    }
    if (value === "Reversal reported to the registry") return pass("I'll carry it into E_reversal for the period.");
    return pass();
  },

  "audit-fee": ({ value, pass, flag }) => {
    const corcs = Number(value);
    if (corcs <= 1000) {
      return flag(`At ${corcs.toLocaleString("en-GB")} CORCs Puro invoices a flat €12,000 when the audit is booked, before any credit exists (about €${Math.round(12000 / Math.max(corcs, 1)).toLocaleString("en-GB")} a CORC). A longer period moves you onto per-CORC fees paid at sale.`);
    }
    return pass("Per-CORC service fees apply, invoiced when the CORCs are sold or retired.");
  },

  "issued-count": ({ value, plan, pass, flag }) => {
    const number = Number(value);
    if (isPuro(plan)) {
      if (!Number.isInteger(number)) {
        return flag(`CORCs are whole tonnes: ${Math.floor(number)} now, and ${(number % 1).toFixed(2)} t carries to the next issuance.`);
      }
      return pass("I'll add them to the removal ledger.");
    }
    const buffer = number * 0.01;
    return pass(`About ${buffer.toFixed(2)} t goes to the 1% buffer and ${(number - buffer).toFixed(2)} t to your account.`);
  },

  vintage: ({ value, answers, pass, flag }) => {
    const [, end] = splitPeriod(answers["monitor.period"]?.value);
    const last = parseDay(end);
    if (last != null && Number(value) !== new Date(last).getUTCFullYear()) {
      return flag(`The vintage is the year the period ends: ${new Date(last).getUTCFullYear()}.`);
    }
    return pass();
  },

  "next-period": ({ value, answers, pass, flag }) => {
    const at = parseDay(value);
    if (at == null) return flag("That isn't a date.");
    const [, end] = splitPeriod(answers["monitor.period"]?.value);
    const last = parseDay(end);
    if (last != null && at <= last) return flag(`This overlaps the period that ends ${LONG.format(last)}. Periods must not overlap.`);
    if (last != null && at - last > DAY) {
      return flag(`That leaves ${Math.round((at - last) / DAY) - 1} days after ${LONG.format(last)} with no period, so removals then earn nothing.`);
    }
    return pass("I'll open the next period's Monitor step from this date.");
  },

  "host-country": ({ value, plan, pass, flag }) => {
    if (value === "Not sure yet") return flag("Settle it before the audit: the answer decides whether the host country must authorise the credits.");
    if (value === "Inside the NDC") {
      return pass(isPuro(plan) ? "Then Article 6 authorisation from the host country is needed (GSC 3.6.2)." : "Say so in the net-zero and NDC compatibility statement (R-S9BB-0).");
    }
    return pass("I'll write the NDC conclusion into the package.");
  },
};

/** The input type's own check, used when a task names no rule. */
function baseCheck(task: JourneyTask, state: TaskState, answers: Answers): Verdict | null {
  const value = state.value?.trim() ?? "";
  const flag = (note: string): Verdict => ({ ok: false, note });
  switch (task.input.type) {
    case "file": {
      const files = state.files ?? [];
      if (files.length === 0) return flag("No file attached.");
      const accept = task.input.accept;
      const wrong = files.filter((file) => !extensionOk(file.name, accept));
      if (wrong.length > 0) {
        return flag(`${wrong.map((file) => file.name).join(", ")} isn't ${task.input.formats}. Check it's the right document before accepting.`);
      }
      return null;
    }
    case "draft":
      return null;
    case "period": {
      const [start, end] = splitPeriod(value);
      const a = parseDay(start);
      const b = parseDay(end);
      if (a == null || b == null) return flag("Both dates are needed.");
      if (b <= a) return flag("The end date is before the start date.");
      return null;
    }
    case "date":
      return parseDay(value) == null ? flag("That isn't a date.") : null;
    case "number": {
      const number = Number(value.replace(/,/g, ""));
      return !value || !Number.isFinite(number) || number < 0 ? flag("That isn't a number.") : null;
    }
    case "location":
      return parseLocation(value) ? null : flag("Latitude must be between -90 and 90, longitude between -180 and 180.");
    case "choice":
      return value ? null : flag("Choose an answer.");
    default:
      void answers;
      return value.length < 2 ? flag("That looks empty.") : null;
  }
}

export function checkAnswer(task: JourneyTask, state: TaskState, answers: Answers, context: CheckContext): Verdict {
  const failed = baseCheck(task, state, answers);
  if (failed) return failed;
  if (task.input.type === "draft") return checkDraft(task, answers, context.plan);

  const fallback = (): string => {
    if (task.input.type === "file") {
      const files = state.files ?? [];
      return `Filed ${files.length === 1 ? files[0].name : `${files.length} files`}.${task.tip ? ` ${task.tip}` : ""}`;
    }
    return task.tip ?? "";
  };
  const pass = (note?: string): Verdict => ({ ok: true, note: note ?? fallback() });
  const flag = (note: string): Verdict => ({ ok: false, note });

  const rule = task.cortex.check ? CHECKS[task.cortex.check] : undefined;
  if (!rule) return pass();
  return rule({
    task,
    value: (state.value ?? "").trim().replace(/,/g, task.input.type === "number" ? "" : ","),
    state,
    answers,
    plan: context.plan,
    laps: context.laps,
    now: context.now ?? Date.now(),
    pass,
    flag,
  });
}

// Every rule journey.yaml names must exist here.
for (const step of STEP_DEFS) {
  for (const task of step.tasks) {
    const variants = [task, ...Object.values(task.by_registry ?? {})];
    for (const variant of variants) {
      const help = variant.cortex as { check?: string } | undefined;
      if (help && typeof help === "object" && help.check && !CHECKS[help.check]) {
        throw new Error(`journey.yaml · ${task.id}: no Cortex rule named "${help.check}" in cortex.ts`);
      }
    }
  }
}

// ── Drafts ──────────────────────────────────────────────────────────────────

function mark(answers: Answers, plan: Plan, id: string): string {
  const task = plan.taskById[id];
  if (!task) return "";
  const state = answers[id];
  if (state?.status === "done") return `✓ ${task.label}`;
  if (state?.status === "flagged") return `! ${task.label} — given, with a question open`;
  return `○ ${task.label} — missing`;
}

/** What Cortex drafts for a generate task: its lines in journey.yaml, filled from earlier answers. */
export function draftFor(task: JourneyTask, answers: Answers, plan: Plan): string[] {
  const methodology = plan.methodology;
  const fill = (token: string): string => {
    if (token.startsWith("mark:")) return mark(answers, plan, token.slice(5));
    switch (token) {
      case "location":
        return formatLocation(answers["setup.location"]?.value) || "[location]";
      case "registry":
        return plan.registry?.label ?? "[registry]";
      case "methodology":
        return methodology ? [methodology.label, methodology.version].filter(Boolean).join(" ") : "[methodology]";
      case "modules":
        return methodology?.modules.join(", ") || "[modules]";
      case "credits":
        return plan.credit.many;
      case "period":
        return formatPeriod(answers["monitor.period"]?.value) || "[period]";
    }
    const source = plan.taskById[token];
    if (!source) return "[to confirm]";
    return formatAnswer(source, answers[token]) || "[to confirm]";
  };
  return (task.draft?.lines ?? [])
    .map((line) => {
      const marksOnly = /^\{mark:[^}]+\}$/.test(line);
      const filled = line.replace(/\{([a-z0-9:.\-]+)\}/gi, (_, token: string) => fill(token));
      return marksOnly && !filled ? null : filled;
    })
    .filter((line): line is string => line !== null);
}

/** A draft passes when nothing it leans on is missing. */
function checkDraft(task: JourneyTask, answers: Answers, plan: Plan): Verdict {
  const missing = (task.draft?.needs ?? []).filter((id) => plan.taskById[id] && answers[id]?.status !== "done");
  if (missing.length === 0) return { ok: true, note: task.tip ?? "Drafted from your answers. Read it through, then accept it." };
  const names = missing.map((id) => plan.taskById[id].label);
  return {
    ok: false,
    note: `Drafted, but it leans on ${names.length === 1 ? "an item" : "items"} that ${names.length === 1 ? "isn't" : "aren't"} settled: ${names.join(", ")}.`,
  };
}
