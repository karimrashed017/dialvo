// Run after `npm run build`. Fails if the design preview's made-up data
// (src/lib/app/fixtures.ts) is anywhere in the production build. It never
// should be: the only import of it sits behind a NODE_ENV test the compiler
// removes. This is the proof.
//
//   npm run build && node scripts/check-no-preview-data.mjs

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Strings that exist only in the preview data.
const MARKERS = [
  "DESIGN-PREVIEW-FIXTURES",
  "Jordan Avery",
  "Ridgeline Roofing",
];
const hits = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    // .next/dev and .next/cache belong to the dev server, not the build.
    if (path === join(".next", "dev") || path === join(".next", "cache"))
      continue;
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(js|mjs|cjs|html|rsc|json|map)$/.test(name)) {
      const text = readFileSync(path, "utf8");
      for (const marker of MARKERS)
        if (text.includes(marker)) hits.push(`${path}: "${marker}"`);
    }
  }
}

walk(".next");
if (hits.length > 0) {
  console.error(
    "Preview data found in the production build:\n" + hits.join("\n"),
  );
  process.exit(1);
}
console.log("OK: no preview data in the production build.");
