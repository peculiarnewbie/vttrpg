// @vitest-environment node
import type { WorldDO } from "./world-do";
import * as Schema from "effect/Schema";
import { startTabletop, type Tabletop, type CallOptions } from "../test/miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Character, SheetTemplate } from "../domain/schemas";

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
  const world = await call("/worlds", { method: "POST", body: { name: "Character test" } });
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

const save = (body: unknown, authCookie = cookie) =>
  call(`/worlds/${worldId}/characters`, { method: "POST", body, cookie: authCookie });
const list = async () =>
  Schema.decodeUnknownSync(Schema.Array(Character))(
    await (await call(`/worlds/${worldId}/characters`)).json(),
  );
const template = async () => {
  const templates = Schema.decodeUnknownSync(Schema.Array(SheetTemplate))(
    await (await call(`/worlds/${worldId}/templates`)).json(),
  );
  return templates[0];
};
const create = async (authCookie = cookie) => {
  const sheet = await template();
  const response = await save({ name: "Hero", templateId: sheet.id, values: {} }, authCookie);
  expect(response.status).toBe(200);
  return Schema.decodeUnknownSync(Character)(await response.json());
};
const connect = async (authCookie: string) => {
  const { socket, frames, send } = await tabletop.connect({ worldId, cookie: authCookie });
  await expect.poll(() => frames.some((frame) => frame.type === "hello")).toBe(true);
  return { socket, frames, send };
};

