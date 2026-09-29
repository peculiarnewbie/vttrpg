// @vitest-environment node
import * as Schema from "effect/Schema";
import { build, stop } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { Character, SheetTemplate, ServerFrame, type ClientFrame } from "../domain/schemas";

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
  const world = await call("/worlds", { method: "POST", body: { name: "Character test" } });
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
  return { socket, frames, send: (frame: ClientFrame) => socket.send(JSON.stringify(frame)) };
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
