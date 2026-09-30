import { Effect } from "effect";
import type { CompendiumEntry, EntryType, IndexRow } from "../../../src/domain/compendium";
import type { CorpusSource } from "../../../src/domain/corpus-rpc";
import { entryFacets } from "../../../src/domain/entry-facets";
import {
  encodeBodies,
  encodeIndex,
  snapshotFile,
  snapshotKeys,
  validateManifest,
  type BodyChunk,
  type SnapshotManifest,
} from "../../../src/domain/snapshot";

export type FrozenSource = {
  source: CorpusSource;
  types: readonly EntryType[];
  entries: readonly CompendiumEntry[];
  version: number;
};

/** Every key belongs to a durably reserved version; the manifest is written last. */
export const publishSnapshot = (bucket: R2Bucket, frozen: FrozenSource) =>
  Effect.gen(function* () {
    const { source, types, version } = frozen;
    const keys = snapshotKeys(source.id, version);
    const entries = frozen.entries.map((entry) => ({
      ...entry,
      licence: source.licence,
      sourceVersion: version,
      sourceRev: entry.rev ?? 0,
    }));
    const rows: IndexRow[] = entries.map((entry) => {
      const type = types.find((candidate) => candidate.id === entry.typeId);
      if (!type) throw new Error(`Unknown frozen entry type: ${entry.typeId}`);
      return {
        id: entry.id,
        name: entry.name,
        typeId: entry.typeId,
        tags: entry.tags,
        visibility: entry.visibility,
        updatedAt: entry.updatedAt,
        rev: entry.rev ?? 0,
        facets: entryFacets(entry, type),
      };
    });
    const publicBytes = yield* Effect.promise(() =>
      encodeIndex(
        rows.filter((row) => row.visibility === "public"),
        "public",
      ),
    );
    const dmBytes = yield* Effect.promise(() =>
      encodeIndex(
        rows.filter((row) => row.visibility === "dm"),
        "dm",
      ),
    );
    const publicIndex = yield* Effect.promise(() => snapshotFile(keys.publicIndex, publicBytes));
    const dmIndex = yield* Effect.promise(() => snapshotFile(keys.dmIndex, dmBytes));
    yield* Effect.promise(() =>
      bucket.put(keys.publicIndex, publicBytes, {
        httpMetadata: { contentType: "application/gzip" },
      }),
    );
    yield* Effect.promise(() =>
      bucket.put(keys.dmIndex, dmBytes, { httpMetadata: { contentType: "application/gzip" } }),
    );
    const bodyChunks: BodyChunk[] = [];
    for (const type of types) {
      for (const visibility of ["public", "dm"] as const) {
        const selected = entries.filter(
          (entry) => entry.typeId === type.id && entry.visibility === visibility,
        );
        for (let offset = 0; offset < selected.length; offset += 100) {
          const chunk = selected.slice(offset, offset + 100);
          const key = keys.body(type.id, visibility, offset / 100);
          const bytes = yield* Effect.promise(() => encodeBodies(chunk));
          const file = yield* Effect.promise(() => snapshotFile(key, bytes));
          yield* Effect.promise(() =>
            bucket.put(key, bytes, { httpMetadata: { contentType: "application/gzip" } }),
          );
          bodyChunks.push({
            typeId: type.id,
            visibility,
            ids: chunk.map((entry) => entry.id),
            file,
          });
        }
      }
    }
    const manifest: SnapshotManifest = validateManifest({
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
    });
    yield* Effect.promise(() =>
      bucket.put(keys.manifest, JSON.stringify(manifest), {
        httpMetadata: { contentType: "application/json" },
      }),
    );
    return manifest;
  });
