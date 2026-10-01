// @vitest-environment node
import * as Schema from "effect/Schema";
import { startTabletop, type Tabletop, type CallOptions } from "../test/miniflare";
import type { Caller } from "./world-rpc";
import type { Reply } from "./reply";
import type { CompendiumRequest } from "./world-do";
import { Character } from "../domain/schemas";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  Compendium,
  CompendiumEntry,
  CompendiumPack,
  ImportPackResult,
  IndexDelta,
  EntryBodies,
  compendiumLimits,
  type EntryType,
  type SaveEntryInput,
} from "../domain/compendium";

let tabletop: Tabletop;
let mf: Tabletop["mf"];
let cookie = "";
let worldId = "";
let playerCookie = "";
const call = (path: string, options: CallOptions = {}) => tabletop.call(path, options);
beforeAll(async () => {
  tabletop = await startTabletop({
    cookie: () => cookie,
    unsafeInspectDurableObjects: true,
  });
  mf = tabletop.mf;
  cookie = await tabletop.signin("dm@example.test", "DM");
}, 30000);
beforeEach(async () => {
  const world = await call("/worlds", { method: "POST", body: { name: "Compendium test 界" } });
  worldId = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await world.json()).id;
  const membership = await call(`/worlds/${worldId}/members`, {
    method: "POST",
    body: { displayName: "Player", role: "player", kind: "invite", email: "player@example.test" },
  });
  expect(membership.status).toBe(201);
  playerCookie = await tabletop.signin("player@example.test", "Player");
}, 30000);
afterAll(async () => {
  await tabletop?.dispose();
});

const type: EntryType = {
  id: "item",
  name: "Item",
  plural: "Items",
  fields: [
    { key: "cost", label: "Cost", kind: "number" },
    { key: "dice", label: "Dice", kind: "dice" },
  ],
};
const entry: SaveEntryInput = {
  typeId: "item",
  name: "Sword",
  tags: ["gear"],
  body: "A plain sword.",
  fields: { cost: 5, dice: "1d6" },
  visibility: "public",
};
const compendiumCall = (
  suffix = "",
  options: { method?: string; body?: unknown; cookie?: string } = {},
  id = worldId,
) => call(`/worlds/${id}/compendium${suffix}`, options);
const saveType = (body = type) => compendiumCall(`/types/${body.id}`, { method: "PUT", body });
const saveEntry = (body: unknown = entry, authCookie = cookie) =>
  compendiumCall("/entries", { method: "POST", body, cookie: authCookie });
const read = async (authCookie = cookie, id = worldId) =>
  Schema.decodeUnknownSync(Compendium)(
    await (await compendiumCall("", { cookie: authCookie }, id)).json(),
  );
const exported = async () =>
  Schema.decodeUnknownSync(CompendiumPack)(await (await compendiumCall("/export")).json());
const importPack = (body: unknown, id = worldId) =>
  compendiumCall("/import", { method: "POST", body }, id);
const decodedEntry = async (response: Awaited<ReturnType<typeof call>>) =>
  Schema.decodeUnknownSync(CompendiumEntry)(await response.json());

