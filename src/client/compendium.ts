import { createSignal, getOwner, onCleanup, onSettled } from "solid-js";
import {
  compendiumLimits,
  type CompendiumEntry,
  type EntryBodies,
  type EntryType,
  type IndexDelta,
  type IndexRow,
} from "../domain/compendium";
import type { CompendiumStore } from "./compendium-store";
import { api } from "./api";
import { normalizeName } from "../domain/entry-links";

/** Debounce bursts, then serialize fetches with at most one queued refresh. */
export function createCompendiumRefresh<T>(options: {
  fetch: () => Promise<T>;
  onValue: (value: T) => void;
  onLoading: (loading: boolean) => void;
  onError: (error: unknown) => void;
  delay?: number;
}) {
  let requested = false;
  let disposed = false;
  let running: Promise<boolean> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  const refresh = (): Promise<boolean> => {
    if (disposed) return Promise.resolve(false);
    requested = true;
    if (running) return running;
    options.onLoading(true);
    running = new Promise<void>((resolve) => {
      wake = resolve;
      timer = setTimeout(resolve, options.delay ?? 30);
    }).then(async () => {
      try {
        let ok = false;
        while (requested && !disposed) {
          requested = false;
          try {
            const value = await options.fetch();
            if (!disposed) options.onValue(value);
            ok = true;
          } catch (error) {
            if (!disposed) options.onError(error);
            ok = false;
          }
        }
        return !disposed && ok;
      } finally {
        running = undefined;
        wake = undefined;
        if (!disposed) options.onLoading(false);
      }
    });
    return running;
  };
  return {
    refresh,
    dispose() {
      disposed = true;
      requested = false;
      clearTimeout(timer);
      wake?.();
    },
  };
}

type CompendiumDependencies = {
  index: (worldId: string, since: number) => Promise<IndexDelta>;
  bodies: (worldId: string, ids: readonly string[]) => Promise<EntryBodies>;
};

