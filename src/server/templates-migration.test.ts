// @vitest-environment node
import * as Schema from "effect/Schema";
import { startTabletop, type Tabletop } from "../test/miniflare";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { SheetTemplate } from "../domain/schemas";
import { presetTemplates } from "../domain/preset-templates";

let tabletop: Tabletop;
let mf: Tabletop["mf"];
beforeAll(async () => {
  tabletop = await startTabletop({
    name: "template-migration",
    bindings: false,
    plugins: [
      {
        name: "legacy-template-fixture",
        setup(build) {
          build.onLoad({ filter: /\/world-do\.ts$/ }, async ({ path }) => {
            const source = await readFile(path, "utf8");
            // Exercise the additive migration against an actual old SQLite table.
            return {
              loader: "ts",
              contents: source.replace(
                "      this.ensureSchema();",
                `
                const sql = this.ctx.storage.sql;
                sql.exec("CREATE TABLE templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, fields TEXT NOT NULL, stats TEXT NOT NULL, tickers TEXT NOT NULL, rolls TEXT NOT NULL, updated_at TEXT NOT NULL)");
                sql.exec("INSERT INTO templates (id, name, description, fields, stats, tickers, rolls, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                  "old-template", "Old sheet", "Keep this", '[{"id":"bio","label":"Biography","kind":"longtext"}]', '[]', '[]', '[]', "2026-01-01T00:00:00Z");
                this.ensureSchema();
                this.ensureSchema();
                if (this.worldId === "invalid-json") sql.exec("UPDATE templates SET layout = ?", "{broken");
                if (this.worldId === "invalid-schema") sql.exec("UPDATE templates SET layout = ?", '{"system":"Bad","name":"Bad","pages":[{}]}');
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

const request = async (worldId: string, path: string, body?: unknown) => {
  const namespace = await mf.getDurableObjectNamespace("WORLDS");
  const stub = namespace.get(namespace.idFromName(`world:${worldId}`));
  return stub.fetch(`https://world/internal/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-ttrpg-role": "dm", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
};
const templates = async (worldId: string) =>
  Schema.decodeUnknownSync(Schema.Struct({ templates: Schema.Array(SheetTemplate) }))(
    await (await request(worldId, "state")).json(),
  ).templates;

it("adds layout storage idempotently without replacing an existing template", async () => {
  expect(await templates("legacy")).toEqual([
    {
      id: "old-template",
      worldId: "legacy",
      name: "Old sheet",
      description: "Keep this",
      fields: [{ id: "bio", label: "Biography", kind: "longtext" }],
      stats: [],
      tickers: [],
      rolls: [],
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ]);
  const input = { ...presetTemplates()[0], id: "old-template" };
  expect((await request("legacy", "template", input)).status).toBe(200);
  expect(await templates("legacy")).toMatchObject([{ id: "old-template", layout: input.layout }]);
});

it.each(["invalid-json", "invalid-schema"])(
  "treats stored %s layouts as absent and keeps legacy data readable",
  async (worldId) => {
    const [template] = await templates(worldId);
    expect(template.layout).toBeUndefined();
    expect(template.fields).toEqual([{ id: "bio", label: "Biography", kind: "longtext" }]);
    expect(template.id).toBe("old-template");
  },
);
