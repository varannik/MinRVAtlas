/**
 * Turbopack loader: a .yaml file becomes a module whose default export is the
 * parsed document, so YAML is read at build time and no parser ships to the
 * browser. Configured in next.config.ts (turbopack.rules).
 */
const yaml = require("js-yaml");

module.exports = function yamlLoader(source) {
  const data = yaml.load(source, { filename: this.resourcePath });
  return `export default ${JSON.stringify(data)};`;
};