export function createCompendium(
  worldId: string,
  deps: CompendiumDependencies = { index: api.getCompendiumIndex, bodies: api.getEntryBodies },
): CompendiumStore {
  const [version, setVersion] = createSignal(0);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string>();
  const bump = () => setVersion((value) => value + 1);
  const rows = new Map<string, IndexRow>();
  const cache = new Map<string, CompendiumEntry>();
  const aliases = new Map<string, string>();
  const aliasesById = new Map<string, Set<string>>();
  const misses = new Set<string>();
  const generations = new Map<string, number>();
  const pending = new Map<
    string,
    {
      promise: Promise<CompendiumEntry | undefined>;
      resolve: (entry: CompendiumEntry | undefined) => void;
    }
  >();
  const queued = new Set<string>();
  let scheduled = false;
  let disposed = false;
  let rev = 0;
  let indexGeneration = 0;
  let types: readonly EntryType[] = [];
  let sorted: readonly IndexRow[] = [];
  let byName = new Map<string, IndexRow>();
  let byType = new Map<string, IndexRow[]>();
  const canonical = (id: string) => aliases.get(id) ?? id;
  const cached = (id: string) => {
    const key = canonical(id);
    const entry = cache.get(key);
    if (entry) {
      cache.delete(key);
      cache.set(key, entry);
    }
    return entry;
  };
  const invalidate = (id: string) => {
    const key = canonical(id);
    cache.delete(key);
    for (const candidate of new Set([id, key, ...(aliasesById.get(key) ?? [])])) {
      misses.delete(candidate);
      generations.set(candidate, (generations.get(candidate) ?? 0) + 1);
    }
  };
  const applyIndex = (delta: IndexDelta) => {
    indexGeneration++;
    if (delta.full) {
      const next = new Map(delta.upserts.map((row) => [row.id, row]));
      for (const id of rows.keys()) if (!next.has(id)) invalidate(id);
      for (const entry of cache.values()) if (!next.has(entry.id)) invalidate(entry.id);
      misses.clear();
      rows.clear();
    }
    for (const row of delta.upserts) {
      const previous = rows.get(row.id);
      const entry = cache.get(row.id);
      if (previous?.rev !== row.rev || (entry && entry.rev !== row.rev)) invalidate(row.id);
      rows.set(row.id, row);
    }
    for (const id of delta.deletes) {
      rows.delete(id);
      invalidate(id);
    }
    types = delta.types;
    rev = delta.rev;
    sorted = [...rows.values()].sort((a, b) =>
      a.updatedAt === b.updatedAt
        ? a.id.localeCompare(b.id)
        : b.updatedAt.localeCompare(a.updatedAt),
    );
    byName = new Map();
    byType = new Map();
    for (const row of sorted) {
      const name = normalizeName(row.name);
      if (name && !byName.has(name)) byName.set(name, row);
      const list = byType.get(row.typeId) ?? [];
      list.push(row);
      byType.set(row.typeId, list);
    }
    setError(undefined);
    bump();
  };
  const fetchBatch = async (ids: readonly string[]) => {
    const startedAtGeneration = indexGeneration;
    const before = new Map(ids.map((id) => [id, generations.get(id) ?? 0]));
    const requests = ids.map((id) => pending.get(id));
    const settled = new Map<string, CompendiumEntry>();
    try {
      const response = await deps.bodies(worldId, ids);
      if (disposed) return;
      const entries = new Map(response.entries.map((entry) => [entry.id, entry]));
      const changed = (id: string) => before.get(id) !== (generations.get(id) ?? 0);
      for (const id of ids) {
        if (changed(id)) continue;
        const key = response.aliases?.[id] ?? canonical(id);
        const entry = entries.get(key);
        const row = rows.get(key);
        // An unknown alias may resolve to an entry deleted while this request ran.
        if (entry && (row ? entry.rev === row.rev : startedAtGeneration === indexGeneration)) {
          if (id !== key) {
            aliases.set(id, key);
            const related = aliasesById.get(key) ?? new Set<string>();
            related.add(id);
            aliasesById.set(key, related);
          }
          misses.delete(id);
          misses.delete(key);
          cache.delete(key);
          cache.set(key, entry);
          settled.set(id, entry);
        } else if (startedAtGeneration === indexGeneration && response.missing.includes(id)) {
          misses.add(id);
        }
      }
      while (cache.size > 500) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      setError(undefined);
    } catch (cause) {
      if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      ids.forEach((id, index) => {
        pending.delete(id);
        requests[index]?.resolve(settled.get(id));
      });
      if (!disposed) bump();
    }
  };
  const flushQueue = () => {
    scheduled = false;
    if (disposed) return;
    const ids = [...queued];
    queued.clear();
    for (let offset = 0; offset < ids.length; offset += compendiumLimits.bodiesPerRequest) {
      void fetchBatch(ids.slice(offset, offset + compendiumLimits.bodiesPerRequest));
    }
  };
  const requestEntry = (id: string): Promise<CompendiumEntry | undefined> => {
    const entry = cached(id);
    if (entry || misses.has(id) || disposed) return Promise.resolve(entry);
    const current = pending.get(id);
    if (current) return current.promise;
    let resolve!: (entry: CompendiumEntry | undefined) => void;
    const promise = new Promise<CompendiumEntry | undefined>((done) => {
      resolve = done;
    });
    pending.set(id, { promise, resolve });
    queued.add(id);
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flushQueue);
    }
    return promise;
  };
  const refreshes = createCompendiumRefresh({
    fetch: () => deps.index(worldId, rev),
    onValue: applyIndex,
    onLoading: (value) => {
      setLoading(value);
      if (value) setError(undefined);
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : String(cause)),
  });
  if (getOwner()) {
    onCleanup(() => {
      disposed = true;
      refreshes.dispose();
      for (const request of pending.values()) request.resolve(undefined);
      pending.clear();
      queued.clear();
    });
    onSettled(() => void refreshes.refresh());
  } else void refreshes.refresh();
  return {
    types: () => {
      version();
      return types;
    },
    typeById: (id) => {
      version();
      return types.find((type) => type.id === id);
    },
    rows: () => {
      version();
      return sorted;
    },
    row: (id) => {
      version();
      return rows.get(canonical(id));
    },
    rowsOfType: (id) => {
      version();
      return byType.get(id) ?? [];
    },
    rowByName: (name) => {
      version();
      return byName.get(normalizeName(name));
    },
    entry: (id) => {
      version();
      const entry = cached(id);
      if (!entry) void requestEntry(id);
      return entry;
    },
    missing: (id) => {
      version();
      return misses.has(id);
    },
    load: async (ids) =>
      (await Promise.all(ids.map(requestEntry))).filter(
        (entry): entry is CompendiumEntry => entry !== undefined,
      ),
    rev: () => {
      version();
      return rev;
    },
    loading,
    error,
    refresh: refreshes.refresh,
  };
}
