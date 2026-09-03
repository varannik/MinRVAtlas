import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  parseLocationOverlay,
  type LocationOverlay,
  type SiteLocation,
} from "./project-locations";

const LOCAL_FILE = path.join(process.cwd(), ".data", "project-locations.json");

function parameterName(): string {
  if (process.env.PROJECT_LOCATIONS_PARAM) {
    return process.env.PROJECT_LOCATIONS_PARAM;
  }
  const stage = process.env.MINRV_STAGE ?? "local";
  return `/minrv/ew2/${stage}/project-locations`;
}

/**
 * SSM only on ECS (or when explicitly opted in). Local `next dev` always uses
 * a file so a laptop with AWS credentials cannot overwrite the sandbox pin map.
 */
function shouldUseSsm(): boolean {
  return Boolean(
    process.env.AWS_EXECUTION_ENV ||
      process.env.ECS_CONTAINER_METADATA_URI_V4 ||
      process.env.MINRV_USE_SSM === "1",
  );
}

export async function readLocationOverlay(): Promise<LocationOverlay> {
  return shouldUseSsm() ? readFromSsm() : readFromFile();
}

export async function writeLocationOverlay(
  overlay: LocationOverlay,
): Promise<void> {
  if (shouldUseSsm()) {
    await writeToSsm(overlay);
    return;
  }
  await writeToFile(overlay);
}

export async function upsertProjectLocation(
  projectId: string,
  location: SiteLocation,
): Promise<LocationOverlay> {
  const overlay = await readLocationOverlay();
  const next = { ...overlay, [projectId]: location };
  await writeLocationOverlay(next);
  return next;
}

async function readFromFile(): Promise<LocationOverlay> {
  try {
    const raw = await fs.readFile(LOCAL_FILE, "utf8");
    return parseLocationOverlay(JSON.parse(raw) as unknown);
  } catch (error) {
    if (isMissingFile(error)) return {};
    throw error;
  }
}

async function writeToFile(overlay: LocationOverlay): Promise<void> {
  await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
  await fs.writeFile(LOCAL_FILE, `${JSON.stringify(overlay, null, 2)}\n`, "utf8");
}

async function readFromSsm(): Promise<LocationOverlay> {
  const { GetParameterCommand, SSMClient } = await import("@aws-sdk/client-ssm");
  const client = new SSMClient({
    region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION,
  });
  try {
    const result = await client.send(
      new GetParameterCommand({ Name: parameterName() }),
    );
    const raw = result.Parameter?.Value;
    if (!raw) return {};
    return parseLocationOverlay(JSON.parse(raw) as unknown);
  } catch (error) {
    if (isMissingParameter(error)) return {};
    throw error;
  }
}

async function writeToSsm(overlay: LocationOverlay): Promise<void> {
  const { PutParameterCommand, SSMClient } = await import("@aws-sdk/client-ssm");
  const client = new SSMClient({
    region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION,
  });
  await client.send(
    new PutParameterCommand({
      Name: parameterName(),
      Value: JSON.stringify(overlay),
      Type: "String",
      Overwrite: true,
      Tier: "Standard",
    }),
  );
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "ENOENT"
  );
}

function isMissingParameter(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name: string }).name === "ParameterNotFound"
  );
}
