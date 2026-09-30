import { createSignal, onCleanup, type Accessor } from "solid-js";
import type { IndexRow } from "../domain/compendium";

export type SearchQuery = {
  readonly query: string;
  readonly typeIds?: readonly string[];
  readonly limit?: number;
};

/** Sends one search and resolves with its results (RealtimeController.search). */
export type SearchRequest = (query: SearchQuery) => Promise<readonly IndexRow[]>;

export type Search = {
  /** Set what to search for; results follow after the debounce. */
  setQuery: (query: string, typeIds?: readonly string[]) => void;
  query: Accessor<string>;
  /** Results for the latest query that finished; cleared when the query drops under the minimum. */
  results: Accessor<readonly IndexRow[]>;
  /** A query is waiting on the debounce or the server. */
  pending: Accessor<boolean>;
  error: Accessor<string | undefined>;
};

/**
 * Search-as-you-type over the world's WebSocket: waits `debounceMs` (200)
 * after the last keystroke, skips queries shorter than `minLength` (2) after
 * trimming, and ignores any reply that isn't for the latest query sent — so
 * slow replies never overwrite newer results. Must be created under an owner
 * (timers are cleared on cleanup).
 */
export const createSearch = (options: {
  request: SearchRequest;
  debounceMs?: number;
  minLength?: number;
  limit?: number;
}): Search => {
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<readonly IndexRow[]>([]);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    generation++;
    clearTimeout(timer);
  });
  return {
    query,
    results,
    pending,
    error,
    setQuery: (value, typeIds) => {
      if (disposed) return;
      const current = ++generation;
      clearTimeout(timer);
      setQuery(value);
      setError(undefined);
      const trimmed = value.trim();
      if (trimmed.length < (options.minLength ?? 2)) {
        setResults([]);
        setPending(false);
        return;
      }
      setPending(true);
      const request = { query: trimmed, typeIds: typeIds && [...typeIds], limit: options.limit };
      timer = setTimeout(async () => {
        try {
          const rows = await options.request(request);
          if (!disposed && current === generation) setResults(rows);
        } catch (cause) {
          if (!disposed && current === generation) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        } finally {
          if (!disposed && current === generation) setPending(false);
        }
      }, options.debounceMs ?? 200);
    },
  };
};
