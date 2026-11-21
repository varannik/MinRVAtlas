/**
 * Unit tests under Node (node --test): jiti compiles TypeScript and resolves the
 * "@/" alias from tsconfig; this adds .yaml modules, as Next loads them for the app.
 *
 *   JITI_TSCONFIG_PATHS=true node --import jiti/register --import ./loaders/node-test.mjs --test src/lib/journey/engine.test.ts
 *
 * Tests of *.server.ts modules also alias "server-only" to its empty module (jiti
 * ignores the react-server condition): JITI_ALIAS='{"server-only": "<abs>/node_modules/server-only/empty.js"}'.
 */
import { register } from "node:module";

register("./node-test-hooks.mjs", import.meta.url);
