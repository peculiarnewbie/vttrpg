// @vitest-environment jsdom
import { createMemo, createRoot, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import type { Compendium, CompendiumPack, SaveEntryInput } from "../domain/compendium";
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

it("loads the Solid store, exposes lookups and retains data on failure until a successful retry", async () => {
  vi.useFakeTimers();
  let fail = false;
  const fetcher = vi.fn(async () => {
    if (fail) throw new Error("offline");
    return data;
  });
  let dispose!: () => void;
  const store = createRoot((cleanup) => {
    dispose = cleanup;
    const store = createCompendium("world", fetcher);
    return { ...store, count: createMemo(() => store.entries().length) };
  });
  flush();
  expect(store.loading()).toBe(true);
  expect(store.entries()).toEqual([]);
  expect(store.count()).toBe(0);
  expect(store.entry("missing")).toBeUndefined();
  const initial = store.refresh();
  await vi.advanceTimersByTimeAsync(30);
  expect(await initial).toBe(true);
  flush();
  expect(fetcher).toHaveBeenCalledExactlyOnceWith("world");
  expect(store.loading()).toBe(false);
  expect(store.error()).toBeUndefined();
  expect(store.types()).toEqual(data.types);
  expect(store.entries()).toEqual(data.entries);
  expect(store.count()).toBe(1);
  expect(store.entry(entry.id)).toEqual(entry);
  expect(store.typeById("item")).toEqual(data.types[0]);
  expect(store.typeById("missing")).toBeUndefined();
  expect(store.entriesOfType("item")).toEqual([entry]);
  expect(store.entriesOfType("missing")).toEqual([]);
  fail = true;
  const failed = store.refresh();
  await vi.advanceTimersByTimeAsync(30);
  expect(await failed).toBe(false);
  flush();
  expect(store.error()).toBe("offline");
  expect(store.entries()).toEqual(data.entries);
  fail = false;
  const retry = store.refresh();
  await vi.advanceTimersByTimeAsync(30);
  expect(await retry).toBe(true);
  flush();
  expect(store.error()).toBeUndefined();
  dispose();
  expect(await store.refresh()).toBe(false);
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
