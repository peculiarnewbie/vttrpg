import * as Schema from "effect/Schema";
import {
  CompendiumEntry,
  EntryType,
  EntryVisibility,
  IndexRow,
  compendiumLimits,
} from "./compendium";
import { Licence, licenceError } from "./licence";
import { parseEntryId } from "./entry-id";
import { typeError } from "./compendium-rules";

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
  if (!Number.isSafeInteger(version) || version < 1 || version > snapshotLimits.version)
    throw new Error("Invalid source version");
  return `corpus/${sourceId}/v${version}`;
};

export const snapshotKeys = (sourceId: string, version: number) => {
  const prefix = snapshotPrefix(sourceId, version);
  return {
    manifest: `${prefix}/manifest.json`,
    publicIndex: `${prefix}/index.public.json.gz`,
    dmIndex: `${prefix}/index.dm.json.gz`,
    body: (typeId: string, visibility: "public" | "dm", chunk: number) => {
      if (
        !/^[a-z0-9][a-z0-9_-]{0,59}$/.test(typeId) ||
        !["public", "dm"].includes(visibility) ||
        !Number.isSafeInteger(chunk) ||
        chunk < 0
      )
        throw new Error("Invalid body chunk");
      return `${prefix}/bodies/${typeId}.${visibility}.${chunk}.json.gz`;
    },
  };
};

/** Limits bound untrusted snapshots before schema validation and allocation. */
export const snapshotLimits = {
  entries: 100_000,
  chunkEntries: 100,
  version: 2_147_483_647,
  indexBytes: 32 * 1024 * 1024,
  bodyBytes: 64 * 1024 * 1024,
  manifestBytes: 32 * 1024 * 1024,
} as const;

const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const safeRevision = (value: number) => Number.isSafeInteger(value) && value >= 1;
const validSlug = (value: string) => /^[a-z0-9][a-z0-9_-]{0,59}$/.test(value);
const finiteValues = (value: unknown): boolean => {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteValues);
  if (typeof value === "object" && value !== null) return Object.values(value).every(finiteValues);
  return true;
};

const rowError = (row: IndexRow): string | undefined => {
  const id = parseEntryId(row.id);
  if (!id || id.typeId !== row.typeId) return "Invalid snapshot entry identity";
  if (!safeRevision(row.rev)) return "Invalid snapshot entry revision";
  if (!finiteValues(row.facets)) return "Snapshot facet numbers must be finite";
  if (!row.name.trim() || row.name.length > compendiumLimits.name)
    return "Invalid snapshot entry name";
  if (row.tags.length > compendiumLimits.tags || row.tags.some((tag) => tag.length > 40))
    return "Invalid snapshot entry tags";
  if (row.updatedAt.length > 120) return "Invalid snapshot entry timestamp";
  if (jsonBytes(row).byteLength > compendiumLimits.entryBytes) return "Snapshot row is too large";
  return undefined;
};

const validateRows = (rows: readonly IndexRow[], visibility: EntryVisibility) => {
  if (rows.length > snapshotLimits.entries) throw new Error("Too many snapshot rows");
  const ids = new Set<string>();
  for (const row of rows) {
    const error = rowError(row);
    if (error) throw new Error(error);
    if (row.visibility !== visibility) throw new Error("Snapshot visibility does not match");
    if (ids.has(row.id)) throw new Error("Duplicate snapshot entry id");
    ids.add(row.id);
  }
};

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
  Schema.decodeUnknownSync(EntryVisibility)(visibility);
  const validated = Schema.decodeUnknownSync(Schema.Array(IndexRow))(rows);
  validateRows(validated, visibility);
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
    visibility,
    strings,
    rows: validated.map((row) => [
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
  if (expectedVisibility !== undefined && packed.visibility !== expectedVisibility)
    throw new Error("Snapshot visibility does not match");
  if (packed.rows.length > snapshotLimits.entries) throw new Error("Too many snapshot rows");
  const string = (index: number): string => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= packed.strings.length)
      throw new Error("Invalid snapshot dictionary index");
    return packed.strings[index];
  };
  const rows = packed.rows.map(([id, name, typeId, tags, updatedAt, rev, facets]): IndexRow => ({
    id: string(id),
    name: string(name),
    typeId: string(typeId),
    tags: tags.map(string),
    updatedAt: string(updatedAt),
    rev,
    visibility: packed.visibility,
    ...(facets === null ? {} : { facets }),
  }));
  validateRows(rows, packed.visibility);
  return rows;
};

