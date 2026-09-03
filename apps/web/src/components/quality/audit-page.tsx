"use client";

import { useCallback, useEffect, useState } from "react";

import { sentinelJson, unwrapItems } from "@/lib/sentinel/browser";
import { Banner, Button, DataTable, PageHeader } from "./ui";

type AuditEvent = {
  id: string;
  event_type?: string;
  entity_type?: string;
  entity_id?: string | null;
  actor_role?: string | null;
  created_at?: string;
};

export function AuditPage() {
  const [rows, setRows] = useState<AuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await sentinelJson<unknown>("v1/audit/?limit=100");
    setRows(unwrapItems<AuditEvent>(data));
  }, []);

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load audit");
    });
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Audit trail"
        description="Sentinel audit log for the M2M admin session."
        actions={<Button onClick={() => void load()}>Refresh</Button>}
      />
      {error ? <Banner kind="error">{error}</Banner> : null}
      <DataTable
        columns={["When", "Event", "Entity", "Role"]}
        empty="No audit events."
        rows={rows.map((row) => [
          <span key="t" className="text-mist">
            {row.created_at ?? "—"}
          </span>,
          <span key="e" className="font-mono text-xs">
            {row.event_type}
          </span>,
          <span key="n">
            {row.entity_type}
            {row.entity_id ? ` · ${row.entity_id.slice(0, 8)}` : ""}
          </span>,
          <span key="r">{row.actor_role ?? "—"}</span>,
        ])}
      />
    </div>
  );
}
