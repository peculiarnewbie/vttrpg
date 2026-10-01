// @vitest-environment node
import { afterAll, beforeAll, expect, it } from "vitest";
import { startTabletop, type Tabletop } from "../test/miniflare";

/** Production runs with `corpus` but not `corpus-admin`: nobody can publish over HTTP. */
let tabletop: Tabletop;
let cookie = "";

beforeAll(async () => {
  tabletop = await startTabletop({
    corpus: true,
    cookie: () => cookie,
    workerOptions: { bindings: { FLAGS: "corpus" } },
  });
  cookie = await tabletop.signin("visitor@example.test", "Visitor");
}, 30000);
afterAll(() => tabletop?.dispose());

it("hides corpus management without corpus-admin, while worlds can still list libraries", async () => {
  for (const [method, path] of [
    ["GET", "/corpus/systems"],
    ["GET", "/corpus/sources"],
    ["POST", "/corpus/sources/anything/publish"],
  ] as const)
    expect((await tabletop.call(path, { method })).status).toBe(404);

  const world = (await (
    await tabletop.call("/worlds", { method: "POST", body: { name: "Gate" } })
  ).json()) as { id: string };
  expect((await tabletop.call(`/worlds/${world.id}/libraries`)).status).toBe(200);
});

it("unwraps management replies and returns tagged corpus error statuses", async () => {
  let auth = "";
  const admin = await startTabletop({ corpus: true, cookie: () => auth });
  try {
    auth = await admin.signin("corpus-owner@example.test", "Owner");
    const system = {
      id: "status-system",
      name: "Status system",
      entryTypes: [{ id: "item", name: "Item", fields: [] }],
    };
    const saved = await admin.call("/corpus/systems", { method: "PUT", body: system });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject(system);
    const source = {
      id: "status-source",
      name: "Source",
      systemId: system.id,
      visibility: "private",
      licence: { id: "CC0", name: "CC0", attribution: "Test authors", shareAlike: false },
    };
    expect((await admin.call("/corpus/sources", { method: "POST", body: source })).status).toBe(
      200,
    );
    expect((await admin.call("/corpus/sources", { method: "POST", body: source })).status).toBe(
      409,
    );
    expect((await admin.call("/corpus/sources", { method: "POST", body: {} })).status).toBe(400);
    expect((await admin.call("/corpus/sources/missing/publish", { method: "POST" })).status).toBe(
      404,
    );
    auth = await admin.signin("corpus-other@example.test", "Other");
    expect(
      (await admin.call("/corpus/sources/status-source/publish", { method: "POST" })).status,
    ).toBe(403);
  } finally {
    await admin.dispose();
  }
}, 30000);