const validateEntries = (entries: readonly CompendiumEntry[]) => {
  if (entries.length > snapshotLimits.chunkEntries) throw new Error("Too many body chunk entries");
  const ids = new Set<string>();
  for (const entry of entries) {
    const first = entries[0];
    if (
      entry.typeId !== first.typeId ||
      entry.visibility !== first.visibility ||
      parseEntryId(entry.id)?.source !== parseEntryId(first.id)?.source
    )
      throw new Error("Body chunk entries must share source, type and visibility");
    const error = rowError({ ...entry, rev: entry.rev ?? 1 });
    if (error) throw new Error(error);
    if (!finiteValues(entry.fields)) throw new Error("Snapshot field numbers must be finite");
    if (
      (entry.sourceRev !== undefined && !safeRevision(entry.sourceRev)) ||
      (entry.sourceVersion !== undefined &&
        (!safeRevision(entry.sourceVersion) || entry.sourceVersion > snapshotLimits.version))
    )
      throw new Error("Invalid source revision or version");
    if (entry.licence !== undefined) {
      const licenceIssue = licenceError(entry.licence);
      if (licenceIssue) throw new Error(licenceIssue);
    }
    if (
      entry.body.length > compendiumLimits.body ||
      jsonBytes(entry).byteLength > compendiumLimits.entryBytes
    )
      throw new Error("Snapshot entry is too large");
    if (ids.has(entry.id)) throw new Error("Duplicate snapshot entry id");
    ids.add(entry.id);
  }
};

export const encodeBodies = async (entries: readonly CompendiumEntry[]): Promise<Uint8Array> => {
  const validated = Schema.decodeUnknownSync(Schema.Array(CompendiumEntry))(entries);
  validateEntries(validated);
  const bodies: SnapshotBodies = {
    format: "ttrpg-corpus-bodies",
    formatVersion: 1,
    entries: validated,
  };
  return gzip(bodies, snapshotLimits.bodyBytes);
};

export const decodeBodies = async (bytes: Uint8Array): Promise<CompendiumEntry[]> => {
  const bodies = Schema.decodeUnknownSync(SnapshotBodies)(
    await gunzip(bytes, snapshotLimits.bodyBytes),
  );
  validateEntries(bodies.entries);
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

export const validateManifest = (value: unknown): SnapshotManifest => {
  if (jsonBytes(value).byteLength > snapshotLimits.manifestBytes)
    throw new Error("Snapshot manifest is too large");
  const manifest = Schema.decodeUnknownSync(SnapshotManifest)(value);
  const keys = snapshotKeys(manifest.sourceId, manifest.version);
  if (
    !validSlug(manifest.systemId) ||
    !manifest.sourceName.trim() ||
    manifest.sourceName.length > 200 ||
    !manifest.publishedAt.trim() ||
    manifest.publishedAt.length > 120
  )
    throw new Error("Invalid snapshot source metadata");
  const licenceIssue = licenceError(manifest.licence);
  if (licenceIssue) throw new Error(licenceIssue);
  if (
    !Number.isSafeInteger(manifest.entryCount) ||
    manifest.entryCount < 0 ||
    manifest.entryCount > snapshotLimits.entries ||
    manifest.bodyChunks.length > snapshotLimits.entries ||
    manifest.types.length > compendiumLimits.types
  )
    throw new Error("Invalid snapshot entry count");
  const typeIds = new Set<string>();
  for (const type of manifest.types) {
    const error = typeError(type);
    if (error) throw new Error(error);
    if (typeIds.has(type.id)) throw new Error("Duplicate snapshot type id");
    typeIds.add(type.id);
  }
  const fileKeys = new Set<string>();
  const checkFile = (file: SnapshotFile, expected: string, maximum: number) => {
    if (file.key !== expected) throw new Error("Invalid snapshot file key");
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > maximum)
      throw new Error("Invalid snapshot file size");
    if (!/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Invalid snapshot file digest");
    if (fileKeys.has(file.key)) throw new Error("Duplicate snapshot file key");
    fileKeys.add(file.key);
  };
  checkFile(manifest.publicIndex, keys.publicIndex, snapshotLimits.indexBytes);
  checkFile(manifest.dmIndex, keys.dmIndex, snapshotLimits.indexBytes);
  const ids = new Set<string>();
  for (const chunk of manifest.bodyChunks) {
    if (!typeIds.has(chunk.typeId)) throw new Error("Unknown snapshot chunk type");
    if (chunk.ids.length < 1 || chunk.ids.length > snapshotLimits.chunkEntries)
      throw new Error("Invalid snapshot chunk count");
    const ordinal = /\.(0|[1-9][0-9]*)\.json\.gz$/.exec(chunk.file.key);
    const number = ordinal === null ? -1 : Number(ordinal[1]);
    if (!Number.isSafeInteger(number) || number < 0 || number >= snapshotLimits.entries)
      throw new Error("Invalid snapshot chunk number");
    checkFile(
      chunk.file,
      keys.body(chunk.typeId, chunk.visibility, number),
      snapshotLimits.bodyBytes,
    );
    for (const id of chunk.ids) {
      const parsed = parseEntryId(id);
      if (!parsed || parsed.source !== manifest.sourceId || parsed.typeId !== chunk.typeId)
        throw new Error("Snapshot chunk entry identity does not match");
      if (ids.has(id)) throw new Error("Duplicate snapshot entry id");
      ids.add(id);
    }
  }
  if (ids.size !== manifest.entryCount)
    throw new Error("Snapshot entry count does not match chunks");
  return manifest;
};
