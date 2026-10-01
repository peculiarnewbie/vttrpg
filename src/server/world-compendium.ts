import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  CompendiumEntry,
  CompendiumPack,
  EntryBodiesInput,
  EntryType,
  IndexRow,
  SaveEntryInput,
  compendiumLimits,
  type IndexDelta,
  type PackEntry,
} from "../domain/compendium";
import { entryFacets } from "../domain/entry-facets";
import { entryError, packError, typeError } from "../domain/compendium-rules";
import {
  entryId,
  isEntryId,
  librarySource,
  parseEntryId,
  slugify,
  uniqueSlug,
  WORLD_SOURCE,
} from "../domain/entry-id";
import type { ClientFrame } from "../domain/schemas";
import { BadRequest, Conflict, Forbidden, NotFound, Unavailable, type ApiError } from "./services";
import { WorldStorage, WorldBucket, Broadcast, WorldId } from "./world-rpc";
import { nowIso } from "./crypto";

type CompendiumTypeRow = {
  id: string;
  name: string;
  plural: string | null;
  fields: string;
  filters: string | null;
  position: number;
};

type CompendiumIndexRow = {
  id: string;
  type_id: string;
  name: string;
  tags: string;
  visibility: string;
  updated_at: string;
  rev: number;
  facets: string | null;
  licence?: string | null;
  source_id: string | null;
};
type CompendiumEntryRow = CompendiumIndexRow & {
  body: string;
  fields: string;
};

const indexColumns = "id, type_id, name, tags, visibility, updated_at, rev, facets";
const normalize = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
const nameWords = (text: string) =>
  normalize(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join(" ");
const storageFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catchDefect((cause) =>
      Effect.logError(cause).pipe(
        Effect.andThen(
          Effect.fail(new Unavailable({ message: "Library operation is temporarily unavailable" })),
        ),
      ),
    ),
  );
const storageIO = <A>(operation: () => A) =>
  Effect.try({ try: operation, catch: (cause) => cause }).pipe(
    Effect.catch((cause) =>
      Effect.logError(cause).pipe(
        Effect.andThen(
          Effect.fail(new Unavailable({ message: "Library operation is temporarily unavailable" })),
        ),
      ),
    ),
  );
const BodiesInput = Schema.Struct({
  ids: EntryBodiesInput.fields.ids.check(Schema.isMaxLength(compendiumLimits.bodiesPerRequest)),
});
const decode = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  body: unknown,
  message: string,
) =>
  Schema.decodeUnknownEffect(schema)(body).pipe(Effect.mapError(() => new BadRequest({ message })));
const parse = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};
export const compatibleType = (left: EntryType | undefined, right: EntryType): boolean => {
  const canonical = (_key: string, value: unknown): unknown =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value;
  return (
    !!left &&
    JSON.stringify([left.fields, left.filters ?? []], canonical) ===
      JSON.stringify([right.fields, right.filters ?? []], canonical)
  );
};
const indexValue = (row: CompendiumIndexRow) => ({
  id: row.id,
  typeId: row.type_id,
  name: row.name,
  tags: parse<unknown>(row.tags, undefined),
  visibility: row.visibility,
  rev: row.rev,
  updatedAt: row.updated_at,
  facets: parse<unknown>(row.facets, undefined),
});
const toIndex = (row: CompendiumIndexRow): IndexRow[] => {
  const decoded = Schema.decodeUnknownResult(IndexRow)(indexValue(row));
  return decoded._tag === "Success" ? [decoded.success] : [];
};
const toEntry = (row: CompendiumEntryRow): CompendiumEntry[] => {
  const decoded = Schema.decodeUnknownResult(CompendiumEntry)({
    ...indexValue(row),
    body: row.body,
    fields: parse<unknown>(row.fields, undefined),
    licence: parse<unknown>(row.licence ?? null, undefined),
  });
  return decoded._tag === "Success" ? [decoded.success] : [];
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const entryKeys = (layout: unknown): string[] => {
  if (Array.isArray(layout)) return layout.flatMap(entryKeys);
  if (!isRecord(layout)) return [];
  return [
    ...(layout.type === "entry" && typeof layout.key === "string" ? [layout.key] : []),
    ...Object.values(layout).flatMap(entryKeys),
  ];
};
const rewriteRows = (value: unknown, aliases: ReadonlyMap<string, string>): unknown => {
  if (Array.isArray(value))
    return value.map((item) => {
      const rewritten = rewriteRows(item, aliases);
      if (isRecord(rewritten) && typeof rewritten._entry === "string")
        rewritten._entry = aliases.get(rewritten._entry) ?? rewritten._entry;
      return rewritten;
    });
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, rewriteRows(item, aliases)]),
  );
};

export interface CompendiumSources {
  readonly available: boolean;
  resolve(id: string, role: string): Effect.Effect<CompendiumEntry | undefined, ApiError>;
  bodies(
    ids: readonly string[],
    role: string,
  ): Effect.Effect<ReadonlyMap<string, CompendiumEntry>, ApiError>;
  ownsType(id: string): boolean;
  exportEntries(): Effect.Effect<CompendiumEntry[], ApiError>;
  prepareImport(entries: readonly PackEntry[]): Effect.Effect<PreparedSourceImport, ApiError>;
}

export type PreparedSourceImport = { apply: (rev: number) => void };

export class WorldCompendium {
  private sources?: CompendiumSources;

  setSources(sources: CompendiumSources) {
    this.sources = sources;
  }

  sourceTypes(): EntryType[] {
    return this.types();
  }

  /** Caller holds the transaction encompassing source metadata and index changes. */
  replaceSourceRows(
    sourceId: string,
    rows: readonly IndexRow[],
    types: readonly EntryType[],
  ): number {
    return this.writeSourceRows(sourceId, rows, types);
  }

  /** The caller writes the world layer and its effective row in the same transaction. */
  updateSourceEntry(sourceId: string, id: string, row?: IndexRow, rev?: number): number {
    return this.writeSourceRows(sourceId, row ? [row] : [], [], id, rev);
  }

