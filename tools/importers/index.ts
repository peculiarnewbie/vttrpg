import type { SourceBundle } from "../../src/domain/source-bundle";

/** Each importer reads its fetched upstream (sources.ts) and returns a bundle. */
export const importers: Record<string, () => Promise<SourceBundle>> = {
  // srd52: () => importSrd52(),
  // starforged: () => importStarforged(),
  // cairn2e: () => importCairn(),
  // blades: () => importBlades(),
};