describe("character authorization and tracker persistence", () => {
  it("allows self creation and owner edits, denies takeover, reassignment and player deletion", async () => {
    const dm = await create();
    const player = await create(playerCookie);
    expect(
      (await save({ ...dm, name: "Stolen", memberId: player.memberId }, playerCookie)).status,
    ).toBe(403);
    expect((await save({ ...player, memberId: dm.memberId }, playerCookie)).status).toBe(403);
    expect(
      (
        await save(
          { name: "Assigned", templateId: dm.templateId, values: {}, memberId: dm.memberId },
          playerCookie,
        )
      ).status,
    ).toBe(403);
    expect((await save({ ...player, name: "My hero" }, playerCookie)).status).toBe(200);
    expect(
      (
        await call(`/worlds/${worldId}/characters/${player.id}`, {
          method: "DELETE",
          cookie: playerCookie,
        })
      ).status,
    ).toBe(403);
    expect((await save({ ...player, memberId: dm.memberId })).status).toBe(200);
    expect(
      (await call(`/worlds/${worldId}/characters/${player.id}`, { method: "DELETE" })).status,
    ).toBe(200);
    expect((await list()).map((item) => item.id)).toEqual([dm.id]);
  });

  it("stores personal maxima, clamps current on lowering, preserves omitted overrides and clears with an empty map", async () => {
    const player = await create(playerCookie);
    const sheet = await template();
    const tracker = sheet.tickers[0];
    const maximum = tracker.max + 10;
    const response = await save({ ...player, tickerMax: { [tracker.id]: maximum } }, playerCookie);
    expect(response.status).toBe(200);
    const peer = await connect(playerCookie);
    try {
      peer.send({
        type: "ticker.set",
        characterId: player.id,
        tickerId: tracker.id,
        value: maximum + 10,
        requestId: "max",
      });
      await expect
        .poll(() =>
          peer.frames.some(
            (frame) =>
              frame.type === "character" &&
              frame.requestId === "max" &&
              frame.character.tickers[tracker.id] === maximum,
          ),
        )
        .toBe(true);
      const lowered = await save(
        { ...player, tickerMax: { [tracker.id]: tracker.min + 1 } },
        playerCookie,
      );
      expect(Schema.decodeUnknownSync(Character)(await lowered.json()).tickers[tracker.id]).toBe(
        tracker.min + 1,
      );
      const { tickerMax: _oldMax, ...legacy } = player;
      await save(legacy, playerCookie);
      expect((await list())[0].tickerMax?.[tracker.id]).toBe(tracker.min + 1);
      await save({ ...player, tickerMax: {} }, playerCookie);
      peer.send({
        type: "ticker.set",
        characterId: player.id,
        tickerId: tracker.id,
        value: maximum,
        requestId: "default",
      });
      await expect
        .poll(() =>
          peer.frames.some(
            (frame) =>
              frame.type === "character" &&
              frame.requestId === "default" &&
              frame.character.tickers[tracker.id] === tracker.max,
          ),
        )
        .toBe(true);
      expect((await list())[0].tickerMax).toEqual({});
      expect(
        (await save({ ...player, tickerMax: { [tracker.id]: 1.5 } }, playerCookie)).status,
      ).toBe(400);
    } finally {
      peer.socket.close();
    }
  });

  it("enforces ownership on WebSocket saves and trackers while allowing owner and DM updates", async () => {
    const dm = await create();
    const player = await create(playerCookie);
    const tracker = (await template()).tickers[0];
    const peer = await connect(playerCookie);
    const gm = await connect(cookie);
    try {
      peer.send({ type: "character.save", character: { ...dm, memberId: player.memberId } });
      peer.send({ type: "character.save", character: { ...player, memberId: dm.memberId } });
      peer.send({ type: "character.save", character: { ...dm, tickerMax: { [tracker.id]: 999 } } });
      peer.send({
        type: "ticker.set",
        characterId: dm.id,
        tickerId: tracker.id,
        value: tracker.min,
      });
      await expect.poll(() => peer.frames.filter((frame) => frame.type === "error").length).toBe(4);
      expect((await list()).find((item) => item.id === dm.id)).toEqual(dm);
      peer.send({
        type: "character.save",
        character: { ...player, name: "Owner edit", tickerMax: { [tracker.id]: tracker.min + 2 } },
      });
      await expect
        .poll(() =>
          peer.frames.some(
            (frame) => frame.type === "character" && frame.character.name === "Owner edit",
          ),
        )
        .toBe(true);
      gm.send({
        type: "ticker.set",
        characterId: player.id,
        tickerId: tracker.id,
        value: tracker.max + 100,
        requestId: "dm",
      });
      await expect
        .poll(() =>
          gm.frames.some(
            (frame) =>
              frame.type === "character" &&
              frame.requestId === "dm" &&
              frame.character.tickers[tracker.id] === tracker.min + 2,
          ),
        )
        .toBe(true);
      gm.send({
        type: "character.save",
        character: { ...player, name: "DM edit", memberId: dm.memberId },
      });
      await expect
        .poll(() =>
          gm.frames.some(
            (frame) =>
              frame.type === "character" &&
              frame.character.name === "DM edit" &&
              frame.character.memberId === dm.memberId,
          ),
        )
        .toBe(true);
    } finally {
      peer.socket.close();
      gm.socket.close();
    }
  });
});

const acknowledged = async (peer: Awaited<ReturnType<typeof connect>>, requestId: string) => {
  await expect
    .poll(() =>
      peer.frames.some((frame) => frame.type === "character" && frame.requestId === requestId),
    )
    .toBe(true);
};
const storage = () =>
  mf.unsafeGetDurableObjectStorage("tabletop", "WorldDO", { name: `world:${worldId}` });

const invalidValues: { label: string; values: Character["values"]; message: string }[] = [
  { label: "long string", values: { text: "x".repeat(4001) }, message: "4000" },
  { label: "long key", values: { ["x".repeat(81)]: true }, message: "80" },
  {
    label: "too many tags",
    values: { tags: Array.from({ length: 51 }, () => "tag") },
    message: "50",
  },
  { label: "long tag", values: { tags: ["x".repeat(4001)] }, message: "4000" },
  {
    label: "too many rows",
    values: { inventory: Array.from({ length: 101 }, () => ({ item: "Rope" })) },
    message: "100",
  },
  {
    label: "long list column",
    values: { inventory: [{ ["x".repeat(81)]: "Rope" }] },
    message: "80",
  },
  {
    label: "long list string",
    values: { inventory: [{ item: "x".repeat(4001) }] },
    message: "4000",
  },
  {
    label: "too many list tags",
    values: { inventory: [{ tags: Array.from({ length: 51 }, () => "tag") }] },
    message: "50",
  },
  {
    label: "long list tag",
    values: { inventory: [{ tags: ["x".repeat(4001)] }] },
    message: "4000",
  },
  {
    label: "large serialized values",
    values: { inventory: Array.from({ length: 17 }, () => ({ item: "x".repeat(4000) })) },
    message: "64 KB",
  },
  {
    label: "large UTF-8 values",
    values: { tags: Array.from({ length: 6 }, () => "界".repeat(4000)) },
    message: "64 KB",
  },
];

