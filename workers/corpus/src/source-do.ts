import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";
import * as Schema from "effect/Schema";
import {
  CompendiumEntry,
  EntryType,
  SaveEntryInput,
  compendiumLimits,
} from "../../../src/domain/compendium";
import { CorpusSource } from "../../../src/domain/corpus-rpc";
import { entryId, parseEntryId, slugify, uniqueSlug } from "../../../src/domain/entry-id";
import { typeError } from "../../../src/domain/compendium-rules";
import { Registry } from "./registry";
import { publishSnapshot } from "./publish";
import { safeId, validateBatch, validateSource, validateSourceEntry } from "./validation";
import type { CorpusEnv } from "./entrypoint";

const DraftContext = Schema.Struct({ source: CorpusSource, types: Schema.Array(EntryType) });
type DraftContext = typeof DraftContext.Type;
const SaveDraftCall = Schema.Struct({
  ...DraftContext.fields,
  entries: Schema.Array(SaveEntryInput),
});
const DeleteDraftCall = Schema.Struct({ ...DraftContext.fields, ids: Schema.Array(Schema.String) });

export class SourceDO extends DurableObject<CorpusEnv> {
  #publication: Promise<unknown> = Promise.resolve();

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

  #context(value: DraftContext): DraftContext {
    const decoded = Schema.decodeUnknownSync(DraftContext)(value);
    validateSource(decoded.source);
    const state = this.ctx.storage.sql
      .exec<{ source_id: string | null; owner_account_id: string | null }>(
        "SELECT source_id, owner_account_id FROM source_state",
      )
      .one();
    if (state.source_id === null) {
      this.ctx.storage.sql.exec(
        "UPDATE source_state SET source_id = ?, owner_account_id = ? WHERE singleton = 1",
        decoded.source.id,
        decoded.source.ownerAccountId,
      );
    } else if (
      state.source_id !== decoded.source.id ||
      state.owner_account_id !== decoded.source.ownerAccountId
    ) {
      throw new Error("Source identity is immutable");
    }
    if (
      decoded.types.length > compendiumLimits.types ||
      new Set(decoded.types.map((type) => type.id)).size !== decoded.types.length
    )
      throw new Error("Invalid source entry types");
    for (const type of decoded.types) {
      const error = typeError(type, decoded.types);
      if (error) throw new Error(error);
    }
    return decoded;
  }

  async saveEntries(value: typeof SaveDraftCall.Type): Promise<readonly CompendiumEntry[]> {
    const call = Schema.decodeUnknownSync(SaveDraftCall)(value);
    const { source, types } = this.#context(call);
    validateBatch(call.entries);
    return this.ctx.storage.transactionSync(() => {
      const count = this.ctx.storage.sql
        .exec<{ count: number }>("SELECT COUNT(*) AS count FROM drafts")
        .one().count;
      let created = 0;
      const reserved = new Set(
        this.ctx.storage.sql
          .exec<{ id: string }>("SELECT id FROM entry_ids")
          .toArray()
          .map((row) => row.id),
      );
      const revision = this.ctx.storage.sql
        .exec<{ revision: number }>("SELECT revision FROM source_state")
        .one().revision;
      const entries: CompendiumEntry[] = [];
      const batchIds = new Set<string>();
      for (const input of call.entries) {
        const type = types.find((candidate) => candidate.id === input.typeId);
        if (!type) throw new Error(`Unknown entry type: ${input.typeId}`);
        validateSourceEntry(source.id, input, type);
        const id =
          input.id ??
          entryId(
            source.id,
            type.id,
            uniqueSlug(slugify(input.name), (slug) =>
              reserved.has(entryId(source.id, type.id, slug)),
            ),
          );
        if (batchIds.has(id)) throw new Error("Batch entry ids must be unique");
        batchIds.add(id);
        const previous = this.ctx.storage.sql
          .exec<{ data: string }>("SELECT data FROM drafts WHERE id = ?", id)
          .toArray()[0];
        if (
          previous &&
          Schema.decodeUnknownSync(CompendiumEntry)(JSON.parse(previous.data)).typeId !==
            input.typeId
        )
          throw new Error("An entry cannot change type");
        if (!previous) created++;
        const entry: CompendiumEntry = {
          ...input,
          id,
          name: input.name.trim(),
          updatedAt: new Date().toISOString(),
          rev: revision + entries.length + 1,
        };
        reserved.add(id);
        entries.push(entry);
      }
      if (count + created > compendiumLimits.entries)
        throw new Error("A source can have at most 10000 entries");
      for (const entry of entries) {
        this.ctx.storage.sql.exec(
          "INSERT INTO drafts (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
          entry.id,
          JSON.stringify(entry),
        );
        this.ctx.storage.sql.exec("INSERT OR IGNORE INTO entry_ids (id) VALUES (?)", entry.id);
      }
      this.ctx.storage.sql.exec(
        "UPDATE source_state SET revision = ? WHERE singleton = 1",
        revision + entries.length,
      );
      return entries;
    });
  }

  async deleteEntries(value: typeof DeleteDraftCall.Type): Promise<void> {
    const call = Schema.decodeUnknownSync(DeleteDraftCall)(value);
    const { source } = this.#context(call);
    validateBatch(call.ids);
    for (const id of call.ids) {
      if (parseEntryId(id)?.source !== source.id)
        throw new Error("Cannot delete an entry from another source");
    }
    this.ctx.storage.transactionSync(() => {
      for (const id of new Set(call.ids))
        this.ctx.storage.sql.exec("DELETE FROM drafts WHERE id = ?", id);
      this.ctx.storage.sql.exec(
        "UPDATE source_state SET revision = revision + ? WHERE singleton = 1",
        new Set(call.ids).size,
      );
    });
  }

  async publish(value: DraftContext) {
    // Snapshot metadata and draft rows are frozen before the first async R2 write.
    const context = this.#context(value);
    safeId(context.source.id);
    const work = this.#publication.then(async () => {
      const frozen = this.ctx.storage.transactionSync(() => {
        const version = this.ctx.storage.sql
          .exec<{ next_version: number }>("SELECT next_version FROM source_state")
          .one().next_version;
        if (!Number.isSafeInteger(version) || version < 1 || version > 2147483647)
          throw new Error("Invalid next version");
        const entries = this.ctx.storage.sql
          .exec<{ data: string }>("SELECT data FROM drafts ORDER BY id")
          .toArray()
          .map((row) => Schema.decodeUnknownSync(CompendiumEntry)(JSON.parse(row.data)));
        for (const entry of entries) {
          const type = context.types.find((candidate) => candidate.id === entry.typeId);
          if (!type) throw new Error(`Draft entry type was removed: ${entry.typeId}`);
          validateSourceEntry(context.source.id, entry, type);
        }
        // Durable allocation precedes all object writes, including failed attempts.
        this.ctx.storage.sql.exec(
          "UPDATE source_state SET next_version = next_version + 1 WHERE singleton = 1",
        );
        return { ...context, entries, version };
      });
      const manifest = await Effect.runPromise(publishSnapshot(this.env.CORPUS_BUCKET, frozen));
      await Effect.runPromise(new Registry(this.env.CORPUS_DB).commitVersion(manifest));
      return manifest;
    });
    this.#publication = work.catch(() => undefined);
    return work;
  }
}
