// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { WorldSources, SourceStorage, CorpusBucket, CorpusAccountId } from "./world-sources";
import { CorpusClient } from "./corpus-env";
import {
  encodeIndex,
  encodeBodies,
  snapshotKeys,
  snapshotFile,
  type SnapshotManifest,
} from "../domain/snapshot";
import * as Schema from "effect/Schema";
import { expect, it } from "vitest";
import { WorldCompendium } from "./world-compendium";
import { WorldStorage, WorldBucket, Broadcast, WorldId } from "./world-rpc";
import { BadRequest, Conflict, Forbidden, NotFound, Unavailable, type ApiError } from "./services";
import { toReply } from "./reply";
import { corpusClient, corpusEdge, corpusStatus } from "./corpus-env";
import {
  CorpusNotFound,
  CorpusForbidden,
  CorpusInvalid,
  CorpusConflict,
  CorpusUnavailable,
  CorpusError,
} from "../domain/corpus-errors";
import {
  BlockedEntries,
  LibraryEntryDiff,
  WorldLibraries,
  type CorpusApi,
} from "../domain/corpus-rpc";
import type { CompendiumEntry, EntryType, IndexRow } from "../domain/compendium";
import { librarySource } from "../domain/entry-id";

// Bridge WorldSources until its world ApiError conversion is merged.
const apiError = (error: CorpusError | ApiError): ApiError => {
  switch (error._tag) {
    case "CorpusNotFound":
      return new NotFound({ message: error.message });
    case "CorpusForbidden":
      return new Forbidden({ message: error.message });
    case "CorpusInvalid":
      return new BadRequest({ message: error.message });
    case "CorpusConflict":
      return new Conflict({ message: error.message });
    case "CorpusUnavailable":
      return new Unavailable({ message: error.message });
    default:
      return error;
  }
};
const worldResponse = async <A>(effect: Effect.Effect<A, ApiError>): Promise<Response> => {
  const reply = await toReply(effect, Effect.runPromiseExit);
  if (reply.ok)
    return reply.value === undefined
      ? new Response(null, { status: 204 })
      : Response.json(reply.value);
  const statuses = {
    Unauthorized: 401,
    Forbidden: 403,
    NotFound: 404,
    BadRequest: 400,
    Conflict: 409,
    Unavailable: 503,
  };
  return Response.json({ error: reply.error.message }, { status: statuses[reply.error._tag] });
};

const rpcBinding = (methods: Partial<CorpusApi>): CorpusApi => {
  const unused = async () => ({
    ok: false as const,
    error: Schema.encodeSync(CorpusError)(new CorpusUnavailable({ message: "Unused test method" })),
  });
  return {
    listSystems: unused,
    saveSystem: unused,
    listSources: unused,
    createSource: unused,
    getSource: unused,
    saveEntries: unused,
    deleteEntries: unused,
    publish: unused,
    getLatest: unused,
    getManifest: unused,
    ...methods,
  };
};

const type: EntryType = { id: "item", name: "Item", fields: [] };
const row = (id: string, name = id): IndexRow => ({
  id,
  typeId: "item",
  name,
  tags: [],
  visibility: "public",
  rev: 1,
  updatedAt: "2026-10-01",
});

