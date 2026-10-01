import { WorldStorage } from "./world-rpc";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Cache from "effect/Cache";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import {
  CorpusForbidden,
  CorpusNotFound,
  CorpusInvalid,
  CorpusConflict,
  CorpusUnavailable,
  type CorpusError,
} from "../domain/corpus-errors";
import { CorpusClient, corpusIO } from "./corpus-env";
import * as Schema from "effect/Schema";
import {
  EnableSourceInput,
  type WorldSource,
  type SourceUpdateSummary,
  type LibraryEntryDiff,
  type BlockedEntries,
} from "../domain/corpus-rpc";
import {
  type CompendiumEntry,
  type EntryType,
  type IndexRow,
  type PackEntry,
  compendiumLimits,
} from "../domain/compendium";
import { entryError } from "../domain/compendium-rules";
import { entryFacets } from "../domain/entry-facets";
import { librarySource, parseEntryId } from "../domain/entry-id";
import { SourceSlug } from "../domain/constraints";
import {
  EntryOverride,
  SaveOverrideInput,
  applyOverride,
  overrideError,
} from "../domain/overrides";
import { inheritLicence } from "../domain/licence";
import {
  decodeIndex,
  decodeBodies,
  snapshotFile,
  validateManifest,
  type SnapshotManifest,
  type SnapshotFile,
  type BodyChunk,
} from "../domain/snapshot";
import { compatibleType, type WorldCompendium } from "./world-compendium";
import { nowIso } from "./crypto";

// Kept as an alias for callers migrating to the shared world storage layer.
export { WorldStorage as SourceStorage } from "./world-rpc";
export class CorpusBucket extends Context.Service<CorpusBucket, R2Bucket | undefined>()(
  "ttrpg/CorpusBucket",
) {}
export class CorpusAccountId extends Context.Service<CorpusAccountId, () => string>()(
  "ttrpg/CorpusAccountId",
) {}
const EnableInput = Schema.Struct({
  ...EnableSourceInput.fields,
  version: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
});
const OverrideInput = Schema.Struct({
  ...SaveOverrideInput.fields,
  baseRev: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});
const unavailable = (message: string) => new CorpusUnavailable({ message });
const verified = <T>(operation: () => T) =>
  Effect.try({ try: operation, catch: (error) => error }).pipe(
    Effect.catch((error) =>
      Effect.logError(error).pipe(
        Effect.andThen(Effect.fail(unavailable("Invalid library snapshot"))),
      ),
    ),
  );
const storageIO = <T>(operation: () => T) =>
  Effect.try({ try: operation, catch: (error) => error }).pipe(
    Effect.catch((error) =>
      Effect.logError(error).pipe(
        Effect.andThen(Effect.fail(unavailable("Library storage is temporarily unavailable"))),
      ),
    ),
  );
const storageFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catchDefect((error) =>
      Effect.logError(error).pipe(
        Effect.andThen(Effect.fail(unavailable("Library storage is temporarily unavailable"))),
      ),
    ),
  );
type VerifiedVersion = { manifest: SnapshotManifest; rows: readonly IndexRow[] };
type SourceRow = {
  source_id: string;
  version: number;
  mode: "pinned" | "follow";
  manifest: string;
  latest_version: number | null;
  update_json: string | null;
};
type RawRow = { id: string; source_id: string; row_json: string };
const decodeId = (id: string) =>
  Effect.try({
    try: () => decodeURIComponent(id),
    catch: () => new CorpusInvalid({ message: "Invalid encoded entry id" }),
  });
/** World enablement never leaves this DO. Only manifests and compact indexes are stored here. */
export class WorldSources {
  private readonly manifests = new Map<
    string,
    { manifest: SnapshotManifest; chunks: ReadonlyMap<string, BodyChunk> }
  >();
  private readonly chunkMetadata = new Map<
    string,
    { manifest: SnapshotManifest; chunk: BodyChunk; rows: ReadonlyMap<string, IndexRow> }
  >();
  private readonly mutations = Semaphore.makeUnsafe(1);
  private readonly decodedChunks: Cache.Cache<
    string,
    ReadonlyMap<string, CompendiumEntry>,
    CorpusError
  >;

