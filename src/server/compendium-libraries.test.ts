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
import { corpusClient, corpusEdge, corpusStatus } from "./corpus-env";
import {
  CorpusNotFound,
  CorpusForbidden,
  CorpusInvalid,
  CorpusConflict,
  CorpusUnavailable,
  CorpusError,
} from "../domain/corpus-errors";
import type { CorpusApi } from "../domain/corpus-rpc";
import type { CompendiumEntry, EntryType, IndexRow } from "../domain/compendium";
import { librarySource } from "../domain/entry-id";

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

const sqlite = () => {
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
  const compendium = new WorldCompendium({
    sql,
    transactionSync,
    broadcast: () => {},
    bucket: {} as R2Bucket,
    worldId: "fixture",
  });
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
    fixture.compendium.migrate();
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
    fixture.compendium.migrate();
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
    fixture.compendium.migrate();
    const sword = row("book/item/sword");
    const shield = row("book/item/shield");
    fixture.transactionSync(() =>
      fixture.compendium.replaceSourceRows("book", [sword, shield], [type]),
    );
    fixture.compendium.setSources({
      available: true,
      ownsType: () => true,
      resolve: async () => undefined,
      bodies: async () => new Map(),
      exportEntries: async () => [],
      prepareImport: async () => ({ apply: () => {} }),
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
    expect(reads.get(manifest.bodyChunks[0].file.key)).toBeUndefined();
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
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { sources, entries } = await sourceFixture(fixture, async () => {
      started?.();
      await pause;
    });
    await Effect.runPromise(sources.enable("book", {}));
    const reading = Effect.runPromise(sources.resolve(entries[0].id, "player"));
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
    const result = await Effect.runPromise(Effect.result(sources.enable("book", {})));
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(result.failure._tag).toBe("CorpusUnavailable");
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
  fixture.compendium.migrate();
  const licence = { id: "CC0", name: "CC0", attribution: "Fixture authors", shareAlike: false };
  const entries: CompendiumEntry[] = Array.from({ length: 100 }, (_, n) => ({
    ...row(`book/item/gear-${n}`),
    body: "Gear",
    fields: {},
  }));
  const files = new Map<string, Uint8Array>();
  const keys = snapshotKeys("book", 1);
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
  const manifest: SnapshotManifest = {
    format: "ttrpg-corpus",
    formatVersion: 1,
    sourceId: "book",
    sourceName: "Book",
    systemId: "system",
    version: 1,
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
      getLatest: async () => ({ ok: true, value: manifest }),
      getManifest: async () => ({ ok: true, value: manifest }),
    }),
  );
  const sources = await Effect.runPromise(
    WorldSources.make(fixture.compendium).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(SourceStorage, {
            sql: fixture.sql,
            transactionSync: fixture.transactionSync,
          }),
          Layer.succeed(CorpusClient, client),
          Layer.succeed(CorpusBucket, bucket),
          Layer.succeed(CorpusAccountId, () => "account"),
        ),
      ),
    ),
  );
  await Effect.runPromise(sources.migrate());
  fixture.compendium.setSources({
    available: true,
    ownsType: (id) => sources.ownsType(id),
    resolve: (id, role) => Effect.runPromise(sources.resolve(id, role)),
    bodies: (ids, role) => Effect.runPromise(sources.bodies(ids, role)),
    exportEntries: () => Effect.runPromise(sources.exportEntries()),
    prepareImport: (entries) => Effect.runPromise(sources.prepareImport(entries)),
  });
  return { sources, files, reads, manifest, entries };
};

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
    const invalid = await fixture.compendium.handle(
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
    );
    expect(invalid.status).toBe(400);
    expect(fixture.compendium.index(null, "dm")).toEqual(before);
    fixture.sql.exec(
      "CREATE TRIGGER reject_local BEFORE INSERT ON compendium_entries WHEN new.id = 'world/item/local' BEGIN SELECT RAISE(ABORT, 'fixture'); END",
    );
    const failed = await fixture.compendium.handle(
      "POST",
      "compendium/import",
      pack,
      "dm",
      "Fixture",
    );
    expect(failed.status).toBe(503);
    expect(fixture.compendium.index(null, "dm")).toEqual(before);
    expect(fixture.sql.exec("SELECT * FROM entry_overrides").toArray()).toEqual([]);
    fixture.sql.exec("DROP TRIGGER reject_local");
    const imported = await fixture.compendium.handle(
      "POST",
      "compendium/import",
      pack,
      "dm",
      "Fixture",
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
