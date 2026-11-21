import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");
/** A .yaml module is its parsed document, as loaders/yaml-loader.cjs makes it for the app. */
export async function load(url, context, nextLoad) {
  if (url.endsWith(".yaml") || url.endsWith(".yml")) {
    const path = fileURLToPath(url);
    const data = yaml.load(readFileSync(path, "utf8"), { filename: path });
    return { format: "module", source: `export default ${JSON.stringify(data)};`, shortCircuit: true };
  }
  return nextLoad(url, context);
}