const unavailableBucket = (message: string): R2Bucket => {
  const fail = async () => {
    throw new Error(message);
  };
  return {
    head: fail,
    get: fail,
    put: fail,
    createMultipartUpload: fail,
    resumeMultipartUpload: () => {
      throw new Error(message);
    },
    delete: fail,
    list: fail,
  };
};
const sqlite = (bucket: R2Bucket = unavailableBucket("Unused R2 method")) => {
  const db = new DatabaseSync(":memory:");
  // Exercise real SQLite; this adapter exposes the DO cursor operations used by the compendium.
  const sql = {
    exec: (query: string, ...bindings: (string | number | null)[]) => {
      const rows = db.prepare(query).all(...bindings);
      return {
        toArray: () => rows,
        one: () => {
          if (rows.length !== 1) throw new Error("Expected one SQLite row");
          return rows[0];
        },
      };
    },
  } as SqlStorage;
  const transactionSync = <T>(operation: () => T): T => {
    db.exec("SAVEPOINT fixture");
    try {
      const value = operation();
      db.exec("RELEASE fixture");
      return value;
    } catch (error) {
      db.exec("ROLLBACK TO fixture");
      db.exec("RELEASE fixture");
      throw error;
    }
  };
  sql.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)");
  const compendium = Effect.runSync(
    WorldCompendium.make.pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(WorldStorage, {
            sql,
            transactionSync,
            storage: { sql, transactionSync } as DurableObjectStorage,
          }),
          Layer.succeed(WorldBucket, bucket),
          Layer.succeed(Broadcast, () => {}),
          Layer.succeed(WorldId, "fixture"),
        ),
      ),
    ),
  );
  return { db, sql, compendium, transactionSync };
};

it("backfills entry and tombstone sources once, preserving world and legacy rows", () => {
  const fixture = sqlite();
  try {
    fixture.sql.exec(
      "CREATE TABLE compendium_entries (id TEXT PRIMARY KEY, type_id TEXT, name TEXT, tags TEXT, body TEXT, fields TEXT, visibility TEXT, updated_at TEXT)",
    );
    fixture.sql.exec("CREATE TABLE compendium_tombstones (id TEXT PRIMARY KEY, rev INTEGER)");
    for (const id of ["world/item/local", "legacy", "book/item/sword"]) {
      fixture.sql.exec(
        "INSERT INTO compendium_entries VALUES (?, 'item', 'Item', '[]', '', '{}', 'public', '2026-10-01')",
        id,
      );
      fixture.sql.exec("INSERT INTO compendium_tombstones VALUES (?, 1)", id);
    }
    Effect.runSync(fixture.compendium.migrate());
    const expected = [
      { id: "book/item/sword", source_id: "book" },
      { id: "legacy", source_id: null },
      { id: "world/item/local", source_id: null },
    ];
    for (const table of ["compendium_entries", "compendium_tombstones"])
      expect(fixture.sql.exec(`SELECT id, source_id FROM ${table} ORDER BY id`).toArray()).toEqual(
        expected,
      );
    fixture.sql.exec(
      "CREATE TRIGGER forbid_source_backfill BEFORE UPDATE OF source_id ON compendium_entries BEGIN SELECT RAISE(ABORT, 'already migrated'); END",
    );
    Effect.runSync(fixture.compendium.migrate());
    expect(
      fixture.compendium
        .index(null, "dm")
        .upserts.map((item) => item.id)
        .sort(),
    ).toEqual(["legacy", "world/item/local"]);
    expect(librarySource("book/item/sword")).toBe("book");
    expect(librarySource("world/item/local")).toBeUndefined();
    expect(librarySource("legacy")).toBeUndefined();
  } finally {
    fixture.db.close();
  }
});

