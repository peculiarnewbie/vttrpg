import { DurableObject } from "cloudflare:workers";
import { Context, Effect, Layer, ManagedRuntime, References, Schema, Semaphore } from "effect";
import {
  CompendiumEntry,
  compendiumLimits,
  type EntryType,
  type SaveEntryInput,
} from "../../../src/domain/compendium";
import type { CorpusSource } from "../../../src/domain/corpus-rpc";
import { CorpusConflict, CorpusInvalid } from "../../../src/domain/corpus-errors";
import { entryId, slugify, uniqueSlug } from "../../../src/domain/entry-id";
import { snapshotLimits } from "../../../src/domain/snapshot";
import { Registry, registryLayer } from "./registry";
import { snapshotBucketLayer } from "./bucket";
import { readStored, runReply, storageCall, unavailable } from "./effects";
import { publishSnapshot, type FrozenSource } from "./publish";
import { validatePublishedEntrySize } from "./validation";
import type { CorpusEnv } from "./entrypoint";

export type DraftContext = { source: CorpusSource; types: readonly EntryType[] };
export type SaveDraftCall = DraftContext & { entries: readonly SaveEntryInput[] };
export type DeleteDraftCall = DraftContext & { ids: readonly string[] };

class DraftStorage extends Context.Service<DraftStorage, DurableObjectStorage>()(
  "ttrpg/corpus/DraftStorage",
) {}