describe("rich character values", () => {
  it("accepts rich values on HTTP and WebSocket saves and still loads legacy strings and numbers", async () => {
    const player = await create(playerCookie);
    const values = {
      text: "A hero",
      strength: 12,
      checked: true,
      tags: ["brave", "careful"],
      inventory: [{ item: "Torch", quantity: 2, carried: true, tags: ["gear"] }],
    };
    const saved = await save({ ...player, values }, playerCookie);
    expect(saved.status).toBe(200);
    expect(Schema.decodeUnknownSync(Character)(await saved.json()).values).toEqual(values);
    const peer = await connect(playerCookie);
    try {
      peer.send({
        type: "character.save",
        character: { ...player, values: { ...values, checked: false } },
      });
      await expect
        .poll(() =>
          peer.frames.some(
            (frame) => frame.type === "character" && frame.character.values.checked === false,
          ),
        )
        .toBe(true);
      expect((await list())[0].values).toEqual({ ...values, checked: false });
    } finally {
      peer.socket.close();
    }
    const db = await storage();
    await db.exec(
      "UPDATE characters SET data = ?, ticker_max = NULL, layout_prefs = NULL WHERE id = ?",
      JSON.stringify({ race: "Human", level: 1 }),
      player.id,
    );
    const legacy = (await list())[0];
    expect(legacy.values).toEqual({ race: "Human", level: 1 });
    expect(legacy.layoutPrefs).toBeUndefined();
  });

  it("accepts values at the individual limits", async () => {
    const owner = await create(playerCookie);
    const values: Character["values"] = {
      ["x".repeat(80)]: "x".repeat(4000),
      tags: Array.from({ length: 50 }, () => "tag"),
      inventory: Array.from({ length: 100 }, () => ({ item: "Rope" })),
      rowTags: [{ tags: Array.from({ length: 50 }, () => "tag") }],
    };
    const response = await save({ ...owner, values }, playerCookie);
    expect(response.status).toBe(200);
    expect(Schema.decodeUnknownSync(Character)(await response.json()).values).toEqual(values);
  });

  it.each(invalidValues)("rejects $label on HTTP save", async ({ values, message }) => {
    const player = await create(playerCookie);
    const response = await save({ ...player, values }, playerCookie);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.stringContaining(message) });
    expect((await list())[0].values).toEqual({});
  });

  it("rejects malformed values at HTTP and WebSocket boundaries", async () => {
    const player = await create(playerCookie);
    const malformed = [
      null,
      { nested: { object: true } },
      ["tag", { item: "Rope" }],
      [{ item: null }],
    ];
    const peer = await connect(playerCookie);
    try {
      for (const [index, value] of malformed.entries()) {
        expect((await save({ ...player, values: { bad: value } }, playerCookie)).status).toBe(400);
        peer.socket.send(
          JSON.stringify({ type: "character.value", characterId: player.id, key: "bad", value }),
        );
        await expect
          .poll(() => peer.frames.filter((frame) => frame.type === "error").length)
          .toBe(index + 1);
      }
      expect((await list())[0].values).toEqual({});
    } finally {
      peer.socket.close();
    }
  });

  it("enforces every limit on WebSocket saves and single-value updates", async () => {
    const player = await create(playerCookie);
    const peer = await connect(playerCookie);
    let errors = 0;
    try {
      for (const { values, message } of invalidValues) {
        peer.send({ type: "character.save", character: { ...player, values } });
        await expect
          .poll(() => peer.frames.filter((frame) => frame.type === "error").length)
          .toBe(++errors);
        expect(peer.frames.at(-1)).toMatchObject({
          type: "error",
          message: expect.stringContaining(message),
        });
        const [key, value] = Object.entries(values)[0];
        peer.send({
          type: "character.value",
          characterId: player.id,
          key,
          value,
          requestId: String(errors),
        });
        await expect
          .poll(() => peer.frames.filter((frame) => frame.type === "error").length)
          .toBe(++errors);
        expect(peer.frames.at(-1)).toMatchObject({
          type: "error",
          message: expect.stringContaining(message),
        });
      }
      expect((await list())[0].values).toEqual({});
    } finally {
      peer.socket.close();
    }
  });

  it("allows owner and DM single-value edits, rejects another player and tracker keys", async () => {
    const owner = await create(playerCookie);
    await call(`/worlds/${worldId}/members`, {
      method: "POST",
      body: { displayName: "Other", role: "player", kind: "invite", email: "other@example.test" },
    });
    const otherCookie = await tabletop.signin("other@example.test", "Other");
    const peer = await connect(playerCookie);
    const other = await connect(otherCookie);
    const gm = await connect(cookie);
    try {
      peer.send({
        type: "character.value",
        characterId: owner.id,
        key: "inventory",
        value: [{ item: "Torch", carried: true }],
        requestId: "owner-value",
      });
      await acknowledged(peer, "owner-value");
      await acknowledged(other, "owner-value");
      other.send({
        type: "character.value",
        characterId: owner.id,
        key: "inventory",
        value: [],
        requestId: "other-value",
      });
      await expect
        .poll(() =>
          other.frames.some(
            (frame) => frame.type === "error" && frame.message === "You cannot edit this character",
          ),
        )
        .toBe(true);
      expect((await list())[0].values.inventory).toEqual([{ item: "Torch", carried: true }]);
      gm.send({
        type: "character.value",
        characterId: owner.id,
        key: "inventory",
        value: [{ item: "Rope", quantity: 2 }],
        requestId: "dm-value",
      });
      await acknowledged(gm, "dm-value");
      expect((await list())[0].values.inventory).toEqual([{ item: "Rope", quantity: 2 }]);
      const tracker = (await template()).tickers[0];
      peer.send({ type: "character.value", characterId: owner.id, key: tracker.id, value: 5 });
      await expect
        .poll(() =>
          peer.frames.some(
            (frame) => frame.type === "error" && frame.message?.includes("ticker.set"),
          ),
        )
        .toBe(true);
      expect((await list())[0].tickers).toEqual(owner.tickers);
      peer.send({ type: "ticker.set", characterId: owner.id, tickerId: "unknown", value: 5 });
      await expect
        .poll(() =>
          peer.frames.some(
            (frame) => frame.type === "error" && frame.message === "Tracker not found",
          ),
        )
        .toBe(true);
    } finally {
      peer.socket.close();
      other.socket.close();
      gm.socket.close();
    }
  });

  it("preserves concurrent updates to different keys and checks the merged size", async () => {
    const owner = await create(playerCookie);
    const peer = await connect(playerCookie);
    const gm = await connect(cookie);
    try {
      peer.send({
        type: "character.value",
        characterId: owner.id,
        key: "a",
        value: ["tag"],
        requestId: "a",
      });
      gm.send({
        type: "character.value",
        characterId: owner.id,
        key: "b",
        value: true,
        requestId: "b",
      });
      await Promise.all([acknowledged(peer, "a"), acknowledged(gm, "b")]);
      expect((await list())[0].values).toEqual({ a: ["tag"], b: true });
      const rows = Array.from({ length: 9 }, () => ({ item: "x".repeat(4000) }));
      peer.send({
        type: "character.value",
        characterId: owner.id,
        key: "first",
        value: rows,
        requestId: "first",
      });
      await acknowledged(peer, "first");
      peer.send({
        type: "character.value",
        characterId: owner.id,
        key: "second",
        value: rows,
        requestId: "second",
      });
      await expect
        .poll(() =>
          peer.frames.some((frame) => frame.type === "error" && frame.message?.includes("64 KB")),
        )
        .toBe(true);
      expect((await list())[0].values).toEqual({ a: ["tag"], b: true, first: rows });
    } finally {
      peer.socket.close();
      gm.socket.close();
    }
  });

  it("keeps every key from a burst of frames sent without waiting", async () => {
    const owner = await create(playerCookie);
    const peer = await connect(playerCookie);
    try {
      const keys = Array.from({ length: 20 }, (_, index) => `k${index}`);
      for (const key of keys)
        peer.send({
          type: "character.value",
          characterId: owner.id,
          key,
          value: key,
          requestId: key,
        });
      await Promise.all(keys.map((key) => acknowledged(peer, key)));
      expect((await list())[0].values).toEqual(Object.fromEntries(keys.map((key) => [key, key])));
    } finally {
      peer.socket.close();
    }
  });
});

