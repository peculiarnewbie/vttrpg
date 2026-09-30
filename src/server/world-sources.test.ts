// @vitest-environment node
import * as Schema from "effect/Schema";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { startTabletop, type Tabletop, type CallOptions } from "../test/miniflare";
import {
  CompendiumEntry,
  EntryBodies,
  IndexDelta,
  CompendiumPack,
  type SaveEntryInput,
  type EntryType,
} from "../domain/compendium";
import { WorldLibraries, WorldSource, CORPUS_API_VERSION } from "../domain/corpus-rpc";
import { EntryOverride } from "../domain/overrides";
import type { SnapshotManifest } from "../domain/snapshot";

let tabletop: Tabletop;
let cookie = "";
let playerCookie = "";
let worldId = "";
let accountId = "";
let sourceId = "";
let counter = 0;
const type: EntryType = {
  id: "item",
  name: "Item",
  fields: [{ key: "cost", label: "Cost", kind: "number" }],
  filters: [{ key: "cost", kind: "range" }],
};
const licence = {
  id: "CC-BY-SA-4.0",
  name: "Creative Commons Attribution Share Alike 4.0",
  attribution: "Based on the testing corpus, by its authors",
  shareAlike: true,
};
const input = (name: string, visibility: "public" | "dm" = "public"): SaveEntryInput => ({
  typeId: "item",
  name,
  tags: ["gear"],
  body: `${name} description.`,
  fields: { cost: 5 },
  visibility,
});
const rpc = <T>(method: string, extra: Record<string, unknown> = {}) =>
  tabletop.corpusCall<T>(method, { apiVersion: CORPUS_API_VERSION, accountId, ...extra });
const worldCall = (suffix: string, options: CallOptions = {}) =>
  tabletop.call(`/worlds/${worldId}/${suffix}`, options);
const enable = (body: unknown = {}) => worldCall(`libraries/${sourceId}`, { method: "PUT", body });
const index = async (since = 0, auth = playerCookie) =>
  Schema.decodeUnknownSync(IndexDelta)(
    await (await worldCall(`compendium/index?since=${since}`, { cookie: auth })).json(),
  );
const bodies = async (ids: string[], auth = playerCookie) =>
  Schema.decodeUnknownSync(EntryBodies)(
    await (
      await worldCall("compendium/bodies", { method: "POST", body: { ids }, cookie: auth })
    ).json(),
  );
const overridePath = (id: string) => `compendium/overrides/${encodeURIComponent(id)}`;
const blockPath = (id: string) => `compendium/blocked/${encodeURIComponent(id)}`;
const publish = () => rpc<SnapshotManifest>("publish", { sourceId });
const save = (entries: readonly SaveEntryInput[]) =>
  rpc<CompendiumEntry[]>("saveEntries", { sourceId, entries });
const storage = () =>
  tabletop.mf.unsafeGetDurableObjectStorage("tabletop", "WorldDO", { name: `world:${worldId}` });
const search = async (query: string, auth = playerCookie) => {
  const peer = await tabletop.connect({ worldId, cookie: auth });
  try {
    await peer.sync();
    peer.send({ type: "search", requestId: "source-search", query });
    await peer.sync();
    const reply = peer.frames.find(
      (frame) => frame.type === "search.result" && frame.requestId === "source-search",
    );
    if (reply?.type !== "search.result") throw new Error("No search reply");
    return reply.results;
  } finally {
    peer.socket.close();
  }
};

