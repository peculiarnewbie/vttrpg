// @vitest-environment node
import * as Schema from "effect/Schema";
import { startTabletop, type Tabletop, type CallOptions } from "../test/miniflare";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { Character, type SaveNoteInput } from "../domain/schemas";
import type { CompendiumEntry, EntryType, SaveEntryInput } from "../domain/compendium";
import { CorpusError, type CorpusReply } from "../domain/corpus-errors";
import { CORPUS_API_VERSION } from "../domain/corpus-rpc";
import { ImportStatus, WorldExport } from "../domain/world-export";

let tabletop: Tabletop;
let cookie = "";
let playerCookie = "";
let playerId = "";
let worldId = "";
let accountId = "";
let counter = 0;

const call = (path: string, options: CallOptions = {}) => tabletop.call(path, options);
const worldCall = (suffix: string, options: CallOptions = {}, id = worldId) =>
  call(`/worlds/${id}/${suffix}`, options);
const upload = (path: string, bytes: Uint8Array, contentType: string, auth = cookie) =>
  tabletop.mf.dispatchFetch(`https://tabletop.test/api${path}`, {
    method: path.includes("/import/files/") ? "PUT" : "POST",
    headers: { cookie: auth, "content-type": contentType },
    body: bytes,
  });
const exported = async (id = worldId, query = "") => {
  const response = await worldCall(`export${query}`, {}, id);
  expect(response.status, await response.clone().text()).toBe(200);
  return Schema.decodeUnknownSync(WorldExport)(await response.json());
};
const importWorld = async (data: unknown) => {
  const response = await call("/worlds/import", { method: "POST", body: data });
  expect(response.status, await response.clone().text()).toBe(201);
  const body = (await response.json()) as { world: { id: string }; status: unknown };
  return { id: body.world.id, status: Schema.decodeUnknownSync(ImportStatus)(body.status) };
};
const rpc = async <T>(method: string, extra: Record<string, unknown> = {}) => {
  const reply = await tabletop.corpusCall<CorpusReply<T>>(method, {
    apiVersion: CORPUS_API_VERSION,
    accountId,
    ...extra,
  });
  if (!reply.ok) throw Schema.decodeUnknownSync(CorpusError)(reply.error);
  return reply.value;
};

const itemType: EntryType = {
  id: "item",
  name: "Item",
  fields: [{ key: "cost", label: "Cost", kind: "number" }],
};
const licence = {
  id: "CC-BY-4.0",
  name: "Creative Commons Attribution 4.0",
  attribution: "Based on the export test library",
  shareAlike: false,
};
const item = (name: string): SaveEntryInput => ({
  typeId: "item",
  name,
  tags: [],
  body: `${name} description.`,
  fields: { cost: 1 },
  visibility: "public",
});

beforeAll(async () => {
  tabletop = await startTabletop({ corpus: true, cookie: () => cookie });
  cookie = await tabletop.signin("export-dm@example.test", "DM");
  const db = await tabletop.mf.getD1Database("DB");
  const owner = await db
    .prepare("SELECT id FROM users WHERE email = ?")
    .bind("export-dm@example.test")
    .first<{ id: string }>();
  if (!owner) throw new Error("Missing DM account");
  accountId = owner.id;
  await rpc("saveSystem", {
    system: { id: "export-system", name: "Export system", entryTypes: [itemType] },
  });
}, 30000);
beforeEach(async () => {
  const response = await call("/worlds", { method: "POST", body: { name: "Export test" } });
  worldId = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(
    await response.json(),
  ).id;
  const member = await worldCall("members", {
    method: "POST",
    body: {
      displayName: "Wren's player",
      role: "player",
      kind: "invite",
      email: "export-player@example.test",
    },
  });
  expect(member.status).toBe(201);
  playerId = ((await member.json()) as { id: string }).id;
  playerCookie = await tabletop.signin("export-player@example.test", "Player");
}, 30000);
afterAll(async () => {
  await tabletop?.dispose();
});