describe("character layout preferences", () => {
  it("sets and clears preferences for an owner or DM and rejects other players", async () => {
    const owner = await create(playerCookie);
    const dmCharacter = await create();
    const peer = await connect(playerCookie);
    const gm = await connect(cookie);
    try {
      peer.send({
        type: "character.prefs",
        characterId: owner.id,
        blockId: "stats",
        variant: "bars",
      });
      await expect
        .poll(() =>
          peer.frames.some(
            (frame) =>
              frame.type === "character" &&
              frame.character.id === owner.id &&
              frame.character.layoutPrefs?.stats === "bars",
          ),
        )
        .toBe(true);
      expect((await list()).find((item) => item.id === owner.id)?.layoutPrefs).toEqual({
        stats: "bars",
      });
      peer.send({
        type: "character.prefs",
        characterId: dmCharacter.id,
        blockId: "stats",
        variant: "bars",
      });
      await expect
        .poll(() =>
          peer.frames.some(
            (frame) => frame.type === "error" && frame.message === "You cannot edit this character",
          ),
        )
        .toBe(true);
      expect(
        (await list()).find((item) => item.id === dmCharacter.id)?.layoutPrefs,
      ).toBeUndefined();
      gm.send({
        type: "character.prefs",
        characterId: owner.id,
        blockId: "stats",
        variant: "boxes",
      });
      await expect
        .poll(() =>
          gm.frames.some(
            (frame) => frame.type === "character" && frame.character.layoutPrefs?.stats === "boxes",
          ),
        )
        .toBe(true);
      peer.send({
        type: "character.prefs",
        characterId: owner.id,
        blockId: "stats",
        variant: null,
      });
      await expect
        .poll(() =>
          peer.frames.some(
            (frame) =>
              frame.type === "character" &&
              frame.character.id === owner.id &&
              Object.keys(frame.character.layoutPrefs ?? {}).length === 0,
          ),
        )
        .toBe(true);
      expect((await list()).find((item) => item.id === owner.id)?.layoutPrefs).toEqual({});
    } finally {
      peer.socket.close();
      gm.socket.close();
    }
  });

  it("preserves prefs through HTTP and WebSocket character saves", async () => {
    const owner = await create(playerCookie);
    const peer = await connect(playerCookie);
    const gm = await connect(cookie);
    try {
      peer.send({
        type: "character.prefs",
        characterId: owner.id,
        blockId: "stats",
        variant: "bars",
      });
      await expect
        .poll(() =>
          peer.frames.some(
            (frame) => frame.type === "character" && frame.character.layoutPrefs?.stats === "bars",
          ),
        )
        .toBe(true);
      const response = await save(
        { ...owner, name: "Saved", layoutPrefs: { stats: "strip" } },
        playerCookie,
      );
      expect(response.status).toBe(200);
      expect(Schema.decodeUnknownSync(Character)(await response.json()).layoutPrefs).toEqual({
        stats: "bars",
      });
      gm.send({
        type: "character.save",
        character: { ...owner, name: "DM saved", layoutPrefs: { stats: "strip" } },
      });
      await expect
        .poll(() =>
          gm.frames.some(
            (frame) => frame.type === "character" && frame.character.name === "DM saved",
          ),
        )
        .toBe(true);
      expect((await list())[0].layoutPrefs).toEqual({ stats: "bars" });
    } finally {
      peer.socket.close();
      gm.socket.close();
    }
  });

  it("enforces preference limits and treats invalid stored prefs as absent", async () => {
    const owner = await create(playerCookie);
    const peer = await connect(playerCookie);
    try {
      peer.send({
        type: "character.prefs",
        characterId: owner.id,
        blockId: "x".repeat(81),
        variant: "bars",
      });
      await expect.poll(() => peer.frames.filter((frame) => frame.type === "error").length).toBe(1);
      expect(peer.frames.at(-1)).toMatchObject({
        type: "error",
        message: expect.stringContaining("80"),
      });
      peer.send({
        type: "character.prefs",
        characterId: owner.id,
        blockId: "stats",
        variant: "x".repeat(41),
      });
      await expect.poll(() => peer.frames.filter((frame) => frame.type === "error").length).toBe(2);
      expect(peer.frames.at(-1)).toMatchObject({
        type: "error",
        message: expect.stringContaining("40"),
      });
      const db = await storage();
      const prefs = Object.fromEntries(
        Array.from({ length: 200 }, (_, i) => [`block-${i}`, "bars"]),
      );
      await db.exec(
        "UPDATE characters SET layout_prefs = ? WHERE id = ?",
        JSON.stringify(prefs),
        owner.id,
      );
      peer.send({
        type: "character.prefs",
        characterId: owner.id,
        blockId: "new-block",
        variant: "bars",
      });
      await expect.poll(() => peer.frames.filter((frame) => frame.type === "error").length).toBe(3);
      expect(peer.frames.at(-1)).toMatchObject({
        type: "error",
        message: expect.stringContaining("200"),
      });
      peer.send({
        type: "character.prefs",
        characterId: owner.id,
        blockId: "block-0",
        variant: null,
      });
      await expect
        .poll(async () => Object.keys((await list())[0].layoutPrefs ?? {}).length)
        .toBe(199);
      for (const raw of [
        "{bad JSON",
        "null",
        JSON.stringify({ stats: 12 }),
        JSON.stringify({ stats: "x".repeat(41) }),
        JSON.stringify({ ["x".repeat(81)]: "bars" }),
        JSON.stringify(
          Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`block-${i}`, "bars"])),
        ),
      ]) {
        await db.exec("UPDATE characters SET layout_prefs = ? WHERE id = ?", raw, owner.id);
        expect((await list())[0].layoutPrefs).toBeUndefined();
      }
    } finally {
      peer.socket.close();
    }
  });
});