beforeAll(async () => {
  tabletop = await startTabletop({
    corpus: true,
    cookie: () => cookie,
    unsafeInspectDurableObjects: true,
  });
  cookie = await tabletop.signin("source-dm@example.test", "DM");
  const db = await tabletop.mf.getD1Database("DB");
  const owner = await db
    .prepare("SELECT id FROM users WHERE email = ?")
    .bind("source-dm@example.test")
    .first<{ id: string }>();
  if (!owner) throw new Error("Missing DM account");
  accountId = owner.id;
  await rpc("saveSystem", {
    system: { id: "test-system", name: "Test system", entryTypes: [type] },
  });
}, 30000);
beforeEach(async () => {
  sourceId = `table-source-${++counter}`;
  const response = await tabletop.call("/worlds", {
    method: "POST",
    body: { name: "Source test" },
  });
  worldId = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(
    await response.json(),
  ).id;
  expect(
    (
      await worldCall("members", {
        method: "POST",
        body: {
          displayName: "Player",
          role: "player",
          kind: "invite",
          email: "source-player@example.test",
        },
      })
    ).status,
  ).toBe(201);
  playerCookie = await tabletop.signin("source-player@example.test", "Player");
  await rpc("createSource", {
    source: {
      id: sourceId,
      systemId: "test-system",
      name: "Test library",
      visibility: "public",
      licence,
    },
  });
}, 30000);
afterAll(async () => {
  await tabletop?.dispose();
});

it("ingests only indexes, includes sources in bounded search, and keeps source bodies and revisions in R2", async () => {
  const [visible, hidden] = await save([input("Sword"), input("Secret sword", "dm")]);
  await publish();
  const source = Schema.decodeUnknownSync(WorldSource)(await (await enable()).json());
  expect(source).toMatchObject({ sourceId, mode: "pinned", version: 1, licence });
  const playerIndex = await index();
  expect(playerIndex.upserts.map((row) => row.id)).toEqual([visible.id]);
  expect(JSON.stringify(playerIndex)).not.toContain(hidden.id);
  expect((await index(0, cookie)).upserts).toHaveLength(2);
  expect((await search("sword")).map((row) => row.id)).toEqual([visible.id]);
  expect((await search("secret")).length).toBe(0);
  const fetched = await bodies([visible.id, hidden.id]);
  expect(fetched.missing).toEqual([hidden.id]);
  expect(fetched.entries[0]).toMatchObject({
    body: visible.body,
    rev: playerIndex.upserts[0].rev,
    sourceRev: visible.rev,
    sourceVersion: 1,
    licence,
  });
  const db = await storage();
  const rows = await db.exec<{ body: string; fields: string }>(
    "SELECT body, fields FROM compendium_entries WHERE id GLOB ?",
    `${sourceId}/*`,
  );
  expect(rows.every((row) => row.body === "" && row.fields === "{}")).toBe(true);
  const delta = await index(playerIndex.rev);
  expect(delta.deletes).toEqual([]);
  expect(JSON.stringify(delta)).not.toContain(hidden.id);
  for (const path of ["libraries", "libraries/blocked", overridePath(visible.id)])
    expect((await worldCall(path, { cookie: playerCookie })).status).toBe(403);
});

it("keeps pinned bodies until acceptance, reports added/changed/removed IDs, and follows new versions without changing local entries", async () => {
  const [sword, removed] = await save([input("Sword"), input("Removed")]);
  await publish();
  await enable();
  expect(
    (await worldCall("compendium/entries", { method: "POST", body: input("Local item") })).status,
  ).toBe(200);
  await save([{ ...input("Renamed sword"), id: sword.id }, input("Added")]);
  await rpc("deleteEntries", { sourceId, ids: [removed.id] });
  await publish();
  const checked = Schema.decodeUnknownSync(WorldLibraries)(
    await (await worldCall("libraries/check", { method: "POST" })).json(),
  );
  expect(checked.enabled[0]).toMatchObject({
    version: 1,
    latestVersion: 2,
    update: { fromVersion: 1, toVersion: 2, changed: [sword.id], removed: [removed.id] },
  });
  expect(checked.enabled[0].update?.added).toHaveLength(1);
  expect((await bodies([sword.id])).entries[0].name).toBe("Sword");
  await enable({ version: 2, mode: "follow" });
  const accepted = await index();
  expect((await bodies([sword.id])).entries[0]).toMatchObject({
    name: "Renamed sword",
    rev: accepted.upserts.find((row) => row.id === sword.id)?.rev,
  });
  await save([{ ...input("Followed sword"), id: sword.id }]);
  await publish();
  expect((await worldCall("libraries/check", { method: "POST" })).status).toBe(200);
  expect((await bodies([sword.id])).entries[0].name).toBe("Followed sword");
  expect((await index()).upserts.some((row) => row.name === "Local item")).toBe(true);
});

