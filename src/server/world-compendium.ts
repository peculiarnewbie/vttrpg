import * as Schema from "effect/Schema";
import {
  CompendiumEntry,
  CompendiumPack,
  EntryBodiesInput,
  EntryType,
  IndexRow,
  SaveEntryInput,
  compendiumLimits,
  type EntryBodies,
  type IndexDelta,
  type PackEntry,
} from "../domain/compendium";
import { entryFacets } from "../domain/entry-facets";
import { entryError, packError, typeError } from "../domain/compendium-rules";
import { licenceError } from "../domain/licence";
import {
  entryId,
  isEntryId,
  parseEntryId,
  slugify,
  uniqueSlug,
  WORLD_SOURCE,
} from "../domain/entry-id";
import type { ClientFrame, ServerFrame } from "../domain/schemas";
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
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
const parse = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};
const sameType = (left: EntryType | undefined, right: EntryType): boolean => {
  const canonical = (_key: string, value: unknown): unknown =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value;
  return JSON.stringify(left, canonical) === JSON.stringify(right, canonical);
};
const toIndex = (row: CompendiumIndexRow): IndexRow[] => {
  const decoded = Schema.decodeUnknownResult(IndexRow)({
    id: row.id,
    typeId: row.type_id,
    name: row.name,
    tags: parse<unknown>(row.tags, undefined),
    visibility: row.visibility,
    rev: row.rev,
    updatedAt: row.updated_at,
    facets: parse<unknown>(row.facets, undefined),
  });
  return decoded._tag === "Success" ? [decoded.success] : [];
};
const toEntry = (row: CompendiumEntryRow): CompendiumEntry[] => {
  const decoded = Schema.decodeUnknownResult(CompendiumEntry)({
    ...toIndex(row)[0],
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

type WorldCompendiumOptions = {
  sql: SqlStorage;
  broadcast: (frame: ServerFrame) => void;
  transactionSync: DurableObjectStorage["transactionSync"];
  bucket: R2Bucket;
  worldId: string;
};

export interface CompendiumSources {
  readonly available: boolean;
  resolve(id: string, role: string): Promise<CompendiumEntry | undefined>;
  ownsType(id: string): boolean;
  exportEntries(): Promise<CompendiumEntry[]>;
  prepareImport(entries: readonly PackEntry[]): Promise<PreparedSourceImport>;
}

export type PreparedSourceImport = { apply: () => void };
export class CompendiumImportError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

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
    const rev = this.bump();
    const next = new Set(rows.map((row) => row.id));
    const previous = this.sql
      .exec<CompendiumIndexRow & { source_rev: number }>(
        "SELECT * FROM compendium_entries WHERE id GLOB ?",
        `${sourceId}/*`,
      )
      .toArray();
    const byId = new Map(previous.map((row) => [row.id, row]));
    const removed = previous.filter((row) => !next.has(row.id));
    for (let start = 0; start < removed.length; start += 20) {
      const batch = removed.slice(start, start + 20);
      this.sql.exec(
        `INSERT INTO compendium_tombstones (id, rev, public) VALUES ${batch.map(() => "(?, ?, ?)").join(",")}
        ON CONFLICT(id) DO UPDATE SET rev=excluded.rev, public=MAX(compendium_tombstones.public, excluded.public)`,
        ...batch.flatMap((row) => [row.id, rev, row.visibility === "public" ? 1 : 0]),
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
        `INSERT INTO compendium_entries (id, type_id, name, tags, body, fields, visibility, updated_at, rev, name_key, name_words, tags_key, text_key, facets, source_rev)
        VALUES ${batch.map(() => "(?, ?, ?, ?, '', '{}', ?, ?, ?, ?, ?, ?, '', ?, ?)").join(",")}
        ON CONFLICT(id) DO UPDATE SET type_id=excluded.type_id, name=excluded.name, tags=excluded.tags, body='', fields='{}', visibility=excluded.visibility, updated_at=excluded.updated_at, rev=excluded.rev, name_key=excluded.name_key, name_words=excluded.name_words, tags_key=excluded.tags_key, text_key='', facets=excluded.facets, source_rev=excluded.source_rev`,
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
  private readonly sql: SqlStorage;
  private readonly broadcast: WorldCompendiumOptions["broadcast"];
  private readonly transactionSync: WorldCompendiumOptions["transactionSync"];
  private readonly bucket: R2Bucket;
  private readonly worldId: string;
  private fts = false;
  private rebuildFts = false;

  constructor({ sql, broadcast, transactionSync, bucket, worldId }: WorldCompendiumOptions) {
    this.sql = sql;
    this.broadcast = broadcast;
    this.transactionSync = transactionSync;
    this.bucket = bucket;
    this.worldId = worldId;
  }

  migrate() {
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
      ["name_key", "TEXT NOT NULL DEFAULT ''"],
      ["name_words", "TEXT NOT NULL DEFAULT ''"],
      ["tags_key", "TEXT NOT NULL DEFAULT ''"],
      ["text_key", "TEXT NOT NULL DEFAULT ''"],
    ])
      if (!columns.has(name)) sql.exec(`ALTER TABLE compendium_entries ADD COLUMN ${name} ${ddl}`);
    sql.exec("CREATE INDEX IF NOT EXISTS compendium_entries_type ON compendium_entries(type_id)");
    sql.exec("CREATE INDEX IF NOT EXISTS compendium_entries_name ON compendium_entries(name_key)");
    sql.exec("CREATE INDEX IF NOT EXISTS compendium_entries_rev ON compendium_entries(rev)");
    sql.exec(
      "CREATE TABLE IF NOT EXISTS compendium_tombstones (id TEXT PRIMARY KEY, rev INTEGER NOT NULL)",
    );
    sql.exec("CREATE INDEX IF NOT EXISTS compendium_tombstones_rev ON compendium_tombstones(rev)");
    if (
      !sql
        .exec<{ name: string }>("PRAGMA table_info(compendium_tombstones)")
        .toArray()
        .some((row) => row.name === "public")
    )
      sql.exec("ALTER TABLE compendium_tombstones ADD COLUMN public INTEGER NOT NULL DEFAULT 1");
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
  }

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
  async ensureMigrated(): Promise<void> {
    const sql = this.sql;
    if (this.setting("compendium_ids") !== "2") {
      const compendium = this.list();
      const oldEntries = compendium.entries.filter((entry) => !isEntryId(entry.id));
      if (oldEntries.length) {
        const characters = sql
          .exec<{ id: string; template_id: string; data: string }>(
            "SELECT id, template_id, data FROM characters",
          )
          .toArray();
        // A failed backup aborts initialization, leaving the old world intact for the next start.
        await this.bucket.put(
          `world/${this.worldId}/backups/compendium-${nowIso()}.json`,
          JSON.stringify({
            ...compendium,
            characters: characters.map((row) => ({
              id: row.id,
              values: parse<unknown>(row.data, {}),
            })),
          }),
          { httpMetadata: { contentType: "application/json" } },
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
            const values = rewriteRows(parse<unknown>(character.data, {}), aliases);
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
  }

  checkRequest(request: Request, url: URL): Response | Promise<Response | undefined> | undefined {
    const read =
      (request.method === "GET" &&
        ["/internal/compendium", "/internal/compendium/index"].includes(url.pathname)) ||
      (request.method === "POST" && url.pathname === "/internal/compendium/bodies");
    if (
      url.pathname.startsWith("/internal/compendium") &&
      !read &&
      request.headers.get("x-ttrpg-role") !== "dm"
    )
      return json({ error: "Only the DM can manage the compendium" }, 403);
    if (url.pathname === "/internal/compendium/import" && request.method === "POST")
      return this.checkPackSize(request);
  }
  private async checkPackSize(request: Request): Promise<Response | undefined> {
    if (
      new TextEncoder().encode(await request.clone().text()).byteLength > compendiumLimits.packBytes
    )
      return json({ error: "Pack JSON must be at most 4 MB" }, 400);
  }
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
          "SELECT * FROM compendium_entries WHERE source_rev IS NULL ORDER BY updated_at DESC, id",
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
            "SELECT id FROM compendium_entries WHERE id NOT GLOB 'world/*' AND id LIKE '%/%' UNION ALL SELECT id FROM compendium_tombstones WHERE id NOT GLOB 'world/*' AND id LIKE '%/%' LIMIT 1",
          )
          .toArray().length > 0) ||
      !Number.isSafeInteger(requested) ||
      requested <= 0 ||
      requested > rev ||
      requested < Number(this.setting("compendium_delta_floor") ?? 0);
    const after = full ? -1 : requested;
    const upserts = this.sql
      .exec<CompendiumIndexRow>(
        `SELECT ${indexColumns} FROM compendium_entries WHERE rev > ? ${this.sources?.available ? "" : "AND (id GLOB 'world/*' OR id NOT LIKE '%/%')"} ${role === "dm" ? "" : "AND visibility = 'public'"}`,
        after,
      )
      .toArray()
      .flatMap(toIndex);
    const deletes = full
      ? []
      : this.sql
          .exec<{ id: string }>(
            `SELECT id FROM compendium_tombstones WHERE rev > ? ${this.sources?.available ? "" : "AND (id GLOB 'world/*' OR id NOT LIKE '%/%')"} ${role === "dm" ? "" : "AND public = 1"}`,
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
  async lookup(
    id: string,
    role: string,
  ): Promise<{ entry: CompendiumEntry; type: EntryType } | undefined> {
    const row = this.sql
      .exec<CompendiumEntryRow>("SELECT * FROM compendium_entries WHERE id = ?", this.resolveId(id))
      .toArray()[0];
    if (!row || (role !== "dm" && row.visibility !== "public")) return undefined;
    if (
      isEntryId(row.id) &&
      parseEntryId(row.id)?.source !== WORLD_SOURCE &&
      !this.sources?.available
    )
      return undefined;
    const entry =
      isEntryId(row.id) && parseEntryId(row.id)?.source !== WORLD_SOURCE
        ? await this.sources?.resolve(row.id, role)
        : toEntry(row)[0];
    const current = this.sql
      .exec<{ rev: number; visibility: string }>(
        "SELECT rev, visibility FROM compendium_entries WHERE id = ?",
        row.id,
      )
      .toArray()[0];
    if (!current || current.rev !== row.rev || (role !== "dm" && current.visibility !== "public"))
      return undefined;
    const type = entry && this.types().find((type) => type.id === entry.typeId);
    return entry && type ? { entry, type } : undefined;
  }

  async bodies(input: EntryBodiesInput, role: string): Promise<EntryBodies> {
    const aliases: Record<string, string> = {};
    const missing: string[] = [];
    const ids = new Set<string>();
    const entries: CompendiumEntry[] = [];
    for (const oldId of input.ids) {
      const id = this.resolveId(oldId);
      const entry = (await this.lookup(id, role))?.entry;
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
  }

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
    if (!this.sources?.available) filters.push("(id GLOB 'world/*' OR id NOT LIKE '%/%')");
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
        "SELECT * FROM compendium_entries WHERE type_id = ? AND (id GLOB 'world/*' OR id NOT LIKE '%/%')",
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
      `INSERT INTO compendium_entries (id, type_id, name, tags, body, fields, visibility, updated_at, rev, name_key, name_words, tags_key, text_key, facets, licence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, tags = excluded.tags, body = excluded.body,
      fields = excluded.fields, visibility = excluded.visibility, updated_at = excluded.updated_at,
      licence = excluded.licence, rev = excluded.rev, name_key = excluded.name_key, name_words = excluded.name_words, tags_key = excluded.tags_key, text_key = excluded.text_key, facets = excluded.facets`,
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
    );
    if (entry.visibility === "dm" && previous?.visibility === "public")
      this.tombstone(entry.id, entry.rev ?? 0, true);
    else if (entry.visibility === "public")
      this.sql.exec("DELETE FROM compendium_tombstones WHERE id = ?", entry.id);
  }
  private tombstone(id: string, rev: number, publicEntry = true) {
    this.sql.exec(
      "INSERT INTO compendium_tombstones (id, rev, public) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET rev = excluded.rev, public = MAX(compendium_tombstones.public, excluded.public)",
      id,
      rev,
      publicEntry ? 1 : 0,
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

  async handle(
    method: string,
    path: string,
    body: unknown,
    role: string,
    worldName: string,
    since: string | null = null,
  ): Promise<Response> {
    if (method === "GET" && path === "compendium/index") return json(this.index(since, role));
    if (method === "POST" && path === "compendium/bodies") {
      const decoded = Schema.decodeUnknownResult(EntryBodiesInput)(body);
      if (
        decoded._tag === "Failure" ||
        decoded.success.ids.length > compendiumLimits.bodiesPerRequest
      )
        return json(
          { error: `Request at most ${compendiumLimits.bodiesPerRequest} entry ids` },
          400,
        );
      try {
        return json(await this.bodies(decoded.success, role));
      } catch {
        return json({ error: "Library content is temporarily unavailable" }, 503);
      }
    }
    if (method === "GET" && path === "compendium") {
      const compendium = this.list();
      return json({
        types: compendium.types,
        entries: compendium.entries.filter(
          (entry) => role === "dm" || entry.visibility === "public",
        ),
      });
    }
    if (role !== "dm") return json({ error: "Only the DM can manage the compendium" }, 403);
    const sql = this.sql;
    const types = this.types();
    if (method === "GET" && path === "compendium/export") {
      let overrides: CompendiumEntry[] = [];
      if (this.sources?.available) {
        try {
          overrides = await this.sources.exportEntries();
        } catch {
          return json({ error: "Library content is temporarily unavailable" }, 503);
        }
      }
      const pack: CompendiumPack = {
        format: "ttrpg-pack",
        version: 2,
        name: worldName,
        types,
        entries: [...this.list().entries, ...overrides].map(
          ({ updatedAt: _updatedAt, rev: _rev, ...entry }) => entry,
        ),
      };
      return json(pack);
    }
    const typeMatch = /^compendium\/types\/([^/]+)$/.exec(path);
    if (
      typeMatch &&
      (method === "PUT" || method === "DELETE") &&
      this.sources?.ownsType(typeMatch[1])
    )
      return json({ error: "Enabled library entry types cannot be edited in the world" }, 409);
    if (typeMatch && method === "PUT") {
      const decoded = Schema.decodeUnknownResult(EntryType)(body);
      if (decoded._tag === "Failure") return json({ error: "Invalid entry type" }, 400);
      const type = decoded.success;
      if (type.id !== typeMatch[1]) return json({ error: "Type id must match the URL" }, 400);
      const error = typeError(type, types);
      if (error) return json({ error }, 400);
      if (!types.some((row) => row.id === type.id) && types.length >= compendiumLimits.types)
        return json({ error: "A world can have at most 50 entry types" }, 400);
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
      return json(type);
    }
    if (typeMatch && method === "DELETE") {
      if (
        sql
          .exec("SELECT id FROM compendium_entries WHERE type_id = ? LIMIT 1", typeMatch[1])
          .toArray().length
      )
        return json({ error: "Delete this type's entries before deleting the type" }, 409);
      const rev = this.transactionSync(() => {
        sql.exec("DELETE FROM compendium_types WHERE id = ?", typeMatch[1]);
        return this.bump();
      });
      this.updated(rev);
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && path === "compendium/entries") {
      const decoded = Schema.decodeUnknownResult(SaveEntryInput)(body);
      if (decoded._tag === "Failure") return json({ error: "Invalid entry data" }, 400);
      const input = decoded.success;
      const type = types.find((candidate) => candidate.id === input.typeId);
      if (!type) return json({ error: `Unknown entry type: ${input.typeId}` }, 400);
      const id =
        input.id === undefined
          ? this.newEntryId(input.typeId, input.name, this.takenIds())
          : this.resolveId(input.id);
      if (isEntryId(id) && parseEntryId(id)?.source !== WORLD_SOURCE)
        return json({ error: "Use the library override editor for this entry" }, 409);
      const existing = sql
        .exec<{ type_id: string }>("SELECT type_id FROM compendium_entries WHERE id = ?", id)
        .toArray()[0];
      if (input.id !== undefined && !existing) return json({ error: "Entry not found" }, 404);
      if (existing && existing.type_id !== input.typeId)
        return json({ error: "An entry cannot move between types" }, 400);
      if (
        input.id === undefined &&
        sql
          .exec<{ n: number }>(
            "SELECT COUNT(*) AS n FROM compendium_entries WHERE id GLOB 'world/*' OR id NOT LIKE '%/%'",
          )
          .one().n >= compendiumLimits.entries
      )
        return json({ error: "A world can have at most 10000 entries" }, 400);
      const entry: CompendiumEntry = {
        ...input,
        id,
        updatedAt: nowIso(),
        rev: this.revision() + 1,
        licence: parse<CompendiumEntry["licence"]>(
          sql
            .exec<{ licence: string | null }>(
              "SELECT licence FROM compendium_entries WHERE id = ?",
              id,
            )
            .toArray()[0]?.licence ?? null,
          undefined,
        ),
      };
      const error = entryError(entry, type);
      if (error) return json({ error }, 400);
      this.transactionSync(() => {
        this.bump();
        this.writeCompendiumEntry(entry, type);
      });
      this.updated(entry.rev ?? 0);
      return json(entry);
    }
    const entryMatch = /^compendium\/entries\/(.+)$/.exec(path);
    if (entryMatch && method === "DELETE") {
      const id = this.resolveId(decodeURIComponent(entryMatch[1]));
      if (isEntryId(id) && parseEntryId(id)?.source !== WORLD_SOURCE)
        return json({ error: "Use the library blocklist for this entry" }, 409);
      const previous = sql
        .exec<{ visibility: string }>("SELECT visibility FROM compendium_entries WHERE id = ?", id)
        .toArray()[0];
      const rev = this.transactionSync(() => {
        const revision = this.bump();
        sql.exec("DELETE FROM compendium_entries WHERE id = ?", id);
        this.tombstone(id, revision, previous?.visibility === "public");
        return revision;
      });
      this.updated(rev);
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && path === "compendium/import") {
      const decoded = Schema.decodeUnknownResult(CompendiumPack)(body);
      if (decoded._tag === "Failure") return json({ error: "Invalid compendium pack" }, 400);
      const pack = decoded.success;
      const expectedRevision = this.revision();
      if (new TextEncoder().encode(JSON.stringify(pack)).byteLength > compendiumLimits.packBytes)
        return json({ error: "Pack JSON must be at most 4 MB" }, 400);
      if (pack.entries.length > compendiumLimits.entries)
        return json({ error: "A pack can have at most 10000 entries" }, 400);
      if (new Set(pack.entries.map((item) => item.id)).size !== pack.entries.length)
        return json({ error: "Pack contains duplicate entry ids" }, 400);
      const sourceEntries = pack.entries.filter(
        (item) => isEntryId(item.id) && parseEntryId(item.id)?.source !== WORLD_SOURCE,
      );
      const localEntries = pack.entries.filter(
        (item) => !isEntryId(item.id) || parseEntryId(item.id)?.source === WORLD_SOURCE,
      );
      for (const item of sourceEntries) {
        if (
          parseEntryId(item.id)?.typeId !== item.typeId ||
          !Number.isSafeInteger(item.sourceVersion) ||
          !Number.isSafeInteger(item.sourceRev) ||
          (item.sourceVersion ?? 0) < 1 ||
          (item.sourceRev ?? 0) < 1 ||
          !item.licence
        )
          return json(
            { error: "Library pack entries require valid identity, provenance and licence" },
            400,
          );
      }
      if (sourceEntries.length && (pack.version !== 2 || !this.sources?.available))
        return json(
          { error: "Enable the pack's libraries before importing version 2 library entries" },
          409,
        );
      for (const item of pack.entries) {
        const previous = sql
          .exec<{ licence: string | null }>(
            "SELECT licence FROM compendium_entries WHERE id = ?",
            item.id,
          )
          .toArray()[0];
        const rights = parse<CompendiumEntry["licence"]>(previous?.licence ?? null, undefined);
        if (rights && JSON.stringify(rights) !== JSON.stringify(item.licence))
          return json(
            { error: "Import must preserve the existing entry licence and attribution" },
            400,
          );
      }
      for (const type of pack.types) {
        const existingType = types.find((candidate) => candidate.id === type.id);
        if (this.sources?.ownsType(type.id) && !sameType(existingType, type))
          return json({ error: "Import cannot replace enabled library entry types" }, 409);
      }
      const error = packError({ ...pack, entries: localEntries }, types);
      if (error) return json({ error }, 400);
      const typeMap = new Map([...types, ...pack.types].map((type) => [type.id, type]));
      if (typeMap.size > compendiumLimits.types)
        return json({ error: "A world can have at most 50 entry types" }, 400);
      const existing = new Map(
        sql
          .exec<{ id: string; type_id: string }>(
            "SELECT id, type_id FROM compendium_entries WHERE id GLOB 'world/*' OR id NOT LIKE '%/%'",
          )
          .toArray()
          .map((row) => [row.id, row.type_id]),
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
        const parts = parseEntryId(id);
        if (!parts || parts.source !== WORLD_SOURCE || parts.typeId !== item.typeId)
          return json({ error: "Entry id must be world/<type>/<slug> and match its type" }, 400);
        const rights = parse<CompendiumEntry["licence"]>(
          sql
            .exec<{ licence: string | null }>(
              "SELECT licence FROM compendium_entries WHERE id = ?",
              id,
            )
            .toArray()[0]?.licence ?? null,
          undefined,
        );
        if (rights && JSON.stringify(rights) !== JSON.stringify(item.licence))
          return json(
            { error: "Import must preserve the existing entry licence and attribution" },
            400,
          );
        if (item.licence) {
          const issue = licenceError(item.licence);
          if (issue) return json({ error: issue }, 400);
        }
        if (existing.has(id) && existing.get(id) !== item.typeId)
          return json({ error: "An entry cannot move between types" }, 400);
        if (importedIds.has(id)) return json({ error: "Pack contains duplicate entry ids" }, 400);
        importedIds.add(id);
        taken.add(id);
        if (!existing.has(id)) created++;
        const entry = { ...item, id, updatedAt: nowIso(), rev: this.revision() + 1 };
        const type = typeMap.get(entry.typeId);
        if (!type) return json({ error: `Unknown entry type: ${entry.typeId}` }, 400);
        const validation = entryError(entry, type);
        if (validation) return json({ error: validation }, 400);
        entries.push(entry);
      }
      if (existing.size + created > compendiumLimits.entries)
        return json({ error: "A world can have at most 10000 entries" }, 400);
      let prepared: PreparedSourceImport | undefined;
      try {
        if (sourceEntries.length) prepared = await this.sources!.prepareImport(sourceEntries);
        const rev = this.transactionSync(() => {
          if (this.revision() !== expectedRevision)
            throw new CompendiumImportError(
              409,
              "Compendium changed while importing; retry the import",
            );
          prepared?.apply();
          const revision = this.bump();
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
        return json({ types: pack.types.length, created, updated: pack.entries.length - created });
      } catch (error) {
        if (error instanceof CompendiumImportError)
          return json({ error: error.message }, error.status);
        return json({ error: "Compendium import is temporarily unavailable" }, 503);
      }
    }
    return json({ error: "Not found" }, 404);
  }
}
