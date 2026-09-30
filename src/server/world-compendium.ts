import * as Schema from "effect/Schema";
import {
  CompendiumEntry,
  CompendiumPack,
  EntryType,
  SaveEntryInput,
  compendiumLimits,
} from "../domain/compendium";
import { entryError, packError, typeError } from "../domain/compendium-rules";
import type { ServerFrame } from "../domain/schemas";
import { newId, nowIso } from "./crypto";

type CompendiumTypeRow = {
  id: string;
  name: string;
  plural: string | null;
  fields: string;
  position: number;
};

type CompendiumEntryRow = {
  id: string;
  type_id: string;
  name: string;
  tags: string;
  body: string;
  fields: string;
  visibility: string;
  updated_at: string;
};

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

type WorldCompendiumOptions = {
  sql: SqlStorage;
  broadcast: (frame: ServerFrame) => void;
  transactionSync: DurableObjectStorage["transactionSync"];
};

export class WorldCompendium {
  private readonly sql: SqlStorage;
  private readonly broadcast: WorldCompendiumOptions["broadcast"];
  private readonly transactionSync: WorldCompendiumOptions["transactionSync"];

  constructor({ sql, broadcast, transactionSync }: WorldCompendiumOptions) {
    this.sql = sql;
    this.broadcast = broadcast;
    this.transactionSync = transactionSync;
  }

