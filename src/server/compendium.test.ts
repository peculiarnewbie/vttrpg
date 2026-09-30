// @vitest-environment node
import * as Schema from "effect/Schema";
import { build, stop } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { ServerFrame } from "../domain/schemas";
import {
  Compendium,
  CompendiumEntry,
  CompendiumPack,
  ImportPackResult,
  type EntryType,
  type SaveEntryInput,
} from "../domain/compendium";

let mf: Miniflare;
let cookie = "";
let worldId = "";
let playerCookie = "";
const call = (path: string, options: { method?: string; body?: unknown; cookie?: string } = {}) =>
  mf.dispatchFetch(`https://tabletop.test/api${path}`, {
    method: options.method ?? "GET",
    headers: { cookie: options.cookie ?? cookie, "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
beforeAll(async () => {
  const bundle = await build({
    entryPoints: ["src/worker.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    external: ["cloudflare:workers", "node:*"],
    target: "es2022",
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      name: "tabletop",
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: "2026-03-22",
      compatibilityFlags: ["nodejs_compat"],
      durableObjects: { WORLDS: { className: "WorldDO", useSQLite: true } },
      d1Databases: ["DB"],
      r2Buckets: ["BUCKET"],
    }),
  );
  const db = await mf.getD1Database("DB");
  const migration = await readFile("src/migrations/0001_initial.sql", "utf8");
  for (const sql of migration
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean))
    await db.prepare(sql).run();
  const signin = await call("/auth/google", {
    method: "POST",
    body: { email: "dm@example.test", displayName: "DM" },
  });
  cookie = signin.headers.get("set-cookie")!.split(";")[0];
}, 30000);
beforeEach(async () => {
  const world = await call("/worlds", { method: "POST", body: { name: "Compendium test 界" } });
  worldId = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await world.json()).id;
  const membership = await call(`/worlds/${worldId}/members`, {
    method: "POST",
    body: { displayName: "Player", role: "player", kind: "invite", email: "player@example.test" },
  });
  expect(membership.status).toBe(201);
  const player = await call("/auth/google", {
    method: "POST",
    body: { email: "player@example.test", displayName: "Player" },
  });
  playerCookie = player.headers.get("set-cookie")!.split(";")[0];
}, 30000);
afterAll(async () => {
  await mf?.dispose();
  await stop();
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
    expect(saved.id).toMatch(/^ent_/);
    expect(saved.updatedAt).toBeTypeOf("string");
    expect(await read()).toEqual({ types: [type], entries: [saved] });
    const second = { ...type, id: "spell", name: "Spell" };
    expect((await saveType(second)).status).toBe(200);
    expect((await saveType({ ...type, name: "Equipment" })).status).toBe(200);
    const changed = await decodedEntry(
      await saveEntry({ ...entry, id: saved.id, typeId: second.id, name: "New entry" }),
    );
    expect((await read()).types.map((item) => item.id)).toEqual(["item", "spell"]);
    expect((await read()).entries).toEqual([changed]);
    expect(changed.typeId).toBe("spell");
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
      ["DELETE", `/entries/${saved.id}`, undefined],
      ["POST", "/import", pack],
      ["GET", "/export", undefined],
    ] as const) {
      expect((await compendiumCall(suffix, { method, body, cookie: playerCookie })).status).toBe(
        403,
      );
      const namespace = await mf.getDurableObjectNamespace("WORLDS");
      const stub = namespace.get(namespace.idFromName(`world:${worldId}`));
      expect(
        (
          await stub.fetch(`https://world/internal/compendium${suffix}`, {
            method,
            headers: { "x-ttrpg-role": "player", "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          })
        ).status,
      ).toBe(403);
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
    const deleted = await compendiumCall(`/entries/${saved.id}`, { method: "DELETE" });
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
        .map(({ updatedAt: _updatedAt, ...item }) => item)
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
    expect((await read()).entries[0].id).toBe("ent_imported");
  });

  it("broadcasts only the invalidation frame to a connected player after every write", async () => {
    const response = await mf.dispatchFetch(`https://tabletop.test/api/worlds/${worldId}/ws`, {
      headers: { cookie: playerCookie, Upgrade: "websocket" },
    });
    const socket = response.webSocket;
    if (!socket) throw new Error("Missing socket");
    const frames: ServerFrame[] = [];
    socket.addEventListener("message", (event) =>
      frames.push(Schema.decodeUnknownSync(ServerFrame)(JSON.parse(String(event.data)))),
    );
    socket.accept();
    const updates = () => frames.filter((frame) => frame.type === "compendium.updated");
    try {
      await expect.poll(() => frames.some((frame) => frame.type === "hello")).toBe(true);
      await saveType();
      await expect.poll(() => updates().length).toBe(1);
      const hidden = await decodedEntry(await saveEntry({ ...entry, visibility: "dm" }));
      await expect.poll(() => updates().length).toBe(2);
      expect(updates()[1]).toEqual({ type: "compendium.updated" });
      expect((await read(playerCookie)).entries).toEqual([]);
      await importPack(await exported());
      await expect.poll(() => updates().length).toBe(3);
      await compendiumCall(`/entries/${hidden.id}`, { method: "DELETE" });
      await expect.poll(() => updates().length).toBe(4);
      await compendiumCall("/types/item", { method: "DELETE" });
      await expect.poll(() => updates().length).toBe(5);
      expect(updates()).toEqual(Array(5).fill({ type: "compendium.updated" }));
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
      entries: Array.from({ length: 2000 }, (_, i) => ({ ...entry, id: `ent_${i}` })),
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
    expect((await read()).entries).toHaveLength(2000);
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