it("updates one source entry, including body-only revisions and public tombstones", () => {
  const fixture = sqlite();
  try {
    Effect.runSync(fixture.compendium.migrate());
    const sword = row("book/item/sword");
    const shield = row("book/item/shield");
    fixture.transactionSync(() =>
      fixture.compendium.replaceSourceRows("book", [sword, shield], [type]),
    );
    fixture.compendium.setSources({
      available: true,
      ownsType: () => true,
      resolve: () => Effect.succeed(undefined),
      bodies: () => Effect.succeed(new Map()),
      exportEntries: () => Effect.succeed([]),
      prepareImport: () => Effect.succeed({ apply: () => {} }),
    });
    const original = fixture.compendium.index(null, "player");
    // No indexed value changes for a body-only override, even with the same timestamp.
    const changed = fixture.transactionSync(() =>
      fixture.compendium.updateSourceEntry("book", sword.id, sword),
    );
    expect(changed).toBe(original.rev + 1);
    expect(
      fixture.compendium.index(String(original.rev), "player").upserts.map((item) => item.id),
    ).toEqual([sword.id]);
    const hidden = fixture.transactionSync(() =>
      fixture.compendium.updateSourceEntry("book", sword.id, { ...sword, visibility: "dm" }),
    );
    expect(fixture.compendium.index(String(changed), "player")).toMatchObject({
      upserts: [],
      deletes: [sword.id],
    });
    const blocked = fixture.transactionSync(() =>
      fixture.compendium.updateSourceEntry("book", sword.id),
    );
    expect(fixture.compendium.index(String(hidden), "player").deletes).toEqual([sword.id]);
    fixture.transactionSync(() => fixture.compendium.updateSourceEntry("book", sword.id, sword));
    expect(
      fixture.compendium.index(String(blocked), "player").upserts.map((item) => item.id),
    ).toEqual([sword.id]);
    expect(
      fixture.sql
        .exec("SELECT rev, source_id FROM compendium_entries WHERE id = ?", shield.id)
        .one(),
    ).toEqual({ rev: original.rev, source_id: "book" });
    expect(
      fixture.sql.exec("SELECT * FROM compendium_tombstones WHERE id = ?", sword.id).toArray(),
    ).toEqual([]);
  } finally {
    fixture.db.close();
  }
});

it.each([
  [new CorpusNotFound({ message: "missing" }), 404],
  [new CorpusForbidden({ message: "owner" }), 403],
  [new CorpusInvalid({ message: "input" }), 400],
  [new CorpusConflict({ message: "revision" }), 409],
  [new CorpusUnavailable({ message: "storage" }), 503],
] as const)("decodes %s from the RPC envelope and maps its tag", async (error, status) => {
  let context: unknown;
  const client = corpusClient(
    rpcBinding({
      listSources: async (call) => {
        context = call;
        return { ok: false, error: Schema.encodeSync(CorpusError)(error) };
      },
    }),
  );
  const result = await Effect.runPromise(
    Effect.result(client.call((api, call) => api.listSources(call), "account")),
  );
  expect(context).toEqual({ apiVersion: 2, accountId: "account" });
  expect(result._tag).toBe("Failure");
  if (result._tag === "Failure") expect(result.failure._tag).toBe(error._tag);
  const response = await Effect.runPromise(
    corpusEdge(
      client.call((api, call) => api.listSources(call), "account").pipe(Effect.map(() => 200)),
      corpusStatus,
    ),
  );
  expect(response).toBe(status);
});

it("maps a rejected binding and an unexpected defect to Unavailable", async () => {
  const client = corpusClient(
    rpcBinding({
      listSources: async (): ReturnType<CorpusApi["listSources"]> => {
        throw new Error("binding failed");
      },
    }),
  );
  const result = await Effect.runPromise(
    Effect.result(client.call((api, call) => api.listSources(call), "account")),
  );
  expect(result._tag).toBe("Failure");
  if (result._tag === "Failure") expect(result.failure._tag).toBe("CorpusUnavailable");
  expect(
    await Effect.runPromise(
      corpusEdge(Effect.die(new Error("unexpected")).pipe(Effect.as(200)), corpusStatus),
    ),
  ).toBe(503);
});

