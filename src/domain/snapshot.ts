import * as Schema from "effect/Schema";
import {
  CompendiumEntry,
  EntryType,
  EntryVisibility,
  IndexRow,
  compendiumLimits,
} from "./compendium";
import {
  MAX_VERSION,
  NonEmptyTrimmed,
  Revision,
  SafeNonNegativeInteger,
  SafePositiveInteger,
  Sha256Hex,
  Slug,
  SourceSlug,
  Version,
  isFiniteJson,
  jsonBytes,
  maxJsonBytes,
} from "./constraints";
import { Licence } from "./licence";
import { parseEntryId } from "./entry-id";
import { typeError } from "./compendium-rules";

/** Limits bound untrusted snapshots and decompression allocations. */
export const snapshotLimits = {
  entries: 100_000,
  chunkEntries: 100,
  version: MAX_VERSION,
  indexBytes: 32 * 1024 * 1024,
  bodyBytes: 64 * 1024 * 1024,
  manifestBytes: 32 * 1024 * 1024,
} as const;

export const SnapshotFile = Schema.Struct({
  key: Schema.String,
  bytes: SafePositiveInteger(snapshotLimits.bodyBytes),
  sha256: Sha256Hex,
});
export type SnapshotFile = typeof SnapshotFile.Type;

const IndexFile = SnapshotFile.check(
  Schema.makeFilter((file) => file.bytes <= snapshotLimits.indexBytes, {
    message: "Invalid snapshot file size",
  }),
);
const SnapshotEntryId = Schema.String.check(
  Schema.makeFilter((id) => parseEntryId(id) !== undefined, {
    message: "Invalid snapshot entry identity",
  }),
);
const ChunkOrdinal = SafeNonNegativeInteger.check(Schema.isLessThan(snapshotLimits.entries));
const chunkOrdinal = (key: string): number => {
  const match = /\.(0|[1-9][0-9]*)\.json\.gz$/.exec(key);
  return match === null ? -1 : Number(match[1]);
};

export const BodyChunk = Schema.Struct({
  typeId: Slug,
  visibility: EntryVisibility,
  ids: Schema.Array(SnapshotEntryId).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(snapshotLimits.chunkEntries),
    Schema.isUnique(),
  ),
  file: SnapshotFile,
}).check(
  Schema.makeFilter((chunk) => {
    const ordinal = Schema.decodeUnknownResult(ChunkOrdinal)(chunkOrdinal(chunk.file.key));
    if (ordinal._tag === "Failure") return "Invalid snapshot chunk number";
    if (chunk.ids.some((id) => id.split("/")[1] !== chunk.typeId))
      return "Snapshot chunk entry identity does not match";
    return undefined;
  }),
);
export type BodyChunk = typeof BodyChunk.Type;

const prefix = (sourceId: string, version: number) => `corpus/${sourceId}/v${version}`;
const bodyKey = (base: string, typeId: string, visibility: EntryVisibility, chunk: number) =>
  `${base}/bodies/${typeId}.${visibility}.${chunk}.json.gz`;

/** Callers pass safe source/type slugs; published version numbers start at one. */
export const snapshotPrefix = (sourceId: string, version: number): string => {
  const source = Schema.decodeUnknownSync(SourceSlug)(sourceId);
  const revision = Schema.decodeUnknownSync(Version)(version);
  return prefix(source, revision);
};

export const snapshotKeys = (sourceId: string, version: number) => {
  const base = snapshotPrefix(sourceId, version);
  return {
    manifest: `${base}/manifest.json`,
    publicIndex: `${base}/index.public.json.gz`,
    dmIndex: `${base}/index.dm.json.gz`,
    body: (typeId: string, visibility: "public" | "dm", chunk: number) =>
      bodyKey(
        base,
        Schema.decodeUnknownSync(Slug)(typeId),
        Schema.decodeUnknownSync(EntryVisibility)(visibility),
        Schema.decodeUnknownSync(SafeNonNegativeInteger)(chunk),
      ),
  };
};

