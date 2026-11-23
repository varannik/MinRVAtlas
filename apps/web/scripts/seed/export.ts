// Writes the seed files under apps/web/seed from the seed sources.
//   npm run seed:export
// The sources are the demo data the app used to bundle. The files this writes
// are what `npm run seed` loads into DynamoDB and S3; commit both.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { calcSpecFor } from "@/lib/mrv/calc/specs";
import { seriesMetrics } from "@/lib/mrv/calc/tree";
import type { MrvDataset } from "@/lib/mrv/types";
import { PROJECTS } from "./sources/projects";
import { SCENARIOS } from "./sources/scenarios";
import { sampleDataset } from "./sources/sample";
import { SITE_LAYOUTS, SITE_PHOTOS } from "./sources/site-layouts";
import { TENANTS } from "./sources/tenants";
import { SEED_DIR, siteModelPrefix, mrvKey } from "./layout";

function write(relative: string, value: unknown) {
  const file = path.join(SEED_DIR, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`);
  return file;
}

function digest(file: string) {
  const bytes = readFileSync(file);
  return { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: statSync(file).size };
}

/** Telemetry is never better than 5 significant figures. */
function round(value: number): number {
  return Number.isFinite(value) && value !== 0 ? Number(value.toPrecision(5)) : value;
}

function compact(dataset: MrvDataset): MrvDataset {
  return {
    ...dataset,
    days: dataset.days.map((row) => ({
      day: row.day,
      metrics: Object.fromEntries(
        Object.entries(row.metrics).map(([metric, cell]) => [
          metric,
          { sum: round(cell.sum), mean: round(cell.mean), min: round(cell.min), max: round(cell.max), last: round(cell.last), count: cell.count },
        ]),
      ),
    })),
  };
}

// Fresh output each run, so a removed project leaves no stale file behind.
for (const dir of ["catalog", "journey", "site-models", "mrv"]) rmSync(path.join(SEED_DIR, dir), { recursive: true, force: true });

write("catalog/tenants.json", TENANTS);
write("catalog/projects.json", PROJECTS.map((project) => ({ ...project, origin: "catalog" })));
write("journey/scenarios.json", SCENARIOS);

// Site models: one versioned folder per project, a manifest listing its documents and assets.
const createdAt = new Date().toISOString();
for (const layout of SITE_LAYOUTS) {
  const project = PROJECTS.find((entry) => entry.id === layout.projectId);
  if (!project) throw new Error(`No catalog project for site model ${layout.projectId}`);
  const version = 1;
  const prefix = siteModelPrefix(project.tenantId, project.id, version);
  const photo = SITE_PHOTOS[layout.projectId];
  const assets = [];
  if (photo) {
    const key = `assets/${path.basename(photo.file)}`;
    const target = path.join(SEED_DIR, prefix, key);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(photo.file, target);
    assets.push({ key, role: "source-photo", contentType: "image/jpeg", width: layout.photo.width, height: layout.photo.height, ...digest(target) });
  }
  // The layout points at its photo by asset key, not by a public URL.
  const document = { ...layout, photo: { ...layout.photo, src: assets[0]?.key ?? "" } };
  const layoutFile = write(path.join(prefix, "layout.json"), document);
  write(path.join(prefix, "manifest.json"), {
    format: "minrv-site-model@1",
    tenantId: project.tenantId,
    projectId: project.id,
    version,
    createdAt,
    layout: { key: "layout.json", contentType: "application/json", ...digest(layoutFile) },
    assets,
  });
}

// MRV: each catalog project's monitoring history, as the stage reads it.
const now = Date.now();
for (const project of PROJECTS) {
  const spec = calcSpecFor(project);
  const dataset = compact(sampleDataset({ ...project, origin: "catalog" }, spec, seriesMetrics(spec.root), now));
  write(mrvKey(project.tenantId, project.registry, project.id), { ...dataset, origin: "sample", note: "Demo history seeded for this project; real stream rows replace it." });
}

console.log(`Seed written to ${path.relative(process.cwd(), SEED_DIR)}: ${TENANTS.length} tenants, ${PROJECTS.length} projects, ${SITE_LAYOUTS.length} site model(s), ${SCENARIOS.length} journey scenarios.`);
