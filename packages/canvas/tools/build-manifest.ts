import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { manifestJson } from "./tool-defs";

// Regenerates the tool manifest the hosted paired.cc/mcp endpoint serves.
const target = fileURLToPath(new URL("../../server/src/canvas/tool-manifest.json", import.meta.url));
writeFileSync(target, manifestJson());
console.log(`Wrote ${target}`);
process.exit(0);