/** Public and DM rows/bodies are physically separate immutable objects. */
const Manifest = Schema.Struct({
  format: Schema.Literal("ttrpg-corpus"),
  formatVersion: Schema.Literal(1),
  sourceId: SourceSlug,
  sourceName: NonEmptyTrimmed(200),
  systemId: Slug,
  version: Version,
  publishedAt: NonEmptyTrimmed(120),
  licence: Licence,
  types: Schema.Array(EntryType.check(Schema.makeFilter((type) => typeError(type)))).check(
    Schema.isMaxLength(compendiumLimits.types),
  ),
  publicIndex: IndexFile,
  dmIndex: IndexFile,
  bodyChunks: Schema.Array(BodyChunk).check(Schema.isMaxLength(snapshotLimits.entries)),
  entryCount: SafeNonNegativeInteger.check(Schema.isLessThanOrEqualTo(snapshotLimits.entries)),
}).check(
  Schema.makeFilter((manifest) => {
    const base = prefix(manifest.sourceId, manifest.version);
    if (
      manifest.publicIndex.key !== `${base}/index.public.json.gz` ||
      manifest.dmIndex.key !== `${base}/index.dm.json.gz`
    )
      return "Invalid snapshot file key";
    const typeIds = new Set(manifest.types.map((type) => type.id));
    if (typeIds.size !== manifest.types.length) return "Duplicate snapshot type id";
    const fileKeys = new Set([manifest.publicIndex.key, manifest.dmIndex.key]);
    const ids = new Set<string>();
    for (const chunk of manifest.bodyChunks) {
      if (!typeIds.has(chunk.typeId)) return "Unknown snapshot chunk type";
      if (
        chunk.file.key !==
        bodyKey(base, chunk.typeId, chunk.visibility, chunkOrdinal(chunk.file.key))
      )
        return "Invalid snapshot file key";
      if (fileKeys.has(chunk.file.key)) return "Duplicate snapshot file key";
      fileKeys.add(chunk.file.key);
      for (const id of chunk.ids) {
        if (id.split("/")[0] !== manifest.sourceId)
          return "Snapshot chunk entry identity does not match";
        if (ids.has(id)) return "Duplicate snapshot entry id";
        ids.add(id);
      }
    }
    return ids.size === manifest.entryCount
      ? undefined
      : "Snapshot entry count does not match chunks";
  }),
);
// Count the original JSON before decoding strips excess properties.
export const SnapshotManifest = Schema.Unknown.check(
  maxJsonBytes(snapshotLimits.manifestBytes, "Snapshot manifest is too large"),
).pipe(Schema.decodeTo(Manifest));
export type SnapshotManifest = typeof SnapshotManifest.Type;

const rowTextFields = {
  id: Schema.String,
  typeId: Schema.String,
  name: NonEmptyTrimmed(compendiumLimits.name),
  tags: Schema.Array(Schema.String.check(Schema.isMaxLength(40))).check(
    Schema.isMaxLength(compendiumLimits.tags),
  ),
  updatedAt: Schema.String.check(Schema.isMaxLength(120)),
};
const identityMatches = Schema.makeFilter(
  (row: { readonly id: string; readonly typeId: string }) => {
    const id = parseEntryId(row.id);
    return id !== undefined && id.typeId === row.typeId
      ? undefined
      : "Invalid snapshot entry identity";
  },
);
const SnapshotRowText = Schema.Struct({
  ...rowTextFields,
  tags: Schema.Array(rowTextFields.tags.value),
}).check(identityMatches);
const rowSizeError = (row: IndexRow): string | undefined =>
  jsonBytes(row).byteLength > compendiumLimits.entryBytes ? "Snapshot row is too large" : undefined;

export const SnapshotIndexRow = Schema.Struct({
  ...IndexRow.fields,
  ...rowTextFields,
  rev: Revision,
  facets: Schema.optional(IndexRow.fields.facets.schema.check(isFiniteJson)),
}).check(identityMatches, Schema.makeFilter(rowSizeError));
export type SnapshotIndexRow = typeof SnapshotIndexRow.Type;

