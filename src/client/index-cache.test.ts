import { afterEach, expect, it, vi } from "vitest";
import { createIndexedDbIndexCache, createMemoryIndexCache, type CachedIndex } from "./index-cache";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const value: CachedIndex = {
  format: 1,
  rev: 7,
  types: [{ id: "spell", name: "Spell", fields: [], filters: [{ key: "level", kind: "range" }] }],
  rows: [
    {
      id: "srd/spell/shield",
      typeId: "spell",
      name: "Shield",
      tags: ["abjuration"],
      rev: 2,
      visibility: "public",
      updatedAt: "2026-01-01",
      facets: { level: 1 },
    },
  ],
};

it("stores indexes by key and takes a snapshot of values on write", async () => {
  const cache = createMemoryIndexCache();
  expect(await cache.read("missing")).toBeUndefined();
  const mutable = { ...value, rows: value.rows.map((row) => ({ ...row })) };
  await cache.write("world:account:player", mutable);
  mutable.rows[0].name = "Changed";
  expect(await cache.read("world:account:player")).toEqual(value);
  expect(await cache.read("world:account:dm")).toBeUndefined();
  await cache.write("world:account:player", { ...value, rev: 8, rows: [] });
  expect(await cache.read("world:account:player")).toEqual({ ...value, rev: 8, rows: [] });
});

it.each([
  undefined,
  null,
  { ...value, format: 2 },
  { ...value, rev: "7" },
  { ...value, rev: 1.5 },
  { ...value, rows: [{ ...value.rows[0], visibility: "secret" }] },
  { ...value, rows: [{ ...value.rows[0], facets: { level: {} } }] },
  { ...value, types: [{ ...value.types[0], fields: [{ key: "bad", kind: "unknown" }] }] },
])("treats incompatible stored data as a miss: %j", async (stored) => {
  const cache = createMemoryIndexCache(new Map([["key", stored]]));
  expect(await cache.read("key")).toBeUndefined();
});

it("tolerates unavailable IndexedDB and a throwing open", async () => {
  for (const indexedDB of [
    undefined,
    {
      open: () => {
        throw new Error("denied");
      },
    },
  ]) {
    vi.stubGlobal("indexedDB", indexedDB);
    const cache = createIndexedDbIndexCache();
    expect(await cache.read("key")).toBeUndefined();
    await expect(cache.write("key", value)).resolves.toBeUndefined();
  }
});

// Native IndexedDB is unavailable in this runner; drive its browser events explicitly.
const openRequest = () => ({
  result: {
    createObjectStore: vi.fn(),
    close: vi.fn(),
    onversionchange: () => {},
    transaction: vi.fn(),
  },
  onupgradeneeded: () => {},
  onsuccess: () => {},
  onerror: () => {},
  onblocked: () => {},
});

it.each(["onerror", "onblocked"] as const)(
  "treats an IndexedDB %s event as an empty cache",
  async (event) => {
    const request = openRequest();
    const open = vi.fn(() => request);
    vi.stubGlobal("indexedDB", { open });
    const cache = createIndexedDbIndexCache();
    const read = cache.read("key");
    request[event]();
    expect(await read).toBeUndefined();
    await expect(cache.write("key", value)).resolves.toBeUndefined();
    expect(open).toHaveBeenCalledOnce();
    request.onsuccess();
    expect(request.result.close).toHaveBeenCalledOnce();
  },
);

it("bounds a stuck database open and closes a late connection", async () => {
  vi.useFakeTimers();
  const request = openRequest();
  vi.stubGlobal("indexedDB", { open: () => request });
  const read = createIndexedDbIndexCache().read("key");
  await vi.advanceTimersByTimeAsync(1_000);
  expect(await read).toBeUndefined();
  request.onsuccess();
  expect(request.result.close).toHaveBeenCalledOnce();
});

const connectedCache = () => {
  const request = openRequest();
  const open = vi.fn(() => request);
  vi.stubGlobal("indexedDB", { open });
  const get = vi.fn<() => { result: unknown }>(() => ({ result: value }));
  const put = vi.fn(() => ({ result: "key" }));
  const transaction = {
    objectStore: vi.fn(() => ({ get, put })),
    oncomplete: () => {},
    onerror: () => {},
    onabort: () => {},
    abort: vi.fn(),
  };
  request.result.transaction.mockReturnValue(transaction);
  const cache = createIndexedDbIndexCache();
  return { cache, request, transaction, open, get, put };
};

it("uses one database and object store, decodes reads and waits for writes to commit", async () => {
  const h = connectedCache();
  const read = h.cache.read("key");
  h.request.onupgradeneeded();
  h.request.onsuccess();
  await Promise.resolve();
  expect(h.get).toHaveBeenCalledExactlyOnceWith("key");
  h.transaction.oncomplete();
  expect(await read).toEqual(value);
  expect(h.request.result.createObjectStore).toHaveBeenCalledExactlyOnceWith("indexes");
  let written = false;
  const write = h.cache.write("key", value).then(() => {
    written = true;
  });
  await Promise.resolve();
  expect(written).toBe(false);
  expect(h.put).toHaveBeenCalledExactlyOnceWith(value, "key");
  h.transaction.oncomplete();
  await write;
  expect(written).toBe(true);
  expect(h.open).toHaveBeenCalledExactlyOnceWith("tabletop-compendium", 1);
  expect(h.request.result.transaction.mock.calls).toEqual([
    ["indexes", "readonly"],
    ["indexes", "readwrite"],
  ]);
  h.request.result.onversionchange();
  expect(h.request.result.close).toHaveBeenCalledOnce();
});

it("treats invalid IndexedDB records as misses", async () => {
  const h = connectedCache();
  h.get.mockReturnValue({ result: { ...value, format: 2 } });
  const read = h.cache.read("key");
  h.request.onsuccess();
  await Promise.resolve();
  h.transaction.oncomplete();
  expect(await read).toBeUndefined();
});

it.each(["onerror", "onabort"] as const)(
  "ignores failed read/write transactions: %s",
  async (event) => {
    const h = connectedCache();
    const read = h.cache.read("key");
    h.request.onsuccess();
    await Promise.resolve();
    h.transaction[event]();
    expect(await read).toBeUndefined();
    const write = h.cache.write("key", value);
    await Promise.resolve();
    h.transaction[event]();
    await expect(write).resolves.toBeUndefined();
  },
);

it("ignores synchronous transaction and quota failures", async () => {
  const h = connectedCache();
  h.request.result.transaction.mockImplementationOnce(() => {
    throw new Error("closed");
  });
  const read = h.cache.read("key");
  h.request.onsuccess();
  expect(await read).toBeUndefined();
  h.put.mockImplementationOnce(() => {
    throw new Error("quota");
  });
  await expect(h.cache.write("key", value)).resolves.toBeUndefined();
});

it("bounds stuck transactions and ignores late completions", async () => {
  vi.useFakeTimers();
  const h = connectedCache();
  const read = h.cache.read("key");
  h.request.onsuccess();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(await read).toBeUndefined();
  expect(h.transaction.abort).toHaveBeenCalledOnce();
  h.transaction.oncomplete();
});
