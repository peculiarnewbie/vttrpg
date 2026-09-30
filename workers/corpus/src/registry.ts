import { Effect } from "effect";
import * as Schema from "effect/Schema";
import {
  CorpusSource,
  CorpusSystem,
  type SourceInput,
  type SystemInput,
} from "../../../src/domain/corpus-rpc";
import { validateManifest, type SnapshotManifest } from "../../../src/domain/snapshot";

type SourceRow = { metadata: string; latest_version: number | null };
const sourceFromRow = (row: SourceRow): CorpusSource =>
  Schema.decodeUnknownSync(CorpusSource)({
    ...JSON.parse(row.metadata),
    ...(row.latest_version === null ? {} : { latestVersion: row.latest_version }),
  });

/** Registry effects wrap every asynchronous Cloudflare binding operation. */
export class Registry {
  constructor(private readonly db: D1Database) {}

  listSystems() {
    return Effect.gen({ self: this }, function* () {
      const rows = yield* Effect.promise(() =>
        this.db.prepare("SELECT metadata FROM systems ORDER BY id").all<{ metadata: string }>(),
      );
      return rows.results.map((row) =>
        Schema.decodeUnknownSync(CorpusSystem)(JSON.parse(row.metadata)),
      );
    });
  }

  getSystem(id: string) {
    return Effect.gen({ self: this }, function* () {
      const row = yield* Effect.promise(() =>
        this.db
          .prepare("SELECT metadata FROM systems WHERE id = ?")
          .bind(id)
          .first<{ metadata: string }>(),
      );
      return row ? Schema.decodeUnknownSync(CorpusSystem)(JSON.parse(row.metadata)) : null;
    });
  }

  saveSystem(input: SystemInput, accountId: string) {
    return Effect.gen({ self: this }, function* () {
      const system: CorpusSystem = { ...input, ownerAccountId: accountId };
      const result = yield* Effect.promise(() =>
        this.db
          .prepare(
            "INSERT INTO systems (id, owner_account_id, metadata) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET metadata = excluded.metadata WHERE systems.owner_account_id = excluded.owner_account_id",
          )
          .bind(input.id, accountId, JSON.stringify(system))
          .run(),
      );
      if (!result.meta.changes) throw new Error("Only the system owner can edit it");
      return system;
    });
  }

  createSource(input: SourceInput, accountId: string) {
    return Effect.gen({ self: this }, function* () {
      const system = yield* this.getSystem(input.systemId);
      if (!system) throw new Error("Unknown system");
      const source: CorpusSource = { ...input, ownerAccountId: accountId };
      const result = yield* Effect.promise(() =>
        this.db
          .prepare(
            "INSERT INTO sources (id, system_id, owner_account_id, visibility, metadata) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
          )
          .bind(input.id, input.systemId, accountId, input.visibility, JSON.stringify(source))
          .run(),
      );
      if (!result.meta.changes)
        throw new Error("Source id already exists; source identity is immutable");
      return source;
    });
  }

  getSource(id: string) {
    return Effect.gen({ self: this }, function* () {
      const row = yield* Effect.promise(() =>
        this.db
          .prepare("SELECT metadata, latest_version FROM sources WHERE id = ?")
          .bind(id)
          .first<SourceRow>(),
      );
      return row ? sourceFromRow(row) : null;
    });
  }

  listSources(accountId: string) {
    return Effect.gen({ self: this }, function* () {
      const rows = yield* Effect.promise(() =>
        this.db
          .prepare(
            "SELECT metadata, latest_version FROM sources WHERE owner_account_id = ? OR (visibility = 'public' AND latest_version IS NOT NULL) ORDER BY id",
          )
          .bind(accountId)
          .all<SourceRow>(),
      );
      return rows.results.map(sourceFromRow);
    });
  }

  getManifest(sourceId: string, version: number) {
    return Effect.gen({ self: this }, function* () {
      const row = yield* Effect.promise(() =>
        this.db
          .prepare("SELECT manifest FROM versions WHERE source_id = ? AND version = ?")
          .bind(sourceId, version)
          .first<{ manifest: string }>(),
      );
      if (!row) return null;
      const manifest = validateManifest(JSON.parse(row.manifest));
      if (manifest.sourceId !== sourceId || manifest.version !== version)
        throw new Error("Registry manifest identity mismatch");
      return manifest;
    });
  }

  commitVersion(manifest: SnapshotManifest) {
    return Effect.gen({ self: this }, function* () {
      yield* Effect.promise(() =>
        this.db.batch([
          this.db
            .prepare("INSERT INTO versions (source_id, version, manifest) VALUES (?, ?, ?)")
            .bind(manifest.sourceId, manifest.version, JSON.stringify(manifest)),
          this.db
            .prepare(
              "UPDATE sources SET latest_version = MAX(COALESCE(latest_version, 0), ?) WHERE id = ?",
            )
            .bind(manifest.version, manifest.sourceId),
        ]),
      );
    });
  }
}
