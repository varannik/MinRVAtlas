/** Certify source PUT must send the same Content-Type as POST /sources. */

const BY_EXT: Record<string, string> = {
  csv: "text/csv",
  txt: "text/plain",
  pdf: "application/pdf",
  json: "application/json",
  geojson: "application/geo+json",
  parquet: "application/vnd.apache.parquet",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
};

export const SOURCE_MAX_BYTES = 50_000_000;
export const PARQUET_MAX_BYTES = 100_000_000;

export function extOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

export function sourceContentType(filename: string, reportedType?: string): string {
  const ext = extOf(filename);
  if (ext && BY_EXT[ext]) return BY_EXT[ext];
  if (reportedType && reportedType !== "application/octet-stream") return reportedType;
  return "application/octet-stream";
}

export function isParquet(filename: string, contentType?: string): boolean {
  return extOf(filename) === "parquet" || contentType === "application/vnd.apache.parquet";
}
