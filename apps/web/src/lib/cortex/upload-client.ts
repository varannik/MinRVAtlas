/**
 * Sending a document to Cortex from the browser: fingerprint it, ask the web for
 * a signed form (/api/cortex/uploads), post the file straight to the intake
 * bucket. Used by the Cortex page's pins and by journey filings.
 */

import { uploadType } from "./uploads";

export interface UploadForm {
  url: string;
  fields: Record<string, string>;
  key: string;
}

/** S3 answers a refused POST with XML; show its message. */
export function storageError(xml: string, status: number): string {
  const message = /<Message>([^<]*)<\/Message>/.exec(xml)?.[1];
  return message ? `Storage refused the file: ${message}` : `Storage refused the file (${status}).`;
}

export function postToStorage(form: UploadForm, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    for (const [name, value] of Object.entries(form.fields)) body.append(name, value);
    body.append("file", file); // S3 ignores fields after the file
    const request = new XMLHttpRequest();
    request.open("POST", form.url);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error(storageError(request.responseText, request.status)));
    request.onerror = () => reject(new Error("The file did not reach storage. Check the connection and try again."));
    request.send(body);
  });
}

/** The file's SHA-256 in base64: Cortex refuses a file it already has, and S3 refuses one that does not match. */
export async function sha256Of(file: File): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** One file given on a journey task, as the journey records it. */
export interface Filed {
  name: string;
  size: number;
  key?: string;
  sha256: string;
  /** Cortex already had this content: it is filed as that document. */
  alreadyAs?: string;
}

/**
 * File one journey document in Cortex, on the task's pin. A document Cortex already
 * has is filed as that document; a different document of the same name is never
 * replaced (the person renames theirs). A file Cortex does not read (a spreadsheet)
 * is kept by name and fingerprint.
 */
export async function fileInCortex(
  file: File,
  target: { projectId: string; pin: string },
  onProgress: (fraction: number) => void,
): Promise<Filed> {
  const sha256 = await sha256Of(file);
  if (!uploadType(file.name)) return { name: file.name, size: file.size, sha256 };
  const response = await fetch("/api/cortex/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...target, fileName: file.name, size: file.size, sha256, replace: false }),
  });
  const body = (await response.json().catch(() => ({}))) as Partial<UploadForm> & {
    error?: string;
    reason?: string;
    key?: string;
    name?: string;
  };
  if (response.status === 409 && body.reason === "duplicate" && body.key) {
    return { name: file.name, size: file.size, key: body.key, sha256, alreadyAs: body.name };
  }
  if (!response.ok || !body.url || !body.fields || !body.key) {
    throw new Error(body.error ?? `Cortex refused ${file.name} (${response.status}).`);
  }
  await postToStorage(body as UploadForm, file, onProgress);
  return { name: file.name, size: file.size, key: body.key, sha256 };
}