  private writeSourceRows(
    sourceId: string,
    rows: readonly IndexRow[],
    types: readonly EntryType[],
    id?: string,
    revision?: number,
  ): number {
    const rev = revision ?? this.bump();
    const next = new Set(rows.map((row) => row.id));
    const previous = this.sql
      .exec<CompendiumIndexRow & { source_rev: number }>(
        `SELECT * FROM compendium_entries WHERE source_id = ? ${id === undefined ? "" : "AND id = ?"}`,
        sourceId,
        ...(id === undefined ? [] : [id]),
      )
      .toArray();
    const byId = new Map(previous.map((row) => [row.id, row]));
    const removed = previous.filter((row) => !next.has(row.id));
    for (let start = 0; start < removed.length; start += 20) {
      const batch = removed.slice(start, start + 20);
      this.sql.exec(
        `INSERT INTO compendium_tombstones (id, rev, public, source_id) VALUES ${batch.map(() => "(?, ?, ?, ?)").join(",")}
        ON CONFLICT(id) DO UPDATE SET rev=excluded.rev, public=MAX(compendium_tombstones.public, excluded.public)`,
        ...batch.flatMap((row) => [row.id, rev, row.visibility === "public" ? 1 : 0, sourceId]),
      );
      this.sql.exec(
        `DELETE FROM compendium_entries WHERE id IN (${batch.map(() => "?").join(",")})`,
        ...batch.map((row) => row.id),
      );
    }
    if (removed.length) this.pruneTombstones();
    for (const type of types) this.writeCompendiumType(type);
    const changed = rows.filter((row) => {
      const old = byId.get(row.id);
      return (
        id !== undefined ||
        !old ||
        old.source_rev !== row.rev ||
        old.name !== row.name ||
        old.tags !== JSON.stringify(row.tags) ||
        old.visibility !== row.visibility ||
        old.updated_at !== row.updatedAt ||
        old.facets !== (row.facets ? JSON.stringify(row.facets) : null)
      );
    });
    for (let start = 0; start < changed.length; start += 6) {
      const batch = changed.slice(start, start + 6);
      this.sql.exec(
        `INSERT INTO compendium_entries (id, type_id, name, tags, body, fields, visibility, updated_at, rev, name_key, name_words, tags_key, text_key, facets, source_rev, source_id)
        VALUES ${batch.map(() => "(?, ?, ?, ?, '', '{}', ?, ?, ?, ?, ?, ?, '', ?, ?, ?)").join(",")}
        ON CONFLICT(id) DO UPDATE SET type_id=excluded.type_id, name=excluded.name, tags=excluded.tags, body='', fields='{}', visibility=excluded.visibility, updated_at=excluded.updated_at, rev=excluded.rev, name_key=excluded.name_key, name_words=excluded.name_words, tags_key=excluded.tags_key, text_key='', facets=excluded.facets, source_rev=excluded.source_rev, source_id=excluded.source_id`,
        ...batch.flatMap((row) => [
          row.id,
          row.typeId,
          row.name,
          JSON.stringify(row.tags),
          row.visibility,
          row.updatedAt,
          rev,
          normalize(row.name),
          nameWords(row.name),
          normalize(row.tags.join(" ")),
          row.facets ? JSON.stringify(row.facets) : null,
          row.rev,
          sourceId,
        ]),
      );
    }
    for (const row of changed) {
      const old = byId.get(row.id);
      if (row.visibility === "dm" && old?.visibility === "public")
        this.tombstone(row.id, rev, true);
    }
    const publicRows = changed.filter((row) => row.visibility === "public");
    for (let start = 0; start < publicRows.length; start += 50) {
      const batch = publicRows.slice(start, start + 50);
      this.sql.exec(
        `DELETE FROM compendium_tombstones WHERE id IN (${batch.map(() => "?").join(",")})`,
        ...batch.map((row) => row.id),
      );
    }
    return rev;
  }

  notifySources(rev: number) {
    this.updated(rev);
  }
  private fts = false;
  private rebuildFts = false;

  private constructor(
    private readonly storage: typeof WorldStorage.Service,
    private readonly bucket: typeof WorldBucket.Service,
    private readonly broadcast: typeof Broadcast.Service,
    private readonly worldId: typeof WorldId.Service,
  ) {}

  static make = Effect.gen(function* () {
    const storage = yield* WorldStorage;
    const bucket = yield* WorldBucket;
    const broadcast = yield* Broadcast;
    const worldId = yield* WorldId;
    return new WorldCompendium(storage, bucket, broadcast, worldId);
  });

  private get sql() {
    return this.storage.sql;
  }
  private transactionSync<T>(operation: () => T): T {
    return this.storage.transactionSync(operation);
  }