it("lets members edit shared sheets, preserves their scope and creator, and enforces DM locks", async () => {
  const sheet = await template();
  const shared = Schema.decodeUnknownSync(Character)(
    await (
      await save({ name: "Crew", templateId: sheet.id, values: {}, scope: "world" }, playerCookie)
    ).json(),
  );
  expect(shared).toMatchObject({ scope: "world", locked: false });
  expect(await (await call(`/worlds/${worldId}`, { cookie: playerCookie })).json()).toMatchObject({
    characters: [{ id: shared.id, scope: "world", locked: false }],
  });
  expect((await list()).find((character) => character.id === shared.id)).toMatchObject({
    scope: "world",
    locked: false,
  });
  const invited = await call(`/worlds/${worldId}/members`, {
    method: "POST",
    body: { displayName: "Other", role: "player", kind: "invite", email: "other@example.test" },
  });
  expect(invited.status).toBe(201);
  const otherCookie = await tabletop.signin("other@example.test", "Other");
  const peer = await tabletop.connect({ worldId, cookie: otherCookie });
  const gm = await tabletop.connect({ worldId, cookie });
  const tracker = sheet.tickers[0];
  const current = async () => (await list()).find((character) => character.id === shared.id);
  try {
    await peer.sync();
    await gm.sync();
    peer.send({ type: "character.value", characterId: shared.id, key: "crew", value: "Hawkers" });
    peer.send({
      type: "ticker.set",
      characterId: shared.id,
      tickerId: tracker.id,
      value: tracker.min,
    });
    peer.send({ type: "roll.dice", characterId: shared.id, notation: "1d6", visibility: "public" });
    await peer.sync();
    expect(await current()).toMatchObject({
      values: { crew: "Hawkers" },
      tickers: { [tracker.id]: tracker.min },
    });
    expect(
      peer.frames.some((frame) => frame.type === "message" && frame.message.kind === "roll"),
    ).toBe(true);
    const saved = await save(
      { ...shared, name: "The crew", scope: "member", memberId: "forged-owner" },
      otherCookie,
    );
    expect(saved.status).toBe(200);
    expect(Schema.decodeUnknownSync(Character)(await saved.json())).toMatchObject({
      scope: "world",
      memberId: shared.memberId,
    });
    peer.send({ type: "character.save", character: { ...shared, scope: "member", locked: true } });
    await peer.sync();
    expect(await current()).toMatchObject({
      scope: "world",
      locked: false,
      memberId: shared.memberId,
    });
    peer.send({ type: "character.lock", characterId: shared.id, locked: true });
    await peer.sync();
    expect(peer.frames.filter((frame) => frame.type === "error")).toHaveLength(1);
    expect(await current()).toMatchObject({ locked: false });

    gm.send({ type: "character.lock", characterId: shared.id, locked: true });
    await gm.sync();
    await peer.sync();
    expect(
      peer.frames.some(
        (frame) =>
          frame.type === "character" && frame.character.id === shared.id && frame.character.locked,
      ),
    ).toBe(true);
    peer.send({ type: "character.value", characterId: shared.id, key: "crew", value: "Denied" });
    peer.send({
      type: "ticker.set",
      characterId: shared.id,
      tickerId: tracker.id,
      value: tracker.max,
    });
    peer.send({
      type: "character.prefs",
      characterId: shared.id,
      blockId: "anything",
      variant: "bars",
    });
    peer.send({ type: "character.save", character: { ...shared, locked: false } });
    peer.send({ type: "roll.dice", characterId: shared.id, notation: "1d6", visibility: "public" });
    await peer.sync();
    expect(peer.frames.filter((frame) => frame.type === "error")).toHaveLength(6);
    expect((await save({ ...shared, locked: false }, otherCookie)).status).toBe(403);
    expect(await current()).toMatchObject({ locked: true, tickers: { [tracker.id]: tracker.min } });
    gm.send({ type: "character.value", characterId: shared.id, key: "crew", value: "DM edit" });
    gm.send({
      type: "ticker.set",
      characterId: shared.id,
      tickerId: tracker.id,
      value: tracker.max,
    });
    gm.send({ type: "roll.dice", characterId: shared.id, notation: "1d6", visibility: "public" });
    await gm.sync();
    expect(await current()).toMatchObject({
      locked: true,
      values: { crew: "DM edit" },
      tickers: { [tracker.id]: tracker.max },
    });
    expect(gm.frames.filter((frame) => frame.type === "error")).toHaveLength(0);
    gm.send({ type: "character.lock", characterId: shared.id, locked: false });
    await gm.sync();
    peer.send({ type: "character.value", characterId: shared.id, key: "crew", value: "Unlocked" });
    peer.send({
      type: "ticker.set",
      characterId: shared.id,
      tickerId: tracker.id,
      value: tracker.min,
    });
    await peer.sync();
    expect(await current()).toMatchObject({
      locked: false,
      values: { crew: "Unlocked" },
      tickers: { [tracker.id]: tracker.min },
    });
    expect(peer.frames.filter((frame) => frame.type === "error")).toHaveLength(6);

    expect(
      (
        await call(`/worlds/${worldId}/characters/${shared.id}`, {
          method: "DELETE",
          cookie: otherCookie,
        })
      ).status,
    ).toBe(403);
    // The creator can delete even while a shared sheet is locked.
    gm.send({ type: "character.lock", characterId: shared.id, locked: true });
    await gm.sync();
    expect(
      (
        await call(`/worlds/${worldId}/characters/${shared.id}`, {
          method: "DELETE",
          cookie: playerCookie,
        })
      ).status,
    ).toBe(200);
  } finally {
    peer.socket.close();
    gm.socket.close();
  }
});

