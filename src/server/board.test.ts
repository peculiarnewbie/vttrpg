// @vitest-environment node
import * as Schema from "effect/Schema";
import { build, stop } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { BoardSnapshot, emptyBoard } from "../domain/board";
import { ServerFrame, type ClientFrame } from "../domain/schemas";

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
  it("relays authenticated cursors, respects toggles, validates coordinates, and clears disconnected tabs", async () => {
    const connect = async (authCookie: string) => {
      const response = await mf.dispatchFetch(`https://tabletop.test/api/worlds/${worldId}/ws`, {
        headers: { cookie: authCookie, Upgrade: "websocket" },
      });
      expect(response.status).toBe(101);
      const socket = response.webSocket;
      if (!socket) throw new Error("Missing websocket");
      const frames: ServerFrame[] = [];
      socket.addEventListener("message", (event) =>
        frames.push(Schema.decodeUnknownSync(ServerFrame)(JSON.parse(String(event.data)))),
      );
      socket.accept();
      await expect.poll(() => frames.some((frame) => frame.type === "board")).toBe(true);
      const send = (frame: ClientFrame) => socket.send(JSON.stringify(frame));
      // A reply on the same ordered socket is a barrier for preceding messages.
      const sync = async () => {
        const count = frames.filter((frame) => frame.type === "presence").length;
        send({ type: "note.saved", noteId: "cursor-test-barrier" });
        await expect
          .poll(() => frames.filter((frame) => frame.type === "presence").length)
          .toBeGreaterThan(count);
      };
      return { socket, frames, send, sync };
    };
    const dm = await connect(cookie);
    const player = await connect(playerCookie);
    const secondTab = await connect(playerCookie);
    try {
      for (const client of [dm, player, secondTab]) {
        client.send({ type: "cursors.subscribe", enabled: true });
        await client.sync();
      }
      player.socket.send(
        JSON.stringify({
          type: "cursor",
          memberId: "spoofed",
          displayName: "Imposter",
          position: { x: 20, y: 40 },
        }),
      );
      await expect.poll(() => dm.frames.filter((frame) => frame.type === "cursor").length).toBe(1);
      const first = dm.frames.find((frame) => frame.type === "cursor");
      if (first?.type !== "cursor") throw new Error("Missing cursor");
      expect(first.cursor).toMatchObject({ displayName: "Player", position: { x: 20, y: 40 } });
      expect(first.cursor.memberId).not.toBe("spoofed");
      expect(player.frames.some((frame) => frame.type === "cursor")).toBe(false);

      secondTab.send({ type: "cursor", position: { x: 70, y: 80 } });
      await expect.poll(() => dm.frames.filter((frame) => frame.type === "cursor").length).toBe(2);
      const second = dm.frames.filter((frame) => frame.type === "cursor").at(-1);
      expect(second?.cursor.id).not.toBe(first.cursor.id);

      player.send({ type: "cursors.subscribe", enabled: false });
      await expect
        .poll(() => dm.frames.filter((frame) => frame.type === "cursor").at(-1)?.cursor)
        .toEqual({ ...first.cursor, position: null });
      const count = dm.frames.filter((frame) => frame.type === "cursor").length;
      player.send({ type: "cursor", position: { x: 99, y: 99 } });
      await player.sync();
      expect(dm.frames.filter((frame) => frame.type === "cursor")).toHaveLength(count);

      secondTab.socket.send(JSON.stringify({ type: "cursor", position: { x: 100001, y: 0 } }));
      await expect.poll(() => secondTab.frames.some((frame) => frame.type === "error")).toBe(true);
      expect(dm.frames.filter((frame) => frame.type === "cursor")).toHaveLength(count);

      secondTab.socket.close();
      await expect
        .poll(() => dm.frames.filter((frame) => frame.type === "cursor").at(-1)?.cursor)
        .toEqual({ ...second?.cursor, position: null });

      dm.send({ type: "cursors.subscribe", enabled: false });
      await dm.sync();
      const disabledCount = dm.frames.filter((frame) => frame.type === "cursor").length;
      player.send({ type: "cursors.subscribe", enabled: true });
      player.send({ type: "cursor", position: { x: 50, y: 60 } });
      await player.sync();
      expect(dm.frames.filter((frame) => frame.type === "cursor")).toHaveLength(disabledCount);
    } finally {
      for (const client of [dm, player, secondTab]) {
        if (client.socket.readyState === 1) client.socket.close();
      }
    }
  });
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
  it("persists scaled text and sends the saved font size to players", async () => {
    const scaled = {
      ...board,
      document: {
        ...board.document,
        elements: [{ ...board.document.elements[0], width: 480, height: 320, fontSize: 40 }],
      },
    };
    expect((await call(`/worlds/${worldId}/board`, { method: "PUT", body: scaled })).status).toBe(
      200,
    );
    expect(await (await call(`/worlds/${worldId}/board`, { cookie: playerCookie })).json()).toEqual(
      { ...scaled, revision: 1 },
    );
    const invalid = {
      ...scaled,
      revision: 1,
      document: { ...scaled.document, elements: [{ ...scaled.document.elements[0], fontSize: 0 }] },
    };
    expect((await call(`/worlds/${worldId}/board`, { method: "PUT", body: invalid })).status).toBe(
      400,
    );
    expect(await (await call(`/worlds/${worldId}/board`)).json()).toEqual({
      ...scaled,
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
