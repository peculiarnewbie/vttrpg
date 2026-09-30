// @vitest-environment jsdom
import { createMemo, createRoot, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import type {
  Compendium,
  CompendiumPack,
  CompendiumEntry,
  EntryBodies,
  IndexDelta,
  IndexRow,
  SaveEntryInput,
} from "../domain/compendium";
import { api, ApiError } from "./api";
import { createCompendium, createCompendiumRefresh } from "./compendium";

vi.mock("solid-js", () => vi.importActual("../../node_modules/solid-js/dist/solid.dev.js"));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

it("coalesces a burst before fetching and shares its completion promise", async () => {
  vi.useFakeTimers();
  const values: number[] = [];
  const loading: boolean[] = [];
  let fetches = 0;
  const refreshes = createCompendiumRefresh({
    fetch: async () => ++fetches,
    onValue: (value) => values.push(value),
    onLoading: (value) => loading.push(value),
    onError: () => {},
  });
  const first = refreshes.refresh();
  await vi.advanceTimersByTimeAsync(10);
  expect(refreshes.refresh()).toBe(first);
  expect(refreshes.refresh()).toBe(first);
  expect(fetches).toBe(0);
  await vi.advanceTimersByTimeAsync(20);
  expect(await first).toBe(true);
  expect(fetches).toBe(1);
  expect(values).toEqual([1]);
  expect(loading).toEqual([true, false]);
  refreshes.dispose();
});

it("runs exactly one more fetch for an in-flight burst, applying responses in order", async () => {
  vi.useFakeTimers();
  const first = deferred<number>();
  const second = deferred<number>();
  let fetches = 0;
  const values: number[] = [];
  const refreshes = createCompendiumRefresh({
    fetch: () => (++fetches === 1 ? first.promise : second.promise),
    onValue: (value) => values.push(value),
    onLoading: () => {},
    onError: () => {},
  });
  const finished = refreshes.refresh();
  await vi.advanceTimersByTimeAsync(30);
  refreshes.refresh();
  refreshes.refresh();
  refreshes.refresh();
  expect(fetches).toBe(1);
  first.resolve(1);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetches).toBe(2);
  expect(values).toEqual([1]);
  second.resolve(2);
  expect(await finished).toBe(true);
  expect(values).toEqual([1, 2]);
  expect(fetches).toBe(2);
  refreshes.dispose();
});

it("reports failures, honors a queued refresh after failure and allows later retries", async () => {
  vi.useFakeTimers();
  const first = deferred<number>();
  const errors: unknown[] = [];
  const values: number[] = [];
  let fetches = 0;
  let fail = true;
  const refreshes = createCompendiumRefresh({
    fetch: () => {
      fetches++;
      if (fetches === 1) return first.promise;
      return fail ? Promise.reject(new Error("offline")) : Promise.resolve(fetches);
    },
    onValue: (value) => values.push(value),
    onLoading: () => {},
    onError: (error) => errors.push(error),
  });
  const finished = refreshes.refresh();
  await vi.advanceTimersByTimeAsync(30);
  refreshes.refresh();
  first.reject(new Error("first failed"));
  expect(await finished).toBe(false);
  expect(errors).toHaveLength(2);
  expect(fetches).toBe(2);
  fail = false;
  const retried = refreshes.refresh();
  await vi.advanceTimersByTimeAsync(30);
  expect(await retried).toBe(true);
  expect(values).toEqual([3]);
  refreshes.dispose();
});

it("disposes scheduled and in-flight refreshes without applying values or errors", async () => {
  vi.useFakeTimers();
  for (const inFlight of [false, true]) {
    const fetched = deferred<number>();
    const fetch = vi.fn(() => fetched.promise);
    const onValue = vi.fn();
    const onError = vi.fn();
    const refreshes = createCompendiumRefresh({ fetch, onValue, onError, onLoading: () => {} });
    const finished = refreshes.refresh();
    if (inFlight) await vi.advanceTimersByTimeAsync(30);
    refreshes.dispose();
    fetched.resolve(1);
    expect(await finished).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(fetch).toHaveBeenCalledTimes(inFlight ? 1 : 0);
    expect(onValue).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(await refreshes.refresh()).toBe(false);
  }
});

