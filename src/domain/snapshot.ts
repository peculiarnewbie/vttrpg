import * as Schema from "effect/Schema";
import { CompendiumEntry, EntryType, EntryVisibility } from "./compendium";
import { Licence } from "./licence";

export const SnapshotFile = Schema.Struct({
  key: Schema.String,
  bytes: Schema.Int,
  sha256: Schema.String,
});
export type SnapshotFile = typeof SnapshotFile.Type;

export const BodyChunk = Schema.Struct({
  typeId: Schema.String,
  visibility: EntryVisibility,
  ids: Schema.Array(Schema.String),
  file: SnapshotFile,
});
export type BodyChunk = typeof BodyChunk.Type;

/** Public and DM rows/bodies are physically separate immutable objects. */
export const SnapshotManifest = Schema.Struct({
  format: Schema.Literal("ttrpg-corpus"),
  formatVersion: Schema.Literal(1),
  sourceId: Schema.String,
  sourceName: Schema.String,
  systemId: Schema.String,
  version: Schema.Int,
  publishedAt: Schema.String,
  licence: Licence,
  types: Schema.Array(EntryType),
  publicIndex: SnapshotFile,
  dmIndex: SnapshotFile,
  bodyChunks: Schema.Array(BodyChunk),
  entryCount: Schema.Int,
});
export type SnapshotManifest = typeof SnapshotManifest.Type;

/** String dictionaries reduce repetition; facets remain typed JSON values. */
export const PackedIndexRow = Schema.Tuple([
  Schema.Int, // id
  Schema.Int, // name
  Schema.Int, // typeId
  Schema.Array(Schema.Int), // tags
  Schema.Int, // updatedAt
  Schema.Int, // entry revision
  Schema.NullOr(
    Schema.Record(
      Schema.String,
      Schema.Union([Schema.Number, Schema.String, Schema.Boolean, Schema.Array(Schema.String)]),
    ),
  ),
]);
export type PackedIndexRow = typeof PackedIndexRow.Type;

export const PackedIndex = Schema.Struct({
  format: Schema.Literal("ttrpg-corpus-index"),
  formatVersion: Schema.Literal(1),
  visibility: EntryVisibility,
  strings: Schema.Array(Schema.String),
  rows: Schema.Array(PackedIndexRow),
});
export type PackedIndex = typeof PackedIndex.Type;

export const SnapshotBodies = Schema.Struct({
  format: Schema.Literal("ttrpg-corpus-bodies"),
  formatVersion: Schema.Literal(1),
  entries: Schema.Array(CompendiumEntry),
});
export type SnapshotBodies = typeof SnapshotBodies.Type;

/** Callers pass safe source/type slugs; published version numbers start at one. */
export const snapshotPrefix = (sourceId: string, version: number): string => {
  if (!/^[a-z0-9][a-z0-9_-]{0,59}$/.test(sourceId) || sourceId === "world")
    throw new Error("Invalid source id");
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("Invalid source version");
  return `corpus/${sourceId}/v${version}`;
};

export const snapshotKeys = (sourceId: string, version: number) => {
  const prefix = snapshotPrefix(sourceId, version);
  return {
    manifest: `${prefix}/manifest.json`,
    publicIndex: `${prefix}/index.public.json.gz`,
    dmIndex: `${prefix}/index.dm.json.gz`,
    body: (typeId: string, visibility: "public" | "dm", chunk: number) => {
      if (!/^[a-z0-9][a-z0-9_-]{0,59}$/.test(typeId) || !Number.isSafeInteger(chunk) || chunk < 0)
        throw new Error("Invalid body chunk");
      return `${prefix}/bodies/${typeId}.${visibility}.${chunk}.json.gz`;
    },
  };
};
