import * as Schema from "effect/Schema";
import {
  CORPUS_API_VERSION,
  EnableSourceInput,
  type CorpusApi,
  type WorldLibraries,
  type WorldSource,
  type SourceUpdateSummary,
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
import { parseEntryId, WORLD_SOURCE } from "../domain/entry-id";
import {
  EntryOverride,
  SaveOverrideInput,
  applyOverride,
  overrideError,
} from "../domain/overrides";
import { inheritLicence, licenceError } from "../domain/licence";
import {
  decodeIndex,
  decodeBodies,
  snapshotFile,
  validateManifest,
  type SnapshotManifest,
  type SnapshotFile,
} from "../domain/snapshot";
import {
  CompendiumImportError,
  type WorldCompendium,
  type CompendiumSources,
  type PreparedSourceImport,
} from "./world-compendium";
import { nowIso } from "./crypto";

type Options = {
  sql: SqlStorage;
  transactionSync: <T>(f: () => T) => T;
  compendium: WorldCompendium;
  corpus?: CorpusApi;
  bucket?: R2Bucket;
  accountId: () => string;
};
type SourceRow = {
  source_id: string;
  version: number;
  mode: "pinned" | "follow";
  manifest: string;
  latest_version: number | null;
  update_json: string | null;
};
type RawRow = { id: string; source_id: string; row_json: string };
class SourceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const json = (value: unknown, status = 200) => Response.json(value, { status });
const compatibleType = (a: EntryType, b: EntryType) =>
  JSON.stringify(a.fields) === JSON.stringify(b.fields) &&
  JSON.stringify(a.filters ?? []) === JSON.stringify(b.filters ?? []);

/** World enablement never leaves this DO. Only manifests and compact indexes are stored here. */
export class WorldSources implements CompendiumSources {
  private readonly sql: SqlStorage;
  private readonly transactionSync: Options["transactionSync"];
  private readonly compendium: WorldCompendium;
  private readonly corpus?: CorpusApi;
  private readonly bucket?: R2Bucket;
  private readonly accountId: Options["accountId"];
  private pending: Promise<unknown> = Promise.resolve();

  constructor(options: Options) {
    this.sql = options.sql;
    this.transactionSync = options.transactionSync;
    this.compendium = options.compendium;
    this.corpus = options.corpus;
    this.bucket = options.bucket;
    this.accountId = options.accountId;
  }
  get available(): boolean {
    return Boolean(this.corpus && this.bucket);
  }
  get enabled(): boolean {
    return this.available;
  }
  migrate(): void {
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
  }
  private requireAvailable(): void {
    if (!this.available || !this.accountId())
      throw new SourceError(503, "Libraries are unavailable");
  }
  private call() {
    this.requireAvailable();
    return { apiVersion: CORPUS_API_VERSION, accountId: this.accountId() };
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(operation, operation);
    this.pending = next.catch(() => undefined);
    return next;
  }
  private source(sourceId: string): SourceRow | undefined {
    return this.sql
      .exec<SourceRow>("SELECT * FROM world_sources WHERE source_id = ?", sourceId)
      .toArray()[0];
  }
  private sources(): SourceRow[] {
    return this.sql.exec<SourceRow>("SELECT * FROM world_sources ORDER BY source_id").toArray();
  }
  private manifest(row: SourceRow): SnapshotManifest {
    return validateManifest(JSON.parse(row.manifest));
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
  async list(): Promise<WorldLibraries> {
    const available = await this.corpus!.listSources(this.call());
    return {
      available: available.filter((source) => source.latestVersion !== undefined),
      enabled: this.sources().map((row) => this.status(row)),
    };
  }
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
    return row ? Schema.decodeUnknownSync(EntryOverride)(JSON.parse(row.override_json)) : undefined;
  }
  private blocked(id: string): boolean {
    return (
      this.sql.exec("SELECT entry_id FROM entry_blocked WHERE entry_id = ?", id).toArray().length >
      0
    );
  }

  private async bytes(file: SnapshotFile): Promise<Uint8Array> {
    this.requireAvailable();
    // Never cache a resolved/overridden entry. Every read rechecks world permissions.
    const key = new Request(`https://corpus-cache.invalid/${file.key}?sha256=${file.sha256}`);
    const cache =
      typeof caches === "undefined"
        ? undefined
        : (caches as CacheStorage & { default: Cache }).default;
    let cached: Response | undefined;
    try {
      cached = await cache?.match(key);
    } catch {
      /* Cache unavailable: use R2. */
    }
    if (cached?.status === 404)
      throw new SourceError(503, "Library content is temporarily unavailable");
    let bytes: Uint8Array;
    if (cached?.ok) bytes = new Uint8Array(await cached.arrayBuffer());
    else {
      const object = await this.bucket!.get(file.key);
      if (!object) {
        try {
          await cache?.put(
            key,
            new Response(null, { status: 404, headers: { "cache-control": "max-age=60" } }),
          );
        } catch {
          /* Best effort. */
        }
        throw new SourceError(503, "Library content is temporarily unavailable");
      }
      if (object.size !== file.bytes)
        throw new SourceError(503, "Library snapshot integrity check failed");
      bytes = new Uint8Array(await object.arrayBuffer());
    }
    const actual = await snapshotFile(file.key, bytes);
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256)
      throw new SourceError(503, "Library snapshot integrity check failed");
    if (!cached?.ok) {
      try {
        await cache?.put(
          key,
          new Response(bytes.slice().buffer, {
            headers: { "cache-control": "public, max-age=31536000, immutable" },
          }),
        );
      } catch {
        /* Best effort. */
      }
    }
    return bytes;
  }
  private async indexes(manifest: SnapshotManifest): Promise<IndexRow[]> {
    const [publicRows, dmRows] = await Promise.all([
      this.bytes(manifest.publicIndex).then((bytes) => decodeIndex(bytes, "public")),
      this.bytes(manifest.dmIndex).then((bytes) => decodeIndex(bytes, "dm")),
    ]);
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
        throw new SourceError(503, "Invalid library snapshot index");
      ids.add(row.id);
      const filters = new Map(
        types.get(row.typeId)!.filters?.map((filter) => [filter.key, filter.kind]),
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
          throw new SourceError(503, "Invalid library snapshot facets");
      }
    }
    if (ids.size !== manifest.entryCount)
      throw new SourceError(503, "Invalid library snapshot entry count");
    return rows;
  }
  private validateTypes(manifest: SnapshotManifest): void {
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
                "SELECT id FROM compendium_entries WHERE type_id = ? AND (id GLOB 'world/*' OR id NOT LIKE '%/%') LIMIT 1",
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
        throw new SourceError(
          409,
          `Library entry type conflicts with the world's ${type.id} definition`,
        );
    }
    if (
      new Set([...existing, ...manifest.types].map((type) => type.id)).size > compendiumLimits.types
    )
      throw new SourceError(409, "A world can have at most 50 entry types");
  }
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
  private refresh(sourceId: string, types: readonly EntryType[]): number {
    const byType = new Map(types.map((type) => [type.id, type]));
    const blocked = new Set(
      this.sql
        .exec<{ entry_id: string }>("SELECT entry_id FROM entry_blocked")
        .toArray()
        .map((row) => row.entry_id),
    );
    const overrides = new Map(
      this.sql
        .exec<{ override_json: string }>("SELECT override_json FROM entry_overrides")
        .toArray()
        .map((row) => {
          const override = Schema.decodeUnknownSync(EntryOverride)(JSON.parse(row.override_json));
          return [override.entryId, override] as const;
        }),
    );
    const rows = this.rawRows(sourceId)
      .filter((row) => !blocked.has(row.id))
      .map((row) => this.effective(row, byType.get(row.typeId)!, overrides.get(row.id)));
    return this.compendium.replaceSourceRows(sourceId, rows, types);
  }
  private ingest(
    manifest: SnapshotManifest,
    rows: readonly IndexRow[],
    mode: "pinned" | "follow",
    latestVersion: number,
  ): WorldSource {
    this.validateTypes(manifest);
    const rev = this.transactionSync(() => {
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
      return this.refresh(manifest.sourceId, manifest.types);
    });
    this.compendium.notifySources(rev);
    return this.status(this.source(manifest.sourceId)!);
  }
  async enable(sourceId: string, input: EnableSourceInput): Promise<WorldSource> {
    return this.serial(async () => {
      const decoded = Schema.decodeUnknownResult(EnableSourceInput, { onExcessProperty: "error" })(
        input,
      );
      if (
        decoded._tag === "Failure" ||
        (input.version !== undefined && (!Number.isSafeInteger(input.version) || input.version < 1))
      )
        throw new SourceError(400, "Invalid library version or mode");
      const call = { ...this.call(), sourceId };
      const source = await this.corpus!.getSource(call);
      if (!source) throw new SourceError(404, "Library not found");
      const value =
        input.version === undefined
          ? await this.corpus!.getLatest(call)
          : await this.corpus!.getManifest({ ...call, version: input.version });
      if (!value) throw new SourceError(404, "Published library version not found");
      const manifest = validateManifest(value);
      if (
        manifest.sourceId !== sourceId ||
        manifest.systemId !== source.systemId ||
        (input.version !== undefined && manifest.version !== input.version)
      )
        throw new SourceError(503, "Library snapshot identity check failed");
      return this.ingest(
        manifest,
        await this.indexes(manifest),
        input.mode ?? "pinned",
        source.latestVersion ?? manifest.version,
      );
    });
  }
  async disable(sourceId: string): Promise<void> {
    return this.serial(async () => {
      this.requireAvailable();
      if (!/^[a-z0-9][a-z0-9_-]{0,59}$/.test(sourceId) || sourceId === WORLD_SOURCE)
        throw new SourceError(400, "Invalid library id");
      const rev = this.transactionSync(() => {
        this.sql.exec("DELETE FROM world_sources WHERE source_id = ?", sourceId);
        this.sql.exec("DELETE FROM source_index WHERE source_id = ?", sourceId);
        return this.compendium.replaceSourceRows(sourceId, [], []);
      });
      this.compendium.notifySources(rev);
    });
  }
  async check(): Promise<void> {
    return this.serial(async () => {
      this.requireAvailable();
      for (const source of this.sources()) {
        const latestValue = await this.corpus!.getLatest({
          ...this.call(),
          sourceId: source.source_id,
        });
        if (!latestValue) {
          const rev = this.transactionSync(() => {
            this.sql.exec("DELETE FROM world_sources WHERE source_id = ?", source.source_id);
            this.sql.exec("DELETE FROM source_index WHERE source_id = ?", source.source_id);
            return this.compendium.replaceSourceRows(source.source_id, [], []);
          });
          this.compendium.notifySources(rev);
          continue;
        }
        const latest = validateManifest(latestValue);
        if (
          latest.sourceId !== source.source_id ||
          latest.systemId !== this.manifest(source).systemId
        )
          throw new SourceError(503, "Library snapshot identity check failed");
        if (latest.version <= source.version) continue;
        if (
          source.mode === "pinned" &&
          latest.version === source.latest_version &&
          source.update_json !== null
        )
          continue;
        const rows = await this.indexes(latest);
        if (source.mode === "follow") this.ingest(latest, rows, "follow", latest.version);
        else {
          const before = new Map(this.rawRows(source.source_id).map((row) => [row.id, row]));
          const after = new Map(rows.map((row) => [row.id, row]));
          const update: SourceUpdateSummary = {
            fromVersion: source.version,
            toVersion: latest.version,
            added: rows.filter((row) => !before.has(row.id)).map((row) => row.id),
            changed: rows
              .filter(
                (row) =>
                  before.has(row.id) && JSON.stringify(before.get(row.id)) !== JSON.stringify(row),
              )
              .map((row) => row.id),
            removed: [...before.keys()].filter((id) => !after.has(id)),
          };
          this.sql.exec(
            "UPDATE world_sources SET latest_version = ?, update_json = ? WHERE source_id = ?",
            latest.version,
            JSON.stringify(update),
            source.source_id,
          );
        }
      }
    });
  }
  private async base(id: string): Promise<CompendiumEntry | undefined> {
    const parsed = parseEntryId(id);
    if (!parsed || parsed.source === WORLD_SOURCE) return undefined;
    const source = this.source(parsed.source);
    const row = this.raw(id);
    if (!source || !row) return undefined;
    const manifest = this.manifest(source);
    const chunk = manifest.bodyChunks.find((chunk) => chunk.ids.includes(id));
    if (!chunk) return undefined;
    const entries: CompendiumEntry[] = await decodeBodies(await this.bytes(chunk.file));
    if (entries.length !== chunk.ids.length)
      throw new SourceError(503, "Invalid library body chunk");
    const ids = new Set<string>();
    for (const entry of entries) {
      const indexed = this.raw(entry.id);
      const type = manifest.types.find((type) => type.id === entry.typeId);
      if (
        !chunk.ids.includes(entry.id) ||
        ids.has(entry.id) ||
        !indexed ||
        !type ||
        entry.typeId !== chunk.typeId ||
        entry.visibility !== chunk.visibility ||
        entry.rev !== indexed.rev ||
        entry.name !== indexed.name ||
        entry.updatedAt !== indexed.updatedAt ||
        JSON.stringify(entry.tags) !== JSON.stringify(indexed.tags) ||
        entryError({ ...entry, id: undefined }, type)
      )
        throw new SourceError(503, "Invalid library body entry");
      ids.add(entry.id);
    }
    if (this.source(parsed.source)?.version !== source.version) return undefined;
    const entry = entries.find((entry) => entry.id === id);
    return entry
      ? {
          ...entry,
          licence: inheritLicence(manifest.licence, entry.licence),
          sourceRev: row.rev,
          sourceVersion: source.version,
        }
      : undefined;
  }
  async resolve(id: string, role: string): Promise<CompendiumEntry | undefined> {
    this.requireAvailable();
    const visible = () =>
      this.sql
        .exec<{ rev: number; visibility: string }>(
          "SELECT rev, visibility FROM compendium_entries WHERE id = ?",
          id,
        )
        .toArray()[0];
    const before = visible();
    if (!before || this.blocked(id) || (role !== "dm" && before.visibility !== "public"))
      return undefined;
    const entry = await this.base(id);
    const after = visible();
    if (
      !entry ||
      !after ||
      before.rev !== after.rev ||
      this.blocked(id) ||
      (role !== "dm" && after.visibility !== "public")
    )
      return undefined;
    const override = this.override(id);
    const resolved = override ? applyOverride(entry, override) : entry;
    if (role !== "dm" && resolved.visibility !== "public") return undefined;
    return { ...resolved, rev: after.rev };
  }
  async exportEntries(): Promise<CompendiumEntry[]> {
    const rows = this.sql
      .exec<{ entry_id: string }>("SELECT entry_id FROM entry_overrides ORDER BY entry_id")
      .toArray();
    const entries: CompendiumEntry[] = [];
    for (const row of rows) {
      const entry = await this.resolve(row.entry_id, "dm");
      if (entry) entries.push(entry);
    }
    return entries;
  }
  /** Fetch and validate without mutations; apply runs inside the caller's SQLite transaction. */
  async prepareImport(entries: readonly PackEntry[]): Promise<PreparedSourceImport> {
    this.requireAvailable();
    const prepared: {
      sourceId: string;
      sourceVersion: number;
      sourceRev: number;
      override: EntryOverride;
    }[] = [];
    for (const item of entries) {
      const id = parseEntryId(item.id);
      if (!id || id.source === WORLD_SOURCE || id.typeId !== item.typeId)
        throw new CompendiumImportError(400, "Invalid library entry identity in pack");
      if (
        !Number.isSafeInteger(item.sourceVersion) ||
        !Number.isSafeInteger(item.sourceRev) ||
        (item.sourceVersion ?? 0) < 1 ||
        (item.sourceRev ?? 0) < 1
      )
        throw new CompendiumImportError(
          400,
          "Library pack entries require sourceVersion and sourceRev",
        );
      const source = this.source(id.source);
      const row = this.raw(item.id);
      if (!source || !row || source.version !== item.sourceVersion || row.rev !== item.sourceRev)
        throw new CompendiumImportError(
          409,
          "Enable the pack's library version and review changed entries before importing",
        );
      const base = await this.base(item.id);
      if (!base || base.sourceVersion !== item.sourceVersion || base.sourceRev !== item.sourceRev)
        throw new CompendiumImportError(
          409,
          "Library changed while importing; retry after reviewing its version",
        );
      const licence = item.licence;
      if (licence) {
        const issue = licenceError(licence);
        if (issue) throw new CompendiumImportError(400, issue);
      }
      const previous = this.override(item.id);
      const rights = inheritLicence(base.licence!, previous?.licence);
      if (
        !licence ||
        licence.id !== rights.id ||
        licence.name !== rights.name ||
        licence.url !== rights.url ||
        (rights.shareAlike && !licence.shareAlike) ||
        !licence.attribution.includes(rights.attribution)
      )
        throw new CompendiumImportError(
          400,
          "Import must preserve the library licence, share-alike and source attribution",
        );
      if (base.visibility === "dm" && item.visibility === "public")
        throw new CompendiumImportError(400, "Import cannot reveal a DM-only library entry");
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
        baseRev: item.sourceRev!,
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
      if (issue) throw new CompendiumImportError(400, issue);
      const type = this.manifest(source).types.find((type) => type.id === item.typeId)!;
      const error = entryError({ ...applyOverride(base, override), id: undefined }, type);
      if (error) throw new CompendiumImportError(400, error);
      prepared.push({
        sourceId: id.source,
        sourceVersion: item.sourceVersion!,
        sourceRev: item.sourceRev!,
        override,
      });
    }
    return {
      apply: () => {
        // Check every source before writing any override; the enclosing transaction also rolls back locals.
        for (const item of prepared) {
          if (
            this.source(item.sourceId)?.version !== item.sourceVersion ||
            this.raw(item.override.entryId)?.rev !== item.sourceRev
          )
            throw new CompendiumImportError(
              409,
              "Library changed while importing; retry after reviewing its version",
            );
        }
        for (const item of prepared)
          this.sql.exec(
            "INSERT INTO entry_overrides (entry_id, override_json) VALUES (?, ?) ON CONFLICT(entry_id) DO UPDATE SET override_json=excluded.override_json",
            item.override.entryId,
            JSON.stringify(item.override),
          );
        for (const sourceId of new Set(prepared.map((item) => item.sourceId)))
          this.refresh(sourceId, this.manifest(this.source(sourceId)!).types);
      },
    };
  }
  private async saveOverride(id: string, body: unknown): Promise<EntryOverride> {
    const decoded = Schema.decodeUnknownResult(SaveOverrideInput, { onExcessProperty: "error" })(
      body,
    );
    if (decoded._tag === "Failure") throw new SourceError(400, "Invalid entry override");
    const input = decoded.success;
    const issue = overrideError(input.patch);
    if (issue || !Number.isSafeInteger(input.baseRev) || input.baseRev < 1)
      throw new SourceError(400, issue ?? "Invalid base revision");
    const base = await this.base(id);
    if (!base) throw new SourceError(404, "Library entry not found");
    if (base.sourceRev !== input.baseRev)
      throw new SourceError(409, "Library entry changed; review its current version before saving");
    if (base.visibility === "dm" && input.patch.visibility === "public")
      throw new SourceError(400, "A DM-only library entry cannot be revealed by an override");
    const override: EntryOverride = {
      entryId: id,
      baseRev: input.baseRev,
      patch: input.patch,
      licence: base.licence!,
      updatedAt: nowIso(),
    };
    const source = this.source(parseEntryId(id)!.source)!;
    const type = this.manifest(source).types.find((type) => type.id === base.typeId)!;
    const error = entryError({ ...applyOverride(base, override), id: undefined }, type);
    if (error) throw new SourceError(400, error);
    const rev = this.transactionSync(() => {
      this.sql.exec(
        "INSERT INTO entry_overrides (entry_id, override_json) VALUES (?, ?) ON CONFLICT(entry_id) DO UPDATE SET override_json=excluded.override_json",
        id,
        JSON.stringify(override),
      );
      return this.refresh(source.source_id, this.manifest(source).types);
    });
    this.compendium.notifySources(rev);
    return override;
  }
  async handle(method: string, path: string, body: unknown, role: string): Promise<Response> {
    if (role !== "dm") return json({ error: "Only the DM can manage libraries" }, 403);
    try {
      this.requireAvailable();
      if (method === "GET" && path === "libraries") return json(await this.list());
      if (method === "POST" && path === "libraries/check") {
        await this.check();
        return json(await this.list());
      }
      if (method === "GET" && path === "libraries/blocked")
        return json({
          ids: this.sql
            .exec<{ entry_id: string }>("SELECT entry_id FROM entry_blocked ORDER BY entry_id")
            .toArray()
            .map((row) => row.entry_id),
        });
      const library = /^libraries\/([^/]+)$/.exec(path);
      if (library && (method === "PUT" || method === "DELETE")) {
        const id = decodeURIComponent(library[1]);
        if (!/^[a-z0-9][a-z0-9_-]{0,59}$/.test(id) || id === WORLD_SOURCE)
          throw new SourceError(400, "Invalid library id");
        if (method === "PUT") return json(await this.enable(id, body as EnableSourceInput));
        await this.disable(id);
        return new Response(null, { status: 204 });
      }
      const entry = /^compendium\/(overrides|blocked)\/(.+)$/.exec(path);
      if (entry) {
        const id = decodeURIComponent(entry[2]);
        const parsed = parseEntryId(id);
        if (!parsed || parsed.source === WORLD_SOURCE)
          throw new SourceError(400, "Expected a library entry id");
        if (entry[1] === "overrides" && method === "GET") return json(this.override(id) ?? null);
        if (entry[1] === "overrides" && method === "PUT")
          return json(await this.serial(() => this.saveOverride(id, body)));
        if (method === "PUT" || method === "DELETE") {
          await this.serial(async () => {
            const source = this.source(parsed.source);
            if (method === "PUT" && (!source || !this.raw(id)))
              throw new SourceError(404, "Library entry not found");
            const rev = this.transactionSync(() => {
              if (entry[1] === "overrides")
                this.sql.exec("DELETE FROM entry_overrides WHERE entry_id = ?", id);
              else if (method === "PUT")
                this.sql.exec("INSERT OR IGNORE INTO entry_blocked (entry_id) VALUES (?)", id);
              else this.sql.exec("DELETE FROM entry_blocked WHERE entry_id = ?", id);
              return source
                ? this.refresh(source.source_id, this.manifest(source).types)
                : undefined;
            });
            if (rev !== undefined) this.compendium.notifySources(rev);
          });
          return new Response(null, { status: 204 });
        }
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      if (error instanceof SourceError) return json({ error: error.message }, error.status);
      if (error instanceof URIError) return json({ error: "Invalid encoded entry id" }, 400);
      // RPC, malformed manifests and storage errors must not disclose source internals.
      return json({ error: "Library operation is temporarily unavailable" }, 503);
    }
  }
}
