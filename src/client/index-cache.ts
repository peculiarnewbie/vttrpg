import * as Schema from "effect/Schema";
import { EntryType, IndexRow } from "../domain/compendium";

export const CachedIndex = Schema.Struct({
  format: Schema.Literal(1),
  rev: Schema.Int,
  types: Schema.Array(EntryType),
  rows: Schema.Array(IndexRow),
});
export type CachedIndex = typeof CachedIndex.Type;

export interface IndexCache {
  read(key: string): Promise<CachedIndex | undefined>;
  write(key: string, value: CachedIndex): Promise<void>;
}

const decode = Schema.decodeUnknownSync(CachedIndex);
const decodeStored = (value: unknown): CachedIndex | undefined => {
  try {
    return decode(value);
  } catch {
    return undefined;
  }
};

export function createMemoryIndexCache(
  initial: ReadonlyMap<string, unknown> = new Map(),
): IndexCache {
  const values = new Map(initial);
  return {
    async read(key) {
      return decodeStored(values.get(key));
    },
    async write(key, value) {
      values.set(key, structuredClone(value));
    },
  };
}

const databaseName = "tabletop-compendium";
const storeName = "indexes";
// Reads give up quickly (the page shows the network index instead); writes of a
// large index can take longer on slow devices and finish in the background.
const timeout = 1_000;
const writeTimeout = 20_000;

export function createIndexedDbIndexCache(): IndexCache {
  let database: Promise<IDBDatabase | undefined> | undefined;
  const open = () =>
    (database ??= new Promise<IDBDatabase | undefined>((resolve) => {
      let finished = false;
      const finish = (db?: IDBDatabase) => {
        if (finished) {
          db?.close();
          return;
        }
        finished = true;
        clearTimeout(timer);
        resolve(db);
      };
      // Some browser privacy modes leave requests pending without an error.
      const timer = setTimeout(() => finish(), timeout);
      try {
        const request = globalThis.indexedDB.open(databaseName, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(storeName);
        request.onerror = request.onblocked = () => finish();
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            database = undefined;
          };
          finish(db);
        };
      } catch {
        finish();
      }
    }));

  const transact = async (
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest,
  ): Promise<unknown> => {
    const limit = mode === "readwrite" ? writeTimeout : timeout;
    const db = await open();
    if (!db) return undefined;
    return new Promise((resolve) => {
      let transaction: IDBTransaction | undefined;
      let finished = false;
      const finish = (value?: unknown) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        finish();
        try {
          transaction?.abort();
        } catch {
          // It may have completed while the timeout was queued.
        }
      }, limit);
      try {
        transaction = db.transaction(storeName, mode);
        const request = operation(transaction.objectStore(storeName));
        transaction.oncomplete = () => finish(request.result);
        transaction.onerror = transaction.onabort = () => finish();
      } catch {
        finish();
      }
    });
  };

  return {
    async read(key) {
      return decodeStored(await transact("readonly", (store) => store.get(key)));
    },
    async write(key, value) {
      await transact("readwrite", (store) => store.put(value, key));
    },
  };
}