const SnapshotRows = Schema.Struct({
  visibility: EntryVisibility,
  rows: Schema.Array(SnapshotIndexRow).check(
    Schema.isMaxLength(snapshotLimits.entries, { message: "Too many snapshot rows" }),
  ),
}).check(
  Schema.makeFilter(({ rows, visibility }) => {
    if (rows.some((row) => row.visibility !== visibility))
      return "Snapshot visibility does not match";
    return new Set(rows.map((row) => row.id)).size === rows.length
      ? undefined
      : "Duplicate snapshot entry id";
  }),
);

/** String dictionaries reduce repetition; facets remain typed JSON values. */
export const PackedIndexRow = Schema.Tuple([
  SafeNonNegativeInteger, // id
  SafeNonNegativeInteger, // name
  SafeNonNegativeInteger, // typeId
  Schema.Array(SafeNonNegativeInteger).check(Schema.isMaxLength(compendiumLimits.tags)),
  SafeNonNegativeInteger, // updatedAt
  Revision,
  Schema.NullOr(
    Schema.Record(
      Schema.String,
      Schema.Union([Schema.Number, Schema.String, Schema.Boolean, Schema.Array(Schema.String)]),
    ).check(isFiniteJson),
  ),
]);
export type PackedIndexRow = typeof PackedIndexRow.Type;

type IndexData = {
  readonly strings: readonly string[];
  readonly visibility: EntryVisibility;
  readonly rows: readonly PackedIndexRow[];
};
const unpackRow = (
  packed: IndexData,
  [id, name, typeId, tags, updatedAt, rev, facets]: PackedIndexRow,
): IndexRow => ({
  id: packed.strings[id],
  name: packed.strings[name],
  typeId: packed.strings[typeId],
  tags: tags.map((index) => packed.strings[index]),
  updatedAt: packed.strings[updatedAt],
  rev,
  visibility: packed.visibility,
  ...(facets === null ? {} : { facets }),
});

export const PackedIndex = Schema.Struct({
  format: Schema.Literal("ttrpg-corpus-index"),
  formatVersion: Schema.Literal(1),
  visibility: EntryVisibility,
  strings: Schema.Array(Schema.String),
  rows: Schema.Array(PackedIndexRow).check(
    Schema.isMaxLength(snapshotLimits.entries, { message: "Too many snapshot rows" }),
  ),
}).check(
  Schema.makeFilter((packed) => {
    const ids = new Set<string>();
    for (const row of packed.rows) {
      const [id, name, typeId, tags, updatedAt] = row;
      if ([id, name, typeId, updatedAt, ...tags].some((index) => index >= packed.strings.length))
        return "Invalid snapshot dictionary index";
      const unpacked = unpackRow(packed, row);
      // Dictionary strings acquire their field meaning only when referenced by a row.
      const text = Schema.decodeUnknownResult(SnapshotRowText)(unpacked);
      if (text._tag === "Failure") return text.failure.message;
      const sizeError = rowSizeError(unpacked);
      if (sizeError) return sizeError;
      if (ids.has(unpacked.id)) return "Duplicate snapshot entry id";
      ids.add(unpacked.id);
    }
    return undefined;
  }),
);
export type PackedIndex = typeof PackedIndex.Type;

export const SnapshotEntry = Schema.Struct({
  ...CompendiumEntry.fields,
  ...rowTextFields,
  rev: Schema.optional(Revision),
  sourceRev: Schema.optional(Revision),
  sourceVersion: Schema.optional(Version),
  body: Schema.String.check(Schema.isMaxLength(compendiumLimits.body)),
  fields: CompendiumEntry.fields.fields.check(isFiniteJson),
}).check(
  identityMatches,
  Schema.makeFilter((entry) => {
    // Legacy entries count the implicit revision one in their snapshot row size.
    return rowSizeError({ ...entry, rev: entry.rev ?? 1 });
  }),
);
export type SnapshotEntry = typeof SnapshotEntry.Type;