it("decodes a chunk once for a hundred ids and rechecks visibility on warm reads", async () => {
  const fixture = sqlite();
  try {
    const { sources, reads, files, manifest, entries } = await sourceFixture(fixture);
    await Effect.runPromise(sources.enable("book", {}));
    // Ingest reads each chunk once, for the entries' search text.
    expect(reads.get(manifest.bodyChunks[0].file.key)).toBe(1);
    const ids = entries.map((entry) => entry.id);
    expect((await Effect.runPromise(sources.bodies(ids, "player"))).size).toBe(100);
    expect(reads.get(manifest.bodyChunks[0].file.key)).toBe(1);
    // Verified immutable content survives repeated reads without hashing or decoding the bytes again.
    files.set(manifest.bodyChunks[0].file.key, new Uint8Array([0]));
    expect((await Effect.runPromise(sources.bodies(ids, "player"))).size).toBe(100);
    await Effect.runPromise(
      sources.handle(
        "PUT",
        `compendium/overrides/${encodeURIComponent(ids[0])}`,
        { baseRev: 1, patch: { visibility: "dm" } },
        "dm",
      ),
    );
    await Effect.runPromise(
      sources.handle("PUT", `compendium/blocked/${encodeURIComponent(ids[1])}`, {}, "dm"),
    );
    const visible = await Effect.runPromise(sources.bodies(ids, "player"));
    expect(visible.size).toBe(98);
    expect(visible.has(ids[0])).toBe(false);
    expect(visible.has(ids[1])).toBe(false);
    expect((await Effect.runPromise(sources.bodies(ids, "dm"))).size).toBe(99);
    expect(reads.get(manifest.bodyChunks[0].file.key)).toBe(1);
    const before = fixture.compendium.index(null, "dm");
    await Effect.runPromise(sources.enable("book", { mode: "follow" }));
    expect(fixture.compendium.index(null, "dm")).toEqual(before);
    expect(reads.get(manifest.publicIndex.key)).toBe(1);
    await Effect.runPromise(sources.check());
    expect(
      Number(
        fixture.sql.exec("SELECT value FROM settings WHERE key = 'corpus_last_check'").one().value,
      ),
    ).toBeGreaterThan(0);
    expect(reads.get(manifest.publicIndex.key)).toBe(1);
  } finally {
    fixture.db.close();
  }
});

it("rejects a blocked or changed entry after an outgoing body read yields", async () => {
  const fixture = sqlite();
  try {
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    // Ingest reads bodies too (search text); pause only the read under test.
    let armed = false;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { sources, fresh, entries } = await sourceFixture(fixture, async () => {
      if (!armed) return;
      started?.();
      await pause;
    });
    await Effect.runPromise(sources.enable("book", {}));
    // A restarted DO has no decoded chunks, so this read awaits R2.
    const cold = await fresh();
    armed = true;
    const reading = Effect.runPromise(cold.resolve(entries[0].id, "player"));
    await waiting;
    await Effect.runPromise(
      sources.handle("PUT", `compendium/blocked/${encodeURIComponent(entries[0].id)}`, {}, "dm"),
    );
    release?.();
    expect(await reading).toBeUndefined();
  } finally {
    fixture.db.close();
  }
});

it("exposes corrupt snapshot bytes as a typed Unavailable without ingesting rows", async () => {
  const fixture = sqlite();
  try {
    const { sources, files, manifest } = await sourceFixture(fixture);
    files.set(manifest.publicIndex.key, new Uint8Array([0]));
    const result = await Effect.runPromise(
      sources.enable("book", {}).pipe(Effect.mapError(apiError), Effect.result),
    );
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(result.failure._tag).toBe("Unavailable");
    expect(fixture.sql.exec("SELECT * FROM world_sources").toArray()).toEqual([]);
    expect(fixture.sql.exec("SELECT * FROM compendium_entries").toArray()).toEqual([]);
  } finally {
    fixture.db.close();
  }
});