  private constructor(
    private readonly storage: typeof WorldStorage.Service,
    private readonly compendium: Pick<
      WorldCompendium,
      "notifySources" | "replaceSourceRows" | "updateSourceEntry" | "sourceTypes"
    >,
    private readonly corpus: typeof CorpusClient.Service,
    private readonly bucket: typeof CorpusBucket.Service,
    private readonly accountId: typeof CorpusAccountId.Service,
    decodedChunks: Cache.Cache<string, ReadonlyMap<string, CompendiumEntry>, CorpusError>,
    private readonly verifiedVersions: Cache.Cache<string, VerifiedVersion, CorpusUnavailable>,
  ) {
    this.decodedChunks = decodedChunks;
  }
  static make(
    compendium: Pick<
      WorldCompendium,
      "notifySources" | "replaceSourceRows" | "updateSourceEntry" | "sourceTypes"
    >,
  ) {
    return Effect.gen(function* () {
      const storage = yield* WorldStorage;
      const corpus = yield* CorpusClient;
      const bucket = yield* CorpusBucket;
      const accountId = yield* CorpusAccountId;
      let sources: WorldSources;
      const chunks = yield* Cache.makeWith<
        string,
        ReadonlyMap<string, CompendiumEntry>,
        CorpusError
      >((key) => sources.loadChunk(key), {
        capacity: 32,
        timeToLive: (exit) => (Exit.isSuccess(exit) ? Infinity : 0),
      });
      const versions = yield* Cache.makeWith<string, VerifiedVersion, CorpusUnavailable>(
        () => Effect.fail(unavailable("Library version has not been verified")),
        { capacity: 2 },
      );
      sources = new WorldSources(storage, compendium, corpus, bucket, accountId, chunks, versions);
      return sources;
    });
  }
  private get sql() {
    return this.storage.sql;
  }
  private transactionSync<T>(operation: () => T) {
    return storageIO(() => this.storage.transactionSync(operation));
  }
  get available(): boolean {
    return this.corpus.available && !!this.bucket;
  }
  get enabled(): boolean {
    return this.available;
  }
  migrate = () =>
    storageIO(() => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS world_sources (
      source_id TEXT PRIMARY KEY, version INTEGER NOT NULL, mode TEXT NOT NULL,
      manifest TEXT NOT NULL, latest_version INTEGER, update_json TEXT
    )`);
      this.sql.exec(
        "CREATE TABLE IF NOT EXISTS source_index (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, row_json TEXT NOT NULL)",
      );
      this.sql.exec("CREATE INDEX IF NOT EXISTS source_index_source ON source_index(source_id)");
      this.sql.exec(
        "CREATE TABLE IF NOT EXISTS entry_overrides (entry_id TEXT PRIMARY KEY, override_json TEXT NOT NULL)",
      );
      this.sql.exec("CREATE TABLE IF NOT EXISTS entry_blocked (entry_id TEXT PRIMARY KEY)");
    });
  private requireAvailable = () =>
    this.available && this.accountId()
      ? Effect.void
      : Effect.fail(unavailable("Libraries are unavailable"));
  private call<T>(action: Parameters<typeof this.corpus.call<T>>[0]) {
    return this.corpus.call(action, this.accountId());
  }
  private serial<A, E>(operation: Effect.Effect<A, E>): Effect.Effect<A, E> {
    return this.mutations.withPermit(operation);
  }
  private source(sourceId: string): SourceRow | undefined {
    return this.sql
      .exec<SourceRow>("SELECT * FROM world_sources WHERE source_id = ?", sourceId)
      .toArray()[0];
  }
  private sourceVersion(sourceId: string): number | undefined {
    return this.sql
      .exec<{ version: number }>("SELECT version FROM world_sources WHERE source_id = ?", sourceId)
      .toArray()[0]?.version;
  }
  private sources(): SourceRow[] {
    return this.sql.exec<SourceRow>("SELECT * FROM world_sources ORDER BY source_id").toArray();
  }
  private remember(manifest: SnapshotManifest, rows?: readonly IndexRow[]): void {
    const key = `${manifest.sourceId}/${manifest.version}`;
    if (this.manifests.has(key)) return;
    this.manifests.set(key, {
      manifest,
      chunks: new Map(
        manifest.bodyChunks.flatMap((chunk) => chunk.ids.map((id) => [id, chunk] as const)),
      ),
    });
    const indexed = new Map((rows ?? this.rawRows(manifest.sourceId)).map((row) => [row.id, row]));
    for (const chunk of manifest.bodyChunks)
      this.chunkMetadata.set(chunk.file.key, { manifest, chunk, rows: indexed });
  }
  private forget(sourceId: string): void {
    for (const [key, value] of this.manifests) {
      if (value.manifest.sourceId !== sourceId) continue;
      this.manifests.delete(key);
      for (const chunk of value.manifest.bodyChunks) this.chunkMetadata.delete(chunk.file.key);
    }
  }
  private manifest(row: SourceRow): SnapshotManifest {
    const key = `${row.source_id}/${row.version}`;
    const cached = this.manifests.get(key);
    if (cached) return cached.manifest;
    // Stored JSON was verified at ingest; hibernation only rebuilds the lookup maps.
    const manifest = JSON.parse(row.manifest) as SnapshotManifest;
    this.remember(manifest);
    return manifest;
  }
  private status(row: SourceRow): WorldSource {
    const manifest = this.manifest(row);
    return {
      sourceId: row.source_id,
      name: manifest.sourceName,
      version: row.version,
      mode: row.mode,
      licence: manifest.licence,
      ...(row.latest_version === null ? {} : { latestVersion: row.latest_version }),
      ...(row.update_json === null
        ? {}
        : { update: JSON.parse(row.update_json) as SourceUpdateSummary }),
    };
  }
  list = Effect.fn("WorldSources.list")(function* (this: WorldSources) {
    const available = yield* this.call((api, context) => api.listSources(context));
    return {
      available: available.filter((source) => source.latestVersion !== undefined),
      enabled: this.sources().map((row) => this.status(row)),
    };
  }, storageFailure);
  ownsType(id: string): boolean {
    return this.sources().some((row) => this.manifest(row).types.some((type) => type.id === id));
  }
  private rawRows(sourceId: string): IndexRow[] {
    return this.sql
      .exec<RawRow>("SELECT * FROM source_index WHERE source_id = ?", sourceId)
      .toArray()
      .map((row) => JSON.parse(row.row_json) as IndexRow);
  }
  private raw(id: string): IndexRow | undefined {
    const row = this.sql.exec<RawRow>("SELECT * FROM source_index WHERE id = ?", id).toArray()[0];
    return row ? (JSON.parse(row.row_json) as IndexRow) : undefined;
  }
  private override(id: string): EntryOverride | undefined {
    const row = this.sql
      .exec<{ override_json: string }>(
        "SELECT override_json FROM entry_overrides WHERE entry_id = ?",
        id,
      )
      .toArray()[0];
    return row ? (JSON.parse(row.override_json) as EntryOverride) : undefined;
  }
  private blocked(id: string): boolean {
    return (
      this.sql.exec("SELECT entry_id FROM entry_blocked WHERE entry_id = ?", id).toArray().length >
      0
    );
  }

  private bytes = Effect.fn("WorldSources.bytes")(function* (
    this: WorldSources,
    file: SnapshotFile,
  ) {
    yield* this.requireAvailable();
    const key = new Request(`https://corpus-cache.invalid/${file.key}?sha256=${file.sha256}`);
    const cache =
      typeof caches === "undefined"
        ? undefined
        : (caches as CacheStorage & { default: globalThis.Cache }).default;
    const bestEffort = <T>(action: () => Promise<T>) =>
      Effect.tryPromise({ try: action, catch: () => undefined }).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      );
    const cached = cache ? yield* bestEffort(() => cache.match(key)) : undefined;
    if (cached?.status === 404)
      return yield* Effect.fail(unavailable("Library content is temporarily unavailable"));
    let bytes: Uint8Array;
    if (cached?.ok) bytes = new Uint8Array(yield* corpusIO(() => cached.arrayBuffer()));
    else {
      const bucket = this.bucket;
      if (!bucket) return yield* Effect.fail(unavailable("Libraries are unavailable"));
      const object = yield* corpusIO(() => bucket.get(file.key));
      if (!object) {
        if (cache)
          yield* bestEffort(() =>
            cache.put(
              key,
              new Response(null, { status: 404, headers: { "cache-control": "max-age=60" } }),
            ),
          );
        return yield* Effect.fail(unavailable("Library content is temporarily unavailable"));
      }
      if (object.size !== file.bytes)
        return yield* Effect.fail(unavailable("Library snapshot integrity check failed"));
      bytes = new Uint8Array(yield* corpusIO(() => object.arrayBuffer()));
    }
    const actual = yield* corpusIO(() => snapshotFile(file.key, bytes));
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256)
      return yield* Effect.fail(unavailable("Library snapshot integrity check failed"));
    if (!cached?.ok && cache)
      yield* bestEffort(() =>
        cache.put(
          key,
          new Response(bytes.slice().buffer, {
            headers: { "cache-control": "public, max-age=31536000, immutable" },
          }),
        ),
      );
    return bytes;
  }, storageFailure);
  private indexes = Effect.fn("WorldSources.indexes")(function* (
    this: WorldSources,
    manifest: SnapshotManifest,
  ) {
    const [publicRows, dmRows] = yield* Effect.all(
      [
        this.bytes(manifest.publicIndex).pipe(
          Effect.flatMap((bytes) => corpusIO(() => decodeIndex(bytes, "public"))),
        ),
        this.bytes(manifest.dmIndex).pipe(
          Effect.flatMap((bytes) => corpusIO(() => decodeIndex(bytes, "dm"))),
        ),
      ],
      { concurrency: 2 },
    );
    const chunks = new Map(
      manifest.bodyChunks.flatMap((chunk) => chunk.ids.map((id) => [id, chunk] as const)),
    );
    const rows = [...publicRows, ...dmRows];
    const ids = new Set<string>();
    const types = new Map(manifest.types.map((type) => [type.id, type]));
    for (const row of rows) {
      const id = parseEntryId(row.id);
      const chunk = chunks.get(row.id);
      if (
        !id ||
        id.source !== manifest.sourceId ||
        id.typeId !== row.typeId ||
        !chunk ||
        chunk.typeId !== row.typeId ||
        chunk.visibility !== row.visibility ||
        ids.has(row.id)
      )
        return yield* Effect.fail(
          new CorpusUnavailable({ message: "Invalid library snapshot index" }),
        );
      ids.add(row.id);
      const filters = new Map(
        types.get(row.typeId)?.filters?.map((filter) => [filter.key, filter.kind]),
      );
      for (const [key, value] of Object.entries(row.facets ?? {})) {
        const kind = filters.get(key);
        if (
          !kind ||
          (kind === "range" && (typeof value !== "number" || !Number.isFinite(value))) ||
          (kind === "flag" && typeof value !== "boolean") ||
          (kind === "set" &&
            typeof value !== "string" &&
            (!Array.isArray(value) || value.some((item) => typeof item !== "string")))
        )
          return yield* Effect.fail(
            new CorpusUnavailable({ message: "Invalid library snapshot facets" }),
          );
      }
    }
    if (ids.size !== manifest.entryCount)
      return yield* Effect.fail(
        new CorpusUnavailable({ message: "Invalid library snapshot entry count" }),
      );
    return rows;
  }, storageFailure);
  private verifyVersion = Effect.fn("WorldSources.verifyVersion")(function* (
    this: WorldSources,
    value: SnapshotManifest,
    sourceId: string,
    systemId: string,
  ) {
    if (value.sourceId !== sourceId || value.systemId !== systemId)
      return yield* Effect.fail(unavailable("Library snapshot identity check failed"));
    const key = `${sourceId}/${value.version}`;
    const cached = yield* Cache.getOption(this.verifiedVersions, key);
    if (Option.isSome(cached)) return cached.value;
    const manifest = yield* verified(() => validateManifest(value));
    const version = { manifest, rows: yield* this.indexes(manifest) };
    yield* Cache.set(this.verifiedVersions, key, version);
    return version;
  }, storageFailure);
  private validateTypes = Effect.fn("WorldSources.validateTypes")(function* (
    this: WorldSources,
    manifest: SnapshotManifest,
  ) {
    const others = this.sources()
      .filter((source) => source.source_id !== manifest.sourceId)
      .flatMap((source) => this.manifest(source).types);
    const previous = this.source(manifest.sourceId);
    const ownIds = new Set(previous ? this.manifest(previous).types.map((type) => type.id) : []);
    // Types left behind after disabling still belong to world/local content and cannot be clobbered.
    const existing = [
      ...this.compendium
        .sourceTypes()
        .filter(
          (type) =>
            !ownIds.has(type.id) ||
            others.some((other) => other.id === type.id) ||
            this.sql
              .exec(
                "SELECT id FROM compendium_entries WHERE type_id = ? AND source_id IS NULL LIMIT 1",
                type.id,
              )
              .toArray().length > 0,
        ),
      ...others,
    ];
    for (const type of manifest.types) {
      if (
        existing.some((candidate) => candidate.id === type.id && !compatibleType(candidate, type))
      )
        return yield* Effect.fail(
          new CorpusConflict({
            message: `Library entry type conflicts with the world's ${type.id} definition`,
          }),
        );
    }
    if (
      new Set([...existing, ...manifest.types].map((type) => type.id)).size > compendiumLimits.types
    )
      return yield* Effect.fail(
        new CorpusConflict({ message: "A world can have at most 50 entry types" }),
      );
  }, storageFailure);
  private effective(row: IndexRow, type: EntryType, override?: EntryOverride): IndexRow {
    if (!override) return row;
    const patch = override.patch;
    let facets: Record<string, number | string | boolean | readonly string[]> | undefined =
      row.facets ? { ...row.facets } : undefined;
    if (patch.fields || patch.removeFields) {
      facets = { ...row.facets };
      const patchFacets = entryFacets({ fields: patch.fields ?? {} } as CompendiumEntry, type);
      for (const filter of type.filters ?? []) {
        if (Object.hasOwn(patch.fields ?? {}, filter.key)) {
          if (patchFacets && Object.hasOwn(patchFacets, filter.key))
            facets[filter.key] = patchFacets[filter.key];
          else delete facets[filter.key];
        }
        if (patch.removeFields?.includes(filter.key)) {
          if (filter.kind === "flag") facets[filter.key] = false;
          else delete facets[filter.key];
        }
      }
    }
    return {
      ...row,
      name: patch.name ?? row.name,
      tags: patch.tags ?? row.tags,
      visibility: row.visibility === "dm" ? "dm" : (patch.visibility ?? row.visibility),
      updatedAt: override.updatedAt,
      facets,
    };
  }
  private effectiveRows(rows: readonly IndexRow[], types: readonly EntryType[]): IndexRow[] {
    const byType = new Map(types.map((type) => [type.id, type]));
    return rows.flatMap((row) => {
      const type = byType.get(row.typeId);
      return type && !this.blocked(row.id)
        ? [this.effective(row, type, this.override(row.id))]
        : [];
    });
  }
  private ingest = Effect.fn("WorldSources.ingest")(function* (
    this: WorldSources,
    manifest: SnapshotManifest,
    rows: readonly IndexRow[],
    mode: "pinned" | "follow",
    latestVersion: number,
  ) {
    yield* this.validateTypes(manifest);
    const effective = this.effectiveRows(rows, manifest.types);
    const rev = yield* this.transactionSync(() => {
      this.sql.exec(
        `INSERT INTO world_sources (source_id, version, mode, manifest, latest_version, update_json) VALUES (?, ?, ?, ?, ?, NULL)
        ON CONFLICT(source_id) DO UPDATE SET version=excluded.version, mode=excluded.mode, manifest=excluded.manifest, latest_version=excluded.latest_version, update_json=NULL`,
        manifest.sourceId,
        manifest.version,
        mode,
        JSON.stringify(manifest),
        latestVersion,
      );
      this.sql.exec("DELETE FROM source_index WHERE source_id = ?", manifest.sourceId);
      // Batch below SQLite's parameter limit, including large 10k indexes in one atomic transaction.
      for (let start = 0; start < rows.length; start += 20) {
        const batch = rows.slice(start, start + 20);
        this.sql.exec(
          `INSERT INTO source_index (id, source_id, row_json) VALUES ${batch.map(() => "(?, ?, ?)").join(",")}`,
          ...batch.flatMap((row) => [row.id, manifest.sourceId, JSON.stringify(row)]),
        );
      }
      return this.compendium.replaceSourceRows(manifest.sourceId, effective, manifest.types);
    });
    this.forget(manifest.sourceId);
    this.remember(manifest, rows);
    this.compendium.notifySources(rev);
    return {
      sourceId: manifest.sourceId,
      name: manifest.sourceName,
      version: manifest.version,
      mode,
      licence: manifest.licence,
      latestVersion,
    };
  }, storageFailure);
  enable = Effect.fn("WorldSources.enable")(function* (
    this: WorldSources,
    sourceId: string,
    input: EnableSourceInput,
  ) {
    return yield* this.serial(
      Effect.gen({ self: this }, function* () {
        if (!Schema.is(SourceSlug)(sourceId))
          return yield* Effect.fail(new CorpusInvalid({ message: "Invalid library id" }));
        const decoded = Schema.decodeUnknownResult(EnableInput, { onExcessProperty: "error" })(
          input,
        );
        if (decoded._tag === "Failure")
          return yield* Effect.fail(
            new CorpusInvalid({ message: "Invalid library version or mode" }),
          );
        const source = yield* this.call((api, context) => api.getSource({ ...context, sourceId }));
        if (!source)
          return yield* Effect.fail(new CorpusNotFound({ message: "Library not found" }));
        const value =
          input.version === undefined
            ? yield* this.call((api, context) => api.getLatest({ ...context, sourceId }))
            : yield* this.call((api, context) =>
                api.getManifest({ ...context, sourceId, version: decoded.success.version ?? 1 }),
              );
        if (!value)
          return yield* Effect.fail(
            new CorpusNotFound({ message: "Published library version not found" }),
          );
        if (input.version !== undefined && value.version !== input.version)
          return yield* Effect.fail(unavailable("Library snapshot identity check failed"));
        const previous = this.source(sourceId);
        if (previous?.version === value.version) {
          yield* storageIO(() =>
            this.sql.exec(
              "UPDATE world_sources SET mode = ? WHERE source_id = ?",
              input.mode ?? "pinned",
              sourceId,
            ),
          );
          return this.status({ ...previous, mode: input.mode ?? "pinned" });
        }
        const { manifest, rows } = yield* this.verifyVersion(value, sourceId, source.systemId);
        return yield* this.ingest(
          manifest,
          rows,
          input.mode ?? "pinned",
          source.latestVersion ?? manifest.version,
        );
      }),
    );
  }, storageFailure);
  disable = Effect.fn("WorldSources.disable")(function* (this: WorldSources, sourceId: string) {
    return yield* this.serial(
      Effect.gen({ self: this }, function* () {
        yield* this.requireAvailable();
        if (!Schema.is(SourceSlug)(sourceId))
          return yield* Effect.fail(new CorpusInvalid({ message: "Invalid library id" }));
        const rev = yield* this.transactionSync(() => {
          this.sql.exec("DELETE FROM world_sources WHERE source_id = ?", sourceId);
          this.sql.exec("DELETE FROM source_index WHERE source_id = ?", sourceId);
          return this.compendium.replaceSourceRows(sourceId, [], []);
        });
        this.forget(sourceId);
        this.compendium.notifySources(rev);
      }),
    );
  }, storageFailure);
  check = Effect.fn("WorldSources.check")(function* (this: WorldSources) {
    return yield* this.serial(
      Effect.gen({ self: this }, function* () {
        yield* this.requireAvailable();
        for (const source of this.sources()) {
          const latestValue = yield* this.call((api, context) =>
            api.getLatest({ ...context, sourceId: source.source_id }),
          );
          if (!latestValue) {
            const rev = yield* this.transactionSync(() => {
              this.sql.exec("DELETE FROM world_sources WHERE source_id = ?", source.source_id);
              this.sql.exec("DELETE FROM source_index WHERE source_id = ?", source.source_id);
              return this.compendium.replaceSourceRows(source.source_id, [], []);
            });
            this.forget(source.source_id);
            this.compendium.notifySources(rev);
            continue;
          }
          if (
            latestValue.version <= source.version ||
            (source.mode === "pinned" &&
              latestValue.version === source.latest_version &&
              source.update_json !== null)
          )
            continue;
          const { manifest: latest, rows } = yield* this.verifyVersion(
            latestValue,
            source.source_id,
            this.manifest(source).systemId,
          );
          if (source.mode === "follow") yield* this.ingest(latest, rows, "follow", latest.version);
          else {
            const before = new Map(this.rawRows(source.source_id).map((row) => [row.id, row]));
            const after = new Map(rows.map((row) => [row.id, row]));
            const added = rows.filter((row) => !before.has(row.id));
            const changed = rows.filter(
              (row) =>
                before.has(row.id) && JSON.stringify(before.get(row.id)) !== JSON.stringify(row),
            );
            const removed = [...before.values()].filter((row) => !after.has(row.id));
            const update: SourceUpdateSummary = {
              fromVersion: source.version,
              toVersion: latest.version,
              added: added.map((row) => row.id),
              changed: changed.map((row) => row.id),
              removed: removed.map((row) => row.id),
              names: Object.fromEntries(
                [...added, ...changed, ...removed].map((row) => [row.id, row.name]),
              ),
            };
            this.sql.exec(
              "UPDATE world_sources SET latest_version = ?, update_json = ? WHERE source_id = ?",
              latest.version,
              JSON.stringify(update),
              source.source_id,
            );
          }
        }
        this.sql.exec(
          "INSERT INTO settings (key, value) VALUES ('corpus_last_check', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          String(Date.now()),
        );
      }),
    );
  }, storageFailure);
  private loadChunk = Effect.fn("WorldSources.loadChunk")(function* (
    this: WorldSources,
    key: string,
  ) {
    const metadata = this.chunkMetadata.get(key);
    if (!metadata) return yield* Effect.fail(unavailable("Library chunk is unavailable"));
    const { manifest, chunk, rows } = metadata;
    const indexed = new Map(chunk.ids.map((id) => [id, rows.get(id)]));
    const entries = yield* this.bytes(chunk.file).pipe(
      Effect.flatMap((bytes) => corpusIO(() => decodeBodies(bytes))),
    );
    if (entries.length !== chunk.ids.length)
      return yield* Effect.fail(unavailable("Invalid library body chunk"));
    const byId = new Map<string, CompendiumEntry>();
    const types = new Map(manifest.types.map((type) => [type.id, type]));
    for (const entry of entries) {
      const row = indexed.get(entry.id);
      const type = types.get(entry.typeId);
      if (
        !row ||
        !type ||
        byId.has(entry.id) ||
        entry.typeId !== chunk.typeId ||
        entry.visibility !== chunk.visibility ||
        entry.rev !== row.rev ||
        entry.name !== row.name ||
        entry.updatedAt !== row.updatedAt ||
        JSON.stringify(entry.tags) !== JSON.stringify(row.tags) ||
        entryError({ ...entry, id: undefined }, type)
      )
        return yield* Effect.fail(unavailable("Invalid library body entry"));
      byId.set(entry.id, {
        ...entry,
        licence: inheritLicence(manifest.licence, entry.licence),
        sourceRev: row.rev,
        sourceVersion: manifest.version,
      });
    }
    return byId as ReadonlyMap<string, CompendiumEntry>;
  }, storageFailure);

  private chunk(source: SourceRow, id: string): BodyChunk | undefined {
    this.manifest(source);
    return this.manifests.get(`${source.source_id}/${source.version}`)?.chunks.get(id);
  }
  private base = Effect.fn("WorldSources.base")(function* (this: WorldSources, id: string) {
    const sourceId = librarySource(id);
    if (!sourceId) return undefined;
    const source = this.source(sourceId);
    if (!source || !this.raw(id)) return undefined;
    const chunk = this.chunk(source, id);
    if (!chunk) return undefined;
    const entries = yield* Cache.get(this.decodedChunks, chunk.file.key);
    return this.sourceVersion(sourceId) === source.version ? entries.get(id) : undefined;
  }, storageFailure);

  private entryDiff = Effect.fn("WorldSources.entryDiff")(function* (
    this: WorldSources,
    sourceId: string,
    entryId: string,
  ) {
    // Hold the source version steady while snapshot reads yield.
    return yield* this.serial(
      Effect.gen({ self: this }, function* () {
        const source = this.source(sourceId);
        if (!source || source.update_json === null)
          return yield* Effect.fail(new CorpusNotFound({ message: "No pending library update" }));
        const update = JSON.parse(source.update_json) as SourceUpdateSummary;
        const offered = `${sourceId}/${update.toVersion}`;
        // Verify the offered version once; later diffs of the same update reuse it.
        if (!this.manifests.has(offered)) {
          const pinned = this.manifest(source);
          const value = yield* this.call((api, context) =>
            api.getManifest({ ...context, sourceId, version: update.toVersion }),
          );
          if (!value)
            return yield* Effect.fail(unavailable("Offered library version is unavailable"));
          // The corpus reply must identify the requested immutable version.
          if (value.version !== update.toVersion)
            return yield* Effect.fail(unavailable("Library snapshot identity check failed"));
          const { manifest, rows } = yield* this.verifyVersion(value, sourceId, pinned.systemId);
          this.remember(manifest, rows);
        }
        const fromChunk = this.chunk(source, entryId);
        const toChunk = this.manifests.get(offered)?.chunks.get(entryId);
        if (!fromChunk && !toChunk)
          return yield* Effect.fail(new CorpusNotFound({ message: "Library entry not found" }));
        const from = fromChunk
          ? (yield* Cache.get(this.decodedChunks, fromChunk.file.key)).get(entryId)
          : undefined;
        const to = toChunk
          ? (yield* Cache.get(this.decodedChunks, toChunk.file.key)).get(entryId)
          : undefined;
        return {
          entryId,
          fromVersion: source.version,
          toVersion: update.toVersion,
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          overridden: this.override(entryId) !== undefined,
        } satisfies LibraryEntryDiff;
      }),
    );
  }, storageFailure);

  private blockedEntries(): BlockedEntries {
    const rows = this.sql
      .exec<{ entry_id: string; row_json: string | null }>(
        `SELECT b.entry_id, i.row_json FROM entry_blocked b
        LEFT JOIN source_index i ON i.id = b.entry_id ORDER BY b.entry_id`,
      )
      .toArray();
    return {
      ids: rows.map((row) => row.entry_id),
      entries: rows.map((row) => {
        const entry = row.row_json === null ? undefined : (JSON.parse(row.row_json) as IndexRow);
        return {
          id: row.entry_id,
          ...(entry ? { name: entry.name, typeId: entry.typeId } : {}),
        };
      }),
    };
  }

  bodies = Effect.fn("WorldSources.bodies")(function* (
    this: WorldSources,
    ids: readonly string[],
    role: string,
  ) {
    yield* this.requireAvailable();
    const visible = (id: string) =>
      this.sql
        .exec<{ rev: number; visibility: string }>(
          "SELECT rev, visibility FROM compendium_entries WHERE id = ?",
          id,
        )
        .toArray()[0];
    const groups = new Map<
      string,
      { id: string; rev: number; sourceId: string; version: number }[]
    >();
    const sources = new Map<string, SourceRow | undefined>();
    for (const id of new Set(ids)) {
      const sourceId = librarySource(id);
      if (sourceId && !sources.has(sourceId)) sources.set(sourceId, this.source(sourceId));
      const source = sourceId ? sources.get(sourceId) : undefined;
      const before = visible(id);
      if (!source || !before || (role !== "dm" && before.visibility !== "public")) continue;
      const chunk = this.chunk(source, id);
      if (!chunk) continue;
      const group = groups.get(chunk.file.key) ?? [];
      group.push({ id, rev: before.rev, sourceId: source.source_id, version: source.version });
      groups.set(chunk.file.key, group);
    }
    const loaded = new Map<string, CompendiumEntry>();
    for (const [key, group] of groups) {
      const entries = yield* Cache.get(this.decodedChunks, key);
      for (const item of group) {
        const entry = entries.get(item.id);
        if (entry) loaded.set(item.id, entry);
      }
    }
    // Outgoing R2/cache awaits release the input gate: version, override or block changes can interleave.
    const versions = new Map(
      [...sources.keys()].map((sourceId) => [sourceId, this.sourceVersion(sourceId)]),
    );
    const resolved = new Map<string, CompendiumEntry>();
    for (const group of groups.values()) {
      for (const before of group) {
        const after = visible(before.id);
        const entry = loaded.get(before.id);
        if (
          !entry ||
          !after ||
          after.rev !== before.rev ||
          versions.get(before.sourceId) !== before.version ||
          (role !== "dm" && after.visibility !== "public")
        )
          continue;
        const override = this.override(before.id);
        resolved.set(before.id, {
          ...(override ? applyOverride(entry, override) : entry),
          rev: after.rev,
        });
      }
    }
    return resolved as ReadonlyMap<string, CompendiumEntry>;
  }, storageFailure);
  resolve = Effect.fn("WorldSources.resolve")(function* (
    this: WorldSources,
    id: string,
    role: string,
  ) {
    return (yield* this.bodies([id], role)).get(id);
  }, storageFailure);
  exportEntries = Effect.fn("WorldSources.exportEntries")(function* (this: WorldSources) {
    const rows = this.sql
      .exec<{ entry_id: string }>("SELECT entry_id FROM entry_overrides ORDER BY entry_id")
      .toArray();
    const entries: CompendiumEntry[] = [];
    for (const row of rows) {
      const entry = yield* this.resolve(row.entry_id, "dm");
      if (entry) entries.push(entry);
    }
    return entries;
  }, storageFailure);
  /** Fetch and validate without mutations; apply runs inside the caller's SQLite transaction. */
  prepareImport = Effect.fn("WorldSources.prepareImport")(function* (
    this: WorldSources,
    entries: readonly PackEntry[],
  ) {
    yield* this.requireAvailable();
    const prepared: {
      sourceId: string;
      override: EntryOverride;
      row?: IndexRow;
    }[] = [];
    for (const item of entries) {
      const sourceId = librarySource(item.id);
      if (!sourceId)
        return yield* Effect.fail(
          new CorpusInvalid({ message: "Invalid library entry identity in pack" }),
        );
      const source = this.source(sourceId);
      const row = this.raw(item.id);
      if (!source || !row || source.version !== item.sourceVersion || row.rev !== item.sourceRev)
        return yield* Effect.fail(
          new CorpusConflict({
            message:
              "Enable the pack's library version and review changed entries before importing",
          }),
        );
      const base = yield* this.base(item.id);
      if (!base || base.sourceVersion !== item.sourceVersion || base.sourceRev !== item.sourceRev)
        return yield* Effect.fail(
          new CorpusConflict({
            message: "Library changed while importing; retry after reviewing its version",
          }),
        );
      const licence = item.licence;
      const previous = this.override(item.id);
      const rights = base.licence
        ? inheritLicence(base.licence, previous?.licence)
        : previous?.licence;
      if (!rights) return yield* Effect.fail(unavailable("Library licence is unavailable"));
      if (
        !licence ||
        licence.id !== rights.id ||
        licence.name !== rights.name ||
        licence.url !== rights.url ||
        (rights.shareAlike && !licence.shareAlike) ||
        !licence.attribution.includes(rights.attribution)
      )
        return yield* Effect.fail(
          new CorpusInvalid({
            message: "Import must preserve the library licence, share-alike and source attribution",
          }),
        );
      if (base.visibility === "dm" && item.visibility === "public")
        return yield* Effect.fail(
          new CorpusInvalid({ message: "Import cannot reveal a DM-only library entry" }),
        );
      const fields = Object.fromEntries(
        Object.entries(item.fields).filter(
          ([key, value]) => JSON.stringify(base.fields[key]) !== JSON.stringify(value),
        ),
      );
      const removeFields = Object.keys(base.fields).filter(
        (key) => !Object.hasOwn(item.fields, key),
      );
      const override: EntryOverride = {
        entryId: item.id,
        baseRev: row.rev,
        updatedAt: nowIso(),
        licence: inheritLicence(rights, licence),
        patch: {
          ...(item.name === base.name ? {} : { name: item.name }),
          ...(JSON.stringify(item.tags) === JSON.stringify(base.tags) ? {} : { tags: item.tags }),
          ...(item.body === base.body ? {} : { body: item.body }),
          ...(Object.keys(fields).length ? { fields } : {}),
          ...(removeFields.length ? { removeFields } : {}),
          ...(item.visibility === base.visibility ? {} : { visibility: item.visibility }),
        },
      };
      const issue = overrideError(override.patch);
      if (issue) return yield* Effect.fail(new CorpusInvalid({ message: issue }));
      const type = this.manifest(source).types.find((type) => type.id === item.typeId);
      if (!type) return yield* Effect.fail(unavailable("Library entry type is unavailable"));
      const applied = yield* Effect.try({
        try: () => applyOverride(base, override),
        catch: () => new CorpusInvalid({ message: "Invalid resolved override" }),
      });
      const error = entryError({ ...applied, id: undefined }, type);
      if (error) return yield* Effect.fail(new CorpusInvalid({ message: error }));
      prepared.push({
        sourceId,
        override,
        row: this.blocked(item.id) ? undefined : this.effective(row, type, override),
      });
    }
    return {
      apply: (rev: number) => {
        for (const item of prepared)
          this.sql.exec(
            "INSERT INTO entry_overrides (entry_id, override_json) VALUES (?, ?) ON CONFLICT(entry_id) DO UPDATE SET override_json=excluded.override_json",
            item.override.entryId,
            JSON.stringify(item.override),
          );
        for (const item of prepared)
          this.compendium.updateSourceEntry(item.sourceId, item.override.entryId, item.row, rev);
      },
    };
  }, storageFailure);
  private saveOverride = Effect.fn("WorldSources.saveOverride")(function* (
    this: WorldSources,
    id: string,
    body: unknown,
  ) {
    const decoded = Schema.decodeUnknownResult(OverrideInput, { onExcessProperty: "error" })(body);
    if (decoded._tag === "Failure")
      return yield* Effect.fail(new CorpusInvalid({ message: "Invalid entry override" }));
    const input = decoded.success;
    const issue = overrideError(input.patch);
    if (issue) return yield* Effect.fail(new CorpusInvalid({ message: issue }));
    const base = yield* this.base(id);
    if (!base)
      return yield* Effect.fail(new CorpusNotFound({ message: "Library entry not found" }));
    if (base.sourceRev !== input.baseRev)
      return yield* Effect.fail(
        new CorpusConflict({
          message: "Library entry changed; review its current version before saving",
        }),
      );
    if (base.visibility === "dm" && input.patch.visibility === "public")
      return yield* Effect.fail(
        new CorpusInvalid({ message: "A DM-only library entry cannot be revealed by an override" }),
      );
    const sourceId = librarySource(id);
    const source = sourceId ? this.source(sourceId) : undefined;
    const type = source && this.manifest(source).types.find((type) => type.id === base.typeId);
    if (!source || !type || !base.licence)
      return yield* Effect.fail(unavailable("Library entry is unavailable"));
    const override: EntryOverride = {
      entryId: id,
      baseRev: input.baseRev,
      patch: input.patch,
      licence: base.licence,
      updatedAt: nowIso(),
    };
    const applied = yield* Effect.try({
      try: () => applyOverride(base, override),
      catch: () => new CorpusInvalid({ message: "Invalid resolved override" }),
    });
    const error = entryError({ ...applied, id: undefined }, type);
    if (error) return yield* Effect.fail(new CorpusInvalid({ message: error }));
    const raw = this.raw(id);
    const effective = raw && !this.blocked(id) ? this.effective(raw, type, override) : undefined;
    const rev = yield* this.transactionSync(() => {
      this.sql.exec(
        "INSERT INTO entry_overrides (entry_id, override_json) VALUES (?, ?) ON CONFLICT(entry_id) DO UPDATE SET override_json=excluded.override_json",
        id,
        JSON.stringify(override),
      );
      return this.compendium.updateSourceEntry(source.source_id, id, effective);
    });
    this.compendium.notifySources(rev);
    return override;
  }, storageFailure);
  handle = Effect.fn("WorldSources.handle")(function* (
    this: WorldSources,
    method: string,
    path: string,
    body: unknown,
    role: string,
  ) {
    if (role !== "dm")
      return yield* Effect.fail(
        new CorpusForbidden({ message: "Only the DM can manage libraries" }),
      );
    yield* this.requireAvailable();
    if (method === "GET" && path === "libraries") return yield* this.list();
    if (method === "POST" && path === "libraries/check") {
      yield* this.check();
      return yield* this.list();
    }
    if (method === "GET" && path === "libraries/blocked") return this.blockedEntries();
    const diff = /^libraries\/([^/]+)\/diff\/(.+)$/.exec(path);
    if (diff && method === "GET")
      return yield* this.entryDiff(yield* decodeId(diff[1]), yield* decodeId(diff[2]));
    const library = /^libraries\/([^/]+)$/.exec(path);
    if (library && (method === "PUT" || method === "DELETE")) {
      const id = yield* decodeId(library[1]);
      if (method === "PUT") return yield* this.enable(id, body as EnableSourceInput);
      yield* this.disable(id);
      return undefined;
    }
    const entry = /^compendium\/(overrides|blocked)\/(.+)$/.exec(path);
    if (entry) {
      const id = yield* decodeId(entry[2]);
      const sourceId = librarySource(id);
      if (!sourceId)
        return yield* Effect.fail(new CorpusInvalid({ message: "Expected a library entry id" }));
      if (entry[1] === "overrides" && method === "GET") return this.override(id) ?? null;
      if (entry[1] === "overrides" && method === "PUT")
        return yield* this.serial(this.saveOverride(id, body));
      if (method === "PUT" || method === "DELETE") {
        yield* this.serial(
          Effect.gen({ self: this }, function* () {
            const source = this.source(sourceId);
            if (method === "PUT" && (!source || !this.raw(id)))
              return yield* Effect.fail(new CorpusNotFound({ message: "Library entry not found" }));
            const raw = this.raw(id);
            const type =
              source && this.manifest(source).types.find((type) => type.id === raw?.typeId);
            const override = entry[1] === "overrides" ? undefined : this.override(id);
            const blocked = entry[1] === "blocked" ? method === "PUT" : this.blocked(id);
            const effective =
              raw && type && !blocked ? this.effective(raw, type, override) : undefined;
            const rev = yield* this.transactionSync(() => {
              if (entry[1] === "overrides")
                this.sql.exec("DELETE FROM entry_overrides WHERE entry_id = ?", id);
              else if (method === "PUT")
                this.sql.exec("INSERT OR IGNORE INTO entry_blocked (entry_id) VALUES (?)", id);
              else this.sql.exec("DELETE FROM entry_blocked WHERE entry_id = ?", id);
              return source
                ? this.compendium.updateSourceEntry(source.source_id, id, effective)
                : undefined;
            });
            if (rev !== undefined) this.compendium.notifySources(rev);
          }),
        );
        return undefined;
      }
    }
    return yield* Effect.fail(new CorpusNotFound({ message: "Not found" }));
  }, storageFailure);
}
