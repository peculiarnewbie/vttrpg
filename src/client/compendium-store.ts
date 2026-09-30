import type { Accessor } from "solid-js";
import type { CompendiumEntry, EntryType, IndexRow } from "../domain/compendium";

/**
 * What the world page (and world settings) know of the compendium, built by
 * `createCompendium` in compendium.ts.
 *
 * - The **index** (every row this member may see, without bodies) is kept in
 *   memory and synced by revision: `compendium.updated {rev}` or a reconnect
 *   calls `refresh()`, which asks for `index?since=<rev>` and applies the delta.
 * - **Entries** (bodies and fields) load on demand in batches: reading
 *   `entry(id)` returns what's cached and, if nothing is, queues the id; ids
 *   queued in the same tick go out in one POST (≤ 100 per request). Loaded
 *   entries live in an LRU cache (500); misses are remembered too, until the
 *   index says the entry changed. An index row with a newer `rev` evicts the
 *   cached entry, so readers refetch it.
 */
export type CompendiumStore = {
  types: Accessor<readonly EntryType[]>;
  typeById: (id: string) => EntryType | undefined;
  /** Every visible index row, most recently updated first. */
  rows: Accessor<readonly IndexRow[]>;
  row: (id: string) => IndexRow | undefined;
  rowsOfType: (typeId: string) => readonly IndexRow[];
  /** For `[[Name]]` links: the row whose name matches (accent-, case- and spacing-insensitive). */
  rowByName: (name: string) => IndexRow | undefined;
  /** Reactive: the loaded entry, or `undefined` while loading (and then the load is queued). */
  entry: (id: string) => CompendiumEntry | undefined;
  /** Reactive: the id was asked for and doesn't exist or isn't visible. */
  missing: (id: string) => boolean;
  /** Loads (or returns cached) entries; resolves with those that exist, in the order asked. */
  load: (ids: readonly string[]) => Promise<readonly CompendiumEntry[]>;
  /** The index revision this client has. */
  rev: Accessor<number>;
  loading: Accessor<boolean>;
  error: Accessor<string | undefined>;
  /** Fetch and apply the index delta since `rev()` (serialized; bursts coalesce). */
  refresh: () => Promise<boolean>;
};