const sourceFixture = async (
  fixture: ReturnType<typeof sqlite>,
  waitForBody?: () => Promise<void>,
) => {
  Effect.runSync(fixture.compendium.migrate());
  const licence = { id: "CC0", name: "CC0", attribution: "Fixture authors", shareAlike: false };
  const entries: CompendiumEntry[] = Array.from({ length: 100 }, (_, n) => ({
    ...row(`book/item/gear-${n}`),
    body: "Gear",
    fields: {},
  }));
  const files = new Map<string, Uint8Array>();
  const snapshot = async (version: number, entries: readonly CompendiumEntry[]) => {
    const keys = snapshotKeys("book", version);
    const bodyKey = keys.body("item", "public", 0);
    const publicBytes = await encodeIndex(
      entries.map(({ body: _body, fields: _fields, ...entry }) => ({
        ...entry,
        rev: entry.rev ?? 1,
      })),
      "public",
    );
    const dmBytes = await encodeIndex([], "dm");
    const bodyBytes = await encodeBodies(entries);
    files.set(keys.publicIndex, publicBytes);
    files.set(keys.dmIndex, dmBytes);
    files.set(bodyKey, bodyBytes);
    return {
      format: "ttrpg-corpus",
      formatVersion: 1,
      sourceId: "book",
      sourceName: "Book",
      systemId: "system",
      version,
      publishedAt: "2026-10-01",
      licence,
      types: [type],
      entryCount: entries.length,
      publicIndex: await snapshotFile(keys.publicIndex, publicBytes),
      dmIndex: await snapshotFile(keys.dmIndex, dmBytes),
      bodyChunks: [
        {
          typeId: "item",
          visibility: "public",
          ids: entries.map((entry) => entry.id),
          file: await snapshotFile(bodyKey, bodyBytes),
        },
      ],
    } satisfies SnapshotManifest;
  };
  const manifest = await snapshot(1, entries);
  const bodyKey = manifest.bodyChunks[0].file.key;
  let latest = manifest;
  const versions = new Map([[manifest.version, manifest]]);
  const offer = async (entries: readonly CompendiumEntry[]) => {
    latest = await snapshot(latest.version + 1, entries);
    versions.set(latest.version, latest);
    return latest;
  };
  const reads = new Map<string, number>();
  // R2 is the external boundary in these unit tests; SQLite and snapshot codecs are real.
  const bucket = {
    get: async (key: string): Promise<R2ObjectBody | null> => {
      reads.set(key, (reads.get(key) ?? 0) + 1);
      if (key === bodyKey) await waitForBody?.();
      const bytes = files.get(key);
      if (!bytes) return null;
      const response = new Response(bytes.slice().buffer);
      const body = response.body;
      if (!body) throw new Error("Missing fixture body");
      return {
        key,
        version: "1",
        size: bytes.byteLength,
        etag: "fixture",
        httpEtag: '"fixture"',
        uploaded: new Date(),
        storageClass: "Standard",
        checksums: { toJSON: () => ({}) },
        writeHttpMetadata: () => {},
        body,
        bodyUsed: false,
        arrayBuffer: () => response.arrayBuffer(),
        bytes: () => response.bytes(),
        text: () => response.text(),
        json: () => response.json(),
        blob: () => response.blob(),
      };
    },
  } as R2Bucket;
  const client = corpusClient(
    rpcBinding({
      getSource: async () => ({
        ok: true,
        value: {
          id: "book",
          name: "Book",
          systemId: "system",
          licence,
          visibility: "public",
          ownerAccountId: "account",
          latestVersion: 1,
        },
      }),
      listSources: async () => ({ ok: true, value: [] }),
      getLatest: async () => ({ ok: true, value: latest }),
      getManifest: async ({ version }) => ({ ok: true, value: versions.get(version) ?? null }),
    }),
  );
  /** A WorldSources over the same storage with empty in-memory caches (a restarted DO). */
  const fresh = () =>
    Effect.runPromise(
      WorldSources.make(fixture.compendium).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(SourceStorage, {
              sql: fixture.sql,
              transactionSync: fixture.transactionSync,
              storage: { sql: fixture.sql } as DurableObjectStorage,
            }),
            Layer.succeed(CorpusClient, client),
            Layer.succeed(CorpusBucket, bucket),
            Layer.succeed(CorpusAccountId, () => "account"),
          ),
        ),
      ),
    );
  const sources = await fresh();
  await Effect.runPromise(sources.migrate());
  fixture.compendium.setSources({
    available: true,
    ownsType: (id) => sources.ownsType(id),
    resolve: (id, role) => sources.resolve(id, role).pipe(Effect.mapError(apiError)),
    bodies: (ids, role) => sources.bodies(ids, role).pipe(Effect.mapError(apiError)),
    exportEntries: () => sources.exportEntries().pipe(Effect.mapError(apiError)),
    prepareImport: (entries) => sources.prepareImport(entries).pipe(Effect.mapError(apiError)),
  });
  return { sources, fresh, files, reads, manifest, entries, offer };
};