  migrate() {
    const sql = this.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS compendium_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      plural TEXT,
      fields TEXT NOT NULL,
      position INTEGER NOT NULL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS compendium_entries (
      id TEXT PRIMARY KEY,
      type_id TEXT NOT NULL,
      name TEXT NOT NULL,
      tags TEXT NOT NULL,
      body TEXT NOT NULL,
      fields TEXT NOT NULL,
      visibility TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    sql.exec("CREATE INDEX IF NOT EXISTS compendium_entries_type ON compendium_entries(type_id)");
  }

  // Run before the DO reads JSON, preserving authorization and raw pack size checks.
  checkRequest(request: Request, url: URL): Response | Promise<Response | undefined> | undefined {
    if (
      url.pathname.startsWith("/internal/compendium") &&
      !(request.method === "GET" && url.pathname === "/internal/compendium") &&
      request.headers.get("x-ttrpg-role") !== "dm"
    )
      return json({ error: "Only the DM can manage the compendium" }, 403);
    if (url.pathname === "/internal/compendium/import" && request.method === "POST")
      return this.checkPackSize(request);
  }

  private async checkPackSize(request: Request): Promise<Response | undefined> {
    const raw = await request.clone().text();
    if (new TextEncoder().encode(raw).byteLength > compendiumLimits.packBytes)
      return json({ error: "Pack JSON must be at most 4 MB" }, 400);
  }

  list(): { types: EntryType[]; entries: CompendiumEntry[] } {
    const sql = this.sql;
    const types = sql
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
    const entries = sql
      .exec<CompendiumEntryRow>("SELECT * FROM compendium_entries ORDER BY updated_at DESC, id")
      .toArray()
      .flatMap((row) => {
        const decoded = Schema.decodeUnknownResult(CompendiumEntry)({
          id: row.id,
          typeId: row.type_id,
          name: row.name,
          tags: parse<unknown>(row.tags, undefined),
          body: row.body,
          fields: parse<unknown>(row.fields, undefined),
          visibility: row.visibility,
          updatedAt: row.updated_at,
        });
        return decoded._tag === "Success" ? [decoded.success] : [];
      });
    return { types, entries };
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

  private writeCompendiumEntry(entry: CompendiumEntry) {
    this.sql.exec(
      `INSERT INTO compendium_entries (id, type_id, name, tags, body, fields, visibility, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET type_id = excluded.type_id, name = excluded.name,
       tags = excluded.tags, body = excluded.body, fields = excluded.fields,
       visibility = excluded.visibility, updated_at = excluded.updated_at`,
      entry.id,
      entry.typeId,
      entry.name,
      JSON.stringify(entry.tags),
      entry.body,
      JSON.stringify(entry.fields),
      entry.visibility,
      entry.updatedAt,
    );
  }

  handle(method: string, path: string, body: unknown, role: string, worldName: string): Response {
    const compendium = this.list();
    if (method === "GET" && path === "compendium")
      return json({
        types: compendium.types,
        entries: compendium.entries.filter(
          (entry) => role === "dm" || entry.visibility === "public",
        ),
      });
    if (role !== "dm") return json({ error: "Only the DM can manage the compendium" }, 403);
    const sql = this.sql;
    if (method === "GET" && path === "compendium/export") {
      const pack: CompendiumPack = {
        format: "ttrpg-pack",
        version: 1,
        name: worldName,
        types: compendium.types,
        entries: compendium.entries.map(({ updatedAt: _updatedAt, ...entry }) => entry),
      };
      return json(pack);
    }
    const typeMatch = /^compendium\/types\/([^/]+)$/.exec(path);
    if (typeMatch && method === "PUT") {
      const decoded = Schema.decodeUnknownResult(EntryType)(body);
      if (decoded._tag === "Failure") return json({ error: "Invalid entry type" }, 400);
      const type = decoded.success;
      if (type.id !== typeMatch[1]) return json({ error: "Type id must match the URL" }, 400);
      const error = typeError(type, compendium.types);
      if (error) return json({ error }, 400);
      const ids = sql.exec<{ id: string }>("SELECT id FROM compendium_types").toArray();
      if (!ids.some((row) => row.id === type.id) && ids.length >= compendiumLimits.types)
        return json({ error: "A world can have at most 50 entry types" }, 400);
      this.writeCompendiumType(type);
      this.broadcast({ type: "compendium.updated" });
      return json(type);
    }
    if (typeMatch && method === "DELETE") {
      if (
        sql
          .exec("SELECT id FROM compendium_entries WHERE type_id = ? LIMIT 1", typeMatch[1])
          .toArray().length
      )
        return json({ error: "Delete this type's entries before deleting the type" }, 409);
      sql.exec("DELETE FROM compendium_types WHERE id = ?", typeMatch[1]);
      this.broadcast({ type: "compendium.updated" });
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && path === "compendium/entries") {
      const decoded = Schema.decodeUnknownResult(SaveEntryInput)(body);
      if (decoded._tag === "Failure") return json({ error: "Invalid entry data" }, 400);
      const input = decoded.success;
      const ids = sql.exec<{ id: string }>("SELECT id FROM compendium_entries").toArray();
      if (input.id !== undefined && !ids.some((row) => row.id === input.id))
        return json({ error: "Entry not found" }, 404);
      if (input.id === undefined && ids.length >= compendiumLimits.entries)
        return json({ error: "A world can have at most 2000 entries" }, 400);
      const type = compendium.types.find((candidate) => candidate.id === input.typeId);
      if (!type) return json({ error: `Unknown entry type: ${input.typeId}` }, 400);
      const entry: CompendiumEntry = {
        ...input,
        id: input.id ?? newId("ent"),
        updatedAt: nowIso(),
      };
      const error = entryError(entry, type);
      if (error) return json({ error }, 400);
      this.writeCompendiumEntry(entry);
      this.broadcast({ type: "compendium.updated" });
      return json(entry);
    }
    const entryMatch = /^compendium\/entries\/([^/]+)$/.exec(path);
    if (entryMatch && method === "DELETE") {
      sql.exec("DELETE FROM compendium_entries WHERE id = ?", decodeURIComponent(entryMatch[1]));
      this.broadcast({ type: "compendium.updated" });
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && path === "compendium/import") {
      const decoded = Schema.decodeUnknownResult(CompendiumPack)(body);
      if (decoded._tag === "Failure") return json({ error: "Invalid compendium pack" }, 400);
      const pack = decoded.success;
      const error = packError(pack, compendium.types);
      if (error) return json({ error }, 400);
      const typeIds = new Set(
        sql
          .exec<{ id: string }>("SELECT id FROM compendium_types")
          .toArray()
          .map((row) => row.id),
      );
      const entryIds = new Set(
        sql
          .exec<{ id: string }>("SELECT id FROM compendium_entries")
          .toArray()
          .map((row) => row.id),
      );
      if (new Set([...typeIds, ...pack.types.map((type) => type.id)]).size > compendiumLimits.types)
        return json({ error: "A world can have at most 50 entry types" }, 400);
      const created = pack.entries.filter((entry) => !entryIds.has(entry.id)).length;
      if (entryIds.size + created > compendiumLimits.entries)
        return json({ error: "A world can have at most 2000 entries" }, 400);
      const updatedAt = nowIso();
      const entries = pack.entries.map((entry) => ({ ...entry, updatedAt }));
      const types = new Map([...compendium.types, ...pack.types].map((type) => [type.id, type]));
      for (const entry of entries) {
        const type = types.get(entry.typeId);
        if (!type) return json({ error: `Unknown entry type: ${entry.typeId}` }, 400);
        const entryValidation = entryError(entry, type);
        if (entryValidation) return json({ error: entryValidation }, 400);
      }
      this.transactionSync(() => {
        for (const type of pack.types) this.writeCompendiumType(type);
        for (const entry of entries) this.writeCompendiumEntry(entry);
      });
      this.broadcast({ type: "compendium.updated" });
      return json({ types: pack.types.length, created, updated: pack.entries.length - created });
    }
    return json({ error: "Not found" }, 404);
  }
}
