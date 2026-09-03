"use client";

import { useCallback, useEffect, useState } from "react";

import { sentinelJson, unwrapItems } from "@/lib/sentinel/browser";
import { useQuality } from "@/store/quality-store";
import type { DqaRule } from "./types";
import {
  Banner,
  Button,
  DataTable,
  Field,
  inputClass,
  Modal,
  PageHeader,
  Pill,
  severityTone,
} from "./ui";

const SEVERITIES = ["critical", "high", "medium", "low", "info"];

export function RulesPage() {
  const projectId = useQuality((state) => state.projectId);
  const [rules, setRules] = useState<DqaRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<DqaRule | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setError(null);
    const data = await sentinelJson<unknown>(
      `v1/rules?project_id=${encodeURIComponent(projectId)}&limit=500`,
    );
    setRules(unwrapItems<DqaRule>(data));
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load rules");
    });
  }, [load, projectId]);

  async function seed() {
    if (!projectId) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await sentinelJson<{ message?: string }>(
        `v1/rules/seed/${projectId}`,
        { method: "POST" },
      );
      setNotice(result.message ?? "Rules seeded");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Seed failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Rule Manager"
        description="28 CO₂ injection rules across eight dimensions. Edits apply to the next DQA run for this Sentinel project."
        actions={
          <>
            <Button onClick={() => void load()} disabled={!projectId}>
              Refresh
            </Button>
            <Button
              tone="primary"
              onClick={() => void seed()}
              disabled={!projectId || busy}
            >
              Seed CO₂ rules
            </Button>
          </>
        }
      />
      {!projectId ? (
        <Banner kind="info">Select a Sentinel project in the header.</Banner>
      ) : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="ok">{notice}</Banner> : null}
      <DataTable
        columns={[
          "ID",
          "Name",
          "Dimension",
          "Severity",
          "Weight",
          "Gate",
          "Active",
          "",
        ]}
        empty="No rules yet. Seed the CO₂ set for this project."
        rows={rules.map((rule) => [
          <span key="id" className="font-mono text-xs text-signal-sky">
            {rule.rule_id}
          </span>,
          <span key="name">{rule.rule_name}</span>,
          <span key="dim" className="text-mist">
            {rule.dimension}
          </span>,
          <Pill key="sev" tone={severityTone(rule.severity)}>
            {rule.severity}
          </Pill>,
          <span key="w" className="tabular">
            {Math.round((rule.weight ?? 0) * 100)}%
          </span>,
          rule.is_hard_gate ? (
            <Pill key="gate" tone="bad">
              hard
            </Pill>
          ) : (
            <span key="gate" className="text-mist">
              —
            </span>
          ),
          <Pill key="on" tone={rule.is_active ? "ok" : "mist"}>
            {rule.is_active ? "on" : "off"}
          </Pill>,
          <Button key="edit" onClick={() => setEditing(rule)}>
            Edit
          </Button>,
        ])}
      />
      {editing ? (
        <RuleEditor
          rule={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            setNotice("Rule saved. The next DQA run will use these parameters.");
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function RuleEditor({
  rule,
  onClose,
  onSaved,
}: {
  rule: DqaRule;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [severity, setSeverity] = useState(rule.severity);
  const [weight, setWeight] = useState(String(rule.weight));
  const [active, setActive] = useState(rule.is_active);
  const [parameters, setParameters] = useState(
    JSON.stringify(rule.parameters ?? {}, null, 2),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(parameters) as Record<string, unknown>;
    } catch {
      setError("Parameters must be valid JSON");
      return;
    }
    setSaving(true);
    try {
      await sentinelJson(`v1/rules/${rule.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          severity,
          is_active: active,
          weight: Number(weight),
          parameters: parsed,
        }),
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`${rule.rule_id} · ${rule.rule_name}`} onClose={onClose}>
      {rule.what_it_checks ? (
        <p className="mb-4 text-sm text-mist">{rule.what_it_checks}</p>
      ) : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      <div className="grid gap-3">
        <Field label="Severity">
          <select
            className={inputClass}
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
          >
            {SEVERITIES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Weight (0–1)">
          <input
            className={inputClass}
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
          />
          Active
        </label>
        <Field label="Parameters (JSON)">
          <textarea
            className={`${inputClass} min-h-40 font-mono text-xs`}
            value={parameters}
            onChange={(event) => setParameters(event.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" onClick={() => void save()} disabled={saving}>
            Save rule
          </Button>
        </div>
      </div>
    </Modal>
  );
}
