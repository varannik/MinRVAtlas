"use client";

import { useCallback, useEffect, useState } from "react";

import { sentinelJson } from "@/lib/sentinel/browser";
import { useQuality } from "@/store/quality-store";
import { Banner, Button, DataTable, PageHeader, Pill } from "./ui";

type CorrectionRule = {
  id: string;
  name: string;
  target_dqa_rule_id?: string;
  correction_type?: string;
  is_active?: boolean;
};

export function CorrectionRulesPage() {
  const projectId = useQuality((state) => state.projectId);
  const [rules, setRules] = useState<CorrectionRule[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    const data = await sentinelJson<CorrectionRule[]>(
      `v1/corrections/rules?project_id=${encodeURIComponent(projectId)}`,
    );
    setRules(Array.isArray(data) ? data : []);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load");
    });
  }, [load, projectId]);

  async function toggle(rule: CorrectionRule) {
    try {
      const qs = new URLSearchParams({
        is_active: String(!(rule.is_active ?? true)),
      });
      await sentinelJson(`v1/corrections/rules/${rule.id}?${qs.toString()}`, {
        method: "PATCH",
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toggle failed");
    }
  }

  return (
    <div>
      <PageHeader
        title="Correction Rules"
        description="Apply / approve policy for rule-based fixes."
        actions={
          <Button onClick={() => void load()} disabled={!projectId}>
            Refresh
          </Button>
        }
      />
      {!projectId ? (
        <Banner kind="info">Select a Sentinel project in the header.</Banner>
      ) : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      <DataTable
        columns={["Name", "Target rule", "Type", "Active", ""]}
        empty="No correction rules for this project."
        rows={rules.map((rule) => [
          <span key="n">{rule.name}</span>,
          <span key="t" className="font-mono text-xs">
            {rule.target_dqa_rule_id}
          </span>,
          <span key="ty" className="text-mist">
            {rule.correction_type}
          </span>,
          <Pill key="a" tone={rule.is_active ? "ok" : "mist"}>
            {rule.is_active ? "on" : "off"}
          </Pill>,
          <Button key="e" onClick={() => void toggle(rule)}>
            Toggle
          </Button>,
        ])}
      />
    </div>
  );
}
