// @vitest-environment node
import * as Schema from "effect/Schema";
import { build, stop } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { BoardSnapshot, emptyBoard } from "../domain/board";

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
const board = {
  revision: 0,
  document: {
    background: null,
    elements: [
      {
        id: "note",
        type: "text",
        text: "Welcome to the forest",
        x: 10,
        y: 20,
        width: 240,
        height: 160,
      },
    ],
  },
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
  const world = await call("/worlds", { method: "POST", body: { name: "Board test" } });
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

describe("published board through real Worker, D1, R2, and SQLite DO", () => {
  it("starts empty and denies anonymous access and player writes", async () => {
    expect(await (await call(`/worlds/${worldId}/board`)).json()).toEqual(emptyBoard());
    expect((await call(`/worlds/${worldId}/board`, { cookie: "" })).status).toBe(401);
    expect(
      (await call(`/worlds/${worldId}/board`, { method: "PUT", cookie: playerCookie, body: board }))
        .status,
    ).toBe(403);
    expect(
      (await call(`/worlds/${worldId}/board/images`, { method: "POST", cookie: playerCookie }))
        .status,
    ).toBe(403);
  });
  it("persists a DM snapshot and makes it available to players and bootstrap", async () => {
    const response = await call(`/worlds/${worldId}/board`, { method: "PUT", body: board });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...board, revision: 1 });
    expect(await (await call(`/worlds/${worldId}/board`, { cookie: playerCookie })).json()).toEqual(
      { ...board, revision: 1 },
    );
    expect(
      Schema.decodeUnknownSync(Schema.Struct({ board: BoardSnapshot }))(
        await (await call(`/worlds/${worldId}`)).json(),
      ).board,
    ).toEqual({
      ...board,
      revision: 1,
    });
  });
  it("rejects stale and invalid publications without losing the saved board", async () => {
    await call(`/worlds/${worldId}/board`, { method: "PUT", body: board });
    expect((await call(`/worlds/${worldId}/board`, { method: "PUT", body: board })).status).toBe(
      400,
    );
    expect(
      (
        await call(`/worlds/${worldId}/board`, {
          method: "PUT",
          body: {
            revision: 1,
            document: {
              background: null,
              elements: [{ ...board.document.elements[0], width: -1 }],
            },
          },
        })
      ).status,
    ).toBe(400);
    expect(await (await call(`/worlds/${worldId}/board`)).json()).toEqual({
      ...board,
      revision: 1,
    });
  });
  it("streams uploaded images to members and isolates assets between worlds", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const uploaded = await mf.dispatchFetch(
      `https://tabletop.test/api/worlds/${worldId}/board/images`,
      { method: "POST", headers: { cookie, "content-type": "image/png" }, body: bytes },
    );
    expect(uploaded.status).toBe(201);
    const { assetId } = Schema.decodeUnknownSync(Schema.Struct({ assetId: Schema.String }))(
      await uploaded.json(),
    );
    const image = await call(`/worlds/${worldId}/board/images/${assetId}`, {
      cookie: playerCookie,
    });
    expect(image.status).toBe(200);
    expect(image.headers.get("cache-control")).toContain("private");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(bytes);
    const other = await call("/worlds", { method: "POST", body: { name: "Other world" } });
    const { id } = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(
      await other.json(),
    );
    expect((await call(`/worlds/${id}/board/images/${assetId}`)).status).toBe(404);
    expect((await call(`/worlds/${id}/board`, { cookie: playerCookie })).status).toBe(403);
    const oversized = await mf.dispatchFetch(
      `https://tabletop.test/api/worlds/${worldId}/board/images`,
      {
        method: "POST",
        headers: { cookie, "content-type": "image/png" },
        body: new Uint8Array(5 * 1024 * 1024 + 1),
      },
    );
    expect(oversized.status).toBe(400);
  });
  it("sends the current board on connection and broadcasts only published snapshots", async () => {
    await call(`/worlds/${worldId}/board`, { method: "PUT", body: board });
    const response = await mf.dispatchFetch(`https://tabletop.test/api/worlds/${worldId}/ws`, {
      headers: { cookie: playerCookie, Upgrade: "websocket" },
    });
    expect(response.status).toBe(101);
    const socket = response.webSocket!;
    const frames: { type: string; board?: { revision: number } }[] = [];
    socket.addEventListener("message", (event) => frames.push(JSON.parse(String(event.data))));
    socket.accept();
    await expect
      .poll(() => frames.find((frame) => frame.type === "board")?.board?.revision)
      .toBe(1);
    await call(`/worlds/${worldId}/board`, { method: "PUT", body: { ...board, revision: 1 } });
    await expect
      .poll(() => frames.filter((frame) => frame.type === "board").at(-1)?.board?.revision)
      .toBe(2);
    socket.close();
  });
});
