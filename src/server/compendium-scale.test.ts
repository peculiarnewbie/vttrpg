// @vitest-environment node
import * as Schema from "effect/Schema";
import { afterAll, beforeAll, expect, it } from "vitest";
import { CompendiumEntry, IndexDelta, compendiumLimits } from "../domain/compendium";
import { ServerFrame } from "../domain/schemas";
import { startTabletop, type Tabletop } from "../test/miniflare";

let tabletop: Tabletop;
let cookie = "";
let worldId = "";
const call = (suffix: string, options: { method?: string; body?: unknown } = {}) =>
  tabletop.call(`/worlds/${worldId}/compendium${suffix}`, options);

const search = async (
  connection: Awaited<ReturnType<Tabletop["connect"]>>,
  requestId: string,
  query: string,
) => {
  const start = performance.now();
  const result = await new Promise<Extract<ServerFrame, { type: "search.result" }>>(
    (resolve, reject) => {
      const timeout = setTimeout(() => {
        connection.socket.removeEventListener("message", receive);
        reject(new Error("Search timed out"));
      }, 5000);
      const receive = (event: { data: unknown }) => {
        const frame = Schema.decodeUnknownSync(ServerFrame)(JSON.parse(String(event.data)));
        if (frame.type !== "search.result" || frame.requestId !== requestId) return;
        clearTimeout(timeout);
        connection.socket.removeEventListener("message", receive);
        resolve(frame);
      };
      connection.socket.addEventListener("message", receive);
      connection.send({ type: "search", requestId, query, limit: 20 });
    },
  );
  return { result, elapsed: performance.now() - start };
};

beforeAll(async () => {
  tabletop = await startTabletop({ cookie: () => cookie, unsafeInspectDurableObjects: true });
  cookie = await tabletop.signin("scale@example.test", "DM");
  worldId = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(
    await (await tabletop.call("/worlds", { method: "POST", body: { name: "Scale" } })).json(),
  ).id;
  await call("/types/item", { method: "PUT", body: { id: "item", name: "Item", fields: [] } });
  const db = await tabletop.mf.unsafeGetDurableObjectStorage("tabletop", "WorldDO", {
    name: `world:${worldId}`,
  });
  // Seed bodies too: index and search must not deserialize or return this bulk text.
  await db.exec(
    `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
    INSERT INTO compendium_entries (id, type_id, name, tags, body, fields, visibility, updated_at, rev, name_key, name_words, tags_key, text_key)
    SELECT 'world/item/entry-' || i, 'item', 'Entry ' || i, '[]', ?, '{}', 'public',
      '2026-01-01T00:00:00Z', 1, 'entry ' || i, 'entry ' || i, '', 'a forgotten artifact' FROM n`,
    compendiumLimits.entries - 1,
    "A forgotten artifact. ".repeat(100),
  );
}, 30000);
afterAll(async () => {
  await tabletop?.dispose();
});

it("keeps 10000-entry indexes small, search quick, and one edit's delta to one row", async () => {
  const response = await call("/index");
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(new TextEncoder().encode(text).byteLength).toBeLessThan(2 * 1024 * 1024);
  const full = Schema.decodeUnknownSync(IndexDelta)(JSON.parse(text));
  expect(full.full).toBe(true);
  expect(full.upserts).toHaveLength(compendiumLimits.entries);
  const connection = await tabletop.connect({ worldId, cookie });
  try {
    await connection.sync();
    const names = full.upserts.map((row) => row.name).sort();
    const times: number[] = [];
    const misses: number[] = [];
    for (let i = 0; i < 20; i++) {
      const { result, elapsed } = await search(
        connection,
        `scale-${i}`,
        i % 2 ? `entry ${i}` : "forgotten",
      );
      times.push(elapsed);
      expect(result.results).toHaveLength(20);
      expect(result.results.map((row) => row.name)).toEqual(
        (i % 2 ? names.filter((name) => name.startsWith(`Entry ${i}`)) : names).slice(0, 20),
      );
      expect(result.results.every((row) => !("body" in row) && !("fields" in row))).toBe(true);
      const miss = await search(connection, `missing-${i}`, i % 2 ? "unfindablexyz" : "zz");
      misses.push(miss.elapsed);
      expect(miss.result.results).toEqual([]);
    }
    // Round trips include transport and decode overhead; medians avoid scheduler
    // outliers while allowing headroom over the 15 ms / 5 ms DO CPU targets.
    times.sort((a, b) => a - b);
    misses.sort((a, b) => a - b);
    expect(times[10]).toBeLessThan(40);
    expect(misses[10]).toBeLessThan(20);
  } finally {
    connection.socket.close();
  }
  const saved = Schema.decodeUnknownSync(CompendiumEntry)(
    await (
      await call("/entries", {
        method: "POST",
        body: {
          id: "world/item/entry-42",
          typeId: "item",
          name: "Changed",
          tags: [],
          body: "New text",
          fields: {},
          visibility: "public",
        },
      })
    ).json(),
  );
  const delta = Schema.decodeUnknownSync(IndexDelta)(
    await (await call(`/index?since=${full.rev}`)).json(),
  );
  expect(delta).toMatchObject({
    full: false,
    rev: saved.rev,
    deletes: [],
    upserts: [{ id: saved.id, name: "Changed" }],
  });
  expect(delta.upserts).toHaveLength(1);
}, 30000);

