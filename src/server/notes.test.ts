// @vitest-environment node
import * as Schema from "effect/Schema";
import { startTabletop, type Tabletop, type CallOptions } from "../test/miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Note, NoteSummary, type SaveNoteInput } from "../domain/schemas";

let tabletop: Tabletop;
let cookie = "";
let worldId = "";
let playerCookie = "";
const call = (path: string, options: CallOptions = {}) => tabletop.call(path, options);
beforeAll(async () => {
  tabletop = await startTabletop({
    cookie: () => cookie,
  });
  cookie = await tabletop.signin("dm@example.test", "DM");
}, 30000);
beforeEach(async () => {
  const world = await call("/worlds", { method: "POST", body: { name: "Notes test" } });
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

const save = (id: string, input: SaveNoteInput, authCookie = cookie) =>
  call(`/worlds/${worldId}/notes/${id}`, { method: "PUT", body: input, cookie: authCookie });
const input: SaveNoteInput = { title: "Journal", content: "First entry", visibility: "public" };

describe("notes through real Worker, R2, and SQLite DO", () => {
  it("enforces shared editing, DM access, and owner-only controls", async () => {
    expect((await save("journal", input)).status).toBe(200);
    expect((await save("journal", { ...input, content: "Denied" }, playerCookie)).status).toBe(403);
    expect((await save("journal", { ...input, editableByAll: true })).status).toBe(200);
    const edited = await save(
      "journal",
      { ...input, title: "Party journal", content: "Player entry" },
      playerCookie,
    );
    expect(edited.status).toBe(200);
    const note = Schema.decodeUnknownSync(Note)(await edited.json());
    expect(note).toMatchObject({
      title: "Party journal",
      content: "Player entry",
      editableByAll: true,
    });
    expect((await save("journal", { ...input, editableByAll: false }, playerCookie)).status).toBe(
      403,
    );
    expect((await save("journal", { ...input, visibility: "private" }, playerCookie)).status).toBe(
      403,
    );
    expect(
      (await call(`/worlds/${worldId}/notes/journal`, { method: "DELETE", cookie: playerCookie }))
        .status,
    ).toBe(403);
    expect((await save("journal", { ...input, editableByAll: false })).status).toBe(200);
    expect((await save("journal", input, playerCookie)).status).toBe(403);

    expect((await save("player-note", input, playerCookie)).status).toBe(200);
    expect((await save("player-note", { ...input, content: "DM entry" })).status).toBe(200);
    expect((await save("player-note", { ...input, editableByAll: true })).status).toBe(403);
    expect((await call(`/worlds/${worldId}/notes/player-note`, { method: "DELETE" })).status).toBe(
      403,
    );
    expect(
      (
        await save(
          "player-note",
          { ...input, visibility: "private", editableByAll: true },
          playerCookie,
        )
      ).status,
    ).toBe(200);
    expect((await save("player-note", { ...input, visibility: "private" })).status).toBe(403);
    expect((await call(`/worlds/${worldId}/notes/player-note`)).status).toBe(403);
  });

  it("filters create/save/delete notifications and removes notes when visibility is revoked", async () => {
    const connect = async (authCookie: string) => {
      const { socket, frames, sync } = await tabletop.connect({
        worldId,
        cookie: authCookie,
        barrierNoteId: "barrier",
        missingSocketMessage: "Missing socket",
      });
      await expect.poll(() => frames.some((frame) => frame.type === "hello")).toBe(true);
      return {
        socket,
        sync,
        updates: () => frames.filter((frame) => frame.type === "notes.updated"),
      };
    };
    const dm = await connect(cookie);
    const player = await connect(playerCookie);
    try {
      await save("secret", { ...input, visibility: "dm" });
      await player.sync();
      await dm.sync();
      expect(player.updates()).toHaveLength(0);
      expect(dm.updates()).toHaveLength(1);
      await save("secret", { ...input, visibility: "private" });
      await player.sync();
      expect(player.updates()).toHaveLength(0);
      await save("secret", input);
      await player.sync();
      expect(player.updates()).toHaveLength(1);
      expect(player.updates()[0]).toEqual({ type: "notes.updated" });
      await save("secret", { ...input, title: "Renamed" });
      await player.sync();
      expect(player.updates()).toHaveLength(2);
      const listed = Schema.decodeUnknownSync(Schema.Array(NoteSummary))(
        await (await call(`/worlds/${worldId}/notes`, { cookie: playerCookie })).json(),
      );
      expect(listed[0].title).toBe("Renamed");
      await save("secret", { ...input, visibility: "private" });
      await player.sync();
      expect(player.updates()).toHaveLength(3);
      expect(
        await (await call(`/worlds/${worldId}/notes`, { cookie: playerCookie })).json(),
      ).toEqual([]);
      await call(`/worlds/${worldId}/notes/secret`, { method: "DELETE" });
      await player.sync();
      expect(player.updates()).toHaveLength(3);
      await save("public", input);
      await call(`/worlds/${worldId}/notes/public`, { method: "DELETE" });
      await player.sync();
      expect(player.updates()).toHaveLength(5);
    } finally {
      dm.socket.close();
      player.socket.close();
    }
  });
});