export class SourceDO extends DurableObject<CorpusEnv> {
  #publication = Semaphore.makeUnsafe(1);
  #verifiedDrafts = new Map<string, { data: string; entry: CompendiumEntry }>();
  #runtime = ManagedRuntime.make(
    Layer.mergeAll(
      registryLayer(this.env.CORPUS_DB),
      snapshotBucketLayer(this.env.CORPUS_BUCKET),
      Layer.succeed(DraftStorage, this.ctx.storage),
    ),
  );

  constructor(ctx: DurableObjectState, env: CorpusEnv) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS source_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        source_id TEXT, owner_account_id TEXT, revision INTEGER NOT NULL DEFAULT 0,
        next_version INTEGER NOT NULL DEFAULT 1
      );
      INSERT OR IGNORE INTO source_state (singleton) VALUES (1);
      CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entry_ids (id TEXT PRIMARY KEY);
    `);
  }

  // Only the entrypoint calls this DO; its arguments and saved system types are already validated.
  #context(context: DraftContext) {
    return Effect.gen(function* () {
      const storage = yield* DraftStorage;
      const state = yield* storageCall("Corpus draft storage unavailable", () =>
        storage.sql
          .exec<{ source_id: string | null; owner_account_id: string | null }>(
            "SELECT source_id, owner_account_id FROM source_state",
          )
          .one(),
      );
      // A persisted identity must still match after a Worker upgrade or namespace change.
      if (
        state.source_id !== null &&
        (state.source_id !== context.source.id ||
          state.owner_account_id !== context.source.ownerAccountId)
      )
        return yield* Effect.fail(new CorpusConflict({ message: "Source identity is immutable" }));
      return storage;
    });
  }

  #bind(storage: DurableObjectStorage, source: CorpusSource) {
    storage.sql.exec(
      "UPDATE source_state SET source_id = ?, owner_account_id = ? WHERE singleton = 1 AND source_id IS NULL",
      source.id,
      source.ownerAccountId,
    );
  }

  saveEntries(call: SaveDraftCall) {
    const effect = Effect.gen({ self: this }, function* () {
      const { source } = call;
      const storage = yield* this.#context(call);
      const state = yield* storageCall("Corpus draft storage unavailable", () => ({
        count: storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM drafts").one()
          .count,
        reserved: new Set(
          storage.sql
            .exec<{ id: string }>("SELECT id FROM entry_ids")
            .toArray()
            .map((row) => row.id),
        ),
        revision: storage.sql.exec<{ revision: number }>("SELECT revision FROM source_state").one()
          .revision,
      }));
      let created = 0;
      const entries: CompendiumEntry[] = [];
      const batchIds = new Set<string>();
      for (const input of call.entries) {
        const id =
          input.id ??
          entryId(
            source.id,
            input.typeId,
            uniqueSlug(slugify(input.name), (slug) =>
              state.reserved.has(entryId(source.id, input.typeId, slug)),
            ),
          );
        if (batchIds.has(id))
          return yield* Effect.fail(
            new CorpusInvalid({ message: "Batch entry ids must be unique" }),
          );
        batchIds.add(id);
        const previous = yield* storageCall(
          "Corpus draft storage unavailable",
          () =>
            storage.sql.exec<{ id: string }>("SELECT id FROM drafts WHERE id = ?", id).toArray()[0],
        );
        if (!previous) created++;
        const entry: CompendiumEntry = {
          ...input,
          id,
          name: input.name.trim(),
          updatedAt: new Date().toISOString(),
          rev: state.revision + entries.length + 1,
        };
        // The byte budget depends on the generated id, timestamp and publication metadata.
        yield* validatePublishedEntrySize(entry, source.licence);
        state.reserved.add(id);
        entries.push(entry);
      }
      if (state.count + created > compendiumLimits.entries)
        return yield* Effect.fail(
          new CorpusInvalid({ message: "A source can have at most 10000 entries" }),
        );
      const rows = entries.map((entry) => ({ entry, data: JSON.stringify(entry) }));
      // Scheduler yielding is disabled until the synchronous reads and writes finish.
      yield* storageCall("Corpus draft storage unavailable", () =>
        storage.transactionSync(() => {
          this.#bind(storage, source);
          for (const { entry, data } of rows) {
            storage.sql.exec(
              "INSERT INTO drafts (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
              entry.id,
              data,
            );
            storage.sql.exec("INSERT OR IGNORE INTO entry_ids (id) VALUES (?)", entry.id);
          }
          storage.sql.exec(
            "UPDATE source_state SET revision = ? WHERE singleton = 1",
            state.revision + entries.length,
          );
        }),
      );
      for (const row of rows) this.#verifiedDrafts.set(row.entry.id, row);
      return entries;
    });
    return runReply(
      effect.pipe(Effect.provideService(References.PreventSchedulerYield, true)),
      this.#runtime.runPromiseExit,
    );
  }

  deleteEntries(call: DeleteDraftCall) {
    const effect = Effect.gen({ self: this }, function* () {
      const storage = yield* this.#context(call);
      const ids = new Set(call.ids);
      yield* storageCall("Corpus draft storage unavailable", () =>
        storage.transactionSync(() => {
          this.#bind(storage, call.source);
          for (const id of ids) storage.sql.exec("DELETE FROM drafts WHERE id = ?", id);
          storage.sql.exec(
            "UPDATE source_state SET revision = revision + ? WHERE singleton = 1",
            ids.size,
          );
        }),
      );
      for (const id of ids) this.#verifiedDrafts.delete(id);
    });
    return runReply(
      effect.pipe(Effect.provideService(References.PreventSchedulerYield, true)),
      this.#runtime.runPromiseExit,
    );
  }

  #freeze(context: DraftContext) {
    return Effect.gen({ self: this }, function* () {
      const storage = yield* this.#context(context);
      const state = yield* storageCall("Corpus draft storage unavailable", () => ({
        version: storage.sql
          .exec<{ next_version: number }>("SELECT next_version FROM source_state")
          .one().next_version,
        rows: storage.sql
          .exec<{ id: string; data: string }>("SELECT id, data FROM drafts ORDER BY id")
          .toArray(),
      }));
      if (!Number.isSafeInteger(state.version) || state.version < 1)
        return yield* unavailable(
          "Invalid stored next version",
          "Corpus draft storage unavailable",
        );
      if (state.version > snapshotLimits.version)
        return yield* Effect.fail(new CorpusConflict({ message: "Source version limit reached" }));
      const entries: Array<FrozenSource["entries"][number]> = [];
      const types = new Map(context.types.map((type) => [type.id, type]));
      for (const row of state.rows) {
        const cached = this.#verifiedDrafts.get(row.id);
        // Verify bytes from an older instance once; our own writes enter the cache directly.
        let entry: CompendiumEntry;
        if (cached?.data === row.data) {
          entry = cached.entry;
        } else {
          entry = yield* readStored(Schema.fromJsonString(CompendiumEntry), row.data);
          if (entry.id !== row.id)
            return yield* unavailable(
              "Stored draft identity mismatch",
              "Stored corpus draft did not verify",
            );
          this.#verifiedDrafts.set(row.id, { data: row.data, entry });
        }
        const type = types.get(entry.typeId);
        // The system can remove a type after its drafts were saved.
        if (!type)
          return yield* Effect.fail(
            new CorpusConflict({ message: `Draft entry type was removed: ${entry.typeId}` }),
          );
        entries.push({ entry, type });
      }
      // Durable allocation precedes every R2 write, including failed publication attempts.
      yield* storageCall("Corpus draft storage unavailable", () =>
        storage.transactionSync(() => {
          this.#bind(storage, context.source);
          storage.sql.exec(
            "UPDATE source_state SET next_version = next_version + 1 WHERE singleton = 1",
          );
        }),
      );
      return { ...context, entries, version: state.version };
    }).pipe(Effect.provideService(References.PreventSchedulerYield, true));
  }

  publish(context: DraftContext) {
    const effect = Effect.gen({ self: this }, function* () {
      const frozen = yield* this.#freeze(context);
      const manifest = yield* publishSnapshot(frozen);
      const registry = yield* Registry;
      yield* registry.commitVersion(manifest);
      return manifest;
    });
    return runReply(this.#publication.withPermit(effect), this.#runtime.runPromiseExit);
  }
}
