import { Effect } from "effect";
import { SnapshotBucket } from "./bucket";
export { SnapshotBucket } from "./bucket";
import { bindingCall } from "./effects";
import type { CompendiumEntry, EntryType, IndexRow } from "../../../src/domain/compendium";
import type { CorpusSource } from "../../../src/domain/corpus-rpc";
import { entryFacets } from "../../../src/domain/entry-facets";
import {
  encodeBodies,
  encodeIndex,
  snapshotFile,
  snapshotKeys,
  snapshotLimits,
  type BodyChunk,
  type SnapshotManifest,
} from "../../../src/domain/snapshot";

export type FrozenSource = {
  source: CorpusSource;
  types: readonly EntryType[];
  entries: readonly { entry: CompendiumEntry; type: EntryType }[];
  version: number;
};

/** Every key belongs to a durably reserved version; the manifest is written last. */
export const publishSnapshot = Effect.fn("Corpus.publishSnapshot")(function* (
  frozen: FrozenSource,
) {
  const bucket = yield* SnapshotBucket;
  const { source, types, version } = frozen;
  const keys = snapshotKeys(source.id, version);
  const entries = frozen.entries.map(({ entry }) => ({
    ...entry,
    licence: source.licence,
    sourceVersion: version,
    sourceRev: entry.rev ?? 0,
  }));
  const rows: IndexRow[] = frozen.entries.map(({ entry, type }) => ({
    id: entry.id,
    name: entry.name,
    typeId: entry.typeId,
    tags: entry.tags,
    visibility: entry.visibility,
    updatedAt: entry.updatedAt,
    rev: entry.rev ?? 0,
    facets: entryFacets(entry, type),
  }));
  const publicBytes = yield* bindingCall("Corpus snapshot encoding failed", () =>
    encodeIndex(
      rows.filter((row) => row.visibility === "public"),
      "public",
    ),
  );
  const dmBytes = yield* bindingCall("Corpus snapshot encoding failed", () =>
    encodeIndex(
      rows.filter((row) => row.visibility === "dm"),
      "dm",
    ),
  );
  const publicIndex = yield* bindingCall("Corpus snapshot encoding failed", () =>
    snapshotFile(keys.publicIndex, publicBytes),
  );
  const dmIndex = yield* bindingCall("Corpus snapshot encoding failed", () =>
    snapshotFile(keys.dmIndex, dmBytes),
  );
  yield* bucket.put(keys.publicIndex, publicBytes, "application/gzip");
  yield* bucket.put(keys.dmIndex, dmBytes, "application/gzip");
  const bodyChunks: BodyChunk[] = [];
  for (const type of types) {
    for (const visibility of ["public", "dm"] as const) {
      const selected = entries.filter(
        (entry) => entry.typeId === type.id && entry.visibility === visibility,
      );
      for (let offset = 0; offset < selected.length; offset += snapshotLimits.chunkEntries) {
        const chunk = selected.slice(offset, offset + snapshotLimits.chunkEntries);
        const key = keys.body(type.id, visibility, offset / snapshotLimits.chunkEntries);
        const bytes = yield* bindingCall("Corpus snapshot encoding failed", () =>
          encodeBodies(chunk),
        );
        const file = yield* bindingCall("Corpus snapshot encoding failed", () =>
          snapshotFile(key, bytes),
        );
        yield* bucket.put(key, bytes, "application/gzip");
        bodyChunks.push({
          typeId: type.id,
          visibility,
          ids: chunk.map((entry) => entry.id),
          file,
        });
      }
    }
  }
  const manifest: SnapshotManifest = {
    format: "ttrpg-corpus",
    formatVersion: 1,
    sourceId: source.id,
    sourceName: source.name,
    systemId: source.systemId,
    version,
    publishedAt: new Date().toISOString(),
    licence: source.licence,
    types,
    publicIndex,
    dmIndex,
    bodyChunks,
    entryCount: entries.length,
  };
  yield* bucket.put(keys.manifest, JSON.stringify(manifest), "application/json");
  return manifest;
});
