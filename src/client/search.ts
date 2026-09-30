import type { Accessor } from "solid-js";
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
export const createSearch = (_options: {
  request: SearchRequest;
  debounceMs?: number;
  minLength?: number;
  limit?: number;
}): Search => {
  throw new Error("not implemented");
};
