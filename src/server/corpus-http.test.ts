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
