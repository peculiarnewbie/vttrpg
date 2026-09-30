// @vitest-environment node
import * as Schema from "effect/Schema";
import { build, stop } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  Character,
  MessagePage,
  SheetTemplate,
  ServerFrame,
  type ClientFrame,
  type RollResult,
} from "../domain/schemas";
import type { SheetLayout } from "../domain/sheet-layout";
import { parseNotation } from "../domain/dice-notation";

let mf: Miniflare;
let cookie = "";
let worldId = "";
let playerCookie = "";
let otherCookie = "";
const closeSockets: (() => void)[] = [];
const call = (path: string, options: { method?: string; body?: unknown; cookie?: string } = {}) =>
  mf.dispatchFetch(`https://tabletop.test/api${path}`, {
    method: options.method ?? "GET",
    headers: { cookie: options.cookie ?? cookie, "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
const signin = async (email: string, displayName: string) => {
  const response = await call("/auth/google", { method: "POST", body: { email, displayName } });
  const session = response.headers.get("set-cookie");
  if (!session) throw new Error("Missing session cookie");
  return session.split(";")[0];
};

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
      unsafeInspectDurableObjects: true,
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
  cookie = await signin("roll-dm@example.test", "DM");
}, 30000);

beforeEach(async () => {
  const response = await call("/worlds", { method: "POST", body: { name: "Roll test" } });
  worldId = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(
    await response.json(),
  ).id;
  for (const [email, displayName] of [
    ["roll-player@example.test", "Player"],
    ["roll-other@example.test", "Other"],
  ]) {
    const member = await call(`/worlds/${worldId}/members`, {
      method: "POST",
      body: { displayName, role: "player", kind: "invite", email },
    });
    expect(member.status).toBe(201);
  }
  playerCookie = await signin("roll-player@example.test", "Player");
  otherCookie = await signin("roll-other@example.test", "Other");
}, 30000);

afterEach(() => {
  for (const close of closeSockets.splice(0)) close();
});
afterAll(async () => {
  await mf?.dispose();
  await stop();
});

const layout: SheetLayout = {
  system: "test",
  name: "Rolls",
  derived: [{ key: "str_mod", label: "STR mod", expr: "floor((@str-10)/2)" }],
  pages: [
    {
      id: "main",
      title: "Main",
      blocks: [
        { id: "stats", type: "stats", items: [{ key: "str", label: "Strength" }] },
        {
          id: "weapons",
          type: "list",
          key: "weapons",
          columns: [{ key: "bonus", label: "Bonus", kind: "number" }],
        },
      ],
    },
  ],
};
const create = async (sheetLayout: SheetLayout | undefined = layout) => {
  const templateResponse = await call(`/worlds/${worldId}/templates`, {
    method: "POST",
    body: {
      name: "Roll sheet",
      fields: [],
      stats: [],
      tickers: [],
      rolls: [],
      layout: sheetLayout,
    },
  });
  expect(templateResponse.status).toBe(200);
  const template = Schema.decodeUnknownSync(SheetTemplate)(await templateResponse.json());
  const response = await call(`/worlds/${worldId}/characters`, {
    method: "POST",
    cookie: playerCookie,
    body: {
      name: "Hero",
      templateId: template.id,
      values: { str: 14, UpperBonus: 3, weapons: [{ bonus: 5 }, { bonus: 7 }], tags: ["brave"] },
    },
  });
  expect(response.status).toBe(200);
  return Schema.decodeUnknownSync(Character)(await response.json());
};
const characters = async () =>
  Schema.decodeUnknownSync(Schema.Array(Character))(
    await (await call(`/worlds/${worldId}/characters`)).json(),
  );
const history = async () =>
  Schema.decodeUnknownSync(MessagePage)(await (await call(`/worlds/${worldId}/messages`)).json());
const connect = async (authCookie: string) => {
  const response = await mf.dispatchFetch(`https://tabletop.test/api/worlds/${worldId}/ws`, {
    headers: { cookie: authCookie, Upgrade: "websocket" },
  });
  const socket = response.webSocket;
  if (!socket) throw new Error("Missing websocket");
  const frames: ServerFrame[] = [];
  socket.addEventListener("message", (event) =>
    frames.push(Schema.decodeUnknownSync(ServerFrame)(JSON.parse(String(event.data)))),
  );
  socket.accept();
  await expect.poll(() => frames.some((frame) => frame.type === "hello")).toBe(true);
  const peer = { socket, frames, send: (frame: ClientFrame) => socket.send(JSON.stringify(frame)) };
  closeSockets.push(() => socket.close());
  return peer;
};
type Peer = Awaited<ReturnType<typeof connect>>;
type DiceFrame = Extract<ClientFrame, { type: "roll.dice" }>;
let rollNumber = 0;
const diceFrame = (
  notation: string,
  options: Omit<Partial<DiceFrame>, "type" | "notation"> = {},
): DiceFrame => ({ type: "roll.dice", notation, visibility: "public", ...options });
const messages = (peer: Peer) =>
  peer.frames.flatMap((frame) => (frame.type === "message" ? [frame.message] : []));
const roll = async (peer: Peer, frame: DiceFrame) => {
  const label = frame.label ?? `Roll ${++rollNumber}`;
  const find = () =>
    messages(peer).find((message) => message.kind === "roll" && message.content === label.trim());
  peer.send({ ...frame, label });
  await expect.poll(() => find() !== undefined).toBe(true);
  const message = find();
  if (!message?.roll) throw new Error("Missing roll result");
  return { message, result: message.roll };
};
const rejected = async (peer: Peer, observer: Peer, frame: DiceFrame, error?: string) => {
  const stored = (await history()).messages.length;
  await expect.poll(() => messages(peer).length).toBe(stored);
  await expect.poll(() => messages(observer).length).toBe(stored);
  const start = peer.frames.length;
  const observerStart = observer.frames.length;
  peer.send(frame);
  await expect
    .poll(() => peer.frames.slice(start).some((item) => item.type === "error"))
    .toBe(true);
  expect(peer.frames.slice(start).find((item) => item.type === "error")).toMatchObject({
    type: "error",
    code: "roll",
    message: error ?? expect.any(String),
  });
  // A following chat message is a barrier: both sockets have seen this roll's effects.
  const marker = `after rejection ${stored}`;
  peer.send({
    type: "chat",
    kind: "ooc",
    content: marker,
    visibility: "public",
    recipientMemberIds: [],
  });
  await expect
    .poll(() => messages(observer).some((message) => message.content === marker))
    .toBe(true);
  await expect.poll(() => messages(peer).some((message) => message.content === marker)).toBe(true);
  expect(peer.frames.slice(start).filter((item) => item.type === "message")).toHaveLength(1);
  expect(
    observer.frames.slice(observerStart).filter((item) => item.type === "message"),
  ).toHaveLength(1);
  expect(observer.frames.slice(observerStart).some((item) => item.type === "error")).toBe(false);
  expect((await history()).messages).toHaveLength(stored + 1);
};
const range = (result: RollResult, minimum: number, maximum: number) => {
  expect(result.total).toBeGreaterThanOrEqual(minimum);
  expect(result.total).toBeLessThanOrEqual(maximum);
};

describe("notation rolls", () => {
  it("rolls plain notation and /roll commands with the existing author and label behaviour", async () => {
    const character = await create();
    const peer = await connect(playerCookie);
    const { message, result } = await roll(peer, diceFrame("/roll 2d6+3", { label: "  Damage  " }));
    expect(message).toMatchObject({ kind: "roll", content: "Damage", characterId: character.id });
    expect(result.dice).toHaveLength(1);
    expect(result.dice[0].results).toHaveLength(2);
    expect(result.modifiers).toEqual([{ label: "static", value: 3 }]);
    range(result, 5, 15);
    expect((await history()).messages[0].roll).toEqual(result);
  });

  it("sends invalid notation errors only to the sender without persisting or broadcasting a roll", async () => {
    const peer = await connect(playerCookie);
    const observer = await connect(cookie);
    const parsed = parseNotation("1d20 + nonsense");
    if (parsed.ok) throw new Error("Expected invalid notation");
    await rejected(peer, observer, diceFrame("1d20 + nonsense"), parsed.error);
  });

  it("resolves a derived modifier and label from the character's own template without changing values", async () => {
    const character = await create();
    // Another template must not replace the character's chosen layout.
    await call(`/worlds/${worldId}/templates`, {
      method: "POST",
      body: {
        name: "Other sheet",
        fields: [],
        stats: [],
        tickers: [],
        rolls: [],
        layout: { ...layout, derived: [{ key: "str_mod", label: "Wrong", expr: "99" }] },
      },
    });
    const peer = await connect(playerCookie);
    const { result } = await roll(peer, diceFrame("1d20+@str_mod", { characterId: character.id }));
    expect(result.modifiers).toEqual([{ label: "STR mod", value: 2 }]);
    range(result, 3, 22);
    expect((await characters()).find((item) => item.id === character.id)).toEqual(character);
  });

  it("allows the owner and DM, rejects another player even without refs, and attributes the chosen character", async () => {
    const character = await create();
    const db = await mf.unsafeGetDurableObjectStorage("tabletop", "WorldDO", {
      name: `world:${worldId}`,
    });
    await db.exec("UPDATE characters SET avatar_key = ? WHERE id = ?", "hero-avatar", character.id);
    const owner = await connect(playerCookie);
    const other = await connect(otherCookie);
    const dm = await connect(cookie);
    await roll(owner, diceFrame("1d20+@str_mod", { characterId: character.id }));
    await rejected(other, owner, diceFrame("1d20+@str_mod", { characterId: character.id }));
    await rejected(other, owner, diceFrame("1d20", { characterId: character.id }));
    const { message, result } = await roll(
      dm,
      diceFrame("1d20+@str_mod", { characterId: character.id }),
    );
    expect(message).toMatchObject({
      authorName: "DM",
      characterId: character.id,
      authorAvatarKey: "hero-avatar",
    });
    expect(message.authorMemberId).not.toBe(character.memberId);
    expect(result.modifiers).toEqual([{ label: "STR mod", value: 2 }]);
  });

  it("rejects refs without an explicit character and nonexistent characters, including for a DM", async () => {
    await create();
    const owner = await connect(playerCookie);
    const dm = await connect(cookie);
    await rejected(owner, dm, diceFrame("1d20+@str_mod"));
    await rejected(owner, dm, diceFrame("(@str)d6"));
    await rejected(dm, owner, diceFrame("1d20", { characterId: "missing" }), "Character not found");
  });

  it("resolves the selected list row and rejects invalid row selections", async () => {
    const character = await create();
    const owner = await connect(playerCookie);
    const dm = await connect(cookie);
    const { result } = await roll(
      owner,
      diceFrame("1d20+@row.bonus", {
        characterId: character.id,
        row: { key: "weapons", index: 1 },
      }),
    );
    expect(result.modifiers).toEqual([{ label: "Bonus", value: 7 }]);
    range(result, 8, 27);
    for (const row of [
      { key: "weapons", index: -1 },
      { key: "weapons", index: 2 },
      { key: "missing", index: 0 },
      { key: "str", index: 0 },
      { key: "tags", index: 0 },
    ])
      await rejected(owner, dm, diceFrame("1d20+@row.bonus", { characterId: character.id, row }));
    expect((await characters())[0]).toEqual(character);
  });

  it("reports unknown values and excessive resolved dice instead of creating messages", async () => {
    const character = await create();
    const owner = await connect(playerCookie);
    const dm = await connect(cookie);
    await rejected(
      owner,
      dm,
      diceFrame("1d20+@typo", { characterId: character.id }),
      "Unknown value @typo",
    );
    await rejected(owner, dm, diceFrame("(@str)d6+90d6", { characterId: character.id }));
    expect((await characters())[0]).toEqual(character);
  });

  it("reads legacy templates without layouts and preserves case-sensitive refs after /roll", async () => {
    const character = await create({ system: "test", name: "Legacy", pages: [] });
    const db = await mf.unsafeGetDurableObjectStorage("tabletop", "WorldDO", {
      name: `world:${worldId}`,
    });
    await db.exec("UPDATE templates SET layout = NULL WHERE id = ?", character.templateId);
    const owner = await connect(playerCookie);
    const { result } = await roll(
      owner,
      diceFrame("/roll 1d20+@UpperBonus", { characterId: character.id }),
    );
    expect(result.modifiers).toEqual([{ label: "UpperBonus", value: 3 }]);
    range(result, 4, 23);
  });

  it("carries independent groups and kept dice through broadcasts and stored history", async () => {
    const peer = await connect(playerCookie);
    const { result } = await roll(peer, diceFrame("1d20adv+2 | 4d6kh3-1"));
    expect(result.groups).toHaveLength(2);
    const [first, second] = result.groups ?? [];
    expect(result.total).toBe(first.total);
    expect(result.dice).toEqual(first.dice);
    expect(result.modifiers).toEqual(first.modifiers);
    expect(first.dice[0].results).toHaveLength(2);
    expect(first.dice[0].kept).toHaveLength(2);
    expect(first.dice[0].kept?.filter(Boolean)).toHaveLength(1);
    expect(second.dice[0].results).toHaveLength(4);
    expect(second.dice[0].kept).toHaveLength(4);
    expect(second.dice[0].kept?.filter(Boolean)).toHaveLength(3);
    expect(first.total).toBeGreaterThanOrEqual(3);
    expect(first.total).toBeLessThanOrEqual(22);
    expect(second.total).toBeGreaterThanOrEqual(2);
    expect(second.total).toBeLessThanOrEqual(17);
    expect((await history()).messages[0].roll).toEqual(result);
  });

  it("decodes older stored rolls without the new optional fields", async () => {
    const peer = await connect(playerCookie);
    const { message } = await roll(peer, diceFrame("1d6"));
    const legacy: RollResult = {
      notation: "1d6",
      dice: [{ sides: 6, results: [4] }],
      modifiers: [],
      total: 4,
    };
    const db = await mf.unsafeGetDurableObjectStorage("tabletop", "WorldDO", {
      name: `world:${worldId}`,
    });
    await db.exec("UPDATE messages SET roll = ? WHERE id = ?", JSON.stringify(legacy), message.id);
    expect((await history()).messages[0].roll).toEqual(legacy);
  });
});