it("keeps member sheets private to their owner for values, preferences, rolls and scope updates", async () => {
  const owner = await create();
  expect(owner).toMatchObject({ scope: "member", locked: false });
  const peer = await tabletop.connect({ worldId, cookie: playerCookie });
  try {
    peer.send({ type: "character.value", characterId: owner.id, key: "name", value: "Denied" });
    peer.send({
      type: "character.prefs",
      characterId: owner.id,
      blockId: "stats",
      variant: "bars",
    });
    peer.send({ type: "roll.dice", characterId: owner.id, notation: "1d6", visibility: "public" });
    await peer.sync();
    expect(peer.frames.filter((frame) => frame.type === "error")).toHaveLength(3);
    expect((await list())[0].values).toEqual(owner.values);
    const saved = await save({ ...owner, scope: "world" });
    expect(saved.status).toBe(200);
    expect(Schema.decodeUnknownSync(Character)(await saved.json()).scope).toBe("member");
  } finally {
    peer.socket.close();
  }
});

it("uses shared permissions for avatar uploads and deletion, including the DO boundary", async () => {
  const sheet = await template();
  const shared = Schema.decodeUnknownSync(Character)(
    await (
      await save({ name: "Steading", templateId: sheet.id, values: {}, scope: "world" })
    ).json(),
  );
  const namespace = await mf.getDurableObjectNamespace("WORLDS");
  const rawStub = namespace.get(namespace.idFromName(`world:${worldId}`));
  const stub = rawStub as typeof rawStub & Pick<WorldDO, "setAvatar">;
  const player = await create(playerCookie);
  const privateSheet = await create();
  const avatarPath = `/worlds/${worldId}/characters/${shared.id}/avatar`;
  const upload = (authCookie: string) =>
    mf.dispatchFetch(`https://tabletop.test/api${avatarPath}`, {
      method: "POST",
      headers: { cookie: authCookie, "content-type": "image/png" },
      body: new Uint8Array([137, 80, 78, 71]),
    });
  expect((await upload(playerCookie)).status).toBe(200);
  expect((await list()).find((character) => character.id === shared.id)?.avatarKey).toBeTypeOf(
    "string",
  );
  expect((await call(avatarPath, { method: "DELETE", cookie: playerCookie })).status).toBe(200);
  expect((await list()).find((character) => character.id === shared.id)?.avatarKey).toBeUndefined();
  const gm = await tabletop.connect({ worldId, cookie });
  try {
    gm.send({ type: "character.lock", characterId: shared.id, locked: true });
    await gm.sync();
    expect((await upload(playerCookie)).status).toBe(403);
    expect((await call(avatarPath, { method: "DELETE", cookie: playerCookie })).status).toBe(403);
    for (const characterId of [shared.id, privateSheet.id]) {
      expect(
        await stub.setAvatar(
          { memberId: player.memberId, role: "player", displayName: "Player" },
          { characterId, avatarKey: "forged-key" },
        ),
      ).toMatchObject({ ok: false, error: { _tag: "Forbidden" } });
    }
    expect((await upload(cookie)).status).toBe(200);
    expect((await call(avatarPath, { method: "DELETE" })).status).toBe(200);
  } finally {
    gm.socket.close();
  }
});
