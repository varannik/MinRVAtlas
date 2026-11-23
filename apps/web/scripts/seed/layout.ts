import path from "node:path";

export { mrvKey, siteModelPrefix } from "@/lib/atlas/keys";

/** Seed files, laid out as they are stored: S3 keys under site-models/ and mrv/, table items under catalog/ and journey/. */
export const SEED_DIR = path.join(process.cwd(), "seed");
