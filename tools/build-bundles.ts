import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateBundle } from "./importers/validate";
import { importers } from "./importers/index";

/*
 * `pnpm bundles:build [name…]`: run the importers over the fetched sources and
 * write `.cache/bundles/<source>.json`, printing counts and any problems.
 * Publishing reads these files (tools/publish-corpus.ts).
 */
const wanted = process.argv.slice(2);
const out = join(process.cwd(), ".cache", "bundles");
mkdirSync(out, { recursive: true });
let failed = false;
for (const [name, run] of Object.entries(importers)) {
  if (wanted.length && !wanted.includes(name)) continue;
  const bundle = await run();
  const report = validateBundle(bundle);
  writeFileSync(join(out, `${bundle.source.id}.json`), JSON.stringify(bundle));
  console.log(`${name}: ${bundle.entries.length} entries ${JSON.stringify(report.counts)}`);
  if (report.largest) console.log(`  largest ${report.largest.id} (${report.largest.bytes} bytes)`);
  for (const problem of report.problems.slice(0, 30)) console.log(`  ✗ ${problem}`);
  if (report.problems.length) {
    failed = true;
    console.log(`  ${report.problems.length} problems`);
  }
}
if (failed) process.exitCode = 1;