const input: SaveEntryInput = {
  typeId: "item",
  name: "Rope",
  tags: [],
  body: "",
  fields: {},
  visibility: "public",
};
const entry = { ...input, id: "ent_rope", updatedAt: "now" };
const data: Compendium = { types: [{ id: "item", name: "Item", fields: [] }], entries: [entry] };
const pack: CompendiumPack = {
  format: "ttrpg-pack",
  version: 1,
  name: "World",
  types: data.types,
  entries: [{ ...input, id: entry.id }],
};

const row = (id: string, rev = 1, name = id): IndexRow => ({
  id,
  rev,
  name,
  typeId: "item",
  tags: [],
  visibility: "public",
  updatedAt: `2026-01-${String(rev).padStart(2, "0")}`,
});
const body = (id: string, rev = 1): CompendiumEntry => ({
  ...row(id, rev),
  body: "body",
  fields: {},
});
const delta = (upserts: readonly IndexRow[] = [], rev = 1, full = true): IndexDelta => ({
  rev,
  full,
  upserts,
  types: data.types,
  deletes: [],
});
const harness = (
  initial = delta(),
  bodies = vi.fn(async (_world: string, ids: readonly string[]): Promise<EntryBodies> => ({
    entries: ids.map((id) => body(id)),
    missing: [],
  })),
) => {
  vi.useFakeTimers();
  const index = vi.fn(async () => initial);
  let dispose!: () => void;
  const store = createRoot((cleanup) => {
    dispose = cleanup;
    return createCompendium("world", { index, bodies });
  });
  flush();
  return { store, index, bodies, dispose };
};
const sync = async (store: ReturnType<typeof createCompendium>) => {
  const finished = store.refresh();
  await vi.advanceTimersByTimeAsync(30);
  expect(await finished).toBe(true);
  flush();
};

it("applies full and delta indexes, sorts rows, replaces types, and normalizes names", async () => {
  const h = harness(delta([row("b"), row("a"), row("c", 2, " Épée   fine ")], 2));
  const count = createMemo(() => h.store.rows().length);
  await sync(h.store);
  expect(h.index).toHaveBeenCalledExactlyOnceWith("world", 0);
  expect(h.store.rows().map((row) => row.id)).toEqual(["c", "a", "b"]);
  expect(h.store.rowsOfType("item")).toHaveLength(3);
  expect(h.store.rowsOfType("none")).toEqual([]);
  expect(h.store.rowByName("epee fine")?.id).toBe("c");
  expect(h.store.rowByName("  ")).toBeUndefined();
  expect(count()).toBe(3);
  h.index.mockResolvedValueOnce({ ...delta([row("a", 3)], 3, false), types: [], deletes: ["b"] });
  await sync(h.store);
  expect(h.index).toHaveBeenLastCalledWith("world", 2);
  expect(h.store.row("a")?.rev).toBe(3);
  expect(h.store.row("b")).toBeUndefined();
  expect(h.store.types()).toEqual([]);
  expect(count()).toBe(2);
  h.index.mockResolvedValueOnce(delta([row("replacement")], 4));
  await sync(h.store);
  expect(h.store.rows().map((row) => row.id)).toEqual(["replacement"]);
  h.dispose();
  expect(await h.store.refresh()).toBe(false);
});

it("keeps index data on failure and clears the error on retry", async () => {
  const h = harness(delta([row("a")]));
  await sync(h.store);
  h.index.mockRejectedValueOnce(new Error("offline"));
  const failed = h.store.refresh();
  await vi.advanceTimersByTimeAsync(30);
  expect(await failed).toBe(false);
  flush();
  expect(h.store.error()).toBe("offline");
  expect(h.store.row("a")).toEqual(row("a"));
  await sync(h.store);
  expect(h.store.error()).toBeUndefined();
  h.dispose();
});

