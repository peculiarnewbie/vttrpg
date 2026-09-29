// @vitest-environment node
import * as Schema from "effect/Schema";
import { build, stop } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { BoardSnapshot, SceneList, normalizeBoard } from "../domain/board";

let mf: Miniflare;
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
  const bundle = await build({
    entryPoints: ["src/worker.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    external: ["cloudflare:workers", "node:*"],
    target: "es2022",
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
                "      this.ensureSchema();",
                `
            this.ctx.storage.sql.exec("CREATE TABLE board (id INTEGER PRIMARY KEY CHECK (id = 1), snapshot TEXT NOT NULL)");
            this.ctx.storage.sql.exec("INSERT INTO board (id, snapshot) VALUES (1, ?)", ${JSON.stringify(JSON.stringify(legacy))});
            this.ensureSchema();
            this.ensureSchema();
          `,
              ),
            };
          });
        },
      },
    ],
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      name: "board-migration",
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: "2026-03-22",
      compatibilityFlags: ["nodejs_compat"],
      durableObjects: { WORLDS: { className: "WorldDO", useSQLite: true } },
    }),
  );
  await mf.ready;
}, 30000);
afterAll(async () => {
  await mf?.dispose();
  await stop();
});

it("migrates an existing board losslessly into one active scene and preserves its revision", async () => {
  const namespace = await mf.getDurableObjectNamespace("WORLDS");
  const stub = namespace.get(namespace.idFromName("world:legacy"));
  const request = (path: string, init?: { method?: string; body?: string }) =>
    stub.fetch(`https://world/internal/${path}`, {
      ...init,
      headers: { "x-ttrpg-role": "dm", "content-type": "application/json" },
    });
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
