import { Cache, Context, Data, Duration, Effect, Exit, Layer, Schema } from "effect";
import {
  CorpusSource,
  CorpusSystem,
  type SourceInput,
  type SystemInput,
} from "../../../src/domain/corpus-rpc";
import { CorpusConflict, CorpusForbidden, CorpusNotFound } from "../../../src/domain/corpus-errors";
import { validateManifest, type SnapshotManifest } from "../../../src/domain/snapshot";
import { bindingCall, readStored, storageCall, unavailable } from "./effects";

const SourceRow = Schema.Struct({
  metadata: Schema.fromJsonString(CorpusSource),
  latest_version: Schema.NullOr(CorpusSource.fields.latestVersion.schema),
});
const sourceFromRow = Effect.fn("Registry.sourceFromRow")(function* (value: unknown) {
  const row = yield* readStored(SourceRow, value);
  return {
    ...row.metadata,
    ...(row.latest_version === null ? {} : { latestVersion: row.latest_version }),
  };
});

type RegistryBinding = Pick<D1Database, "prepare" | "batch">;
class ManifestKey extends Data.Class<{ sourceId: string; version: number }> {}

const makeRegistry = (db: RegistryBinding) =>
  Effect.gen(function* () {
    const getSystem = Effect.fn("Registry.getSystem")(function* (id: string) {
      const row = yield* bindingCall("Corpus registry unavailable", () =>
        db
          .prepare("SELECT metadata FROM systems WHERE id = ?")
          .bind(id)
          .first<{ metadata: string }>(),
      );
      return row ? yield* readStored(Schema.fromJsonString(CorpusSystem), row.metadata) : null;
    });
    const readManifest = Effect.fn("Registry.readManifest")(function* (
      sourceId: string,
      version: number,
    ) {
      const row = yield* bindingCall("Corpus registry unavailable", () =>
        db
          .prepare("SELECT manifest FROM versions WHERE source_id = ? AND version = ?")
          .bind(sourceId, version)
          .first<{ manifest: string }>(),
      );
      if (!row) return null;
      // D1 content may have been written by an older Worker version.
      const manifest = yield* storageCall("Stored corpus manifest did not verify", () =>
        validateManifest(JSON.parse(row.manifest)),
      );
      if (manifest.sourceId !== sourceId || manifest.version !== version)
        return yield* unavailable(
          "Registry manifest identity mismatch",
          "Stored corpus manifest did not verify",
        );
      return manifest;
    });
    const manifests = yield* Cache.makeWith(
      ({ sourceId, version }: ManifestKey) => readManifest(sourceId, version),
      {
        capacity: 128,
        timeToLive: (exit) =>
          Exit.isSuccess(exit) && exit.value !== null ? Duration.infinity : Duration.zero,
      },
    );
    return {
      getSystem,
      listSystems: Effect.fn("Registry.listSystems")(function* () {
        const rows = yield* bindingCall("Corpus registry unavailable", () =>
          db.prepare("SELECT metadata FROM systems ORDER BY id").all<{ metadata: string }>(),
        );
        return yield* Effect.forEach(rows.results, (row) =>
          readStored(Schema.fromJsonString(CorpusSystem), row.metadata),
        );
      }),
      saveSystem: Effect.fn("Registry.saveSystem")(function* (
        input: SystemInput,
        accountId: string,
      ) {
        const system: CorpusSystem = { ...input, ownerAccountId: accountId };
        const result = yield* bindingCall("Corpus registry unavailable", () =>
          db
            .prepare(
              "INSERT INTO systems (id, owner_account_id, metadata) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET metadata = excluded.metadata WHERE systems.owner_account_id = excluded.owner_account_id",
            )
            .bind(input.id, accountId, JSON.stringify(system))
            .run(),
        );
        if (!result.meta.changes)
          return yield* Effect.fail(
            new CorpusForbidden({ message: "Only the system owner can edit it" }),
          );
        return system;
      }),
      createSource: Effect.fn("Registry.createSource")(function* (
        input: SourceInput,
        accountId: string,
      ) {
        const system = yield* getSystem(input.systemId);
        if (!system) return yield* Effect.fail(new CorpusNotFound({ message: "Unknown system" }));
        const source: CorpusSource = { ...input, ownerAccountId: accountId };
        const result = yield* bindingCall("Corpus registry unavailable", () =>
          db
            .prepare(
              "INSERT INTO sources (id, system_id, owner_account_id, visibility, metadata) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
            )
            .bind(input.id, input.systemId, accountId, input.visibility, JSON.stringify(source))
            .run(),
        );
        if (!result.meta.changes)
          return yield* Effect.fail(
            new CorpusConflict({
              message: "Source id already exists; source identity is immutable",
            }),
          );
        return source;
      }),
      getSource: Effect.fn("Registry.getSource")(function* (id: string) {
        const row = yield* bindingCall("Corpus registry unavailable", () =>
          db
            .prepare("SELECT metadata, latest_version FROM sources WHERE id = ?")
            .bind(id)
            .first<{ metadata: string; latest_version: number | null }>(),
        );
        return row ? yield* sourceFromRow(row) : null;
      }),
      listSources: Effect.fn("Registry.listSources")(function* (accountId: string) {
        const rows = yield* bindingCall("Corpus registry unavailable", () =>
          db
            .prepare(
              "SELECT metadata, latest_version FROM sources WHERE owner_account_id = ? OR (visibility = 'public' AND latest_version IS NOT NULL) ORDER BY id",
            )
            .bind(accountId)
            .all<{ metadata: string; latest_version: number | null }>(),
        );
        return yield* Effect.forEach(rows.results, sourceFromRow);
      }),
      getManifest: (sourceId: string, version: number) =>
        Cache.get(manifests, new ManifestKey({ sourceId, version })),
      commitVersion: Effect.fn("Registry.commitVersion")(function* (manifest: SnapshotManifest) {
        yield* bindingCall("Corpus registry unavailable", () =>
          db.batch([
            db
              .prepare("INSERT INTO versions (source_id, version, manifest) VALUES (?, ?, ?)")
              .bind(manifest.sourceId, manifest.version, JSON.stringify(manifest)),
            db
              .prepare(
                "UPDATE sources SET latest_version = MAX(COALESCE(latest_version, 0), ?) WHERE id = ?",
              )
              .bind(manifest.version, manifest.sourceId),
          ]),
        );
        yield* Cache.set(
          manifests,
          new ManifestKey({ sourceId: manifest.sourceId, version: manifest.version }),
          manifest,
        );
      }),
    };
  });

export class Registry extends Context.Service<
  Registry,
  Effect.Success<ReturnType<typeof makeRegistry>>
>()("ttrpg/corpus/Registry") {}

export const registryLayer = (db: RegistryBinding) => Layer.effect(Registry, makeRegistry(db));