it("batches reads in a microtask, shares pending loads, and serves cache hits reactively", async () => {
  const h = harness(delta([row("a"), row("b")]));
  await sync(h.store);
  const loaded = createMemo(() => h.store.entry("a"));
  expect(h.store.entry("a")).toBeUndefined();
  expect(h.store.entry("b")).toBeUndefined();
  expect(h.bodies).not.toHaveBeenCalled();
  expect(await h.store.load(["b", "a", "a"])).toEqual([body("b"), body("a"), body("a")]);
  flush();
  expect(loaded()).toEqual(body("a"));
  expect(h.bodies).toHaveBeenCalledExactlyOnceWith("world", ["a", "b"]);
  expect(await h.store.load(["a"])).toEqual([body("a")]);
  expect(h.store.entry("b")).toEqual(body("b"));
  expect(h.bodies).toHaveBeenCalledTimes(1);
  h.dispose();
});

it("splits requests at 100 ids and resolves loads in input order even beyond the LRU bound", async () => {
  const h = harness();
  await sync(h.store);
  const ids = Array.from({ length: 501 }, (_, i) => String(i));
  expect((await h.store.load(ids)).map((entry) => entry.id)).toEqual(ids);
  expect(h.bodies.mock.calls.map((call) => call[1].length)).toEqual([100, 100, 100, 100, 100, 1]);
  expect(h.store.entry("500")).toBeDefined();
  expect(h.store.entry("0")).toBeUndefined();
  await h.store.load(["0"]);
  expect(h.store.entry("0")).toBeDefined();
  h.dispose();
});

it("touches cache entries on reads so the least recently used entry is evicted", async () => {
  const h = harness();
  await sync(h.store);
  await h.store.load(Array.from({ length: 500 }, (_, i) => String(i)));
  expect(h.store.entry("0")).toEqual(body("0"));
  await h.store.load(["500"]);
  expect(h.store.entry("0")).toEqual(body("0"));
  expect(h.store.entry("1")).toBeUndefined();
  h.dispose();
});

it("remembers misses and invalidates cached bodies and misses on index changes or deletes", async () => {
  const h = harness(delta([row("a"), row("missing")]));
  await sync(h.store);
  h.bodies.mockResolvedValueOnce({ entries: [body("a")], missing: ["missing"] });
  expect(await h.store.load(["a", "missing"])).toEqual([body("a")]);
  expect(h.store.missing("missing")).toBe(true);
  h.store.entry("missing");
  expect(await h.store.load(["missing"])).toEqual([]);
  expect(h.bodies).toHaveBeenCalledTimes(1);
  h.index.mockResolvedValueOnce(delta([row("a", 2), row("missing", 2)], 2, false));
  await sync(h.store);
  expect(h.store.entry("a")).toBeUndefined();
  expect(h.store.missing("missing")).toBe(false);
  h.bodies.mockResolvedValueOnce({ entries: [body("a", 2), body("missing", 2)], missing: [] });
  await h.store.load(["a", "missing"]);
  h.index.mockResolvedValueOnce({ ...delta([], 3, false), deletes: ["a"] });
  await sync(h.store);
  expect(h.store.entry("a")).toBeUndefined();
  h.dispose();
});

it("caches aliases under both ids and invalidates both when the canonical entry changes", async () => {
  const h = harness(delta([row("world/item/a")]));
  await sync(h.store);
  h.bodies.mockResolvedValueOnce({
    entries: [body("world/item/a")],
    missing: [],
    aliases: { ent_a: "world/item/a" },
  });
  expect(await h.store.load(["ent_a"])).toEqual([body("world/item/a")]);
  expect(h.store.entry("ent_a")).toEqual(body("world/item/a"));
  expect(h.store.entry("world/item/a")).toEqual(body("world/item/a"));
  expect(h.bodies).toHaveBeenCalledTimes(1);
  h.index.mockResolvedValueOnce(delta([row("world/item/a", 2)], 2, false));
  await sync(h.store);
  expect(h.store.entry("ent_a")).toBeUndefined();
  h.dispose();
});