it("reviews both immutable versions, reuses verified chunks, and keeps the pinned index and overrides", async () => {
  const fixture = sqlite();
  try {
    const { sources, entries, reads, manifest, offer } = await sourceFixture(fixture);
    await Effect.runPromise(sources.enable("book", {}));
    const [changed, removed] = entries;
    const added = { ...changed, id: "book/item/added", name: "Added", body: "New text" };
    const updated = { ...changed, name: "New name", body: "Changed text", rev: 2 };
    await Effect.runPromise(
      sources.handle(
        "PUT",
        `compendium/overrides/${encodeURIComponent(changed.id)}`,
        {
          baseRev: 1,
          patch: { name: "Table name", body: "Table text" },
        },
        "dm",
      ),
    );
    await Effect.runPromise(
      sources.handle("PUT", `compendium/blocked/${encodeURIComponent(removed.id)}`, {}, "dm"),
    );
    const offered = await offer([updated, ...entries.slice(2), added]);
    await Effect.runPromise(sources.check());
    const listed = Schema.decodeUnknownSync(WorldLibraries)(
      await Effect.runPromise(sources.list()),
    );
    expect(listed.enabled[0].update).toEqual({
      fromVersion: 1,
      toVersion: 2,
      added: [added.id],
      changed: [changed.id],
      removed: [removed.id],
      names: { [added.id]: added.name, [changed.id]: updated.name, [removed.id]: removed.name },
    });
    const before = fixture.compendium.index(null, "dm");
    const read = async (id: string) =>
      Schema.decodeUnknownSync(LibraryEntryDiff)(
        await Effect.runPromise(
          sources.handle("GET", `libraries/book/diff/${encodeURIComponent(id)}`, undefined, "dm"),
        ),
      );
    expect(await read(changed.id)).toMatchObject({
      fromVersion: 1,
      toVersion: 2,
      from: { name: changed.name, body: changed.body, sourceRev: 1, sourceVersion: 1 },
      to: { name: updated.name, body: updated.body, sourceRev: 2, sourceVersion: 2 },
      overridden: true,
    });
    const addition = await read(added.id);
    expect(addition.from).toBeUndefined();
    expect(addition.to?.name).toBe("Added");
    const removal = await read(removed.id);
    expect(removal.from?.name).toBe(removed.name);
    expect(removal.to).toBeUndefined();
    expect(removal.overridden).toBe(false);
    expect(reads.get(manifest.bodyChunks[0].file.key)).toBe(1);
    expect(reads.get(offered.bodyChunks[0].file.key)).toBe(1);
    expect(reads.get(offered.publicIndex.key)).toBe(1);
    expect(fixture.compendium.index(null, "dm")).toEqual(before);
    expect(await Effect.runPromise(sources.resolve(changed.id, "dm"))).toMatchObject({
      name: "Table name",
      body: "Table text",
      sourceVersion: 1,
    });
    const blocked = () =>
      Effect.runPromise(sources.handle("GET", "libraries/blocked", undefined, "dm"));
    expect(Schema.decodeUnknownSync(BlockedEntries)(await blocked())).toEqual({
      ids: [removed.id],
      entries: [{ id: removed.id, name: removed.name, typeId: "item" }],
    });
    const summary = listed.enabled[0].update;
    if (!summary) throw new Error("Missing update summary");
    const { names: _names, ...legacy } = summary;
    fixture.sql.exec("UPDATE world_sources SET update_json = ?", JSON.stringify(legacy));
    expect(
      Schema.decodeUnknownSync(WorldLibraries)(await Effect.runPromise(sources.list())).enabled[0]
        .update,
    ).toEqual(legacy);
    expect((await read(changed.id)).to?.name).toBe(updated.name);
    await Effect.runPromise(sources.enable("book", { version: 2 }));
    expect(Schema.decodeUnknownSync(BlockedEntries)(await blocked())).toEqual({
      ids: [removed.id],
      entries: [{ id: removed.id }],
    });
  } finally {
    fixture.db.close();
  }
});

