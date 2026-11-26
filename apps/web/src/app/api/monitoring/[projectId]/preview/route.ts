import type { NextRequest } from "next/server";

import { isBrowserSameOrigin } from "@/lib/auth/session";
import { applyMapping, cleanEntries, tableRange } from "@/lib/monitoring/mapping";
import { suggestMetric, suggestScale } from "@/lib/monitoring/metrics";
import { formFile, monitoringContext } from "@/lib/monitoring/route.server";
import { loadTagMap } from "@/lib/monitoring/store.server";
import { UploadError, readUpload } from "@/lib/monitoring/stream-write.server";
import { periodOf } from "@/lib/quality/gate";
import { NO_STORE, failed, refuse } from "@/lib/quality/route.server";

/**
 * POST multipart { file, entries?, start?, end? }: what the file holds, read and
 * nothing written. Each sheet with a column of dates becomes a table; each column
 * of numbers comes with the project's tag map entry for it, or a suggestion from
 * the plant tag it names. With a mapping and days, also what a load would write:
 * each metric's days, first and last day and total, and what would be left out.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  if (!isBrowserSameOrigin(request)) return refuse("Cross-site request refused.", 403);
  const { projectId } = await params;
  try {
    const context = await monitoringContext(projectId);
    if ("failure" in context) return context.failure;
    const form = await request.formData();
    const file = await formFile(form);
    const read = readUpload(file.name, file.bytes);
    const period = periodOf(String(form.get("start") ?? ""), String(form.get("end") ?? ""));
    let check = null;
    if (period && form.get("entries")) {
      try {
        const applied = applyMapping(read.tables, cleanEntries(JSON.parse(String(form.get("entries")))), period);
        check = { days: Object.keys(applied.days).length, summary: applied.summary, notes: applied.notes };
      } catch {
        return refuse("The column mapping could not be read.", 400);
      }
    }
    const tagMap = await loadTagMap(context.dynamo, context.env.table, context.session.tenantId, context.project.id);

    const tables = read.tables.map((table) => {
      const days = table.rows.map((row) => row.day).sort();
      return {
        sheet: table.sheet,
        dateHeader: table.dateHeader,
        rows: table.rows.length,
        first: days[0] ?? null,
        last: days[days.length - 1] ?? null,
        undated: table.undated,
        labels: table.labels.slice(0, 6),
        columns: table.columns.map((column) => {
          const suggested = suggestMetric(column.header);
          return {
            key: column.key,
            header: column.header,
            tags: column.tags,
            numbers: column.numbers,
            // undefined: the map has never seen this column; null: it is mapped to "not loaded".
            mapped: tagMap && column.key in tagMap.entries ? tagMap.entries[column.key] : undefined,
            suggested: suggested ? { metric: suggested.id, reads: suggested.reads, scale: suggestScale(column.header, suggested) } : null,
          };
        }),
      };
    });
    return Response.json({ fileName: file.name, bytes: file.bytes.length, tables, skipped: read.skipped, range: tableRange(read.tables), check }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof UploadError) return refuse(error.message, 400);
    return failed(error, "monitoring preview");
  }
}