it("exports what the DM can see and imports it into a new world with the same ids", async () => {
  // A character for the player, with a picture.
  const templates = (await (await worldCall("templates")).json()) as { id: string }[];
  const saved = await worldCall("characters", {
    method: "POST",
    body: {
      name: "Wren",
      templateId: templates[0].id,
      memberId: playerId,
      values: { str: 14, background: "Shepherd" },
    },
  });
  const wren = Schema.decodeUnknownSync(Character)(await saved.json());
  const avatar = new Uint8Array([1, 2, 3, 4]);
  expect(
    (await upload(`/worlds/${worldId}/characters/${wren.id}/avatar`, avatar, "image/png")).status,
  ).toBe(200);
  // A board image on the active scene.
  const map = new Uint8Array([137, 80, 78, 71, 9]);
  const image = await upload(`/worlds/${worldId}/board/images`, map, "image/png");
  const { assetId } = (await image.json()) as { assetId: string };
  const board = (await (await worldCall("board")).json()) as { revision: number };
  expect(
    (
      await worldCall("board", {
        method: "PUT",
        body: {
          revision: board.revision,
          document: {
            background: null,
            elements: [
              {
                id: "map",
                type: "image",
                assetId,
                label: "Map",
                x: 0,
                y: 0,
                width: 100,
                height: 100,
              },
            ],
          },
        },
      })
    ).status,
  ).toBe(200);
  // Notes: the DM's, and a player's private one the DM can't read.
  const note = (input: SaveNoteInput, id: string, auth = cookie) =>
    worldCall(`notes/${id}`, { method: "PUT", body: input, cookie: auth });
  expect(
    (await note({ title: "Lore", content: "# Old roads", visibility: "dm" }, "lore")).status,
  ).toBe(200);
  expect(
    (
      await note(
        { title: "Diary", content: "Secret", visibility: "private" },
        "diary",
        playerCookie,
      )
    ).status,
  ).toBe(200);
  // Chat: a public line from the player, and their private aside.
  const peer = await tabletop.connect({ worldId, cookie: playerCookie });
  peer.send({
    type: "chat",
    content: "Hello",
    kind: "ooc",
    visibility: "public",
    recipientMemberIds: [],
  });
  peer.send({
    type: "chat",
    content: "Aside",
    kind: "ooc",
    visibility: "private",
    recipientMemberIds: [],
  });
  await peer.sync();
  peer.socket.close();
  // A world entry.
  expect((await worldCall("compendium/types/item", { method: "PUT", body: itemType })).status).toBe(
    200,
  );
  const entry = (await (
    await worldCall("compendium/entries", { method: "POST", body: item("Lantern") })
  ).json()) as CompendiumEntry;

  // Players can't export.
  expect((await worldCall("export", { cookie: playerCookie })).status).toBe(403);
  const data = await exported();
  expect(data.notes.map((note) => note.id)).toEqual(["lore"]);
  expect(data.notes[0].content).toBe("# Old roads");
  expect(data.messages?.map((message) => message.content)).toEqual(["Hello"]);
  expect((await exported(worldId, "?chat=0")).messages).toBeUndefined();
  expect(data.members.map((member) => member.displayName).sort()).toEqual(["DM", "Wren's player"]);
  expect(JSON.stringify(data.members)).not.toContain("@");
  expect(data.characters[0].avatarKey).toMatch(/^avatars\//);
  expect(data.files.map((file) => file.path).sort()).toEqual(
    [`board/${assetId}`, data.characters[0].avatarKey].sort(),
  );
  const file = await worldCall(`export/files/board/${assetId}`);
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(map);

  const imported = await importWorld(data);
  expect(imported.status).toMatchObject({ skippedLibraries: [], skippedEntries: 0 });
  expect(imported.status.pending.map((file) => file.path).sort()).toEqual(
    data.files.map((file) => file.path).sort(),
  );
  // Importing never touches an existing world, and a retry can't apply twice.
  expect((await exported()).characters).toHaveLength(1);

  // The world waits for its files; only those it lists are accepted.
  const other = `/worlds/${imported.id}/import/files/board/not-listed`;
  expect((await upload(other, map, "image/png")).status).toBe(404);
  const mapPath = `/worlds/${imported.id}/import/files/board/${assetId}`;
  expect((await upload(mapPath, map, "text/html")).status).toBe(400);
  expect((await upload(mapPath, map, "image/png", playerCookie)).status).toBe(403);
  expect((await upload(mapPath, map, "image/png")).status).toBe(200);
  const bootstrap = async () =>
    (await (await worldCall("", {}, imported.id)).json()) as {
      importPending: { path: string }[];
      characters: Character[];
    };
  expect((await bootstrap()).importPending).toHaveLength(1);
  const avatarFile = `/worlds/${imported.id}/import/files/${data.characters[0].avatarKey}`;
  expect((await upload(avatarFile, avatar, "image/png")).status).toBe(200);
  const after = await bootstrap();
  expect(after.importPending).toEqual([]);

  // Same ids; the player's character waits with the DM, named for its old player.
  const copy = after.characters[0];
  expect(copy).toMatchObject({ id: wren.id, name: "Wren", formerPlayer: "Wren's player" });
  expect(copy.avatarKey).toBe(`world/${imported.id}/${data.characters[0].avatarKey}`);
  const picture = await worldCall(`characters/${wren.id}/avatar`, {}, imported.id);
  expect(new Uint8Array(await picture.arrayBuffer())).toEqual(avatar);
  const image2 = await worldCall(`board/images/${assetId}`, {}, imported.id);
  expect(new Uint8Array(await image2.arrayBuffer())).toEqual(map);
  const notes = await worldCall("notes/lore", {}, imported.id);
  expect(await notes.json()).toMatchObject({
    title: "Lore",
    content: "# Old roads",
    visibility: "dm",
  });
  const lantern = await worldCall(
    "compendium/bodies",
    {
      method: "POST",
      body: { ids: [entry.id] },
    },
    imported.id,
  );
  expect(JSON.stringify(await lantern.json())).toContain("Lantern description.");

  // Exporting the copy gives the same world, apart from who it belongs to.
  const again = await exported(imported.id);
  const comparable = (world: WorldExport) => ({
    templates: world.templates.map(({ worldId: _worldId, ...template }) => template),
    characters: world.characters.map(
      ({ worldId: _w, memberId: _m, formerPlayer: _f, ...character }) => character,
    ),
    scenes: world.scenes,
    activeSceneId: world.activeSceneId,
    compendium: { ...world.compendium, entries: world.compendium.entries },
    notes: world.notes.map(({ ownerMemberId: _owner, ...note }) => note),
    messages: world.messages?.map(({ worldId: _w, ...message }) => message),
    files: world.files,
  });
  expect(comparable(again)).toEqual(comparable(data));

  // Handing the character to a member ends its link to the old player.
  const handed = await worldCall(
    "characters",
    {
      method: "POST",
      body: {
        id: wren.id,
        name: "Wren",
        templateId: copy.templateId,
        memberId: "mem_someone",
        values: copy.values,
      },
    },
    imported.id,
  );
  expect(Schema.decodeUnknownSync(Character)(await handed.json()).formerPlayer).toBeUndefined();
});

it("rejects files that aren't world exports", async () => {
  for (const body of [{}, { format: "ttrpg-pack", version: 2 }]) {
    const response = await call("/worlds/import", { method: "POST", body });
    expect(response.status).toBe(400);
  }
  const data = await exported();
  const response = await call("/worlds/import", {
    method: "POST",
    body: { ...data, version: 99 },
  });
  expect(response.status).toBe(400);
});

it("re-enables library versions with their overrides and blocks, and reports libraries it can't", async () => {
  const sourceId = `export-source-${++counter}`;
  await rpc("createSource", {
    source: {
      id: sourceId,
      systemId: "export-system",
      name: "Export library",
      visibility: "public",
      licence,
    },
  });
  const [rope, torch] = await rpc<CompendiumEntry[]>("saveEntries", {
    sourceId,
    entries: [item("Rope"), item("Torch")],
  });
  await rpc("publish", { sourceId });
  expect((await worldCall(`libraries/${sourceId}`, { method: "PUT", body: {} })).status).toBe(200);
  const override = await worldCall(`compendium/overrides/${encodeURIComponent(rope.id)}`, {
    method: "PUT",
    body: { baseRev: rope.rev, patch: { name: "Silk rope" } },
  });
  expect(override.status, await override.clone().text()).toBe(200);
  expect(
    (await worldCall(`compendium/blocked/${encodeURIComponent(torch.id)}`, { method: "PUT" }))
      .status,
  ).toBe(204);

  const data = await exported();
  expect(data.libraries).toEqual([{ sourceId, version: 1, mode: "pinned" }]);
  expect(data.blocked).toEqual([torch.id]);
  const imported = await importWorld(data);
  expect(imported.status).toMatchObject({ skippedLibraries: [], skippedEntries: 0 });
  const copy = await exported(imported.id);
  expect(copy.libraries).toEqual(data.libraries);
  expect(copy.blocked).toEqual([torch.id]);
  expect(copy.compendium.entries.find((entry) => entry.id === rope.id)?.name).toBe("Silk rope");

  // A library the target doesn't serve is skipped with what depended on it.
  const missing = await importWorld({
    ...data,
    libraries: [{ sourceId: "not-published-here", version: 3, mode: "pinned" }],
    blocked: ["not-published-here/item/thing"],
  });
  expect(missing.status.skippedLibraries).toEqual(["not-published-here"]);
  // The Silk rope override (its library isn't in this file's list) and the block.
  expect(missing.status.skippedEntries).toBe(2);
});