it("upgrades populated text-only FTS indexes once and keeps both indexes in sync", async () => {
  const id = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(
    await (
      await tabletop.call("/worlds", { method: "POST", body: { name: "FTS upgrade" } })
    ).json(),
  ).id;
  const path = `/worlds/${id}/compendium`;
  await tabletop.call(`${path}/types/item`, {
    method: "PUT",
    body: { id: "item", name: "Item", fields: [] },
  });
  const saved = Schema.decodeUnknownSync(CompendiumEntry)(
    await (
      await tabletop.call(`${path}/entries`, {
        method: "POST",
        body: {
          typeId: "item",
          name: "Old flame",
          tags: ["enchanted"],
          body: "Moonlit",
          fields: {},
          visibility: "public",
        },
      })
    ).json(),
  );
  const db = await tabletop.mf.unsafeGetDurableObjectStorage("tabletop", "WorldDO", {
    name: `world:${id}`,
  });
  // Reproduce an existing world's pre-upgrade FTS schema and settings.
  await db.exec(`DROP TRIGGER compendium_fts_insert;
    DROP TRIGGER compendium_fts_delete;
    DROP TRIGGER compendium_fts_update;
    DROP TABLE compendium_fts;
    DROP TABLE compendium_tags_fts;
    DELETE FROM settings WHERE key = 'compendium_fts_version';
    CREATE VIRTUAL TABLE compendium_fts USING fts5(id UNINDEXED, text_key);
    INSERT INTO compendium_fts (rowid, id, text_key) SELECT rowid, id, text_key FROM compendium_entries;
    CREATE TRIGGER compendium_fts_insert AFTER INSERT ON compendium_entries BEGIN
      INSERT INTO compendium_fts (rowid, id, text_key) VALUES (new.rowid, new.id, new.text_key); END;
    CREATE TRIGGER compendium_fts_delete AFTER DELETE ON compendium_entries BEGIN
      DELETE FROM compendium_fts WHERE rowid = old.rowid; END;
    CREATE TRIGGER compendium_fts_update AFTER UPDATE OF id, text_key ON compendium_entries BEGIN
      DELETE FROM compendium_fts WHERE rowid = old.rowid;
      INSERT INTO compendium_fts (rowid, id, text_key) VALUES (new.rowid, new.id, new.text_key); END;`);
  const evict = () =>
    tabletop.mf.unsafeEvictDurableObject("tabletop", "WorldDO", { name: `world:${id}` });
  await evict();
  const index = Schema.decodeUnknownSync(IndexDelta)(
    await (await tabletop.call(`${path}/index`)).json(),
  );
  expect(index.rev).toBe(saved.rev);
  expect(await db.exec("SELECT value FROM settings WHERE key = 'compendium_fts_version'")).toEqual([
    { value: "3" },
  ]);
  // A sentinel posting would disappear if initialization rebuilt the index again.
  await db.exec(`INSERT INTO compendium_fts (rowid, id, name_words, tags_key, text_key)
    VALUES (-1, 'migration-sentinel', '', '', 'migration sentinel')`);
  await evict();
  await tabletop.call(`${path}/index`);
  expect(await db.exec("SELECT id FROM compendium_fts WHERE rowid = -1")).toEqual([
    { id: "migration-sentinel" },
  ]);
  await db.exec("DELETE FROM compendium_fts WHERE rowid = -1");
  const connection = await tabletop.connect({ worldId: id, cookie });
  try {
    await connection.sync();
    for (const query of ["FLÂME", "chant", "an", "moonlit"])
      expect((await search(connection, `rebuilt-${query}`, query)).result.results).toMatchObject([
        { id: saved.id },
      ]);
    expect((await search(connection, "all-words", "great flame")).result.results).toEqual([]);
    const changed = Schema.decodeUnknownSync(CompendiumEntry)(
      await (
        await tabletop.call(`${path}/entries`, {
          method: "POST",
          body: { ...saved, name: "New spark", tags: ["radiant"], body: "Daylight" },
        })
      ).json(),
    );
    for (const query of ["flame", "chant", "moonlit"])
      expect((await search(connection, `removed-${query}`, query)).result.results).toEqual([]);
    for (const query of ["spark", "diant", "daylight"])
      expect((await search(connection, `updated-${query}`, query)).result.results).toMatchObject([
        { id: changed.id },
      ]);
    await tabletop.call(`${path}/entries/${encodeURIComponent(saved.id)}`, { method: "DELETE" });
    for (const query of ["spark", "diant", "daylight"])
      expect((await search(connection, `deleted-${query}`, query)).result.results).toEqual([]);
  } finally {
    connection.socket.close();
  }
}, 30000);