it("returns typed missing and forbidden diff failures and rejects a corrupt offered body", async () => {
  const fixture = sqlite();
  try {
    const { sources, entries, files, offer } = await sourceFixture(fixture);
    await Effect.runPromise(sources.enable("book", {}));
    const path = `libraries/book/diff/${encodeURIComponent(entries[0].id)}`;
    const response = (path: string, role = "dm") =>
      worldResponse(sources.handle("GET", path, undefined, role).pipe(Effect.mapError(apiError)));
    expect((await response(path)).status).toBe(404);
    const offered = await offer([{ ...entries[0], body: "New text", rev: 2 }]);
    await Effect.runPromise(sources.check());
    expect((await response(path, "player")).status).toBe(403);
    expect((await response("libraries/book/diff/book%2Fitem%2Fmissing")).status).toBe(404);
    const before = fixture.compendium.index(null, "dm");
    files.set(offered.bodyChunks[0].file.key, new Uint8Array([0]));
    expect((await response(path)).status).toBe(503);
    expect(fixture.compendium.index(null, "dm")).toEqual(before);
  } finally {
    fixture.db.close();
  }
});

it("validates imported source rights at the pack boundary and rolls back a mixed write", async () => {
  const fixture = sqlite();
  try {
    const { sources, entries } = await sourceFixture(fixture);
    await Effect.runPromise(sources.enable("book", {}));
    const base = await Effect.runPromise(sources.resolve(entries[0].id, "dm"));
    if (!base?.licence) throw new Error("Missing fixture library entry");
    const local = {
      ...base,
      id: "world/item/local",
      name: "Local",
      sourceRev: undefined,
      sourceVersion: undefined,
      licence: undefined,
    };
    const pack = {
      format: "ttrpg-pack",
      version: 2,
      name: "Fixture",
      types: [type],
      entries: [local, { ...base, name: "Table gear" }],
    };
    const before = fixture.compendium.index(null, "dm");
    const invalid = await worldResponse(
      fixture.compendium.handle(
        "POST",
        "compendium/import",
        {
          ...pack,
          entries: [
            local,
            {
              ...base,
              licence: {
                ...base.licence,
                attribution: `${base.licence.attribution}${"x".repeat(8000)}`,
              },
            },
          ],
        },
        "dm",
        "Fixture",
      ),
    );
    expect(invalid.status).toBe(400);
    expect(fixture.compendium.index(null, "dm")).toEqual(before);
    fixture.sql.exec(
      "CREATE TRIGGER reject_local BEFORE INSERT ON compendium_entries WHEN new.id = 'world/item/local' BEGIN SELECT RAISE(ABORT, 'fixture'); END",
    );
    const failed = await worldResponse(
      fixture.compendium.handle("POST", "compendium/import", pack, "dm", "Fixture"),
    );
    expect(failed.status).toBe(503);
    expect(fixture.compendium.index(null, "dm")).toEqual(before);
    expect(fixture.sql.exec("SELECT * FROM entry_overrides").toArray()).toEqual([]);
    fixture.sql.exec("DROP TRIGGER reject_local");
    const imported = await worldResponse(
      fixture.compendium.handle("POST", "compendium/import", pack, "dm", "Fixture"),
    );
    expect(imported.status).toBe(200);
    expect(fixture.compendium.index(null, "dm").rev).toBe(before.rev + 1);
    expect(
      fixture.compendium
        .index(String(before.rev), "dm")
        .upserts.map((entry) => entry.id)
        .sort(),
    ).toEqual([base.id, local.id].sort());
  } finally {
    fixture.db.close();
  }
});

