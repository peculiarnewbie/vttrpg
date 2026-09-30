// @vitest-environment node
import * as Schema from "effect/Schema";
import { afterAll, beforeAll, expect, it } from "vitest";
import { CompendiumEntry, IndexDelta, compendiumLimits } from "../domain/compendium";
import { ServerFrame } from "../domain/schemas";
import { startTabletop, type Tabletop } from "../test/miniflare";

let tabletop: Tabletop;
let cookie = "";
let worldId = "";
const call = (suffix: string, options: { method?: string; body?: unknown } = {}) =>
  tabletop.call(`/worlds/${worldId}/compendium${suffix}`, options);

beforeAll(async () => {
  tabletop = await startTabletop({ cookie: () => cookie, unsafeInspectDurableObjects: true });
  cookie = await tabletop.signin("scale@example.test", "DM");
  worldId = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(
    await (await tabletop.call("/worlds", { method: "POST", body: { name: "Scale" } })).json(),
  ).id;
  await call("/types/item", { method: "PUT", body: { id: "item", name: "Item", fields: [] } });
  const db = await tabletop.mf.unsafeGetDurableObjectStorage("tabletop", "WorldDO", {
    name: `world:${worldId}`,
  });
  // Seed bodies too: index and search must not deserialize or return this bulk text.
  await db.exec(
    `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
    INSERT INTO compendium_entries (id, type_id, name, tags, body, fields, visibility, updated_at, rev, name_key, name_words, tags_key, text_key)
    SELECT 'world/item/entry-' || i, 'item', 'Entry ' || i, '[]', ?, '{}', 'public',
      '2026-01-01T00:00:00Z', 1, 'entry ' || i, 'entry ' || i, '', 'a forgotten artifact' FROM n`,
    compendiumLimits.entries - 1,
    "A forgotten artifact. ".repeat(100),
  );
}, 30000);
afterAll(async () => {
  await tabletop?.dispose();
});

it("keeps 10000-entry indexes small, search quick, and one edit's delta to one row", async () => {
  const response = await call("/index");
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(new TextEncoder().encode(text).byteLength).toBeLessThan(2 * 1024 * 1024);
  const full = Schema.decodeUnknownSync(IndexDelta)(JSON.parse(text));
  expect(full.full).toBe(true);
  expect(full.upserts).toHaveLength(compendiumLimits.entries);
  const connection = await tabletop.connect({ worldId, cookie });
  try {
    await connection.sync();
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const requestId = `scale-${i}`;
      const start = performance.now();
      const result = await new Promise<Extract<ServerFrame, { type: "search.result" }>>(
        (resolve, reject) => {
          const timeout = setTimeout(() => {
            connection.socket.removeEventListener("message", receive);
            reject(new Error("Search timed out"));
          }, 5000);
          const receive = (event: { data: unknown }) => {
            const frame = Schema.decodeUnknownSync(ServerFrame)(JSON.parse(String(event.data)));
            if (frame.type !== "search.result" || frame.requestId !== requestId) return;
            clearTimeout(timeout);
            connection.socket.removeEventListener("message", receive);
            resolve(frame);
          };
          connection.socket.addEventListener("message", receive);
          connection.send({
            type: "search",
            requestId,
            query: i % 2 ? `entry ${i}` : "forgotten",
            limit: 20,
          });
        },
      );
      times.push(performance.now() - start);
      expect(result.results).toHaveLength(20);
    }
    // Round trips include transport and decode overhead; median avoids scheduler outliers.
    times.sort((a, b) => a - b);
    expect(times[10]).toBeLessThan(100);
  } finally {
    connection.socket.close();
  }
  const saved = Schema.decodeUnknownSync(CompendiumEntry)(
    await (
      await call("/entries", {
        method: "POST",
        body: {
          id: "world/item/entry-42",
          typeId: "item",
          name: "Changed",
          tags: [],
          body: "New text",
          fields: {},
          visibility: "public",
        },
      })
    ).json(),
  );
  const delta = Schema.decodeUnknownSync(IndexDelta)(
    await (await call(`/index?since=${full.rev}`)).json(),
  );
  expect(delta).toMatchObject({
    full: false,
    rev: saved.rev,
    deletes: [],
    upserts: [{ id: saved.id, name: "Changed" }],
  });
  expect(delta.upserts).toHaveLength(1);
}, 30000);
