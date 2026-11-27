import "server-only";

import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";

import { parseCsvTable } from "@/lib/stream-coverage";
import type { Applied } from "./mapping";
import { readSheets, type ReadResult, type Sheet } from "./table";
import { readXlsx, WorkbookError } from "./xlsx.server";

/**
 * A site's spreadsheet into the project's stream: one observations.csv per day
 * (`<tenant>/<registry>/<project>/dt=YYYY-MM-DD/observations.csv`), the file the
 * calculation tree and the data quality engine both read. Loading replaces the
 * loaded metrics' rows for those days and keeps every other metric's; the bucket
 * keeps each earlier version. The original file is kept under uploads/.
 */

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const HEADER = ["timestamp_utc", "metric", "value", "unit", "quality", "source"];
const CONCURRENCY = 8;

export class UploadError extends Error {}

/** The sheets of an .xlsx workbook, or a .csv file as one sheet. */
export function readUpload(fileName: string, bytes: Buffer): ReadResult {
  if (bytes.length > MAX_UPLOAD_BYTES) throw new UploadError("The file is larger than 20 MB.");
  const isZip = bytes.length > 4 && bytes.readUInt32LE(0) === 0x04034b50;
  let sheets: Sheet[];
  if (isZip) {
    try {
      sheets = readXlsx(bytes);
    } catch (error) {
      throw new UploadError(error instanceof WorkbookError ? error.message : "The workbook could not be read.");
    }
  } else if (/\.(csv|txt)$/i.test(fileName)) {
    const { headers, rows } = parseCsvTable(bytes.toString("utf8"));
    sheets = [{ name: fileName, rows: [headers, ...rows] }];
  } else {
    throw new UploadError("Give an .xlsx workbook or a .csv file.");
  }
  return readSheets(sheets);
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** A day's file with the loaded metrics' rows replaced and every other row kept. */
export function mergeDay(existing: string, day: string, rows: Applied["days"][string], uploadId: string): string {
  const replaced = new Set(rows.map((row) => row.metric));
  const kept: string[][] = [];
  if (existing.trim()) {
    const { headers, rows: old } = parseCsvTable(existing);
    const at = (name: string) => headers.findIndex((header) => header.trim().toLowerCase() === name);
    const columns = HEADER.map(at);
    for (const row of old) {
      const metric = (row[columns[1]] ?? "").trim();
      if (!metric || replaced.has(metric)) continue;
      kept.push(columns.map((index) => (index >= 0 ? (row[index] ?? "").trim() : "")));
    }
  }
  const added = rows.map((row) => [`${day}T00:00:00Z`, row.metric, String(row.value), row.unit, "ok", uploadId]);
  return [HEADER, ...kept, ...added].map((line) => line.map(csvCell).join(",")).join("\n") + "\n";
}

async function readText(s3: S3Client, bucket: string, key: string): Promise<string> {
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return (await result.Body?.transformToString()) ?? "";
  } catch (error) {
    if ((error as { name?: string }).name === "NoSuchKey") return "";
    throw error;
  }
}

/** Write each day of the applied mapping. Returns how many days already had a file. */
export async function writeDays(s3: S3Client, bucket: string, prefix: string, uploadId: string, applied: Applied): Promise<{ days: number; updated: number }> {
  const days = Object.keys(applied.days).sort();
  let updated = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < days.length) {
      const day = days[cursor];
      cursor += 1;
      const key = `${prefix}dt=${day}/observations.csv`;
      const existing = await readText(s3, bucket, key);
      if (existing.trim()) updated += 1;
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: mergeDay(existing, day, applied.days[day], uploadId),
          ContentType: "text/csv; charset=utf-8",
        }),
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, days.length) }, worker));
  return { days: days.length, updated };
}

/**
 * A day's file without one load's rows (rows carry their load's id in `source`).
 * `left` counts the rows that stay; with none, the day's file is deleted.
 */
export function withoutUpload(existing: string, uploadId: string): { text: string; removed: number; left: number } {
  const { headers, rows } = parseCsvTable(existing);
  const at = (name: string) => headers.findIndex((header) => header.trim().toLowerCase() === name);
  const columns = HEADER.map(at);
  const source = columns[5];
  let removed = 0;
  const kept: string[][] = [];
  for (const row of rows) {
    if (!(row[columns[1]] ?? "").trim()) continue;
    if (source >= 0 && (row[source] ?? "").trim() === uploadId) {
      removed += 1;
      continue;
    }
    kept.push(columns.map((index) => (index >= 0 ? (row[index] ?? "").trim() : "")));
  }
  return { text: [HEADER, ...kept].map((line) => line.map(csvCell).join(",")).join("\n") + "\n", removed, left: kept.length };
}

/**
 * Take one load's rows out of the stream over its days. A day left with no rows
 * loses its file, so the project reads as having no data there (and, with no days
 * left at all, falls back to its sample history). What the load replaced is not
 * brought back: load that file again.
 */
export async function removeUploadRows(
  s3: S3Client,
  bucket: string,
  prefix: string,
  uploadId: string,
  period: { start: string; end: string },
): Promise<{ days: number; deleted: number }> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${prefix}dt=`, ContinuationToken: token }));
    for (const item of page.Contents ?? []) {
      const day = /dt=(\d{4}-\d{2}-\d{2})\/observations\.csv$/.exec(item.Key ?? "")?.[1];
      if (day && day >= period.start && day <= period.end) keys.push(item.Key!);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  let days = 0;
  let deleted = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < keys.length) {
      const key = keys[cursor];
      cursor += 1;
      const result = withoutUpload(await readText(s3, bucket, key), uploadId);
      if (!result.removed) continue;
      days += 1;
      if (result.left) {
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: result.text, ContentType: "text/csv; charset=utf-8" }));
      } else {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        deleted += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, keys.length) }, worker));
  return { days, deleted };
}

/** The original file, kept beside the stream for the audit trail. */
export async function keepOriginal(s3: S3Client, bucket: string, prefix: string, uploadId: string, fileName: string, bytes: Buffer): Promise<string> {
  const safe = fileName.replace(/[^\w.() -]+/g, "_").slice(-120) || "upload";
  const key = `${prefix}uploads/${uploadId}/${safe}`;
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: "application/octet-stream" }));
  return key;
}