it("fails a stale mixed import with Conflict before applying either layer", async () => {
  const fixture = sqlite();
  try {
    Effect.runSync(fixture.compendium.migrate());
    const library = row("book/item/sword");
    fixture.transactionSync(() => fixture.compendium.replaceSourceRows("book", [library], [type]));
    let applied = false;
    fixture.compendium.setSources({
      available: true,
      ownsType: () => true,
      resolve: () => Effect.succeed(undefined),
      bodies: () => Effect.succeed(new Map()),
      exportEntries: () => Effect.succeed([]),
      prepareImport: () =>
        Effect.sync(() => {
          fixture.transactionSync(() =>
            fixture.compendium.updateSourceEntry("book", library.id, library),
          );
          return {
            apply: () => {
              applied = true;
            },
          };
        }),
    });
    const entry = {
      typeId: "item",
      name: "Sword",
      tags: [],
      body: "",
      fields: {},
      visibility: "public",
    };
    const imported = fixture.compendium.handle(
      "POST",
      "compendium/import",
      {
        format: "ttrpg-pack",
        version: 2,
        name: "Fixture",
        types: [type],
        entries: [
          { ...entry, id: "world/item/local" },
          {
            ...entry,
            id: library.id,
            sourceVersion: 1,
            sourceRev: 1,
            licence: { id: "CC0", name: "CC0", attribution: "Authors", shareAlike: false },
          },
        ],
      },
      "dm",
      "Fixture",
    );
    const reply = await toReply(imported, Effect.runPromiseExit);
    expect(reply).toEqual({
      ok: false,
      error: { _tag: "Conflict", message: "Compendium changed while importing; retry the import" },
    });
    expect(applied).toBe(false);
    expect(fixture.compendium.list().entries).toEqual([]);
    const response = await worldResponse(imported);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Compendium changed while importing; retry the import",
    });
  } finally {
    fixture.db.close();
  }
});

it("returns typed failures for invalid input and DM-only requests", async () => {
  const fixture = sqlite();
  try {
    Effect.runSync(fixture.compendium.migrate());
    const invalid = await Effect.runPromise(
      fixture.compendium
        .handle(
          "POST",
          "compendium/bodies",
          { ids: Array.from({ length: 101 }, () => "world/item/sword") },
          "player",
          "Fixture",
        )
        .pipe(Effect.result),
    );
    expect(invalid._tag).toBe("Failure");
    if (invalid._tag === "Failure") expect(invalid.failure).toBeInstanceOf(BadRequest);
  } finally {
    fixture.db.close();
  }
});

it("leaves legacy entries intact when the migration backup fails", async () => {
  const fixture = sqlite(unavailableBucket("R2 unavailable"));
  try {
    Effect.runSync(fixture.compendium.migrate());
    fixture.sql.exec("CREATE TABLE characters (id TEXT PRIMARY KEY, template_id TEXT, data TEXT)");
    fixture.sql.exec(
      "INSERT INTO compendium_entries (id, type_id, name, tags, body, fields, visibility, updated_at) VALUES ('ent_old', 'item', 'Old', '[]', '', '{}', 'public', '2026-10-01')",
    );
    const before = fixture.compendium.list();
    const result = await Effect.runPromise(fixture.compendium.ensureMigrated().pipe(Effect.result));
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(result.failure).toBeInstanceOf(Unavailable);
    expect(fixture.compendium.list()).toEqual(before);
    expect(fixture.sql.exec("SELECT * FROM compendium_aliases").toArray()).toEqual([]);
    expect(
      fixture.sql.exec("SELECT value FROM settings WHERE key = 'compendium_ids'").toArray(),
    ).toEqual([]);
  } finally {
    fixture.db.close();
  }
});