export const SnapshotBodies = Schema.Struct({
  format: Schema.Literal("ttrpg-corpus-bodies"),
  formatVersion: Schema.Literal(1),
  entries: Schema.Array(SnapshotEntry).check(
    Schema.isMaxLength(snapshotLimits.chunkEntries, { message: "Too many body chunk entries" }),
  ),
}).check(
  Schema.makeFilter(({ entries }) => {
    const first = entries[0];
    const source = first?.id.split("/")[0];
    const ids = new Set<string>();
    for (const entry of entries) {
      if (
        entry.typeId !== first.typeId ||
        entry.visibility !== first.visibility ||
        entry.id.split("/")[0] !== source
      )
        return "Body chunk entries must share source, type and visibility";
      if (ids.has(entry.id)) return "Duplicate snapshot entry id";
      ids.add(entry.id);
    }
    return undefined;
  }),
);
export type SnapshotBodies = typeof SnapshotBodies.Type;

const gzip = async (value: unknown, maximum: number): Promise<Uint8Array> => {
  const bytes = jsonBytes(value);
  if (bytes.byteLength > maximum) throw new Error("Snapshot exceeds size limit");
  const stream = new Response(bytes).body!.pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/** Count decompressed bytes incrementally so a gzip bomb never reaches JSON.parse. */
const gunzip = async (bytes: Uint8Array, maximum: number): Promise<unknown> => {
  if (bytes.byteLength > maximum) throw new Error("Snapshot exceeds size limit");
  const reader = new Response(bytes.slice())
    .body!.pipeThrough(new DecompressionStream("gzip"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) throw new Error("Decompressed snapshot exceeds size limit");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const decoded = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    decoded.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
};

export const encodeIndex = async (
  rows: readonly IndexRow[],
  visibility: EntryVisibility,
): Promise<Uint8Array> => {
  const validated = Schema.decodeUnknownSync(SnapshotRows)({ rows, visibility });
  const strings: string[] = [];
  const dictionary = new Map<string, number>();
  const code = (value: string): number => {
    const previous = dictionary.get(value);
    if (previous !== undefined) return previous;
    const index = strings.length;
    strings.push(value);
    dictionary.set(value, index);
    return index;
  };
  const packed: PackedIndex = {
    format: "ttrpg-corpus-index",
    formatVersion: 1,
    visibility: validated.visibility,
    strings,
    rows: validated.rows.map((row) => [
      code(row.id),
      code(row.name),
      code(row.typeId),
      row.tags.map(code),
      code(row.updatedAt),
      row.rev,
      row.facets ?? null,
    ]),
  };
  return gzip(packed, snapshotLimits.indexBytes);
};

export const decodeIndex = async (
  bytes: Uint8Array,
  expectedVisibility?: EntryVisibility,
): Promise<IndexRow[]> => {
  const packed = Schema.decodeUnknownSync(PackedIndex)(
    await gunzip(bytes, snapshotLimits.indexBytes),
  );
  // The requested visibility is independent of the stored snapshot.
  if (expectedVisibility !== undefined && packed.visibility !== expectedVisibility)
    throw new Error("Snapshot visibility does not match");
  return packed.rows.map((row) => unpackRow(packed, row));
};

export const encodeBodies = async (entries: readonly CompendiumEntry[]): Promise<Uint8Array> => {
  const bodies = Schema.decodeUnknownSync(SnapshotBodies)({
    format: "ttrpg-corpus-bodies",
    formatVersion: 1,
    entries,
  });
  return gzip(bodies, snapshotLimits.bodyBytes);
};

export const decodeBodies = async (bytes: Uint8Array): Promise<CompendiumEntry[]> => {
  const bodies = Schema.decodeUnknownSync(SnapshotBodies)(
    await gunzip(bytes, snapshotLimits.bodyBytes),
  );
  return [...bodies.entries];
};

export const snapshotFile = async (key: string, bytes: Uint8Array): Promise<SnapshotFile> => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice()));
  return {
    key,
    bytes: bytes.byteLength,
    sha256: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
  };
};

export const validateManifest = (value: unknown): SnapshotManifest =>
  Schema.decodeUnknownSync(SnapshotManifest)(value);
