"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  defaultUnit,
  formatKgCo2e,
  isMonitoredInput,
  unitChoices,
  type AccountingComponent,
} from "@/lib/accounting";
import { formulaLabel, formulaSteps } from "@/lib/blueprint-formula";
import {
  emptyInputDraft,
  inputDraftKey,
  useAccountingDrafts,
} from "@/store/accounting-draft-store";

export function OpBadge({ op }: { op: string }) {
  const minus = op === "−" || op === "÷";
  return (
    <span
      className={`calc-op ${minus ? "calc-op--minus" : ""}`}
      aria-hidden
    >
      {op}
    </span>
  );
}

function ValuePill({
  kg,
  missing,
}: {
  kg: number | null;
  missing?: string | null;
}) {
  if (kg == null) {
    return (
      <span className="calc-pill calc-pill--missing">
        {missing ? `Missing ${missing}` : "Missing input"}
      </span>
    );
  }
  return <span className="calc-pill calc-pill--ok">{formatKgCo2e(kg)}</span>;
}

export function FluxCard({
  title,
  kg,
  incomplete,
  expanded,
  selected,
  onToggle,
}: {
  title: string;
  kg: number | null;
  incomplete?: boolean;
  expanded: boolean;
  selected?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`calc-card calc-card--flux ${selected ? "calc-card--selected" : ""}`}
    >
      <div className="calc-card__row">
        <span className="calc-card__title">{title}</span>
        <ValuePill kg={kg} />
      </div>
      {incomplete ? (
        <p className="calc-card__hint">Some components still need inputs</p>
      ) : null}
      <span className="calc-card__chevron" aria-hidden>
        {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </span>
    </button>
  );
}

function InputRow({
  batchId,
  componentId,
  input,
  op,
}: {
  batchId: string;
  componentId: string;
  input: AccountingComponent["inputs"][number];
  op: string;
}) {
  const setInput = useAccountingDrafts((state) => state.setInput);
  const committed = useAccountingDrafts(
    (state) => state.byKey[inputDraftKey(batchId, componentId, input.key)],
  );
  const key = inputDraftKey(batchId, componentId, input.key);
  const unitDefault = defaultUnit(input.quantityKind);
  const committedDraft = committed ?? emptyInputDraft(unitDefault);
  const committedSig = `${committedDraft.magnitude}\0${committedDraft.unit}\0${committedDraft.stddev}`;
  const [prevCommittedSig, setPrevCommittedSig] = useState(committedSig);
  const [local, setLocal] = useState(committedDraft);
  if (committedSig !== prevCommittedSig) {
    setPrevCommittedSig(committedSig);
    setLocal(committedDraft);
  }
  const monitored = isMonitoredInput(input);
  const units = unitChoices(input.quantityKind);

  const dirty =
    local.magnitude !== committedDraft.magnitude ||
    local.unit !== committedDraft.unit ||
    local.stddev !== committedDraft.stddev;
  const applied =
    Boolean(committedDraft.magnitude) && Number.isFinite(Number(committedDraft.magnitude));
  const rowClass = applied && !dirty ? "calc-input-row calc-input-row--applied" : "calc-input-row";

  return (
    <li className={rowClass}>
      {op !== "=" ? <OpBadge op={op} /> : null}
      <div className="calc-input-row__head">
        <span className="calc-input-row__name">{input.name}</span>
        <span className="calc-input-row__tag">{monitored ? "period" : "fixed"}</span>
      </div>
      <p className="calc-input-row__key">{input.key}</p>
      <div className="calc-input-row__fields">
        <div className="calc-input-row__values">
          <input
            type="text"
            inputMode="decimal"
            value={local.magnitude}
            onChange={(event) => setLocal((prev) => ({ ...prev, magnitude: event.target.value }))}
            placeholder="Value"
            className={`calc-input-field ${applied && !dirty ? "calc-input-field--ok" : ""}`}
            aria-label={`${input.name} value`}
          />
          <select
            value={local.unit || unitDefault}
            onChange={(event) => setLocal((prev) => ({ ...prev, unit: event.target.value }))}
            className="calc-input-unit"
            aria-label={`${input.name} unit`}
          >
            {units.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
          <input
            type="text"
            inputMode="decimal"
            value={local.stddev}
            onChange={(event) => setLocal((prev) => ({ ...prev, stddev: event.target.value }))}
            placeholder="+/-"
            title="Measurement uncertainty"
            className="calc-input-unc"
            aria-label={`${input.name} uncertainty`}
          />
        </div>
        <button
          type="button"
          disabled={!dirty && applied}
          onClick={() =>
            setInput(key, {
              magnitude: local.magnitude,
              unit: local.unit || unitDefault,
              stddev: local.stddev,
            })
          }
          className={`calc-input-apply ${applied && !dirty ? "calc-input-apply--ok" : ""}`}
        >
          {dirty ? "Apply" : applied ? "Applied" : "Apply"}
        </button>
      </div>
    </li>
  );
}

export function ComponentCard({
  batchId,
  component,
  kg,
  missing,
  expanded,
  selected,
  onToggle,
  onSelect,
}: {
  batchId: string;
  component: AccountingComponent;
  kg: number | null;
  missing?: string | null;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const formula = formulaLabel(component);
  const steps = formulaSteps(component);

  return (
    <div className={`calc-component ${selected ? "calc-component--selected" : ""}`}>
      <button
        type="button"
        className={`calc-card calc-card--component ${kg != null ? "calc-card--ok" : ""}`}
        onClick={() => {
          onSelect();
          onToggle();
        }}
      >
        <div className="calc-card__row">
          <span className="calc-card__title">{component.name}</span>
          <ValuePill kg={kg} missing={missing} />
        </div>
        <p className="calc-card__formula">{formula}</p>
        <span className="calc-card__chevron" aria-hidden>
          {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </span>
      </button>

      {expanded ? (
        <div className="calc-zone calc-zone--inputs">
          <p className="calc-zone__label">
            {steps.some((step) => !isMonitoredInput(step.input))
              ? "Formula inputs (period + LCA fixed)"
              : "Manual inputs"}
          </p>
          <ul className="calc-input-list">
            {steps.map((step) => (
              <InputRow
                key={step.input.key}
                batchId={batchId}
                componentId={component.id}
                input={step.input}
                op={step.op}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function TreeStem({ tall }: { tall?: boolean }) {
  return <div className={`calc-stem ${tall ? "calc-stem--tall" : ""}`} aria-hidden />;
}
