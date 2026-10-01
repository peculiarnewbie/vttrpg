// @vitest-environment node
import type { WorldDO } from "./world-do";
import * as Schema from "effect/Schema";
import { startTabletop, type Tabletop } from "../test/miniflare";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { BoardSnapshot, SceneList, normalizeBoard } from "../domain/board";

let tabletop: Tabletop;
let mf: Tabletop["mf"];
const legacy: BoardSnapshot = {
  revision: 17,
  document: {
    background: "old-backdrop",
    elements: [
      {
        id: "old-note",
        type: "text",
        text: "Keep this",
        x: -50,
        y: 25,
        width: 400,
        height: 200,
        fontSize: 32,
      },
    ],
  },
};

beforeAll(async () => {
  tabletop = await startTabletop({
    name: "board-migration",
    bindings: false,
    plugins: [
      {
        name: "legacy-board-fixture",
        setup(build) {
          build.onLoad({ filter: /\/world-do\.ts$/ }, async ({ path }) => {
            const source = await readFile(path, "utf8");
            // Seed the real SQLite database before the production migration, then
            // run initialization twice to exercise its idempotence.
            return {
              loader: "ts",
              contents: source.replace(
                "      yield* worldSync(() => this.ensureSchema());",
                `
            yield* worldSync(() => {
            this.storage.sql.exec("CREATE TABLE board (id INTEGER PRIMARY KEY CHECK (id = 1), snapshot TEXT NOT NULL)");
            this.storage.sql.exec("INSERT INTO board (id, snapshot) VALUES (1, ?)", ${JSON.stringify(JSON.stringify(legacy))});
            this.ensureSchema();
            this.ensureSchema();
            });
          `,
              ),
            };
          });
        },
      },
    ],
  });
  mf = tabletop.mf;
}, 30000);
afterAll(async () => {
  await tabletop?.dispose();
});

it("migrates an existing board losslessly into one active scene and preserves its revision", async () => {
  const namespace = await mf.getDurableObjectNamespace("WORLDS");
  const rawStub = namespace.get(namespace.idFromName("world:legacy"));
  const stub = rawStub as typeof rawStub & Pick<WorldDO, "scenes" | "board" | "publishScene">;
  const caller = { memberId: "dm", displayName: "DM", role: "dm" } as const;
  const request = async (path: string, init?: { method?: string; body?: string }) => {
    const reply =
      path === "scenes"
        ? await stub.scenes(caller)
        : path === "board"
          ? await stub.board(caller)
          : await stub.publishScene(
              caller,
              path.slice("scenes/".length),
              Schema.decodeUnknownSync(BoardSnapshot)(JSON.parse(init?.body ?? "{}")),
            );
    return reply.ok
      ? Response.json(reply.value)
      : Response.json({ error: reply.error.message }, { status: 400 });
  };
  const list = Schema.decodeUnknownSync(SceneList)(await (await request("scenes")).json());
  expect(list.scenes).toHaveLength(1);
  expect(list.scenes[0]).toMatchObject({
    id: list.activeSceneId,
    name: "Scene 1",
    revision: 17,
    elementCount: 1,
  });
  const migrated = Schema.decodeUnknownSync(BoardSnapshot)(await (await request("board")).json());
  expect(migrated).toEqual({
    ...legacy,
    document: normalizeBoard(legacy.document),
    sceneId: list.activeSceneId,
    sceneName: "Scene 1",
  });
  expect(
    (
      await request(`scenes/${list.activeSceneId}`, {
        method: "PUT",
        body: JSON.stringify({ ...legacy, revision: 0 }),
      })
    ).status,
  ).toBe(400);
  expect(
    (await request(`scenes/${list.activeSceneId}`, { method: "PUT", body: JSON.stringify(legacy) }))
      .status,
  ).toBe(200);
  expect(
    Schema.decodeUnknownSync(BoardSnapshot)(await (await request("board")).json()).revision,
  ).toBe(18);
});
