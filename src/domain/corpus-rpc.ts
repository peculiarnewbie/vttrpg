import * as Schema from "effect/Schema";
import { CompendiumEntry, EntryType, SaveEntryInput } from "./compendium";
import { Licence } from "./licence";
import { SheetLayout } from "./sheet-layout";
import { SnapshotManifest } from "./snapshot";

export const CORPUS_API_VERSION = 1 as const;
export const CorpusCall = Schema.Struct({
  apiVersion: Schema.Literal(CORPUS_API_VERSION),
  /** Trusted table-authenticated account; never taken from browser input. */
  accountId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
});
export type CorpusCall = typeof CorpusCall.Type;

export const SystemInput = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  entryTypes: Schema.Array(EntryType),
  layouts: Schema.optional(Schema.Array(SheetLayout)),
});
export type SystemInput = typeof SystemInput.Type;
export const CorpusSystem = Schema.Struct({ ...SystemInput.fields, ownerAccountId: Schema.String });
export type CorpusSystem = typeof CorpusSystem.Type;

export const SourceInput = Schema.Struct({
  id: Schema.String,
  systemId: Schema.String,
  name: Schema.String,
  licence: Licence,
  visibility: Schema.Literals(["public", "private"]),
});
export type SourceInput = typeof SourceInput.Type;
export const CorpusSource = Schema.Struct({
  ...SourceInput.fields,
  ownerAccountId: Schema.String,
  latestVersion: Schema.optional(Schema.Int),
});
export type CorpusSource = typeof CorpusSource.Type;

export const SourceCall = Schema.Struct({ ...CorpusCall.fields, sourceId: Schema.String });
export type SourceCall = typeof SourceCall.Type;
export const SaveSystemCall = Schema.Struct({ ...CorpusCall.fields, system: SystemInput });
export const CreateSourceCall = Schema.Struct({ ...CorpusCall.fields, source: SourceInput });
export const SaveEntriesCall = Schema.Struct({
  ...SourceCall.fields,
  entries: Schema.Array(SaveEntryInput),
});
export const DeleteEntriesCall = Schema.Struct({ ...SourceCall.fields, ids: Schema.Array(Schema.String) });
export const ManifestCall = Schema.Struct({ ...SourceCall.fields, version: Schema.Int });

/** Add methods compatibly; each RPC call validates its version and its whole input. */
export interface CorpusApi {
  listSystems(call: CorpusCall): Promise<readonly CorpusSystem[]>;
  saveSystem(call: typeof SaveSystemCall.Type): Promise<CorpusSystem>;
  listSources(call: CorpusCall): Promise<readonly CorpusSource[]>;
  createSource(call: typeof CreateSourceCall.Type): Promise<CorpusSource>;
  getSource(call: SourceCall): Promise<CorpusSource | null>;
  saveEntries(call: typeof SaveEntriesCall.Type): Promise<readonly CompendiumEntry[]>;
  deleteEntries(call: typeof DeleteEntriesCall.Type): Promise<void>;
  publish(call: SourceCall): Promise<SnapshotManifest>;
  getLatest(call: SourceCall): Promise<SnapshotManifest | null>;
  getManifest(call: typeof ManifestCall.Type): Promise<SnapshotManifest | null>;
}

export const SourceMode = Schema.Literals(["pinned", "follow"]);
export const EnableSourceInput = Schema.Struct({
  version: Schema.optional(Schema.Int),
  mode: Schema.optional(SourceMode),
});
export type EnableSourceInput = typeof EnableSourceInput.Type;
export const SourceUpdateSummary = Schema.Struct({
  fromVersion: Schema.Int,
  toVersion: Schema.Int,
  added: Schema.Array(Schema.String),
  changed: Schema.Array(Schema.String),
  removed: Schema.Array(Schema.String),
});
export type SourceUpdateSummary = typeof SourceUpdateSummary.Type;
export const WorldSource = Schema.Struct({
  sourceId: Schema.String,
  name: Schema.String,
  version: Schema.Int,
  mode: SourceMode,
  licence: Licence,
  latestVersion: Schema.optional(Schema.Int),
  update: Schema.optional(SourceUpdateSummary),
});
export type WorldSource = typeof WorldSource.Type;
export const WorldLibraries = Schema.Struct({
  available: Schema.Array(CorpusSource),
  enabled: Schema.Array(WorldSource),
});
export type WorldLibraries = typeof WorldLibraries.Type;