// These exercise the public API and the SQLite-backed DO rather than mocked storage.
describe("compendium through real Worker, D1 and SQLite DO", () => {
  it("creates and updates entries and preserves type insertion order", async () => {
    expect((await saveType()).status).toBe(200);
    const saved = await decodedEntry(await saveEntry());
    expect(saved.id).toBe("world/item/sword");
    expect(saved.rev).toBe(2);
    expect(saved.updatedAt).toBeTypeOf("string");
    expect(await read()).toEqual({ types: [type], entries: [saved] });
    const second = { ...type, id: "spell", name: "Spell" };
    expect((await saveType(second)).status).toBe(200);
    expect((await saveType({ ...type, name: "Equipment" })).status).toBe(200);
    expect((await saveEntry({ ...entry, id: saved.id, typeId: second.id })).status).toBe(400);
    const changed = await decodedEntry(
      await saveEntry({ ...entry, id: saved.id, name: "New entry" }),
    );
    expect(changed.id).toBe(saved.id);
    expect((await read()).types.map((item) => item.id)).toEqual(["item", "spell"]);
    expect((await read()).entries).toEqual([changed]);
    expect(changed.typeId).toBe("item");
    expect((await saveEntry({ ...entry, id: "ent_unknown" })).status).toBe(404);
  });

  it("returns every type but hides DM entries from players", async () => {
    await saveType();
    const visible = await decodedEntry(await saveEntry());
    await saveEntry({ ...entry, name: "Secret", visibility: "dm" });
    expect((await read()).entries).toHaveLength(2);
    expect(await read(playerCookie)).toEqual({ types: [type], entries: [visible] });
  });

  it("denies every player write and export, including at the DO boundary", async () => {
    await saveType();
    const saved = await decodedEntry(await saveEntry());
    const pack = await exported();
    for (const [method, suffix, body] of [
      ["PUT", "/types/item", type],
      ["DELETE", "/types/item", undefined],
      ["POST", "/entries", entry],
      ["POST", "/entries", { ...entry, id: saved.id }],
      ["DELETE", `/entries/${encodeURIComponent(saved.id)}`, undefined],
      ["POST", "/import", pack],
      ["GET", "/export", undefined],
    ] as const) {
      expect((await compendiumCall(suffix, { method, body, cookie: playerCookie })).status).toBe(
        403,
      );
      // The DO enforces the rule itself, not only the HTTP route.
      const namespace = await mf.getDurableObjectNamespace("WORLDS");
      const stub = namespace.get(namespace.idFromName(`world:${worldId}`)) as unknown as {
        compendium: (caller: Caller, request: CompendiumRequest) => Promise<Reply<unknown>>;
      };
      const reply = await stub.compendium(
        { memberId: "player", role: "player", displayName: "Player" },
        {
          method,
          path: `compendium${suffix}`,
          query: {},
          body,
          worldName: "World",
          accountId: "account",
        },
      );
      expect(reply).toMatchObject({ ok: false, error: { _tag: "Forbidden" } });
    }
  });

  it.each([
    { ...entry, fields: { unknown: "value" } },
    { ...entry, fields: { cost: "five" } },
    { ...entry, body: "x".repeat(12001) },
    { ...entry, typeId: "missing" },
    { ...entry, fields: { dice: "x".repeat(41) } },
    { ...entry, body: "界".repeat(6000) },
    { ...entry, visibility: "private" },
  ])("rejects invalid entries without saving", async (invalid) => {
    await saveType();
    const response = await saveEntry(invalid);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
    expect((await read()).entries).toEqual([]);
  });

  it("rejects invalid types and URL id mismatches", async () => {
    expect(
      (await saveType({ ...type, fields: [{ key: "bad", label: "Bad", kind: "list" }] })).status,
    ).toBe(400);
    expect((await compendiumCall("/types/other", { method: "PUT", body: type })).status).toBe(400);
    expect((await read()).types).toEqual([]);
  });

  it("returns 409 for a populated type and 204 when entries and types are deleted", async () => {
    await saveType();
    const saved = await decodedEntry(await saveEntry());
    const response = await compendiumCall("/types/item", { method: "DELETE" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
    const deleted = await compendiumCall(`/entries/${encodeURIComponent(saved.id)}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
    expect((await compendiumCall("/types/item", { method: "DELETE" })).status).toBe(204);
    expect(await read()).toEqual({ types: [], entries: [] });
  });

  it("exports all entries and imports into another world, updating matching ids in place", async () => {
    await saveType();
    await saveEntry();
    await saveEntry({ ...entry, name: "Secret", visibility: "dm" });
    const pack = await exported();
    expect(pack.version).toBe(2);
    expect(pack.entries.every((item) => !("rev" in item) && !("updatedAt" in item))).toBe(true);
    expect(pack.name).toBe("Compendium test 界");
    expect(pack.entries).toHaveLength(2);
    const secondWorld = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(
      await (await call("/worlds", { method: "POST", body: { name: "Destination" } })).json(),
    ).id;
    const imported = await importPack(pack, secondWorld);
    expect(imported.status).toBe(200);
    expect(Schema.decodeUnknownSync(ImportPackResult)(await imported.json())).toEqual({
      types: 1,
      created: 2,
      updated: 0,
    });
    const loaded = await read(cookie, secondWorld);
    expect(loaded.types).toEqual(pack.types);
    expect(
      loaded.entries
        .map(({ updatedAt: _updatedAt, rev: _rev, ...item }) => item)
        .sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual([...pack.entries].sort((a, b) => a.id.localeCompare(b.id)));
    const changed = {
      ...pack,
      types: [{ ...type, name: "Equipment" }],
      entries: pack.entries.map((item) => ({ ...item, name: `${item.name} edited` })),
    };
    expect(await (await importPack(changed, secondWorld)).json()).toEqual({
      types: 1,
      created: 0,
      updated: 2,
    });
    expect((await read(cookie, secondWorld)).entries).toHaveLength(2);
    expect(
      (await read(cookie, secondWorld)).entries.every((item) => item.name.endsWith(" edited")),
    ).toBe(true);
    expect((await read(cookie, secondWorld)).types[0].name).toBe("Equipment");
  });

  it("validates the whole pack before writing any types or entries", async () => {
    await saveType();
    await saveEntry();
    const before = await read();
    const pack = await exported();
    const bad = {
      ...pack,
      types: [
        { ...type, name: "Changed" },
        { id: "new", name: "New", fields: [] },
      ],
      entries: [
        { ...pack.entries[0], name: "Changed" },
        { ...pack.entries[0], id: "ent_bad", fields: { cost: "wrong" } },
      ],
    };
    expect((await importPack(bad)).status).toBe(400);
    expect(await read()).toEqual(before);
    expect(
      (await importPack({ ...pack, entries: [pack.entries[0], pack.entries[0]] })).status,
    ).toBe(400);
    expect(await read()).toEqual(before);
    expect((await importPack({ ...pack, name: "x".repeat(4 * 1024 * 1024) })).status).toBe(400);
    expect(await read()).toEqual(before);
  });

  it("allows importing entries that use an existing type", async () => {
    await saveType();
    const response = await importPack({
      format: "ttrpg-pack",
      version: 1,
      name: "Gear",
      types: [],
      entries: [{ ...entry, id: "ent_imported" }],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ types: 0, created: 1, updated: 0 });
    expect((await read()).entries[0].id).toBe("world/item/sword");
    expect(
      await (
        await importPack({
          format: "ttrpg-pack",
          version: 1,
          name: "Gear",
          types: [],
          entries: [{ ...entry, id: "ent_imported", name: "Renamed" }],
        })
      ).json(),
    ).toEqual({ types: 0, created: 0, updated: 1 });
    expect((await read()).entries[0].id).toBe("world/item/sword");
  });

  it("broadcasts only the invalidation frame to a connected player after every write", async () => {
    const { socket, frames } = await tabletop.connect({
      worldId,
      cookie: playerCookie,
      missingSocketMessage: "Missing socket",
    });
    const updates = () => frames.filter((frame) => frame.type === "compendium.updated");
    try {
      await expect.poll(() => frames.some((frame) => frame.type === "hello")).toBe(true);
      await saveType();
      await expect.poll(() => updates().length).toBe(1);
      const hidden = await decodedEntry(await saveEntry({ ...entry, visibility: "dm" }));
      await expect.poll(() => updates().length).toBe(2);
      expect(updates()[1]).toEqual({ type: "compendium.updated", rev: hidden.rev });
      expect((await read(playerCookie)).entries).toEqual([]);
      await importPack(await exported());
      await expect.poll(() => updates().length).toBe(3);
      await compendiumCall(`/entries/${encodeURIComponent(hidden.id)}`, { method: "DELETE" });
      await expect.poll(() => updates().length).toBe(4);
      await compendiumCall("/types/item", { method: "DELETE" });
      await expect.poll(() => updates().length).toBe(5);
      expect(
        updates().map((frame) => (frame.type === "compendium.updated" ? frame.rev : undefined)),
      ).toEqual([1, 2, 3, 4, 5]);
    } finally {
      socket.close();
    }
  });

  it("enforces entry totals for create and import while allowing updates at the limit", async () => {
    const pack: CompendiumPack = {
      format: "ttrpg-pack",
      version: 1,
      name: "Full",
      types: [type],
      entries: Array.from({ length: compendiumLimits.entries }, (_, i) => ({
        ...entry,
        id: `ent_${i}`,
        name: `Sword ${i}`,
      })),
    };
    expect((await importPack(pack)).status).toBe(200);
    expect((await saveEntry()).status).toBe(400);
    expect((await saveEntry({ ...entry, id: "ent_0", name: "Updated" })).status).toBe(200);
    expect(
      await (
        await importPack({
          ...pack,
          types: [],
          entries: [{ ...entry, id: "ent_1", name: "Reimported" }],
        })
      ).json(),
    ).toEqual({ types: 0, created: 0, updated: 1 });
    expect(
      (
        await importPack({
          ...pack,
          types: [{ id: "new", name: "New", fields: [] }],
          entries: [{ ...entry, id: "ent_extra" }],
        })
      ).status,
    ).toBe(400);
    expect((await read()).entries).toHaveLength(compendiumLimits.entries);
    expect((await read()).types).toEqual([type]);
  }, 30000);

  it("enforces type totals for upserts and imports", async () => {
    const pack: CompendiumPack = {
      format: "ttrpg-pack",
      version: 1,
      name: "Full",
      types: Array.from({ length: 50 }, (_, i) => ({ id: `type_${i}`, name: "Type", fields: [] })),
      entries: [],
    };
    expect((await importPack(pack)).status).toBe(200);
    expect((await saveType()).status).toBe(400);
    expect((await saveType({ id: "type_0", name: "Updated", fields: [] })).status).toBe(200);
    expect((await importPack({ ...pack, types: [type] })).status).toBe(400);
    expect((await read()).types).toHaveLength(50);
  });
});

const index = async (since?: number | string, authCookie = cookie) =>
  Schema.decodeUnknownSync(IndexDelta)(
    await (
      await compendiumCall(`/index${since === undefined ? "" : `?since=${since}`}`, {
        cookie: authCookie,
      })
    ).json(),
  );
const bodies = async (ids: string[], authCookie = cookie) =>
  Schema.decodeUnknownSync(EntryBodies)(
    await (
      await compendiumCall("/bodies", { method: "POST", body: { ids }, cookie: authCookie })
    ).json(),
  );
const storage = () =>
  mf.unsafeGetDurableObjectStorage("tabletop", "WorldDO", { name: `world:${worldId}` });

it("syncs index revisions, includes types, and removes hidden or deleted player entries", async () => {
  await saveType();
  const visible = await decodedEntry(await saveEntry());
  const secret = await decodedEntry(
    await saveEntry({ ...entry, name: "Secret", visibility: "dm" }),
  );
  const full = await index();
  expect(full).toMatchObject({ rev: 3, full: true, types: [type], deletes: [] });
  expect(full.upserts.map((row) => row.id).sort()).toEqual([visible.id, secret.id].sort());
  expect(full.upserts.every((row) => !("body" in row) && !("fields" in row))).toBe(true);
  const player = await index(0, playerCookie);
  expect(player.upserts.map((row) => row.id)).toEqual([visible.id]);
  expect(await index(full.rev)).toEqual({
    rev: full.rev,
    full: false,
    types: [type],
    upserts: [],
    deletes: [],
  });
  const hidden = await decodedEntry(await saveEntry({ ...visible, visibility: "dm" }));
  expect(await index(player.rev, playerCookie)).toEqual({
    rev: hidden.rev,
    full: false,
    types: [type],
    upserts: [],
    deletes: [visible.id],
  });
  expect((await index(full.rev)).upserts).toMatchObject([{ id: visible.id, visibility: "dm" }]);
  await compendiumCall(`/entries/${encodeURIComponent(visible.id)}`, { method: "DELETE" });
  expect((await index(hidden.rev, playerCookie)).deletes).toEqual([visible.id]);
  expect((await index("invalid")).full).toBe(true);
  expect((await index(-1)).full).toBe(true);
  expect((await index(999999)).full).toBe(true);
  await saveType({ ...type, name: "Equipment" });
  expect((await index(hidden.rev)).types[0].name).toBe("Equipment");
});

it("bounds tombstones and replaces deltas older than discarded deletions", async () => {
  await saveType();
  const db = await storage();
  await db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 20000)
    INSERT INTO compendium_tombstones (id, rev) SELECT 'world/item/gone-' || i, i + 1 FROM n`);
  await db.exec("UPDATE settings SET value = '20001' WHERE key = 'compendium_rev'");
  await compendiumCall(`/entries/${encodeURIComponent("world/item/latest")}`, { method: "DELETE" });
  expect(await db.exec("SELECT COUNT(*) AS n FROM compendium_tombstones")).toEqual([{ n: 20000 }]);
  expect((await index(1)).full).toBe(true);
  expect((await index(2)).full).toBe(false);
  expect((await index(20001)).deletes).toEqual(["world/item/latest"]);
});

it("loads batches, resolves old aliases, and treats invisible bodies as missing", async () => {
  await saveType();
  await importPack({
    format: "ttrpg-pack",
    version: 1,
    name: "Old",
    types: [],
    entries: [{ ...entry, id: "ent_old" }],
  });
  const visible = (await read()).entries[0];
  const secret = await decodedEntry(
    await saveEntry({ ...entry, name: "Secret", visibility: "dm" }),
  );
  expect(await bodies(["ent_old", visible.id, "unknown", secret.id], playerCookie)).toEqual({
    entries: [visible],
    aliases: { ent_old: visible.id },
    missing: ["unknown", secret.id],
  });
  expect((await bodies([secret.id])).entries).toEqual([secret]);
  expect((await bodies([])).entries).toEqual([]);
  expect(
    (
      await compendiumCall("/bodies", {
        method: "POST",
        body: { ids: Array(compendiumLimits.bodiesPerRequest + 1).fill(visible.id) },
        cookie: playerCookie,
      })
    ).status,
  ).toBe(400);
  const changed = await decodedEntry(await saveEntry({ ...entry, id: "ent_old", name: "Renamed" }));
  expect(changed.id).toBe(visible.id);
  await compendiumCall("/entries/ent_old", { method: "DELETE" });
  expect((await bodies(["ent_old"])).missing).toEqual(["ent_old"]);
  const pack = {
    format: "ttrpg-pack",
    version: 2,
    name: "Restored",
    types: [],
    entries: [{ ...entry, id: visible.id }],
  };
  expect((await importPack(pack)).status).toBe(200);
  expect((await index(changed.rev)).deletes).toEqual([]);
  expect((await bodies(["ent_old"])).entries[0].id).toBe(visible.id);
});

it("uses unique stable slugs and validates version 2 world and type identity", async () => {
  await saveType();
  const first = await decodedEntry(await saveEntry());
  const second = await decodedEntry(await saveEntry());
  expect(second.id).toBe(`${first.id}-2`);
  expect(
    (
      await importPack({
        format: "ttrpg-pack",
        version: 2,
        name: "Bad",
        types: [],
        entries: [{ ...entry, id: "srd52/item/sword" }],
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await importPack({
        format: "ttrpg-pack",
        version: 2,
        name: "Bad",
        types: [],
        entries: [{ ...entry, id: "world/spell/sword" }],
      })
    ).status,
  ).toBe(400);
});

it("searches and ranks names, tags and text with accents, filters and private replies", async () => {
  await saveType({
    ...type,
    fields: [...type.fields, { key: "description", label: "Description", kind: "longtext" }],
  });
  await saveType({ id: "spell", name: "Spell", fields: [] });
  const names = [
    "Flamé",
    "Flame blade",
    "Bright-flame",
    "Great flame",
    "Inflamed",
    "Amulet",
    "Book",
    "Scroll",
  ];
  for (const name of names) {
    const saved = await saveEntry({
      ...entry,
      name,
      tags: name === "Amulet" ? ["flame"] : [],
      body: name === "Book" ? "A flame burns" : "",
      fields: name === "Scroll" ? { description: "flame magic" } : {},
    });
    expect(saved.status).toBe(200);
  }
  await saveEntry({
    ...entry,
    typeId: "spell",
    name: "Flame secret",
    fields: {},
    visibility: "dm",
  });
  const sender = await tabletop.connect({ worldId, cookie: playerCookie });
  const observer = await tabletop.connect({ worldId, cookie });
  try {
    await sender.sync();
    await observer.sync();
    sender.send({ type: "search", requestId: "rank", query: "FLÂME" });
    await expect
      .poll(() =>
        sender.frames.some((frame) => frame.type === "search.result" && frame.requestId === "rank"),
      )
      .toBe(true);
    const reply = sender.frames.find(
      (frame) => frame.type === "search.result" && frame.requestId === "rank",
    );
    expect(reply?.type === "search.result" ? reply.results.map((row) => row.name) : []).toEqual(
      names,
    );
    await observer.sync();
    expect(observer.frames.filter((frame) => frame.type === "search.result")).toEqual([]);
    sender.send({
      type: "search",
      requestId: "limited",
      query: "flame",
      typeIds: ["item"],
      limit: 2,
    });
    sender.send({ type: "search", requestId: "hidden", query: "flame", typeIds: ["spell"] });
    sender.send({ type: "search", requestId: "words", query: "great flame" });
    await sender.sync();
    expect(
      sender.frames.find(
        (frame) => frame.type === "search.result" && frame.requestId === "limited",
      ),
    ).toMatchObject({ results: [{ name: "Flamé" }, { name: "Flame blade" }] });
    expect(
      sender.frames.find((frame) => frame.type === "search.result" && frame.requestId === "hidden"),
    ).toMatchObject({ results: [] });
    expect(
      sender.frames.find((frame) => frame.type === "search.result" && frame.requestId === "words"),
    ).toMatchObject({ results: [{ name: "Great flame" }] });
    observer.send({ type: "search", requestId: "dm", query: "flame", typeIds: ["spell"] });
    await observer.sync();
    expect(
      observer.frames.find((frame) => frame.type === "search.result" && frame.requestId === "dm"),
    ).toMatchObject({ results: [{ name: "Flame secret" }] });
    sender.socket.send(
      JSON.stringify({ type: "search", requestId: "invalid", query: "flame", limit: 100 }),
    );
    await sender.sync();
    expect(
      sender.frames.find((frame) => frame.type === "error" && frame.requestId === "invalid"),
    ).toMatchObject({ code: "search", requestId: "invalid" });
  } finally {
    sender.socket.close();
    observer.socket.close();
  }
});

it("backs up legacy ids once and rewrites entry picks and copied rows before character access", async () => {
  // Inspection may activate the object; evict it after seeding to exercise initialization again.
  await read();
  const db = await storage();
  await db.exec("DELETE FROM settings WHERE key IN ('compendium_ids', 'compendium_search')");
  await db.exec(
    "INSERT INTO compendium_types (id, name, fields, position) VALUES ('item', 'Item', '[]', 0)",
  );
  for (const id of ["ent_old", "ent_other"])
    await db.exec(
      "INSERT INTO compendium_entries (id, type_id, name, tags, body, fields, visibility, updated_at) VALUES (?, 'item', 'Café Sword', '[]', 'Keep [[Café Sword]] and ent_old', '{}', 'public', '2026-01-01T00:00:00Z')",
      id,
    );
  const layout = {
    system: "Test",
    name: "Test",
    pages: [
      {
        id: "main",
        title: "Main",
        blocks: [
          { id: "pick", type: "entry", key: "chosen", entryType: "item" },
          {
            id: "inventory",
            type: "list",
            key: "inventory",
            label: "Inventory",
            columns: [{ key: "name", label: "Name", kind: "text" }],
          },
        ],
      },
    ],
  };
  await db.exec(
    "INSERT INTO templates (id, name, fields, stats, tickers, rolls, updated_at, layout) VALUES ('legacy-template', 'Legacy', '[]', '[]', '[]', '[]', '2026-01-01', ?)",
    JSON.stringify(layout),
  );
  const values = {
    chosen: "ent_old",
    inventory: [{ _entry: "ent_other", name: "Keep ent_old" }],
    text: "ent_old",
  };
  await db.exec(
    "INSERT INTO characters (id, member_id, name, template_id, data, tickers, created_at, updated_at) VALUES ('legacy-character', 'dm', 'Hero', 'legacy-template', ?, '{}', '2026-01-01', '2026-01-01')",
    JSON.stringify(values),
  );
  const nestedValues = { nested: { rows: [{ _entry: "ent_other", label: "ent_old" }] } };
  await db.exec(
    "INSERT INTO characters (id, member_id, name, template_id, data, tickers, created_at, updated_at) VALUES ('nested-character', 'dm', 'Nested', 'legacy-template', ?, '{}', '2026-01-01', '2026-01-01')",
    JSON.stringify(nestedValues),
  );
  await mf.unsafeEvictDurableObject("tabletop", "WorldDO", { name: `world:${worldId}` });
  const characters = Schema.decodeUnknownSync(Schema.Array(Character))(
    await (await call(`/worlds/${worldId}/characters`)).json(),
  );
  expect(characters.find((character) => character.id === "legacy-character")?.values).toEqual({
    chosen: "world/item/cafe-sword",
    inventory: [{ _entry: "world/item/cafe-sword-2", name: "Keep ent_old" }],
    text: "ent_old",
  });
  const nested = await db.exec<{ data: string }>(
    "SELECT data FROM characters WHERE id = 'nested-character'",
  );
  expect(JSON.parse(nested[0].data)).toEqual({
    nested: { rows: [{ _entry: "world/item/cafe-sword-2", label: "ent_old" }] },
  });
  const loaded = await read();
  expect(loaded.entries.map((item) => item.id).sort()).toEqual([
    "world/item/cafe-sword",
    "world/item/cafe-sword-2",
  ]);
  expect(loaded.entries.every((item) => item.rev === 1 && item.body.includes("ent_old"))).toBe(
    true,
  );
  expect((await bodies(["ent_old", "ent_other"])).aliases).toEqual({
    ent_old: "world/item/cafe-sword",
    ent_other: "world/item/cafe-sword-2",
  });
  const bucket = await mf.getR2Bucket("BUCKET");
  const backup = await bucket.list({ prefix: `world/${worldId}/backups/compendium-` });
  expect(backup.objects).toHaveLength(1);
  const object = await bucket.get(backup.objects[0].key);
  expect(await object?.json()).toMatchObject({
    entries: [{ id: "ent_old" }, { id: "ent_other" }],
    characters: [
      { id: "legacy-character", values },
      { id: "nested-character", values: nestedValues },
    ],
  });
  await mf.unsafeEvictDurableObject("tabletop", "WorldDO", { name: `world:${worldId}` });
  expect(await read()).toEqual(loaded);
  expect(
    (await bucket.list({ prefix: `world/${worldId}/backups/compendium-` })).objects,
  ).toHaveLength(1);
});

it("stores facets in index deltas and search, refreshes them on type changes and removes absent filters", async () => {
  const filtered: EntryType = { ...type, filters: [{ key: "cost", kind: "range" }] };
  expect((await saveType(filtered)).status).toBe(200);
  const saved = await decodedEntry(await saveEntry());
  const initial = await index(0, playerCookie);
  expect(initial.types).toEqual([filtered]);
  expect(initial.upserts).toMatchObject([{ id: saved.id, facets: { cost: 5 } }]);
  const peer = await tabletop.connect({ worldId, cookie: playerCookie });
  const search = async (requestId: string) => {
    peer.send({ type: "search", requestId, query: "sword" });
    await peer.sync();
    const result = peer.frames.find(
      (frame) => frame.type === "search.result" && frame.requestId === requestId,
    );
    return result?.type === "search.result" ? result.results : [];
  };
  try {
    expect(await search("original")).toMatchObject([{ id: saved.id, facets: { cost: 5 } }]);
    const changed: EntryType = { ...type, filters: [{ key: "dice", kind: "flag" }] };
    expect((await saveType(changed)).status).toBe(200);
    const delta = await index(initial.rev, playerCookie);
    expect(delta.full).toBe(false);
    expect(delta.rev).toBeGreaterThan(initial.rev);
    expect(delta.upserts).toMatchObject([{ id: saved.id, rev: delta.rev, facets: { dice: true } }]);
    expect(await search("changed")).toMatchObject([{ id: saved.id, facets: { dice: true } }]);
    expect((await saveType()).status).toBe(200);
    const cleared = await index(delta.rev, playerCookie);
    expect(cleared.upserts).toHaveLength(1);
    expect(cleared.upserts[0].facets).toBeUndefined();
    expect((await search("cleared"))[0].facets).toBeUndefined();
  } finally {
    peer.socket.close();
  }
});

it("computes facets for imported entries and existing entries when a pack changes filters", async () => {
  await saveType({ ...type, filters: [{ key: "cost", kind: "range" }] });
  const saved = await decodedEntry(await saveEntry());
  const before = await index(0);
  const importedType: EntryType = { ...type, filters: [{ key: "dice", kind: "flag" }] };
  const response = await importPack({
    format: "ttrpg-pack",
    version: 2,
    name: "Equipment",
    types: [importedType],
    entries: [{ ...entry, id: "world/item/axe", name: "Axe" }],
  });
  expect(response.status).toBe(200);
  const delta = await index(before.rev);
  expect(delta.types).toEqual([importedType]);
  expect(
    delta.upserts
      .map((row) => ({ id: row.id, facets: row.facets }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  ).toEqual([
    { id: "world/item/axe", facets: { dice: true } },
    { id: saved.id, facets: { dice: true } },
  ]);
});

const oracleType: EntryType = {
  id: "oracle",
  name: "Oracle",
  fields: [
    { key: "action", label: "Action", kind: "oracle", dice: "1d6" },
    { key: "description", label: "Description", kind: "text" },
  ],
};
const oracleEntry: SaveEntryInput = {
  typeId: "oracle",
  name: "Action oracle",
  tags: [],
  body: "Players decide what this means.",
  fields: {
    action: [
      { min: 1, max: 3, text: "Explore" },
      { min: 4, max: 6, text: "Discover" },
    ],
    description: "Content",
  },
  visibility: "public",
};

it("rolls a visible oracle, broadcasts and persists its table and landed row without applying effects", async () => {
  expect((await saveType(oracleType)).status).toBe(200);
  const saved = await decodedEntry(await saveEntry(oracleEntry));
  const peer = await tabletop.connect({ worldId, cookie: playerCookie });
  const observer = await tabletop.connect({ worldId, cookie });
  try {
    await peer.sync();
    await observer.sync();
    peer.send({ type: "roll.table", entryId: saved.id, field: "action", visibility: "public" });
    await peer.sync();
    await expect
      .poll(() =>
        observer.frames.some((frame) => frame.type === "message" && frame.message.roll?.table),
      )
      .toBe(true);
    const frame = peer.frames.find(
      (frame) => frame.type === "message" && frame.message.roll?.table,
    );
    if (frame?.type !== "message" || !frame.message.roll) throw new Error("Missing oracle message");
    const { message } = frame;
    const roll = frame.message.roll;
    expect(message).toMatchObject({
      kind: "roll",
      content: "Action oracle · Action",
      visibility: "public",
      recipientMemberIds: [],
    });
    expect(roll.table).toEqual({
      entryId: saved.id,
      entryName: saved.name,
      field: "action",
      fieldLabel: "Action",
      row:
        roll.total <= 3
          ? { min: 1, max: 3, text: "Explore" }
          : { min: 4, max: 6, text: "Discover" },
    });
    expect(roll.total).toBeGreaterThanOrEqual(1);
    expect(roll.total).toBeLessThanOrEqual(6);
    expect(
      observer.frames.find((item) => item.type === "message" && item.message.id === message.id),
    ).toMatchObject({ message });
    const history = await call(`/worlds/${worldId}/messages`, { cookie: playerCookie });
    expect(await history.json()).toMatchObject({ messages: [message] });
    expect((await read()).entries).toEqual([saved]);
  } finally {
    peer.socket.close();
    observer.socket.close();
  }
});

it("rejects DM-only entries and non-oracle fields for players, while the DM can roll hidden tables", async () => {
  await saveType(oracleType);
  const publicEntry = await decodedEntry(await saveEntry(oracleEntry));
  const hidden = await decodedEntry(
    await saveEntry({ ...oracleEntry, name: "Hidden oracle", visibility: "dm" }),
  );
  const peer = await tabletop.connect({ worldId, cookie: playerCookie });
  const gm = await tabletop.connect({ worldId, cookie });
  try {
    peer.send({ type: "roll.table", entryId: hidden.id, field: "action", visibility: "public" });
    peer.send({
      type: "roll.table",
      entryId: publicEntry.id,
      field: "description",
      visibility: "public",
    });
    peer.send({ type: "roll.table", entryId: "missing", field: "action", visibility: "public" });
    await peer.sync();
    expect(peer.frames.filter((frame) => frame.type === "error")).toMatchObject([
      { code: "roll" },
      { code: "roll" },
      { code: "roll" },
    ]);
    expect(peer.frames.filter((frame) => frame.type === "message")).toHaveLength(0);
    gm.send({ type: "roll.table", entryId: hidden.id, field: "action", visibility: "private" });
    await gm.sync();
    expect(gm.frames.find((frame) => frame.type === "message")).toMatchObject({
      message: { visibility: "private", roll: { table: { entryId: hidden.id } } },
    });
    await peer.sync();
    expect(peer.frames.filter((frame) => frame.type === "message")).toHaveLength(0);
  } finally {
    peer.socket.close();
    gm.socket.close();
  }
});

it("resolves legacy oracle ids and preserves private visibility", async () => {
  const response = await importPack({
    format: "ttrpg-pack",
    version: 1,
    name: "Oracles",
    types: [oracleType],
    entries: [{ ...oracleEntry, id: "ent_old_oracle" }],
  });
  expect(response.status).toBe(200);
  const peer = await tabletop.connect({ worldId, cookie: playerCookie });
  try {
    peer.send({
      type: "roll.table",
      entryId: "ent_old_oracle",
      field: "action",
      visibility: "private",
      recipientMemberIds: [],
    });
    await peer.sync();
    expect(peer.frames.find((frame) => frame.type === "message")).toMatchObject({
      message: {
        visibility: "private",
        recipientMemberIds: [],
        roll: { table: { entryId: "world/oracle/action-oracle" } },
      },
    });
  } finally {
    peer.socket.close();
  }
});

it("rejects invalid persisted oracle dice and rows and allows a total to land in a gap", async () => {
  await saveType(oracleType);
  const saved = await decodedEntry(await saveEntry(oracleEntry));
  const db = await storage();
  const peer = await tabletop.connect({ worldId, cookie: playerCookie });
  const roll = async () => {
    peer.send({ type: "roll.table", entryId: saved.id, field: "action", visibility: "public" });
    await peer.sync();
  };
  try {
    for (const dice of ["not dice", "1d6 + @cost"]) {
      await db.exec(
        "UPDATE compendium_types SET fields = ? WHERE id = ?",
        JSON.stringify(
          oracleType.fields.map((field) => (field.key === "action" ? { ...field, dice } : field)),
        ),
        oracleType.id,
      );
      await roll();
    }
    await db.exec(
      "UPDATE compendium_types SET fields = ? WHERE id = ?",
      JSON.stringify(oracleType.fields),
      oracleType.id,
    );
    await db.exec(
      "UPDATE compendium_entries SET fields = ? WHERE id = ?",
      JSON.stringify({
        action: [
          { min: 1, max: 4, text: "First" },
          { min: 3, max: 6, text: "Overlap" },
        ],
      }),
      saved.id,
    );
    await roll();
    expect(peer.frames.filter((frame) => frame.type === "error")).toMatchObject([
      { code: "roll" },
      { code: "roll" },
      { code: "roll" },
    ]);
    expect(peer.frames.filter((frame) => frame.type === "message")).toHaveLength(0);
    await db.exec(
      "UPDATE compendium_entries SET fields = ? WHERE id = ?",
      JSON.stringify({ action: [{ min: 7, max: 8, text: "Outside the range" }] }),
      saved.id,
    );
    await roll();
    const result = peer.frames.find((frame) => frame.type === "message");
    if (result?.type !== "message") throw new Error("Missing oracle message");
    expect(result.message.roll?.table).toMatchObject({ entryId: saved.id });
    expect(result.message.roll?.table?.row).toBeUndefined();
  } finally {
    peer.socket.close();
  }
});
