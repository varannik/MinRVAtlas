"use client";

import { useEffect, useMemo, useState } from "react";
import {
  parseCsvHeaders,
  previewSchema,
  schemaForSlot,
  templateCsv,
  type SchemaPreview,
} from "@/lib/slot-schema";
import { getDraftFiles, useRequirementDrafts } from "@/store/requirement-draft-store";
import type { RequirementItem } from "@/lib/types";

export function SchemaPreviewPanel({
  item,
  draftKey,
  bindings,
  onBind,
  onClearBind,
}: {
  item: RequirementItem;
  draftKey: string;
  bindings: Record<string, string>;
  onBind: (header: string, canonical: string) => void;
  onClearBind: (header: string) => void;
}) {
  const schema = useMemo(
    () => schemaForSlot(item.slotId, item.kind, item.label),
    [item.kind, item.label, item.slotId],
  );
  const [headers, setHeaders] = useState<string[]>([]);
  const fileMeta = useRequirementDrafts((state) => state.bySlot[draftKey]?.files);

  useEffect(() => {
    const csv = getDraftFiles(draftKey).find((file) =>
      file.name.toLowerCase().endsWith(".csv"),
    );
    if (!csv) {
      setHeaders([]);
      return;
    }
    void csv.text().then((text) => setHeaders(parseCsvHeaders(text)));
  }, [bindings, draftKey, fileMeta]);

  const preview: SchemaPreview | null = headers.length
    ? previewSchema(headers, schema, bindings)
    : null;

  function downloadTemplate() {
    const blob = new Blob([templateCsv(schema)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${schema.key}-template.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="mt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] tracking-[0.14em] text-mist uppercase">
          Required for this slot
        </h3>
        {schema.columns.length > 0 ? (
          <button
            type="button"
            onClick={downloadTemplate}
            className="text-[10px] font-medium text-carbon-400 hover:underline"
          >
            Template CSV
          </button>
        ) : null}
      </div>
      {schema.documentHints.length > 0 ? (
        <p className="mt-1 text-[10px] leading-relaxed text-mist">
          {schema.documentHints.join(" · ")}
        </p>
      ) : null}
      {schema.columns.length > 0 ? (
        <ul className="mt-1.5 space-y-1">
          {schema.columns.map((column) => (
            <li
              key={column.name}
              className="flex items-start justify-between gap-2 rounded-lg bg-ink-800/45 px-2.5 py-1.5 text-[10px]"
            >
              <span>
                <span className="font-mono text-frost">{column.name}</span>
                <span className="mt-0.5 block text-mist">{column.role}</span>
              </span>
              <span className={column.required ? "text-signal-amber" : "text-mist"}>
                {column.required ? "Required" : "Optional"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {schema.derived.length > 0 ? (
        <p className="mt-1 text-[10px] text-mist">
          Derived if missing: {schema.derived.join(", ")}
        </p>
      ) : null}

      {preview ? (
        <div className="mt-3">
          <h4 className="text-[10px] tracking-[0.14em] text-mist uppercase">
            File headers
          </h4>
          {preview.blocked ? (
            <p className="mt-1 text-[11px] text-signal-rose">
              Missing required columns: {preview.missingRequired.join(", ")}
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-carbon-400">
              Required columns are present.
            </p>
          )}
          <ul className="mt-1.5 space-y-1">
            {preview.rows.map((row) => (
              <li
                key={`${row.canonical}-${row.header ?? "missing"}`}
                className="flex flex-wrap items-center gap-2 rounded-lg bg-ink-800/30 px-2.5 py-1.5 text-[10px]"
              >
                <span className="font-mono text-frost">{row.canonical}</span>
                {row.header && row.header !== row.canonical ? (
                  <span className="text-mist">← {row.header}</span>
                ) : null}
                <span
                  className={`ml-auto ${
                    row.status === "missing"
                      ? "text-signal-rose"
                      : row.status === "unknown"
                        ? "text-signal-amber"
                        : "text-carbon-400"
                  }`}
                >
                  {row.status}
                </span>
                {row.status === "unknown" && schema.columns.length > 0 ? (
                  <select
                    value={bindings[row.header ?? ""] ?? ""}
                    onChange={(event) => {
                      const header = row.header;
                      if (!header) return;
                      if (event.target.value) onBind(header, event.target.value);
                      else onClearBind(header);
                    }}
                    className="basis-full rounded-md bg-ink-800 px-2 py-1 text-[10px] text-frost ring-1 ring-line/70"
                  >
                    <option value="">Bind to required column…</option>
                    {schema.columns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : schema.kind !== "document" ? (
        <p className="mt-2 text-[10px] text-mist">
          Drop a CSV to check exact column names before quality.
        </p>
      ) : null}
    </section>
  );
}
