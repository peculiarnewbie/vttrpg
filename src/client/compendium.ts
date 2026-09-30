import { createSignal, getOwner, onCleanup, onSettled } from "solid-js";
import type { Compendium } from "../domain/compendium";
import { api } from "./api";

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

export function createCompendium(
  worldId: string,
  fetcher: (worldId: string) => Promise<Compendium> = api.getCompendium,
) {
  const [data, setData] = createSignal<Compendium>({ types: [], entries: [] });
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string>();
  const refreshes = createCompendiumRefresh({
    fetch: () => fetcher(worldId),
    onValue: (value) => {
      setData(value);
      setError(undefined);
    },
    onLoading: (value) => {
      setLoading(value);
      if (value) setError(undefined);
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : String(cause)),
  });
  if (getOwner()) {
    onCleanup(refreshes.dispose);
    onSettled(() => void refreshes.refresh());
  } else void refreshes.refresh();
  return {
    types: () => data().types,
    entries: () => data().entries,
    entry: (id: string) => data().entries.find((entry) => entry.id === id),
    typeById: (id: string) => data().types.find((type) => type.id === id),
    entriesOfType: (typeId: string) => data().entries.filter((entry) => entry.typeId === typeId),
    loading,
    error,
    refresh: refreshes.refresh,
  };
}
