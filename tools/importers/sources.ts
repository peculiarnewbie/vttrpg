import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/*
 * Upstream text lives outside the repo, pinned by commit: fetch it once with
 * `pnpm sources:fetch` (see package.json). Importers read from here; their
 * tests use small fixtures and only touch the full sources when present.
 */

export const SOURCES_DIR = process.env.TTRPG_SOURCES ?? join(homedir(), ".cache", "ttrpg-sources");

export type UpstreamName = "dnd5e" | "datasworn" | "cairn" | "blades";

export const upstream = (name: UpstreamName) => {
  const dir = join(SOURCES_DIR, name);
  const revisionFile = join(SOURCES_DIR, `${name}.rev`);
  return {
    dir,
    available: existsSync(dir) && existsSync(revisionFile),
    revision: () => readFileSync(revisionFile, "utf8").trim(),
  };
};