it("applies overrides to bodies and index facets, retains share-alike, and cannot widen a DM-only base", async () => {
  const [sword, hidden] = await save([input("Sword"), input("Secret sword", "dm")]);
  await publish();
  await enable();
  const response = await worldCall(overridePath(sword.id), {
    method: "PUT",
    body: {
      baseRev: sword.rev,
      patch: { name: "Table sword", body: "Our table's text", fields: { cost: 10 } },
    },
  });
  expect(response.status).toBe(200);
  const saved = Schema.decodeUnknownSync(EntryOverride)(await response.json());
  expect(saved.licence).toEqual(licence);
  const row = (await index()).upserts.find((row) => row.id === sword.id)!;
  expect(row).toMatchObject({ name: "Table sword", facets: { cost: 10 } });
  expect((await bodies([sword.id])).entries[0]).toMatchObject({
    name: "Table sword",
    body: "Our table's text",
    fields: { cost: 10 },
    rev: row.rev,
    sourceRev: sword.rev,
    licence,
  });
  expect(
    (
      await worldCall(overridePath(hidden.id), {
        method: "PUT",
        body: { baseRev: hidden.rev, patch: { visibility: "public" } },
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await worldCall(overridePath(sword.id), {
        method: "PUT",
        body: { baseRev: 999, patch: { name: "Stale" } },
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await worldCall(overridePath(sword.id), {
        method: "PUT",
        body: { baseRev: sword.rev, patch: { id: "world/item/stolen" } },
      })
    ).status,
  ).toBe(400);
  const pack = Schema.decodeUnknownSync(CompendiumPack)(
    await (await worldCall("compendium/export")).json(),
  );
  expect(pack.entries).toMatchObject([{ id: sword.id, licence, body: "Our table's text" }]);
  expect((await worldCall("compendium/import", { method: "POST", body: pack })).status).toBe(200);
});

it("checks visibility after cache hits, hides aliases, tombstones previously public rows, and remembers blocks across disable/enable", async () => {
  const [sword, hidden] = await save([input("Sword"), input("Hidden", "dm")]);
  await publish();
  await enable();
  const original = await index();
  await bodies([sword.id], cookie); // Warm the immutable body-chunk cache as DM.
  const db = await storage();
  await db.exec(
    "INSERT INTO compendium_aliases (old_id, new_id) VALUES ('legacy-source', ?)",
    sword.id,
  );
  expect((await bodies(["legacy-source"])).aliases).toEqual({ "legacy-source": sword.id });
  expect(
    (
      await worldCall(overridePath(sword.id), {
        method: "PUT",
        body: { baseRev: sword.rev, patch: { visibility: "dm" } },
      })
    ).status,
  ).toBe(200);
  const delta = await index(original.rev);
  expect(delta.upserts).toEqual([]);
  expect(delta.deletes).toEqual([sword.id]);
  expect(JSON.stringify(delta)).not.toContain(hidden.id);
  expect(await bodies([sword.id, "legacy-source"])).toMatchObject({
    entries: [],
    missing: [sword.id, "legacy-source"],
    aliases: {},
  });
  expect(await search("sword")).toEqual([]);
  await worldCall(overridePath(sword.id), { method: "DELETE" });
  expect((await worldCall(blockPath(sword.id), { method: "PUT" })).status).toBe(204);
  expect((await bodies([sword.id], cookie)).entries).toEqual([]);
  expect((await index(0, cookie)).upserts.map((row) => row.id)).toEqual([hidden.id]);
  await worldCall(`libraries/${sourceId}`, { method: "DELETE" });
  await enable();
  expect((await bodies([sword.id], cookie)).entries).toEqual([]);
  expect(await (await worldCall("libraries/blocked")).json()).toEqual({ ids: [sword.id] });
  await worldCall(blockPath(sword.id), { method: "DELETE" });
  expect((await bodies([sword.id])).entries).toHaveLength(1);
  await worldCall(`libraries/${sourceId}`, { method: "DELETE" });
  expect((await bodies([sword.id])).entries).toEqual([]);
  expect(await search("sword")).toEqual([]);
});

it("rejects ordinary mutation of corpus IDs and conflicting types before an atomic ingest", async () => {
  const [sword] = await save([input("Sword")]);
  await publish();
  await enable();
  expect(
    (
      await worldCall("compendium/entries", {
        method: "POST",
        body: { ...input("Forged"), id: sword.id },
      })
    ).status,
  ).toBe(409);
  expect(
    (await worldCall(`compendium/entries/${encodeURIComponent(sword.id)}`, { method: "DELETE" }))
      .status,
  ).toBe(409);
  expect(
    (
      await worldCall("compendium/types/item", {
        method: "PUT",
        body: { ...type, fields: [], filters: [] },
      })
    ).status,
  ).toBe(409);
  await worldCall(`libraries/${sourceId}`, { method: "DELETE" });
  expect(
    (
      await worldCall("compendium/types/item", {
        method: "PUT",
        body: { ...type, fields: [], filters: [] },
      })
    ).status,
  ).toBe(200);
  expect((await enable()).status).toBe(409);
  expect((await index()).upserts).toEqual([]);
  const listed = Schema.decodeUnknownSync(WorldLibraries)(
    await (await worldCall("libraries")).json(),
  );
  expect(listed.enabled).toEqual([]);
});

it("rejects corrupted snapshot bytes before enabling anything and never downloads bodies to enable", async () => {
  await save([input("Sword")]);
  const manifest = await publish();
  const bucket = await tabletop.mf.getR2Bucket("CORPUS_BUCKET", "corpus");
  for (const chunk of manifest.bodyChunks) await bucket.delete(chunk.file.key);
  expect((await enable()).status).toBe(200); // Enabling uses only public and DM indexes.
  expect(
    (
      await worldCall("compendium/bodies", {
        method: "POST",
        body: { ids: [`${sourceId}/item/sword`] },
      })
    ).status,
  ).toBe(503);
  await worldCall(`libraries/${sourceId}`, { method: "DELETE" });
  // A new immutable version gives an uncached key for the integrity check.
  const fresh = await publish();
  await bucket.put(fresh.publicIndex.key, new Uint8Array([1, 2, 3]));
  expect((await enable({ version: fresh.version })).status).toBe(503);
  expect((await index()).upserts).toEqual([]);
});

it("preserves licensed local entry attribution across saves and rejects imports which strip it", async () => {
  expect(
    (
      await worldCall("compendium/import", {
        method: "POST",
        body: {
          format: "ttrpg-pack",
          version: 2,
          name: "Licensed",
          types: [type],
          entries: [{ ...input("Licensed sword"), id: "world/item/licensed", licence }],
        },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await worldCall("compendium/entries", {
        method: "POST",
        body: { ...input("Edited"), id: "world/item/licensed" },
      })
    ).status,
  ).toBe(200);
  expect((await bodies(["world/item/licensed"])).entries[0].licence).toEqual(licence);
  expect(
    (
      await worldCall("compendium/import", {
        method: "POST",
        body: {
          format: "ttrpg-pack",
          version: 2,
          name: "Stripped",
          types: [],
          entries: [{ ...input("Edited"), id: "world/item/licensed" }],
        },
      })
    ).status,
  ).toBe(400);
});

it("atomically ingests ten thousand rows, keeps search bounded, and clears a source without deleting local content", async () => {
  for (let start = 0; start < 10_000; start += 100) {
    await save(
      Array.from({ length: 100 }, (_, offset) =>
        input(`Sword ${String(start + offset).padStart(5, "0")}`, offset === 0 ? "dm" : "public"),
      ),
    );
  }
  await publish();
  expect((await enable()).status).toBe(200);
  expect((await index(0, cookie)).upserts).toHaveLength(10_000);
  expect((await index()).upserts).toHaveLength(9_900);
  expect((await search("sword")).length).toBeLessThanOrEqual(20);
  expect(
    (await worldCall("compendium/entries", { method: "POST", body: input("Local item") })).status,
  ).toBe(200);
  const before = await index();
  expect((await worldCall(`libraries/${sourceId}`, { method: "DELETE" })).status).toBe(204);
  const after = await index(before.rev);
  expect(after.deletes).toHaveLength(9_900);
  expect((await index()).upserts.map((row) => row.name)).toEqual(["Local item"]);
}, 120000);

it("roundtrips mixed world content and licensed library overrides in the same world and another enabled world", async () => {
  const [sword] = await save([input("Sword")]);
  await publish();
  await enable();
  const local = Schema.decodeUnknownSync(CompendiumEntry)(
    await (
      await worldCall("compendium/entries", { method: "POST", body: input("Local item") })
    ).json(),
  );
  expect(
    (
      await worldCall(overridePath(sword.id), {
        method: "PUT",
        body: { baseRev: sword.rev, patch: { name: "Table sword", removeFields: ["cost"] } },
      })
    ).status,
  ).toBe(200);
  const pack = Schema.decodeUnknownSync(CompendiumPack)(
    await (await worldCall("compendium/export")).json(),
  );
  const exportedSource = pack.entries.find((entry) => entry.id === sword.id)!;
  expect(exportedSource).toMatchObject({
    id: sword.id,
    sourceVersion: 1,
    sourceRev: sword.rev,
    licence,
    fields: {},
  });
  await worldCall(overridePath(sword.id), { method: "DELETE" });
  await worldCall("compendium/entries", {
    method: "POST",
    body: { ...input("Changed local"), id: local.id },
  });
  expect((await worldCall("compendium/import", { method: "POST", body: pack })).status).toBe(200);
  const restored = await bodies([local.id, sword.id], cookie);
  expect(restored.entries.find((entry) => entry.id === local.id)?.name).toBe("Local item");
  expect(restored.entries.find((entry) => entry.id === sword.id)).toMatchObject({
    name: "Table sword",
    fields: {},
    licence,
    sourceVersion: 1,
    sourceRev: sword.rev,
  });
  const currentIndex = await index(0, cookie);
  for (const entry of restored.entries)
    expect(entry.rev).toBe(currentIndex.upserts.find((row) => row.id === entry.id)?.rev);
  const override = Schema.decodeUnknownSync(EntryOverride)(
    await (await worldCall(overridePath(sword.id))).json(),
  );
  expect(override.patch).toEqual({ name: "Table sword", removeFields: ["cost"] });
  const db = await storage();
  expect(
    await db.exec("SELECT body, fields FROM compendium_entries WHERE id = ?", sword.id),
  ).toEqual([{ body: "", fields: "{}" }]);

  const destination = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(
    await (
      await tabletop.call("/worlds", { method: "POST", body: { name: "Import destination" } })
    ).json(),
  );
  const destinationCall = (path: string, options: CallOptions = {}) =>
    tabletop.call(`/worlds/${destination.id}/${path}`, options);
  expect((await destinationCall("compendium/import", { method: "POST", body: pack })).status).toBe(
    409,
  );
  expect(
    (await destinationCall(`libraries/${sourceId}`, { method: "PUT", body: { version: 1 } }))
      .status,
  ).toBe(200);
  expect((await destinationCall("compendium/import", { method: "POST", body: pack })).status).toBe(
    200,
  );
  const copied = Schema.decodeUnknownSync(EntryBodies)(
    await (
      await destinationCall("compendium/bodies", {
        method: "POST",
        body: { ids: [local.id, sword.id] },
      })
    ).json(),
  );
  expect(copied.entries.find((entry) => entry.id === sword.id)).toMatchObject({
    id: sword.id,
    name: "Table sword",
    licence,
    fields: {},
  });
  expect(copied.entries.find((entry) => entry.id === local.id)?.name).toBe("Local item");
});

it("preflights a mixed pack without changing local entries or overrides when source provenance, fields or rights are invalid", async () => {
  const [sword, hidden] = await save([input("Sword"), input("Hidden", "dm")]);
  await publish();
  await enable();
  await worldCall(overridePath(sword.id), {
    method: "PUT",
    body: { baseRev: sword.rev, patch: { name: "Table sword" } },
  });
  const pack = Schema.decodeUnknownSync(CompendiumPack)(
    await (await worldCall("compendium/export")).json(),
  );
  const source = pack.entries.find((entry) => entry.id === sword.id)!;
  const hiddenBody = (await bodies([hidden.id], cookie)).entries[0];
  const local = { ...input("Imported local"), id: "world/item/imported-local" };
  const cases = [
    { entry: { ...source, sourceRev: source.sourceRev! + 1 }, status: 409 },
    { entry: { ...source, sourceVersion: source.sourceVersion! + 1 }, status: 409 },
    { entry: { ...source, sourceRev: undefined }, status: 400 },
    { entry: { ...source, sourceVersion: undefined }, status: 400 },
    { entry: { ...source, licence: undefined }, status: 400 },
    { entry: { ...source, licence: { ...licence, shareAlike: false } }, status: 400 },
    { entry: { ...source, licence: { ...licence, attribution: "Missing authors" } }, status: 400 },
    { entry: { ...source, licence: { ...licence, id: "CC0" } }, status: 400 },
    { entry: { ...source, licence: { ...licence, url: "javascript:alert(1)" } }, status: 400 },
    {
      entry: {
        ...source,
        licence: { ...licence, attribution: `${licence.attribution}${"x".repeat(8_000)}` },
      },
      status: 400,
    },
    { entry: { ...source, fields: { unknown: 10 } }, status: 400 },
    { entry: { ...hiddenBody, visibility: "public" }, status: 400 },
  ];
  const peer = await tabletop.connect({ worldId, cookie });
  try {
    await peer.sync();
    for (const fixture of cases) {
      const before = await index(0, cookie);
      const updates = peer.frames.filter((frame) => frame.type === "compendium.updated").length;
      const response = await worldCall("compendium/import", {
        method: "POST",
        body: { ...pack, entries: [local, fixture.entry] },
      });
      expect(response.status).toBe(fixture.status);
      expect(await index(0, cookie)).toEqual(before);
      expect((await bodies([local.id], cookie)).missing).toEqual([local.id]);
      expect((await bodies([sword.id], cookie)).entries[0].name).toBe("Table sword");
      await peer.sync();
      expect(peer.frames.filter((frame) => frame.type === "compendium.updated").length).toBe(
        updates,
      );
    }
    expect(
      (
        await worldCall("compendium/import", {
          method: "POST",
          body: {
            ...pack,
            types: [{ ...type, fields: [], filters: [] }],
            entries: [local, source],
          },
        })
      ).status,
    ).toBe(409);
    expect((await bodies([local.id], cookie)).missing).toEqual([local.id]);
  } finally {
    peer.socket.close();
  }
});

it("rolls back prepared overrides and index revisions when writing a local entry fails inside the import transaction", async () => {
  const [sword] = await save([input("Sword")]);
  await publish();
  await enable();
  await worldCall(overridePath(sword.id), {
    method: "PUT",
    body: { baseRev: sword.rev, patch: { name: "Previous table name" } },
  });
  const pack = Schema.decodeUnknownSync(CompendiumPack)(
    await (await worldCall("compendium/export")).json(),
  );
  const source = pack.entries.find((entry) => entry.id === sword.id)!;
  const before = await index(0, cookie);
  const beforeOverride = await (await worldCall(overridePath(sword.id))).json();
  const db = await storage();
  await db.exec(
    "CREATE TRIGGER reject_import_fixture BEFORE INSERT ON compendium_entries WHEN new.id = 'world/item/imported' BEGIN SELECT RAISE(ABORT, 'import fixture'); END",
  );
  try {
    expect(
      (
        await worldCall("compendium/import", {
          method: "POST",
          body: {
            ...pack,
            entries: [
              { ...input("Imported"), id: "world/item/imported" },
              { ...source, name: "Attempted new name" },
            ],
          },
        })
      ).status,
    ).toBe(503);
    expect(await index(0, cookie)).toEqual(before);
    expect(await (await worldCall(overridePath(sword.id))).json()).toEqual(beforeOverride);
    expect((await bodies(["world/item/imported"], cookie)).missing).toEqual([
      "world/item/imported",
    ]);
    expect((await bodies([sword.id], cookie)).entries[0].name).toBe("Previous table name");
  } finally {
    await db.exec("DROP TRIGGER reject_import_fixture");
  }
});
