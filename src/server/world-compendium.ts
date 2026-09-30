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
} from "../domain/compendium";
import { entryError, packError, typeError } from "../domain/compendium-rules";
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
};
type CompendiumEntryRow = CompendiumIndexRow & {
  body: string;
  fields: string;
};

const indexColumns = "id, type_id, name, tags, visibility, updated_at, rev";
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
const toIndex = (row: CompendiumIndexRow): IndexRow[] => {
  const decoded = Schema.decodeUnknownResult(IndexRow)({
    id: row.id,
    typeId: row.type_id,
    name: row.name,
    tags: parse<unknown>(row.tags, undefined),
    visibility: row.visibility,
    rev: row.rev,
    updatedAt: row.updated_at,
  });
  return decoded._tag === "Success" ? [decoded.success] : [];
};
const toEntry = (row: CompendiumEntryRow): CompendiumEntry[] => {
  const decoded = Schema.decodeUnknownResult(CompendiumEntry)({
    ...toIndex(row)[0],
    body: row.body,
    fields: parse<unknown>(row.fields, undefined),
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

export class WorldCompendium {
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
    const columns = new Set(
      sql
        .exec<{ name: string }>("PRAGMA table_info(compendium_entries)")
        .toArray()
        .map((row) => row.name),
    );
    for (const [name, ddl] of [
      ["rev", "INTEGER NOT NULL DEFAULT 0"],
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
    sql.exec(
      "CREATE TABLE IF NOT EXISTS compendium_aliases (old_id TEXT PRIMARY KEY, new_id TEXT NOT NULL)",
    );
    const hadFts =
      sql.exec("SELECT name FROM sqlite_master WHERE name = 'compendium_fts'").toArray().length > 0;
    try {
      sql.exec(
        "CREATE VIRTUAL TABLE IF NOT EXISTS compendium_fts USING fts5(id UNINDEXED, text_key)",
      );
      this.fts = true;
      this.rebuildFts = !hadFts;
    } catch {
      this.fts = false;
    }
    this.setting("compendium_search_engine", this.fts ? "fts5" : "like");
    if (this.fts) {
      sql.exec(`CREATE TRIGGER IF NOT EXISTS compendium_fts_insert AFTER INSERT ON compendium_entries BEGIN
        INSERT INTO compendium_fts (rowid, id, text_key) VALUES (new.rowid, new.id, new.text_key); END`);
      sql.exec(`CREATE TRIGGER IF NOT EXISTS compendium_fts_delete AFTER DELETE ON compendium_entries BEGIN
        DELETE FROM compendium_fts WHERE rowid = old.rowid; END`);
      sql.exec(`CREATE TRIGGER IF NOT EXISTS compendium_fts_update AFTER UPDATE OF id, text_key ON compendium_entries BEGIN
        DELETE FROM compendium_fts WHERE rowid = old.rowid;
        INSERT INTO compendium_fts (rowid, id, text_key) VALUES (new.rowid, new.id, new.text_key); END`);
    }
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
    if (this.rebuildFts) {
      this.transactionSync(() => {
        sql.exec("DELETE FROM compendium_fts");
        sql.exec(
          "INSERT INTO compendium_fts (rowid, id, text_key) SELECT rowid, id, text_key FROM compendium_entries",
        );
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
        });
        return decoded._tag === "Success" ? [decoded.success] : [];
      });
  }
  list(): { types: EntryType[]; entries: CompendiumEntry[] } {
    return {
      types: this.types(),
      entries: this.sql
        .exec<CompendiumEntryRow>("SELECT * FROM compendium_entries ORDER BY updated_at DESC, id")
        .toArray()
        .flatMap(toEntry),
    };
  }

  index(since: string | null, role: string): IndexDelta {
    const rev = this.revision();
    const requested = since === null || !/^\d+$/.test(since) ? 0 : Number(since);
    const full =
      !Number.isSafeInteger(requested) ||
      requested <= 0 ||
      requested > rev ||
      requested < Number(this.setting("compendium_delta_floor") ?? 0);
    const after = full ? -1 : requested;
    const upserts = this.sql
      .exec<CompendiumIndexRow>(
        `SELECT ${indexColumns} FROM compendium_entries WHERE rev > ? ${role === "dm" ? "" : "AND visibility = 'public'"}`,
        after,
      )
      .toArray()
      .flatMap(toIndex);
    const deletes = full
      ? []
      : this.sql
          .exec<{ id: string }>(
            `SELECT id FROM compendium_tombstones WHERE rev > ? ${role === "dm" ? "" : "UNION SELECT id FROM compendium_entries WHERE rev > ? AND visibility = 'dm'"}`,
            ...(role === "dm" ? [after] : [after, after]),
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
  bodies(input: EntryBodiesInput, role: string): EntryBodies {
    const aliases: Record<string, string> = {};
    const missing: string[] = [];
    const ids = new Set<string>();
    const entries: CompendiumEntry[] = [];
    for (const oldId of input.ids) {
      const id = this.resolveId(oldId);
      const row = this.sql
        .exec<CompendiumEntryRow>("SELECT * FROM compendium_entries WHERE id = ?", id)
        .toArray()[0];
      const entry =
        row && (role === "dm" || row.visibility === "public") ? toEntry(row)[0] : undefined;
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

  search(frame: Extract<ClientFrame, { type: "search" }>, role: string): IndexRow[] {
    const query = normalize(frame.query);
    const words = query.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (query.length < 2 || !words.length || frame.typeIds?.length === 0) return [];
    const limit = Math.min(frame.limit ?? 20, compendiumLimits.searchResults);
    const params: (string | number)[] = [];
    const filters: string[] = [];
    if (role !== "dm") filters.push("visibility = 'public'");
    if (frame.typeIds) {
      filters.push(`type_id IN (${frame.typeIds.map(() => "?").join(",")})`);
      params.push(...frame.typeIds);
    }
    const filter = filters.length ? `${filters.join(" AND ")} AND ` : "";
    const nameMatch = words.map(() => "instr(name_key, ?) > 0").join(" AND ");
    const wordPrefix = words.map(() => "instr(' ' || name_words, ' ' || ?) > 0").join(" AND ");
    const rows = this.sql
      .exec<CompendiumIndexRow>(
        `SELECT ${indexColumns} FROM compendium_entries
      WHERE ${filter}(${nameMatch})
      ORDER BY CASE WHEN name_key = ? THEN 0 WHEN instr(name_key, ?) = 1 THEN 1
        WHEN ${wordPrefix} THEN 2 ELSE 3 END, name_key, name, id LIMIT ?`,
        ...params,
        ...words,
        query,
        query,
        ...words,
        limit,
      )
      .toArray()
      .flatMap(toIndex);
    if (rows.length === limit) return rows;
    const excluded = rows.map((row) => row.id);
    const exclusion = () =>
      excluded.length ? `id NOT IN (${excluded.map(() => "?").join(",")}) AND ` : "";
    const tags = this.sql
      .exec<CompendiumIndexRow>(
        `SELECT ${indexColumns} FROM compendium_entries WHERE ${filter}${exclusion()}(${words.map(() => "instr(tags_key, ?) > 0").join(" OR ")}) ORDER BY name_key, name, id LIMIT ?`,
        ...params,
        ...excluded,
        ...words,
        limit - rows.length,
      )
      .toArray()
      .flatMap(toIndex);
    rows.push(...tags);
    if (rows.length === limit) return rows;
    excluded.push(...tags.map((row) => row.id));
    const textMatch = this.fts
      ? "id IN (SELECT id FROM compendium_fts WHERE compendium_fts MATCH ?)"
      : words.map(() => "text_key LIKE ?").join(" AND ");
    const textParams = this.fts
      ? [words.map((word) => `"${word}"*`).join(" AND ")]
      : words.map((word) => `%${word}%`);
    return [
      ...rows,
      ...this.sql
        .exec<CompendiumIndexRow>(
          `SELECT ${indexColumns} FROM compendium_entries WHERE ${filter}${exclusion()}(${textMatch}) ORDER BY name_key, name, id LIMIT ?`,
          ...params,
          ...excluded,
          ...textParams,
          limit - rows.length,
        )
        .toArray()
        .flatMap(toIndex),
    ];
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
      `INSERT INTO compendium_types (id, name, plural, fields, position)
      VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM compendium_types))
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, plural = excluded.plural, fields = excluded.fields`,
      type.id,
      type.name,
      type.plural ?? null,
      JSON.stringify(type.fields),
    );
  }
  private writeCompendiumEntry(entry: CompendiumEntry, type?: EntryType) {
    const text = (type?.fields ?? [])
      .filter((field) => field.kind === "text" || field.kind === "longtext")
      .map((field) => entry.fields[field.key])
      .filter((value) => typeof value === "string")
      .join(" ");
    this.sql.exec(
      `INSERT INTO compendium_entries (id, type_id, name, tags, body, fields, visibility, updated_at, rev, name_key, name_words, tags_key, text_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, tags = excluded.tags, body = excluded.body,
      fields = excluded.fields, visibility = excluded.visibility, updated_at = excluded.updated_at,
      rev = excluded.rev, name_key = excluded.name_key, name_words = excluded.name_words, tags_key = excluded.tags_key, text_key = excluded.text_key`,
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
    );
    this.sql.exec("DELETE FROM compendium_tombstones WHERE id = ?", entry.id);
  }
  private tombstone(id: string, rev: number) {
    this.sql.exec(
      "INSERT INTO compendium_tombstones (id, rev) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET rev = excluded.rev",
      id,
      rev,
    );
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

  handle(
    method: string,
    path: string,
    body: unknown,
    role: string,
    worldName: string,
    since: string | null = null,
  ): Response {
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
      return json(this.bodies(decoded.success, role));
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
      const pack: CompendiumPack = {
        format: "ttrpg-pack",
        version: 2,
        name: worldName,
        types,
        entries: this.list().entries.map(({ updatedAt: _updatedAt, rev: _rev, ...entry }) => entry),
      };
      return json(pack);
    }
    const typeMatch = /^compendium\/types\/([^/]+)$/.exec(path);
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
        this.writeCompendiumType(type);
        return this.bump();
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
      const existing = sql
        .exec<{ type_id: string }>("SELECT type_id FROM compendium_entries WHERE id = ?", id)
        .toArray()[0];
      if (input.id !== undefined && !existing) return json({ error: "Entry not found" }, 404);
      if (existing && existing.type_id !== input.typeId)
        return json({ error: "An entry cannot move between types" }, 400);
      if (
        input.id === undefined &&
        sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM compendium_entries").one().n >=
          compendiumLimits.entries
      )
        return json({ error: "A world can have at most 10000 entries" }, 400);
      const entry: CompendiumEntry = {
        ...input,
        id,
        updatedAt: nowIso(),
        rev: this.revision() + 1,
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
      const rev = this.transactionSync(() => {
        const revision = this.bump();
        sql.exec("DELETE FROM compendium_entries WHERE id = ?", id);
        this.tombstone(id, revision);
        return revision;
      });
      this.updated(rev);
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && path === "compendium/import") {
      const decoded = Schema.decodeUnknownResult(CompendiumPack)(body);
      if (decoded._tag === "Failure") return json({ error: "Invalid compendium pack" }, 400);
      const pack = decoded.success;
      const error = packError(pack, types);
      if (error) return json({ error }, 400);
      const typeMap = new Map([...types, ...pack.types].map((type) => [type.id, type]));
      if (typeMap.size > compendiumLimits.types)
        return json({ error: "A world can have at most 50 entry types" }, 400);
      const existing = new Map(
        sql
          .exec<{ id: string; type_id: string }>("SELECT id, type_id FROM compendium_entries")
          .toArray()
          .map((row) => [row.id, row.type_id]),
      );
      const taken = this.takenIds();
      const aliases: [string, string][] = [];
      const entries: CompendiumEntry[] = [];
      const importedIds = new Set<string>();
      let created = 0;
      for (const item of pack.entries) {
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
      const rev = this.transactionSync(() => {
        const revision = this.bump();
        for (const type of pack.types) this.writeCompendiumType(type);
        for (const entry of entries) this.writeCompendiumEntry(entry, typeMap.get(entry.typeId));
        for (const [oldId, newId] of aliases)
          sql.exec("INSERT INTO compendium_aliases (old_id, new_id) VALUES (?, ?)", oldId, newId);
        return revision;
      });
      this.updated(rev);
      return json({ types: pack.types.length, created, updated: pack.entries.length - created });
    }
    return json({ error: "Not found" }, 404);
  }
}
