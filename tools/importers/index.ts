import type { SourceBundle } from "../../src/domain/source-bundle";
import { importBlades } from "./blades";
import { importCairn2e } from "./cairn2e";
import { importStarforged } from "./starforged";

/** Each importer reads its fetched upstream (sources.ts) and returns a bundle. */
export const importers: Record<string, () => Promise<SourceBundle>> = {
  // srd52: () => importSrd52(),
  starforged: () => importStarforged(),
  cairn2e: () => importCairn2e(),
  blades: () => importBlades(),
};