it("reports failed batches without caching misses and retries on the next read", async () => {
  const h = harness();
  await sync(h.store);
  h.bodies.mockRejectedValueOnce(new Error("offline"));
  expect(await h.store.load(["a"])).toEqual([]);
  flush();
  expect(h.store.error()).toBe("offline");
  expect(h.store.missing("a")).toBe(false);
  expect(h.store.entry("a")).toBeUndefined();
  expect(await h.store.load(["a"])).toEqual([body("a")]);
  flush();
  expect(h.store.error()).toBeUndefined();
  expect(h.bodies).toHaveBeenCalledTimes(2);
  h.dispose();
});

it("discards bodies fetched before a newer index revision and settles loads on disposal", async () => {
  const h = harness(delta([row("a")]));
  await sync(h.store);
  const fetched = deferred<EntryBodies>();
  h.bodies.mockReturnValueOnce(fetched.promise);
  const loaded = h.store.load(["a"]);
  await Promise.resolve();
  h.index.mockResolvedValueOnce(delta([row("a", 2)], 2, false));
  await sync(h.store);
  fetched.resolve({ entries: [body("a")], missing: [] });
  expect(await loaded).toEqual([]);
  const waiting = h.store.load(["b"]);
  h.dispose();
  expect(await waiting).toEqual([]);
});

it("sends typed compendium API requests, encodes ids, and decodes each response", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const reply = (body: unknown) => fetch.mockResolvedValueOnce(Response.json(body));
  reply(data);
  expect(await api.getCompendium("world")).toEqual(data);
  expect(fetch).toHaveBeenLastCalledWith(
    "/api/worlds/world/compendium",
    expect.objectContaining({ credentials: "same-origin" }),
  );
  const type = { ...data.types[0], id: "a/b" };
  reply(type);
  expect(await api.saveEntryType("world", type)).toEqual(type);
  expect(fetch).toHaveBeenLastCalledWith(
    "/api/worlds/world/compendium/types/a%2Fb",
    expect.objectContaining({ method: "PUT", body: JSON.stringify(type) }),
  );
  fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
  expect(await api.deleteEntryType("world", type.id)).toBeUndefined();
  expect(fetch).toHaveBeenLastCalledWith(
    "/api/worlds/world/compendium/types/a%2Fb",
    expect.objectContaining({ method: "DELETE" }),
  );
  reply(entry);
  expect(await api.saveEntry("world", input)).toEqual(entry);
  expect(fetch).toHaveBeenLastCalledWith(
    "/api/worlds/world/compendium/entries",
    expect.objectContaining({ method: "POST", body: JSON.stringify(input) }),
  );
  fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
  expect(await api.deleteEntry("world", "ent/a")).toBeUndefined();
  expect(fetch).toHaveBeenLastCalledWith(
    "/api/worlds/world/compendium/entries/ent%2Fa",
    expect.objectContaining({ method: "DELETE" }),
  );
  reply(pack);
  expect(await api.exportCompendium("world")).toEqual(pack);
  expect(fetch).toHaveBeenLastCalledWith("/api/worlds/world/compendium/export", expect.anything());
  reply({ types: 1, created: 1, updated: 0 });
  expect(await api.importCompendium("world", pack)).toEqual({ types: 1, created: 1, updated: 0 });
  expect(fetch).toHaveBeenLastCalledWith(
    "/api/worlds/world/compendium/import",
    expect.objectContaining({ method: "POST", body: JSON.stringify(pack) }),
  );
  reply({ types: [], entries: [{ ...entry, visibility: "bad" }] });
  await expect(api.getCompendium("world")).rejects.toThrow();
  fetch.mockResolvedValueOnce(Response.json({ error: "DM only" }, { status: 403 }));
  await expect(api.saveEntry("world", input)).rejects.toThrow(new ApiError("DM only"));
});

