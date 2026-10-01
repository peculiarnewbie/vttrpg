import * as Schema from "effect/Schema";
import { SaveEntryInput } from "./compendium";
import { SourceInput, SystemInput } from "./corpus-rpc";

/*
 * What an importer produces and the publish tool consumes: one library
 * (source) of one system, with every entry's final id, and where the text came
 * from. Importers are pure functions from upstream files to a bundle; the
 * publish tool turns a bundle into an immutable snapshot (see snapshot.ts).
 */

/** An entry with its id fixed by the importer: `<source>/<type>/<slug>`, stable across versions. */
export const BundleEntry = Schema.Struct({ ...SaveEntryInput.fields, id: Schema.String });
export type BundleEntry = typeof BundleEntry.Type;

export const SourceBundle = Schema.Struct({
  format: Schema.Literal("ttrpg-source-bundle"),
  formatVersion: Schema.Literal(1),
  system: SystemInput,
  source: SourceInput,
  /** Where the text came from, recorded in the published version for the legal page. */
  provenance: Schema.Struct({
    /** Upstream repository or document, e.g. https://github.com/foundryvtt/dnd5e. */
    upstream: Schema.String,
    /** The commit, release or retrieval date the import read. */
    revision: Schema.String,
    /** The importer that produced the bundle, e.g. tools/importers/srd52. */
    importer: Schema.String,
    notes: Schema.optional(Schema.String),
  }),
  entries: Schema.Array(BundleEntry),
});
export type SourceBundle = typeof SourceBundle.Type;