  migrate = () =>
    storageIO(() => {
      const sql = this.sql;
      sql.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('compendium_rev', '0')");
      sql.exec(`CREATE TABLE IF NOT EXISTS compendium_types (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, plural TEXT,
      fields TEXT NOT NULL, position INTEGER NOT NULL
    )`);
      sql.exec(`CREATE TABLE IF NOT EXISTS compendium_entries (
      id TEXT PRIMARY KEY, type_id TEXT NOT NULL, name TEXT NOT NULL,
      tags TEXT NOT NULL, body TEXT NOT NULL, fields TEXT NOT NULL,
      visibility TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
      if (
        !sql
          .exec<{ name: string }>("PRAGMA table_info(compendium_types)")
          .toArray()
          .some((row) => row.name === "filters")
      )
        sql.exec("ALTER TABLE compendium_types ADD COLUMN filters TEXT");
      const columns = new Set(
        sql
          .exec<{ name: string }>("PRAGMA table_info(compendium_entries)")
          .toArray()
          .map((row) => row.name),
      );
      for (const [name, ddl] of [
        ["rev", "INTEGER NOT NULL DEFAULT 0"],
        ["facets", "TEXT"],
        ["licence", "TEXT"],
        ["source_rev", "INTEGER"],
        ["source_id", "TEXT"],
        ["name_key", "TEXT NOT NULL DEFAULT ''"],
        ["name_words", "TEXT NOT NULL DEFAULT ''"],
        ["tags_key", "TEXT NOT NULL DEFAULT ''"],
        ["text_key", "TEXT NOT NULL DEFAULT ''"],
      ])
        if (!columns.has(name))
          sql.exec(`ALTER TABLE compendium_entries ADD COLUMN ${name} ${ddl}`);
      sql.exec("CREATE INDEX IF NOT EXISTS compendium_entries_type ON compendium_entries(type_id)");
      sql.exec(
        "CREATE INDEX IF NOT EXISTS compendium_entries_name ON compendium_entries(name_key)",
      );
      sql.exec("CREATE INDEX IF NOT EXISTS compendium_entries_rev ON compendium_entries(rev)");
      sql.exec(
        "CREATE INDEX IF NOT EXISTS compendium_entries_source ON compendium_entries(source_id)",
      );
      sql.exec(
        "CREATE TABLE IF NOT EXISTS compendium_tombstones (id TEXT PRIMARY KEY, rev INTEGER NOT NULL)",
      );
      sql.exec(
        "CREATE INDEX IF NOT EXISTS compendium_tombstones_rev ON compendium_tombstones(rev)",
      );
      if (
        !sql
          .exec<{ name: string }>("PRAGMA table_info(compendium_tombstones)")
          .toArray()
          .some((row) => row.name === "public")
      )
        sql.exec("ALTER TABLE compendium_tombstones ADD COLUMN public INTEGER NOT NULL DEFAULT 1");
      if (
        !sql
          .exec<{ name: string }>("PRAGMA table_info(compendium_tombstones)")
          .toArray()
          .some((row) => row.name === "source_id")
      )
        sql.exec("ALTER TABLE compendium_tombstones ADD COLUMN source_id TEXT");
      if (this.setting("compendium_source_ids") !== "1") {
        this.transactionSync(() => {
          for (const table of ["compendium_entries", "compendium_tombstones"]) {
            for (const row of sql.exec<{ id: string }>(`SELECT id FROM ${table}`).toArray())
              sql.exec(
                `UPDATE ${table} SET source_id = ? WHERE id = ?`,
                librarySource(row.id) ?? null,
                row.id,
              );
          }
          this.setting("compendium_source_ids", "1");
        });
      }
      sql.exec(
        "CREATE TABLE IF NOT EXISTS compendium_aliases (old_id TEXT PRIMARY KEY, new_id TEXT NOT NULL)",
      );
      // Include the tie breakers so LIMIT can stop an ordered index walk without a sort.
      sql.exec(
        "CREATE INDEX IF NOT EXISTS compendium_entries_search_name ON compendium_entries(name_key, name, id)",
      );
      // One- and two-character tag substrings cannot use trigram MATCH. Keep their
      // fallback scans off body pages and skip entries with no tags altogether.
      sql.exec(
        "CREATE INDEX IF NOT EXISTS compendium_entries_search_tags ON compendium_entries(tags_key) WHERE tags_key <> ''",
      );
      const hadFts =
        sql
          .exec(
            "SELECT name FROM sqlite_master WHERE name IN ('compendium_fts', 'compendium_tags_fts')",
          )
          .toArray().length === 2;
      const upgradeFts = this.setting("compendium_fts_version") !== "3" || !hadFts;
      try {
        this.transactionSync(() => {
          if (upgradeFts) {
            for (const trigger of ["insert", "delete", "update"])
              sql.exec(`DROP TRIGGER IF EXISTS compendium_fts_${trigger}`);
            sql.exec("DROP TABLE IF EXISTS compendium_fts");
            sql.exec("DROP TABLE IF EXISTS compendium_tags_fts");
          }
          sql.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS compendium_fts USING
          fts5(id UNINDEXED, name_words, tags_key, text_key, prefix = '2 3')`);
          // Names and tags keep substring matching, including inside a word ("sword" → Longsword).
          sql.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS compendium_tags_fts USING
          fts5(name_key, tags_key, tokenize = 'trigram')`);
          sql.exec(`CREATE TRIGGER IF NOT EXISTS compendium_fts_insert AFTER INSERT ON compendium_entries BEGIN
          INSERT INTO compendium_fts (rowid, id, name_words, tags_key, text_key)
            VALUES (new.rowid, new.id, new.name_words, new.tags_key, new.text_key);
          INSERT INTO compendium_tags_fts (rowid, name_key, tags_key) VALUES (new.rowid, new.name_key, new.tags_key); END`);
          sql.exec(`CREATE TRIGGER IF NOT EXISTS compendium_fts_delete AFTER DELETE ON compendium_entries BEGIN
          DELETE FROM compendium_fts WHERE rowid = old.rowid;
          DELETE FROM compendium_tags_fts WHERE rowid = old.rowid; END`);
          sql.exec(`CREATE TRIGGER IF NOT EXISTS compendium_fts_update AFTER UPDATE OF id, name_key, name_words, tags_key, text_key ON compendium_entries BEGIN
          DELETE FROM compendium_fts WHERE rowid = old.rowid;
          INSERT INTO compendium_fts (rowid, id, name_words, tags_key, text_key)
            VALUES (new.rowid, new.id, new.name_words, new.tags_key, new.text_key);
          DELETE FROM compendium_tags_fts WHERE rowid = old.rowid;
          INSERT INTO compendium_tags_fts (rowid, name_key, tags_key) VALUES (new.rowid, new.name_key, new.tags_key); END`);
        });
        this.fts = true;
        this.rebuildFts = upgradeFts;
      } catch {
        this.fts = false;
        this.rebuildFts = false;
      }
      this.setting("compendium_search_engine", this.fts ? "fts5" : "like");
    });

  private setting(key: string, value?: string): string | undefined {
    if (value !== undefined)
      this.sql.exec(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        key,
        value,
      );
    return this.sql
      .exec<{ value: string }>("SELECT value FROM settings WHERE key = ?", key)
      .toArray()[0]?.value;
  }
  private revision() {
    return Number(this.setting("compendium_rev") ?? 0);
  }
  private bump() {
    const rev = this.revision() + 1;
    this.setting("compendium_rev", String(rev));
    return rev;
  }
  private updated(rev: number) {
    this.broadcast({ type: "compendium.updated", rev });
  }

  /** Initialization holds the DO input gate: no character can be read or written between backup and rewrite. */
  ensureMigrated = Effect.fn("WorldCompendium.ensureMigrated")(function* (this: WorldCompendium) {
    const sql = this.sql;
    if (this.setting("compendium_ids") !== "2") {
      const compendium = this.list();
      const oldEntries = compendium.entries.filter((entry) => !isEntryId(entry.id));
      if (oldEntries.length) {
        const characters = sql
          .exec<{ id: string; template_id: string; data: string }>(
            "SELECT id, template_id, data FROM characters",
          )
          .toArray()
          .map((row) => ({ ...row, values: parse<unknown>(row.data, {}) }));
        // A failed backup aborts initialization, leaving the old world intact for the next start.
        yield* Effect.tryPromise({
          try: () =>
            this.bucket.put(
              `world/${this.worldId}/backups/compendium-${nowIso()}.json`,
              JSON.stringify({
                ...compendium,
                characters: characters.map((row) => ({
                  id: row.id,
                  values: row.values,
                })),
              }),
              { httpMetadata: { contentType: "application/json" } },
            ),
          catch: (cause) => cause,
        }).pipe(
          Effect.catch((cause) =>
            Effect.logError(cause).pipe(
              Effect.andThen(
                Effect.fail(
                  new Unavailable({ message: "Compendium backup is temporarily unavailable" }),
                ),
              ),
            ),
          ),
        );
        const taken = this.takenIds();
        const aliases = new Map(
          oldEntries.map((entry) => {
            const id = this.newEntryId(entry.typeId, entry.name, taken);
            taken.add(id);
            return [entry.id, id] as const;
          }),
        );
        const templates = new Map(
          sql
            .exec<{ id: string; layout: string | null }>("SELECT id, layout FROM templates")
            .toArray()
            .map((row) => [row.id, entryKeys(parse<unknown>(row.layout, undefined))]),
        );
        this.transactionSync(() => {
          const rev = this.bump();
          for (const entry of compendium.entries) {
            const id = aliases.get(entry.id) ?? entry.id;
            if (id !== entry.id) {
              sql.exec("DELETE FROM compendium_entries WHERE id = ?", entry.id);
              sql.exec(
                "INSERT INTO compendium_aliases (old_id, new_id) VALUES (?, ?)",
                entry.id,
                id,
              );
            }
            this.writeCompendiumEntry(
              { ...entry, id, rev },
              compendium.types.find((type) => type.id === entry.typeId),
            );
          }
          for (const character of characters) {
            const values = rewriteRows(character.values, aliases);
            if (isRecord(values))
              for (const key of templates.get(character.template_id) ?? []) {
                const value = values[key];
                if (typeof value === "string") values[key] = aliases.get(value) ?? value;
              }
            sql.exec(
              "UPDATE characters SET data = ? WHERE id = ?",
              JSON.stringify(values),
              character.id,
            );
          }
          this.setting("compendium_ids", "2");
          this.setting("compendium_search", "1");
        });
      } else this.setting("compendium_ids", "2");
    }
    if (this.setting("compendium_search") !== "1") {
      const compendium = this.list();
      this.transactionSync(() => {
        for (const entry of compendium.entries)
          this.writeCompendiumEntry(
            entry,
            compendium.types.find((type) => type.id === entry.typeId),
          );
        this.setting("compendium_search", "1");
      });
    }
    if (this.setting("compendium_facets") !== "1") {
      this.transactionSync(() => {
        const types = this.types();
        const filtered = types.filter((type) => type.filters?.length);
        if (filtered.length) {
          const rev = this.bump();
          for (const type of filtered) this.recomputeFacets(type, rev);
        }
        this.setting("compendium_facets", "1");
      });
    }
    if (this.rebuildFts) {
      this.transactionSync(() => {
        sql.exec("DELETE FROM compendium_fts");
        sql.exec(
          "INSERT INTO compendium_fts (rowid, id, name_words, tags_key, text_key) SELECT rowid, id, name_words, tags_key, text_key FROM compendium_entries",
        );
        sql.exec("DELETE FROM compendium_tags_fts");
        sql.exec(
          "INSERT INTO compendium_tags_fts (rowid, name_key, tags_key) SELECT rowid, name_key, tags_key FROM compendium_entries",
        );
        this.setting("compendium_fts_version", "3");
      });
      this.rebuildFts = false;
    }
  }, storageFailure);

  checkRequest = Effect.fn("WorldCompendium.checkRequest")(function* (
    this: WorldCompendium,
    request: Request,
    url: URL,
  ) {
    const read =
      (request.method === "GET" &&
        ["/internal/compendium", "/internal/compendium/index"].includes(url.pathname)) ||
      (request.method === "POST" && url.pathname === "/internal/compendium/bodies");
    if (
      url.pathname.startsWith("/internal/compendium") &&
      !read &&
      request.headers.get("x-ttrpg-role") !== "dm"
    )
      return yield* Effect.fail(
        new Forbidden({ message: "Only the DM can manage the compendium" }),
      );
    if (url.pathname === "/internal/compendium/import" && request.method === "POST") {
      const text = yield* Effect.tryPromise({
        try: () => request.clone().text(),
        catch: () => new BadRequest({ message: "Invalid compendium pack" }),
      });
      // Raw bytes include whitespace discarded by JSON decoding.
      if (new TextEncoder().encode(text).byteLength > compendiumLimits.packBytes)
        return yield* Effect.fail(new BadRequest({ message: "Pack JSON must be at most 4 MB" }));
    }
  });
  private types(): EntryType[] {
    return this.sql
      .exec<CompendiumTypeRow>("SELECT * FROM compendium_types ORDER BY position, id")
      .toArray()
      .flatMap((row) => {
        const decoded = Schema.decodeUnknownResult(EntryType)({
          id: row.id,
          name: row.name,
          plural: row.plural ?? undefined,
          fields: parse<unknown>(row.fields, undefined),
          filters: parse<unknown>(row.filters, undefined),
        });
        return decoded._tag === "Success" ? [decoded.success] : [];
      });
  }
  list(): { types: EntryType[]; entries: CompendiumEntry[] } {
    return {
      types: this.types(),
      entries: this.sql
        .exec<CompendiumEntryRow>(
          "SELECT * FROM compendium_entries WHERE source_id IS NULL ORDER BY updated_at DESC, id",
        )
        .toArray()
        .flatMap(toEntry),
    };
  }

  index(since: string | null, role: string): IndexDelta {
    const rev = this.revision();
    const requested = since === null || !/^\d+$/.test(since) ? 0 : Number(since);
    const full =
      (!this.sources?.available &&
        this.sql
          .exec(
            "SELECT id FROM compendium_entries WHERE source_id IS NOT NULL UNION ALL SELECT id FROM compendium_tombstones WHERE source_id IS NOT NULL LIMIT 1",
          )
          .toArray().length > 0) ||
      !Number.isSafeInteger(requested) ||
      requested <= 0 ||
      requested > rev ||
      requested < Number(this.setting("compendium_delta_floor") ?? 0);
    const after = full ? -1 : requested;
    const upserts = this.sql
      .exec<CompendiumIndexRow>(
        `SELECT ${indexColumns} FROM compendium_entries WHERE rev > ? ${this.sources?.available ? "" : "AND source_id IS NULL"} ${role === "dm" ? "" : "AND visibility = 'public'"}`,
        after,
      )
      .toArray()
      .flatMap(toIndex);
    const deletes = full
      ? []
      : this.sql
          .exec<{ id: string }>(
            `SELECT id FROM compendium_tombstones WHERE rev > ? ${this.sources?.available ? "" : "AND source_id IS NULL"} ${role === "dm" ? "" : "AND public = 1"}`,
            after,
          )
          .toArray()
          .map((row) => row.id);
    return { rev, full, types: this.types(), upserts, deletes };
  }
  private resolveId(id: string): string {
    return (
      this.sql
        .exec<{ new_id: string }>("SELECT new_id FROM compendium_aliases WHERE old_id = ?", id)
        .toArray()[0]?.new_id ?? id
    );
  }
  /** Resolve legacy ids and enforce entry visibility before handing content to rolls. */
  lookup = Effect.fn("WorldCompendium.lookup")(function* (
    this: WorldCompendium,
    id: string,
    role: string,
  ) {
    const row = this.sql
      .exec<CompendiumEntryRow>("SELECT * FROM compendium_entries WHERE id = ?", this.resolveId(id))
      .toArray()[0];
    if (!row || (role !== "dm" && row.visibility !== "public")) return undefined;
    if (row.source_id !== null && !this.sources?.available) return undefined;
    const entry =
      row.source_id !== null && this.sources
        ? yield* this.sources.resolve(row.id, role)
        : toEntry(row)[0];
    const type = entry && this.types().find((type) => type.id === entry.typeId);
    return entry && type ? { entry, type } : undefined;
  }, storageFailure);

  bodies = Effect.fn("WorldCompendium.bodies")(function* (
    this: WorldCompendium,
    input: EntryBodiesInput,
    role: string,
  ) {
    const aliases: Record<string, string> = {};
    const missing: string[] = [];
    const ids = new Set<string>();
    const entries: CompendiumEntry[] = [];
    const resolvedIds = input.ids.map((id) => this.resolveId(id));
    const libraries = this.sources?.available
      ? yield* this.sources.bodies(
          resolvedIds.filter((id) => librarySource(id) !== undefined),
          role,
        )
      : new Map<string, CompendiumEntry>();
    for (let i = 0; i < input.ids.length; i++) {
      const oldId = input.ids[i];
      const id = resolvedIds[i];
      const entry =
        librarySource(id) !== undefined ? libraries.get(id) : (yield* this.lookup(id, role))?.entry;
      if (!entry) {
        missing.push(oldId);
        continue;
      }
      if (oldId !== id) aliases[oldId] = id;
      if (!ids.has(id)) {
        ids.add(id);
        entries.push(entry);
      }
    }
    return { entries, missing, aliases };
  }, storageFailure);

  /**
   * Accent/case insensitive. All query words must match within the name, tags or text.
   * Rank exact name, name prefix, name word prefixes, tags, then text; ties by name.
   * FTS names use token prefixes rather than infix substrings. Without FTS, LIKE/
   * instr retains the legacy name substring tier below word prefixes.
   */
  search(frame: Extract<ClientFrame, { type: "search" }>, role: string): IndexRow[] {
    const query = normalize(frame.query);
    const words = query.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (query.length < 2 || !words.length || frame.typeIds?.length === 0) return [];
    const limit = Math.min(frame.limit ?? 20, compendiumLimits.searchResults);
    const params: (string | number)[] = [];
    const filters: string[] = [];
    if (!this.sources?.available) filters.push("source_id IS NULL");
    if (role !== "dm") filters.push("visibility = 'public'");
    if (frame.typeIds) {
      filters.push(`type_id IN (${frame.typeIds.map(() => "?").join(",")})`);
      params.push(...frame.typeIds);
    }
    const filter = filters.length ? `${filters.join(" AND ")} AND ` : "";
    const rows: IndexRow[] = [];
    const append = (
      match: string,
      bindings: (string | number)[],
      order = "name_key, name, id",
      orderedIndex = this.fts,
    ) => {
      if (rows.length === limit) return;
      const excluded = rows.map((row) => row.id);
      rows.push(
        ...this.sql
          .exec<CompendiumIndexRow>(
            `SELECT ${indexColumns} FROM compendium_entries ${orderedIndex ? "INDEXED BY compendium_entries_search_name" : ""}
              WHERE ${filter}${excluded.length ? `id NOT IN (${excluded.map(() => "?").join(",")}) AND ` : ""}
              (${match}) ORDER BY ${order} LIMIT ?`,
            ...params,
            ...excluded,
            ...bindings,
            limit - rows.length,
          )
          .toArray()
          .flatMap(toIndex),
      );
    };
    const prefixes = words.map((word) => `"${word}"*`).join(" AND ");
    if (this.fts) {
      // Small posting lists use rowid lookups and sort at most 128 candidates.
      // Broad matches walk the name index and stop at LIMIT, preserving global
      // alphabetical ties instead of truncating arbitrary FTS rowids.
      const candidateCount = (table: "compendium_fts" | "compendium_tags_fts", match: string) =>
        this.sql
          .exec<{ count: number }>(
            `SELECT COUNT(*) AS count FROM (SELECT rowid FROM ${table} WHERE ${table} MATCH ? LIMIT 129)`,
            match,
          )
          .toArray()[0]?.count ?? 0;
      const nameMatch = `name_words : (${prefixes})`;
      const textMatch = `text_key : (${prefixes})`;
      const nameCount = candidateCount("compendium_fts", nameMatch);
      if (nameCount) {
        // GLOB's literal prefix is optimized to a name_key index range. Escape
        // user wildcard characters; they are ordinary text, never query syntax.
        const glob = query.replace(/[?*[]/g, (char) => `[${char}]`) + "*";
        append("name_key = ?", [query]);
        append("name_key GLOB ?", [glob]);
        append(
          "rowid IN (SELECT rowid FROM compendium_fts WHERE compendium_fts MATCH ?)",
          [nameMatch],
          "name_key, name, id",
          nameCount > 128,
        );
      }
      if (rows.length === limit) return rows;
      // Trigram MATCH requires at least three code points. Short tag words use
      // instr, checked against any longer indexed words before the ordered walk.
      const longWords = words.filter((word) => Array.from(word).length >= 3);
      const trigrams = longWords.map((word) => `"${word}"`).join(" AND ");
      if (longWords.length === words.length) {
        // Inside a word: "sword" finds Longsword after the word-prefix matches.
        const substringMatch = `name_key : (${trigrams})`;
        const substringCount = candidateCount("compendium_tags_fts", substringMatch);
        if (substringCount)
          append(
            "rowid IN (SELECT rowid FROM compendium_tags_fts WHERE compendium_tags_fts MATCH ?)",
            [substringMatch],
            "name_key, name, id",
            substringCount > 128,
          );
        if (rows.length === limit) return rows;
      }
      const tagMatch = `tags_key : (${trigrams})`;
      const tagCondition = words.map(() => "instr(tags_key, ?) > 0").join(" AND ");
      const tagIds = longWords.length
        ? "SELECT rowid FROM compendium_tags_fts WHERE compendium_tags_fts MATCH ?"
        : `SELECT rowid FROM compendium_entries WHERE tags_key <> '' AND ${tagCondition}`;
      const tagBindings = longWords.length ? [tagMatch] : words;
      const tagCount = longWords.length
        ? candidateCount("compendium_tags_fts", tagMatch)
        : (this.sql
            .exec<{ count: number }>(
              `SELECT COUNT(*) AS count FROM (${tagIds} LIMIT 129)`,
              ...tagBindings,
            )
            .toArray()[0]?.count ?? 0);
      if (tagCount)
        append(
          `rowid IN (${tagIds})${longWords.length ? ` AND ${tagCondition}` : ""}`,
          [...tagBindings, ...(longWords.length ? words : [])],
          "name_key, name, id",
          tagCount > 128,
        );
      if (rows.length === limit) return rows;
      const textCount = candidateCount("compendium_fts", textMatch);
      if (textCount)
        append(
          "rowid IN (SELECT rowid FROM compendium_fts WHERE compendium_fts MATCH ?)",
          [textMatch],
          "name_key, name, id",
          textCount > 128,
        );
      return rows;
    }
    // Older SQLite builds keep a fully functional scan-based fallback.
    const nameMatch = words.map(() => "instr(name_key, ?) > 0").join(" AND ");
    const wordPrefix = words.map(() => "instr(' ' || name_words, ' ' || ?) > 0").join(" AND ");
    append(
      nameMatch,
      [...words, query, query, ...words],
      `CASE WHEN name_key = ? THEN 0 WHEN instr(name_key, ?) = 1 THEN 1 WHEN ${wordPrefix} THEN 2 ELSE 3 END, name_key, name, id`,
    );
    append(words.map(() => "instr(tags_key, ?) > 0").join(" AND "), words);
    append(
      words.map(() => "text_key LIKE ?").join(" AND "),
      words.map((word) => `%${word}%`),
    );
    return rows;
  }

  private takenIds(): Set<string> {
    return new Set(
      this.sql
        .exec<{ id: string }>(
          "SELECT id FROM compendium_entries UNION SELECT old_id AS id FROM compendium_aliases UNION SELECT new_id AS id FROM compendium_aliases",
        )
        .toArray()
        .map((row) => row.id),
    );
  }
  private newEntryId(typeId: string, name: string, taken: ReadonlySet<string>): string {
    return entryId(
      WORLD_SOURCE,
      typeId,
      uniqueSlug(slugify(name), (slug) => taken.has(entryId(WORLD_SOURCE, typeId, slug))),
    );
  }
  private writeCompendiumType(type: EntryType) {
    this.sql.exec(
      `INSERT INTO compendium_types (id, name, plural, fields, filters, position)
      VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM compendium_types))
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, plural = excluded.plural, fields = excluded.fields, filters = excluded.filters`,
      type.id,
      type.name,
      type.plural ?? null,
      JSON.stringify(type.fields),
      type.filters === undefined ? null : JSON.stringify(type.filters),
    );
  }
  private recomputeFacets(type: EntryType, rev: number) {
    const entries = this.sql
      .exec<CompendiumEntryRow>(
        "SELECT * FROM compendium_entries WHERE type_id = ? AND source_id IS NULL",
        type.id,
      )
      .toArray()
      .flatMap(toEntry);
    for (const entry of entries) {
      const facets = entryFacets(entry, type);
      this.sql.exec(
        "UPDATE compendium_entries SET facets = ?, rev = ? WHERE id = ?",
        facets === undefined ? null : JSON.stringify(facets),
        rev,
        entry.id,
      );
    }
  }

  private writeCompendiumEntry(entry: CompendiumEntry, type?: EntryType) {
    const previous = this.sql
      .exec<{ visibility: string }>(
        "SELECT visibility FROM compendium_entries WHERE id = ?",
        entry.id,
      )
      .toArray()[0];
    const text = (type?.fields ?? [])
      .filter((field) => field.kind === "text" || field.kind === "longtext")
      .map((field) => entry.fields[field.key])
      .filter((value) => typeof value === "string")
      .join(" ");
    const facets = type ? entryFacets(entry, type) : undefined;
    this.sql.exec(
      `INSERT INTO compendium_entries (id, type_id, name, tags, body, fields, visibility, updated_at, rev, name_key, name_words, tags_key, text_key, facets, licence, source_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, tags = excluded.tags, body = excluded.body,
      fields = excluded.fields, visibility = excluded.visibility, updated_at = excluded.updated_at,
      licence = excluded.licence, rev = excluded.rev, name_key = excluded.name_key, name_words = excluded.name_words, tags_key = excluded.tags_key, text_key = excluded.text_key, facets = excluded.facets, source_id = excluded.source_id`,
      entry.id,
      entry.typeId,
      entry.name,
      JSON.stringify(entry.tags),
      entry.body,
      JSON.stringify(entry.fields),
      entry.visibility,
      entry.updatedAt,
      entry.rev ?? 0,
      normalize(entry.name),
      nameWords(entry.name),
      normalize(entry.tags.join(" ")),
      normalize(`${entry.body} ${text}`),
      facets === undefined ? null : JSON.stringify(facets),
      entry.licence ? JSON.stringify(entry.licence) : null,
      librarySource(entry.id) ?? null,
    );
    if (entry.visibility === "dm" && previous?.visibility === "public")
      this.tombstone(entry.id, entry.rev ?? 0, true);
    else if (entry.visibility === "public")
      this.sql.exec("DELETE FROM compendium_tombstones WHERE id = ?", entry.id);
  }
  private tombstone(id: string, rev: number, publicEntry = true) {
    this.sql.exec(
      "INSERT INTO compendium_tombstones (id, rev, public, source_id) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET rev = excluded.rev, public = MAX(compendium_tombstones.public, excluded.public)",
      id,
      rev,
      publicEntry ? 1 : 0,
      librarySource(id) ?? null,
    );
    this.pruneTombstones();
  }
  private pruneTombstones() {
    const evicted = this.sql
      .exec<{ rev: number }>(
        "SELECT rev FROM compendium_tombstones ORDER BY rev DESC, id DESC LIMIT -1 OFFSET 20000",
      )
      .toArray();
    if (!evicted.length) return;
    this.setting(
      "compendium_delta_floor",
      String(
        Math.max(
          Number(this.setting("compendium_delta_floor") ?? 0),
          ...evicted.map((row) => row.rev),
        ),
      ),
    );
    this.sql.exec(
      "DELETE FROM compendium_tombstones WHERE id IN (SELECT id FROM compendium_tombstones ORDER BY rev DESC, id DESC LIMIT -1 OFFSET 20000)",
    );
  }

  handle = Effect.fn("WorldCompendium.handle")(function* (
    this: WorldCompendium,
    method: string,
    path: string,
    body: unknown,
    role: string,
    worldName: string,
    since: string | null = null,
  ) {
    if (method === "GET" && path === "compendium/index") return this.index(since, role);
    if (method === "POST" && path === "compendium/bodies") {
      const input = yield* decode(
        BodiesInput,
        body,
        `Request at most ${compendiumLimits.bodiesPerRequest} entry ids`,
      );
      return yield* this.bodies(input, role);
    }
    if (method === "GET" && path === "compendium") {
      const compendium = this.list();
      return {
        types: compendium.types,
        entries: compendium.entries.filter(
          (entry) => role === "dm" || entry.visibility === "public",
        ),
      };
    }
    if (role !== "dm")
      return yield* Effect.fail(
        new Forbidden({ message: "Only the DM can manage the compendium" }),
      );
    const sql = this.sql;
    const types = this.types();
    if (method === "GET" && path === "compendium/export") {
      const overrides = this.sources?.available ? yield* this.sources.exportEntries() : [];
      const pack: CompendiumPack = {
        format: "ttrpg-pack",
        version: 2,
        name: worldName,
        types,
        entries: [...this.list().entries, ...overrides].map(
          ({ updatedAt: _updatedAt, rev: _rev, ...entry }) => entry,
        ),
      };
      return pack;
    }
    const typeMatch = /^compendium\/types\/([^/]+)$/.exec(path);
    if (
      typeMatch &&
      (method === "PUT" || method === "DELETE") &&
      this.sources?.ownsType(typeMatch[1])
    )
      return yield* Effect.fail(
        new Conflict({ message: "Enabled library entry types cannot be edited in the world" }),
      );
    if (typeMatch && method === "PUT") {
      const type = yield* decode(EntryType, body, "Invalid entry type");
      if (type.id !== typeMatch[1])
        return yield* Effect.fail(new BadRequest({ message: "Type id must match the URL" }));
      const error = typeError(type, types);
      if (error) return yield* Effect.fail(new BadRequest({ message: error }));
      const rev = this.transactionSync(() => {
        const previous = types.find((candidate) => candidate.id === type.id);
        this.writeCompendiumType(type);
        const revision = this.bump();
        if (
          JSON.stringify(previous?.filters) !== JSON.stringify(type.filters) ||
          JSON.stringify(previous?.fields) !== JSON.stringify(type.fields)
        )
          this.recomputeFacets(type, revision);
        return revision;
      });
      this.updated(rev);
      return type;
    }
    if (typeMatch && method === "DELETE") {
      if (
        sql
          .exec("SELECT id FROM compendium_entries WHERE type_id = ? LIMIT 1", typeMatch[1])
          .toArray().length
      )
        return yield* Effect.fail(
          new Conflict({ message: "Delete this type's entries before deleting the type" }),
        );
      const rev = this.transactionSync(() => {
        sql.exec("DELETE FROM compendium_types WHERE id = ?", typeMatch[1]);
        return this.bump();
      });
      this.updated(rev);
      return undefined;
    }
    if (method === "POST" && path === "compendium/entries") {
      const input = yield* decode(SaveEntryInput, body, "Invalid entry data");
      const type = types.find((candidate) => candidate.id === input.typeId);
      if (!type)
        return yield* Effect.fail(
          new BadRequest({ message: `Unknown entry type: ${input.typeId}` }),
        );
      const id =
        input.id === undefined
          ? this.newEntryId(input.typeId, input.name, this.takenIds())
          : this.resolveId(input.id);
      const existing = sql
        .exec<CompendiumEntryRow>("SELECT * FROM compendium_entries WHERE id = ?", id)
        .toArray()[0];
      if (existing?.source_id != null || librarySource(id) !== undefined)
        return yield* Effect.fail(
          new Conflict({ message: "Use the library override editor for this entry" }),
        );
      if (input.id !== undefined && !existing)
        return yield* Effect.fail(new NotFound({ message: "Entry not found" }));
      if (existing && existing.type_id !== input.typeId)
        return yield* Effect.fail(
          new BadRequest({ message: "An entry cannot move between types" }),
        );
      if (
        input.id === undefined &&
        sql
          .exec<{ n: number }>(
            "SELECT COUNT(*) AS n FROM compendium_entries WHERE source_id IS NULL",
          )
          .one().n >= compendiumLimits.entries
      )
        return yield* Effect.fail(
          new BadRequest({ message: "A world can have at most 10000 entries" }),
        );
      const entry: CompendiumEntry = {
        ...input,
        id,
        updatedAt: nowIso(),
        rev: this.revision() + 1,
        licence: existing ? toEntry(existing)[0]?.licence : undefined,
      };
      const error = entryError(entry, type);
      if (error) return yield* Effect.fail(new BadRequest({ message: error }));
      this.transactionSync(() => {
        this.bump();
        this.writeCompendiumEntry(entry, type);
      });
      this.updated(entry.rev ?? 0);
      return entry;
    }
    const entryMatch = /^compendium\/entries\/(.+)$/.exec(path);
    if (entryMatch && method === "DELETE") {
      const decodedId = yield* Effect.try({
        try: () => decodeURIComponent(entryMatch[1]),
        catch: () => new BadRequest({ message: "Invalid encoded entry id" }),
      });
      const id = this.resolveId(decodedId);
      const previous = sql
        .exec<Pick<CompendiumEntryRow, "visibility" | "source_id">>(
          "SELECT visibility, source_id FROM compendium_entries WHERE id = ?",
          id,
        )
        .toArray()[0];
      if (previous?.source_id != null || librarySource(id) !== undefined)
        return yield* Effect.fail(
          new Conflict({ message: "Use the library blocklist for this entry" }),
        );
      const rev = this.transactionSync(() => {
        const revision = this.bump();
        sql.exec("DELETE FROM compendium_entries WHERE id = ?", id);
        this.tombstone(id, revision, previous?.visibility === "public");
        return revision;
      });
      this.updated(rev);
      return undefined;
    }
    if (method === "POST" && path === "compendium/import") {
      const pack = yield* decode(CompendiumPack, body, "Invalid compendium pack");
      const expectedRevision = this.revision();
      const sourceEntries: PackEntry[] = [];
      const localEntries: PackEntry[] = [];
      for (const item of pack.entries)
        (librarySource(item.id) === undefined ? localEntries : sourceEntries).push(item);
      // packError checks local entries; mixed packs also include library content in their limits.
      if (sourceEntries.length) {
        if (new TextEncoder().encode(JSON.stringify(pack)).byteLength > compendiumLimits.packBytes)
          return yield* Effect.fail(new BadRequest({ message: "Pack JSON must be at most 4 MB" }));
        if (pack.entries.length > compendiumLimits.entries)
          return yield* Effect.fail(
            new BadRequest({ message: "A pack can have at most 10000 entries" }),
          );
        if (new Set(pack.entries.map((item) => item.id)).size !== pack.entries.length)
          return yield* Effect.fail(
            new BadRequest({ message: "Pack contains duplicate entry ids" }),
          );
      }
      for (const item of sourceEntries) {
        if (
          parseEntryId(item.id)?.typeId !== item.typeId ||
          (item.sourceVersion ?? 0) < 1 ||
          (item.sourceRev ?? 0) < 1 ||
          !item.licence
        )
          return yield* Effect.fail(
            new BadRequest({
              message: "Library pack entries require valid identity, provenance and licence",
            }),
          );
      }
      if (sourceEntries.length && (pack.version !== 2 || !this.sources?.available))
        return yield* Effect.fail(
          new Conflict({
            message: "Enable the pack's libraries before importing version 2 library entries",
          }),
        );
      for (const type of pack.types) {
        const existingType = types.find((candidate) => candidate.id === type.id);
        if (this.sources?.ownsType(type.id) && !compatibleType(existingType, type))
          return yield* Effect.fail(
            new Conflict({ message: "Import cannot replace enabled library entry types" }),
          );
      }
      const error = packError({ ...pack, entries: localEntries }, types);
      if (error) return yield* Effect.fail(new BadRequest({ message: error }));
      const typeMap = new Map([...types, ...pack.types].map((type) => [type.id, type]));
      const existing = new Map(
        sql
          .exec<Pick<CompendiumEntryRow, "id" | "type_id" | "licence">>(
            "SELECT id, type_id, licence FROM compendium_entries WHERE source_id IS NULL",
          )
          .toArray()
          .map((row) => [row.id, row]),
      );
      const taken = this.takenIds();
      const aliases: [string, string][] = [];
      const entries: CompendiumEntry[] = [];
      const importedIds = new Set<string>();
      let created = 0;
      for (const item of localEntries) {
        let id = item.id;
        if (pack.version === 1) {
          id = this.resolveId(item.id);
          if (id === item.id && !existing.has(id)) {
            id = this.newEntryId(item.typeId, item.name, taken);
            aliases.push([item.id, id]);
          }
        }
        // Legacy aliases are stored by older versions and may resolve to a different type.
        if (pack.version === 1) {
          const parts = parseEntryId(id);
          if (!parts || parts.source !== WORLD_SOURCE || parts.typeId !== item.typeId)
            return yield* Effect.fail(
              new BadRequest({
                message: "Entry id must be world/<type>/<slug> and match its type",
              }),
            );
        }
        const storedLicence = existing.get(id)?.licence;
        const decodedLicence = Schema.decodeUnknownResult(CompendiumEntry.fields.licence)(
          parse<unknown>(storedLicence ?? null, undefined),
        );
        const rights = decodedLicence._tag === "Success" ? decodedLicence.success : undefined;
        if (rights && JSON.stringify(rights) !== JSON.stringify(item.licence))
          return yield* Effect.fail(
            new BadRequest({
              message: "Import must preserve the existing entry licence and attribution",
            }),
          );
        if (existing.has(id) && existing.get(id)?.type_id !== item.typeId)
          return yield* Effect.fail(
            new BadRequest({ message: "An entry cannot move between types" }),
          );
        if (pack.version === 1 && importedIds.has(id))
          return yield* Effect.fail(
            new BadRequest({ message: "Pack contains duplicate entry ids" }),
          );
        importedIds.add(id);
        taken.add(id);
        if (!existing.has(id)) created++;
        const entry = { ...item, id, updatedAt: nowIso(), rev: this.revision() + 1 };
        entries.push(entry);
      }
      if (existing.size + created > compendiumLimits.entries)
        return yield* Effect.fail(
          new BadRequest({ message: "A world can have at most 10000 entries" }),
        );
      const prepared =
        sourceEntries.length && this.sources
          ? yield* this.sources.prepareImport(sourceEntries)
          : undefined;
      // Corpus/R2 awaits permit edits; check before the uninterrupted SQLite transaction.
      if (this.revision() !== expectedRevision)
        return yield* Effect.fail(
          new Conflict({ message: "Compendium changed while importing; retry the import" }),
        );
      const rev = this.transactionSync(() => {
        const revision = this.bump();
        prepared?.apply(revision);
        for (const type of pack.types) {
          if (this.sources?.ownsType(type.id)) continue;
          const previous = types.find((candidate) => candidate.id === type.id);
          this.writeCompendiumType(type);
          if (
            JSON.stringify(previous?.filters) !== JSON.stringify(type.filters) ||
            JSON.stringify(previous?.fields) !== JSON.stringify(type.fields)
          )
            this.recomputeFacets(type, revision);
        }
        for (const entry of entries)
          this.writeCompendiumEntry({ ...entry, rev: revision }, typeMap.get(entry.typeId));
        for (const [oldId, newId] of aliases)
          sql.exec("INSERT INTO compendium_aliases (old_id, new_id) VALUES (?, ?)", oldId, newId);
        return revision;
      });
      this.updated(rev);
      return { types: pack.types.length, created, updated: pack.entries.length - created };
    }
    return yield* Effect.fail(new NotFound({ message: "Not found" }));
  }, storageFailure);
}