it("sends and decodes index and body requests and checks the batch limit", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  fetch.mockResolvedValueOnce(Response.json(delta([row("a")], 5)));
  expect(await api.getCompendiumIndex("world/id", 3)).toEqual(delta([row("a")], 5));
  expect(fetch).toHaveBeenLastCalledWith(
    "/api/worlds/world%2Fid/compendium/index?since=3",
    expect.anything(),
  );
  const response = { entries: [body("a")], missing: [], aliases: { ent_a: "a" } };
  fetch.mockResolvedValueOnce(Response.json(response));
  expect(await api.getEntryBodies("world/id", ["ent_a"])).toEqual(response);
  expect(fetch).toHaveBeenLastCalledWith(
    "/api/worlds/world%2Fid/compendium/bodies",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ ids: ["ent_a"] }) }),
  );
  await expect(api.getEntryBodies("world", Array(101).fill("a"))).rejects.toThrow("At most 100");
  expect(fetch).toHaveBeenCalledTimes(2);
  fetch.mockResolvedValueOnce(Response.json({ ...delta(), rev: "bad" }));
  await expect(api.getCompendiumIndex("world", 0)).rejects.toThrow();
  fetch.mockResolvedValueOnce(
    Response.json({ entries: [{ ...body("a"), body: 42 }], missing: [] }),
  );
  await expect(api.getEntryBodies("world", ["a"])).rejects.toThrow();
});

it("coalesces store refreshes and uses the revision just applied without a Solid flush", async () => {
  const h = harness();
  const first = deferred<IndexDelta>();
  h.index.mockReturnValueOnce(first.promise);
  const finished = h.store.refresh();
  await vi.advanceTimersByTimeAsync(30);
  expect(h.store.refresh()).toBe(finished);
  expect(h.store.refresh()).toBe(finished);
  first.resolve(delta([row("a")], 7));
  h.index.mockResolvedValueOnce(delta([], 8, false));
  expect(await finished).toBe(true);
  expect(h.index.mock.calls).toEqual([
    ["world", 0],
    ["world", 7],
  ]);
  expect(h.store.rev()).toBe(8);
  h.dispose();
});

it("does not restore a deleted entry from an alias first resolved by an in-flight body request", async () => {
  const h = harness(delta([row("world/item/a")]));
  await sync(h.store);
  const response = deferred<EntryBodies>();
  h.bodies.mockReturnValueOnce(response.promise);
  const loaded = h.store.load(["ent_a"]);
  await Promise.resolve();
  h.index.mockResolvedValueOnce({ ...delta([], 2, false), deletes: ["world/item/a"] });
  await sync(h.store);
  response.resolve({
    entries: [body("world/item/a")],
    missing: [],
    aliases: { ent_a: "world/item/a" },
  });
  expect(await loaded).toEqual([]);
  h.dispose();
});

it("does not remember a stale missing alias if the index changes during the request", async () => {
  const h = harness();
  await sync(h.store);
  const response = deferred<EntryBodies>();
  h.bodies.mockReturnValueOnce(response.promise);
  const loaded = h.store.load(["ent_a"]);
  await Promise.resolve();
  h.index.mockResolvedValueOnce(delta([row("world/item/a", 2)], 2, false));
  await sync(h.store);
  response.resolve({ entries: [], missing: ["ent_a"] });
  expect(await loaded).toEqual([]);
  expect(h.store.missing("ent_a")).toBe(false);
  h.bodies.mockResolvedValueOnce({
    entries: [body("world/item/a", 2)],
    missing: [],
    aliases: { ent_a: "world/item/a" },
  });
  expect(await h.store.load(["ent_a"])).toEqual([body("world/item/a", 2)]);
  h.dispose();
});
