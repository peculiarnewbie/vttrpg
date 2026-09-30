// @vitest-environment jsdom
import { createRoot, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import type { IndexRow } from "../domain/compendium";
import { createSearch, type SearchRequest } from "./search";

vi.mock("solid-js", () => vi.importActual("../../node_modules/solid-js/dist/solid.dev.js"));

const row: IndexRow = {
  id: "world/item/rope",
  typeId: "item",
  name: "Rope",
  tags: [],
  visibility: "public",
  rev: 1,
  updatedAt: "now",
};
const setup = (
  request: SearchRequest,
  options: { debounceMs?: number; minLength?: number; limit?: number } = {},
) => {
  vi.useFakeTimers();
  let dispose!: () => void;
  const search = createRoot((cleanup) => {
    dispose = cleanup;
    return createSearch({ request, ...options });
  });
  return { search, dispose };
};
afterEach(() => vi.useRealTimers());

it("debounces typing, trims queries, forwards filters and limit, and exposes pending", async () => {
  const request = vi.fn(async () => [row]);
  const { search, dispose } = setup(request, { limit: 10 });
  search.setQuery("ro");
  flush();
  expect(search.pending()).toBe(true);
  await vi.advanceTimersByTimeAsync(150);
  search.setQuery(" rope ", ["item"]);
  await vi.advanceTimersByTimeAsync(199);
  expect(request).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  flush();
  expect(request).toHaveBeenCalledExactlyOnceWith({ query: "rope", typeIds: ["item"], limit: 10 });
  expect(search.query()).toBe(" rope ");
  expect(search.results()).toEqual([row]);
  expect(search.pending()).toBe(false);
  expect(search.error()).toBeUndefined();
  dispose();
});

it("skips short trimmed queries and clears prior results", async () => {
  const request = vi.fn(async () => [row]);
  const { search, dispose } = setup(request, { debounceMs: 10, minLength: 3 });
  search.setQuery("rope");
  await vi.advanceTimersByTimeAsync(10);
  search.setQuery(" ro ");
  flush();
  expect(search.results()).toEqual([]);
  expect(search.pending()).toBe(false);
  await vi.advanceTimersByTimeAsync(100);
  expect(request).toHaveBeenCalledTimes(1);
  dispose();
});

it("drops a slow reply after a newer query has finished", async () => {
  let finish!: (rows: readonly IndexRow[]) => void;
  const first = new Promise<readonly IndexRow[]>((resolve) => {
    finish = resolve;
  });
  const request = vi.fn<SearchRequest>().mockReturnValueOnce(first).mockResolvedValueOnce([row]);
  const { search, dispose } = setup(request);
  search.setQuery("first");
  await vi.advanceTimersByTimeAsync(200);
  search.setQuery("second");
  await vi.advanceTimersByTimeAsync(200);
  finish([{ ...row, name: "Stale" }]);
  await Promise.resolve();
  flush();
  expect(search.results()).toEqual([row]);
  expect(search.pending()).toBe(false);
  dispose();
});

it("ignores replies and errors once a query changes, even during the new debounce", async () => {
  let fail!: (cause: unknown) => void;
  const first = new Promise<readonly IndexRow[]>((_resolve, reject) => {
    fail = reject;
  });
  const request = vi.fn<SearchRequest>().mockReturnValueOnce(first).mockResolvedValueOnce([row]);
  const { search, dispose } = setup(request);
  search.setQuery("first");
  await vi.advanceTimersByTimeAsync(200);
  search.setQuery("second");
  fail(new Error("stale"));
  await Promise.resolve();
  flush();
  expect(search.pending()).toBe(true);
  expect(search.error()).toBeUndefined();
  search.setQuery(" ");
  await vi.advanceTimersByTimeAsync(200);
  flush();
  expect(search.results()).toEqual([]);
  expect(search.pending()).toBe(false);
  expect(request).toHaveBeenCalledTimes(1);
  dispose();
});

it("reports errors, clears them on new input, and keeps pending until the server finishes", async () => {
  let finish!: (rows: readonly IndexRow[]) => void;
  const request = vi
    .fn<SearchRequest>()
    .mockRejectedValueOnce(new Error("offline"))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  const { search, dispose } = setup(request);
  search.setQuery("rope");
  await vi.advanceTimersByTimeAsync(200);
  flush();
  expect(search.error()).toBe("offline");
  expect(search.pending()).toBe(false);
  search.setQuery("sword");
  await vi.advanceTimersByTimeAsync(200);
  flush();
  expect(search.error()).toBeUndefined();
  expect(search.pending()).toBe(true);
  finish([row]);
  await Promise.resolve();
  flush();
  expect(search.pending()).toBe(false);
  dispose();
});

it("cleanup cancels scheduled requests and ignores replies from in-flight requests", async () => {
  const request = vi.fn(async () => [row]);
  const { search, dispose } = setup(request);
  search.setQuery("rope");
  dispose();
  await vi.advanceTimersByTimeAsync(200);
  expect(request).not.toHaveBeenCalled();
  let finish!: (rows: readonly IndexRow[]) => void;
  const next = setup(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  next.search.setQuery("rope");
  await vi.advanceTimersByTimeAsync(200);
  next.dispose();
  finish([row]);
  await Promise.resolve();
  flush();
  expect(next.search.results()).toEqual([]);
});
