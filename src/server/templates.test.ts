// @vitest-environment node
import type { WorldDO } from "./world-do";
import * as Schema from "effect/Schema";
import { startTabletop, type Tabletop, type CallOptions } from "../test/miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SheetTemplate } from "../domain/schemas";
import { SheetLayout, layoutTrackers } from "../domain/sheet-layout";
import { layoutFromTemplate } from "../domain/layout-from-template";
import { presetTemplates } from "../domain/preset-templates";

let tabletop: Tabletop;
let mf: Tabletop["mf"];
let cookie = "";
let worldId = "";
let playerCookie = "";
const call = (path: string, options: CallOptions = {}) => tabletop.call(path, options);
beforeAll(async () => {
  tabletop = await startTabletop({
    cookie: () => cookie,
  });
  mf = tabletop.mf;
  cookie = await tabletop.signin("dm@example.test", "DM");
}, 30000);
beforeEach(async () => {
  const world = await call("/worlds", { method: "POST", body: { name: "Template test" } });
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
  call(`/worlds/${worldId}/templates`, { method: "POST", body, cookie: authCookie });
const bootstrap = async () =>
  Schema.decodeUnknownSync(Schema.Struct({ templates: Schema.Array(SheetTemplate) }))(
    await (await call(`/worlds/${worldId}`)).json(),
  );
const input = () => presetTemplates()[0];
const layout: SheetLayout = {
  system: "Test",
  name: "Classic",
  pages: [{ id: "sheet", title: "Sheet", blocks: [] }],
};

describe("templates through real Worker, D1 and SQLite DO", () => {
  it("saves, bootstraps and updates layouts while preserving legacy template data", async () => {
    const response = await save(input());
    expect(response.status).toBe(200);
    const saved = Schema.decodeUnknownSync(SheetTemplate)(await response.json());
    expect(saved.layout).toEqual(input().layout);
    expect((await bootstrap()).templates.find((template) => template.id === saved.id)).toEqual(
      saved,
    );
    const changed = { ...input(), id: saved.id, layout, name: "Edited" };
    expect((await save(changed)).status).toBe(200);
    const loaded = (await bootstrap()).templates.find((template) => template.id === saved.id);
    expect(loaded).toMatchObject({ name: "Edited", layout });
    expect((await bootstrap()).templates).toHaveLength(2);
    const { layout: _layout, ...legacy } = changed;
    expect((await save(legacy)).status).toBe(200);
    expect(
      (await bootstrap()).templates.find((template) => template.id === saved.id)?.layout,
    ).toBeUndefined();
  });

  it("converts the seeded Adventurer template into sensible generic blocks", async () => {
    const starter = (await bootstrap()).templates[0];
    expect(starter.layout).toBeUndefined();
    const converted = layoutFromTemplate(starter);
    expect(Schema.decodeUnknownResult(SheetLayout)(converted)._tag).toBe("Success");
    expect(converted.system).toBe("Adventurer");
    expect(layoutTrackers(converted)).toMatchObject([
      { key: "hp", start: 20, max: 40 },
      { key: "mp", start: 10, max: 30 },
    ]);
    const blocks = converted.pages[0].blocks;
    expect(blocks.filter((block) => block.type === "heading").map((block) => block.text)).toEqual([
      "Identity",
      "Attributes",
      "Story",
    ]);
    expect(
      blocks.filter((block) => block.type === "fields").map((block) => block.items.length),
    ).toEqual([3, 6]);
    expect(blocks.find((block) => block.type === "text")).toMatchObject({ key: "background" });
    expect(blocks.find((block) => block.type === "rolls")?.items).toEqual([
      { label: "Strength check", dice: "1d20" },
      { label: "Attack", dice: "1d8" },
      { label: "Sneak", dice: "1d20+1d6" },
    ]);
  });

  it("rejects an invalid layout with 400 without changing stored templates", async () => {
    const response = await save({
      ...input(),
      layout: { system: "Bad", name: "Broken", pages: [{}] },
    });
    expect(response.status).toBe(400);
    expect((await bootstrap()).templates).toHaveLength(1);
  });

  it.each([
    ["Layout JSON must be at most 64 KB", { ...layout, name: "x".repeat(64 * 1024) }],
    [
      "Layout must have at most 10 pages",
      {
        ...layout,
        pages: Array.from({ length: 11 }, (_, i) => ({ id: `${i}`, title: "Page", blocks: [] })),
      },
    ],
    [
      "Layout must have at most 200 blocks",
      {
        ...layout,
        pages: [
          {
            ...layout.pages[0],
            blocks: Array.from({ length: 201 }, (_, i) => ({
              id: `${i}`,
              type: "heading",
              text: "Header",
            })),
          },
        ],
      },
    ],
    [
      "Layout block ids must be unique",
      {
        ...layout,
        pages: [
          {
            ...layout.pages[0],
            blocks: [
              {
                id: "same",
                type: "group",
                blocks: [{ id: "same", type: "heading", text: "Header" }],
              },
            ],
          },
        ],
      },
    ],
    [
      "Layout tracker keys must be unique",
      {
        ...layout,
        pages: [
          {
            ...layout.pages[0],
            blocks: [
              {
                id: "trackers",
                type: "trackers",
                items: [
                  { key: "hp", label: "HP", min: 0, max: 10 },
                  { key: "hp", label: "Health", min: 0, max: 20 },
                ],
              },
            ],
          },
        ],
      },
    ],
  ])("enforces %s", async (error, invalidLayout) => {
    const response = await save({ ...input(), layout: invalidLayout });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect((await bootstrap()).templates).toHaveLength(1);
  });

  it("denies players both creation and editing of templates", async () => {
    expect((await save(input(), playerCookie)).status).toBe(403);
    const starter = (await bootstrap()).templates[0];
    expect((await save({ ...input(), id: starter.id }, playerCookie)).status).toBe(403);
    expect((await bootstrap()).templates).toEqual([starter]);
  });

  it("decodes layouts at the HTTP edge and authorizes template RPC", async () => {
    const namespace = await mf.getDurableObjectNamespace("WORLDS");
    const rawStub = namespace.get(namespace.idFromName(`world:${worldId}`));
    const stub = rawStub as typeof rawStub & Pick<WorldDO, "saveTemplate">;
    const denied = await stub.saveTemplate(
      { memberId: "player", displayName: "Player", role: "player" },
      input(),
    );
    expect(denied).toMatchObject({ ok: false, error: { _tag: "Forbidden" } });
    const request = (body: unknown) => save(body);
    expect((await request({ ...input(), layout: {} })).status).toBe(400);
    const response = await request({
      ...input(),
      layout: { ...layout, name: "x".repeat(64 * 1024) },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Layout JSON must be at most 64 KB" });
  });
});
