/** YAML files import as their parsed document (loaders/yaml-loader.cjs, wired in next.config.ts). */
declare module "*.yaml" {
  const data: unknown;
  export default data;
}
