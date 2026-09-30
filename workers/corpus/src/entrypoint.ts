import { WorkerEntrypoint } from "cloudflare:workers";
import { Effect } from "effect";
import {
  CorpusCall,
  CreateSourceCall,
  DeleteEntriesCall,
  ManifestCall,
  SaveEntriesCall,
  SaveSystemCall,
  SourceCall,
  type CorpusApi,
  type CorpusSource,
} from "../../../src/domain/corpus-rpc";
import { Registry } from "./registry";
import { decodeCall, validateSource, validateSystem } from "./validation";
import type { SourceDO } from "./source-do";

export type CorpusEnv = {
  CORPUS_DB: D1Database;
  CORPUS_BUCKET: R2Bucket;
  SOURCES: DurableObjectNamespace<SourceDO>;
};

export class CorpusEntrypoint extends WorkerEntrypoint<CorpusEnv> implements CorpusApi {
  #registry() {
    return new Registry(this.env.CORPUS_DB);
  }

  async #readable(call: SourceCall): Promise<CorpusSource | null> {
    const source = await Effect.runPromise(this.#registry().getSource(call.sourceId));
    if (!source) return null;
    if (source.ownerAccountId === call.accountId) return source;
    if (source.visibility === "public" && source.latestVersion !== undefined) return source;
    throw new Error("Source is private or unpublished");
  }

  async #writable(call: SourceCall) {
    const source = await Effect.runPromise(this.#registry().getSource(call.sourceId));
    if (!source) throw new Error("Unknown source");
    if (source.ownerAccountId !== call.accountId)
      throw new Error("Only the source owner can edit it");
    const system = await Effect.runPromise(this.#registry().getSystem(source.systemId));
    if (!system) throw new Error("Unknown system");
    return { source, types: system.entryTypes };
  }

  async listSystems(value: CorpusCall) {
    decodeCall(CorpusCall, value);
    return Effect.runPromise(this.#registry().listSystems());
  }

  async saveSystem(value: typeof SaveSystemCall.Type) {
    const call = decodeCall(SaveSystemCall, value);
    validateSystem(call.system);
    return Effect.runPromise(this.#registry().saveSystem(call.system, call.accountId));
  }

  async listSources(value: CorpusCall) {
    const call = decodeCall(CorpusCall, value);
    return Effect.runPromise(this.#registry().listSources(call.accountId));
  }

  async createSource(value: typeof CreateSourceCall.Type) {
    const call = decodeCall(CreateSourceCall, value);
    validateSource(call.source);
    return Effect.runPromise(this.#registry().createSource(call.source, call.accountId));
  }

  async getSource(value: SourceCall) {
    return this.#readable(decodeCall(SourceCall, value));
  }

  async saveEntries(value: typeof SaveEntriesCall.Type) {
    const call = decodeCall(SaveEntriesCall, value);
    const context = await this.#writable(call);
    return this.env.SOURCES.getByName(call.sourceId).saveEntries({
      ...context,
      entries: call.entries,
    });
  }

  async deleteEntries(value: typeof DeleteEntriesCall.Type) {
    const call = decodeCall(DeleteEntriesCall, value);
    const context = await this.#writable(call);
    await this.env.SOURCES.getByName(call.sourceId).deleteEntries({ ...context, ids: call.ids });
  }

  async publish(value: SourceCall) {
    const call = decodeCall(SourceCall, value);
    const context = await this.#writable(call);
    return this.env.SOURCES.getByName(call.sourceId).publish(context);
  }

  async getLatest(value: SourceCall) {
    const call = decodeCall(SourceCall, value);
    const source = await this.#readable(call);
    return source?.latestVersion === undefined
      ? null
      : Effect.runPromise(this.#registry().getManifest(source.id, source.latestVersion));
  }

  async getManifest(value: typeof ManifestCall.Type) {
    const call = decodeCall(ManifestCall, value);
    if (!Number.isSafeInteger(call.version) || call.version < 1)
      throw new Error("Invalid source version");
    const source = await this.#readable(call);
    return source ? Effect.runPromise(this.#registry().getManifest(source.id, call.version)) : null;
  }
}
