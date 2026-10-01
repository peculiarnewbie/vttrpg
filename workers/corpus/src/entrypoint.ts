import { WorkerEntrypoint } from "cloudflare:workers";
import { Effect, Layer, ManagedRuntime } from "effect";
import {
  CorpusCall,
  CreateSourceCall,
  DeleteEntriesCall,
  ManifestCall,
  SaveEntriesCall,
  SaveSystemCall,
  SourceCall,
  type CorpusApi,
} from "../../../src/domain/corpus-rpc";
import { CorpusForbidden, CorpusInvalid, CorpusNotFound } from "../../../src/domain/corpus-errors";
import { parseEntryId } from "../../../src/domain/entry-id";
import { snapshotLimits } from "../../../src/domain/snapshot";
import { Registry, registryLayer } from "./registry";
import { Sources, sourcesLayer } from "./sources";
import { runReply } from "./effects";
import {
  decodeCall,
  validateBatch,
  validateSource,
  validateSourceEntry,
  validateSystem,
} from "./validation";
import type { SourceDO } from "./source-do";

export type CorpusEnv = {
  CORPUS_DB: D1Database;
  CORPUS_BUCKET: R2Bucket;
  SOURCES: DurableObjectNamespace<SourceDO>;
};

const readable = Effect.fn("Corpus.readable")(function* (call: SourceCall) {
  const registry = yield* Registry;
  const source = yield* registry.getSource(call.sourceId);
  if (!source) return null;
  if (source.ownerAccountId === call.accountId) return source;
  if (source.visibility === "public" && source.latestVersion !== undefined) return source;
  return yield* Effect.fail(new CorpusForbidden({ message: "Source is private or unpublished" }));
});

const writable = Effect.fn("Corpus.writable")(function* (call: SourceCall) {
  const registry = yield* Registry;
  const source = yield* registry.getSource(call.sourceId);
  if (!source) return yield* Effect.fail(new CorpusNotFound({ message: "Unknown source" }));
  if (source.ownerAccountId !== call.accountId)
    return yield* Effect.fail(
      new CorpusForbidden({ message: "Only the source owner can edit it" }),
    );
  const system = yield* registry.getSystem(source.systemId);
  if (!system) return yield* Effect.fail(new CorpusNotFound({ message: "Unknown system" }));
  return { source, types: system.entryTypes };
});

export class CorpusEntrypoint extends WorkerEntrypoint<CorpusEnv> implements CorpusApi {
  // One runtime per entrypoint keeps its adapters and verified manifests together.
  #runtime = ManagedRuntime.make(
    Layer.mergeAll(registryLayer(this.env.CORPUS_DB), sourcesLayer(this.env.SOURCES)),
  );

  listSystems(value: CorpusCall) {
    return runReply(
      Effect.gen(function* () {
        yield* decodeCall(CorpusCall, value);
        const registry = yield* Registry;
        return yield* registry.listSystems();
      }),
      this.#runtime.runPromiseExit,
    );
  }

  saveSystem(value: typeof SaveSystemCall.Type) {
    return runReply(
      Effect.gen(function* () {
        const call = yield* decodeCall(SaveSystemCall, value);
        yield* validateSystem(call.system);
        const registry = yield* Registry;
        return yield* registry.saveSystem(call.system, call.accountId);
      }),
      this.#runtime.runPromiseExit,
    );
  }

  listSources(value: CorpusCall) {
    return runReply(
      Effect.gen(function* () {
        const call = yield* decodeCall(CorpusCall, value);
        const registry = yield* Registry;
        return yield* registry.listSources(call.accountId);
      }),
      this.#runtime.runPromiseExit,
    );
  }

  createSource(value: typeof CreateSourceCall.Type) {
    return runReply(
      Effect.gen(function* () {
        const call = yield* decodeCall(CreateSourceCall, value);
        yield* validateSource(call.source);
        const registry = yield* Registry;
        return yield* registry.createSource(call.source, call.accountId);
      }),
      this.#runtime.runPromiseExit,
    );
  }

  getSource(value: SourceCall) {
    return runReply(
      Effect.gen(function* () {
        return yield* readable(yield* decodeCall(SourceCall, value));
      }),
      this.#runtime.runPromiseExit,
    );
  }

  saveEntries(value: typeof SaveEntriesCall.Type) {
    return runReply(
      Effect.gen(function* () {
        const call = yield* decodeCall(SaveEntriesCall, value);
        const context = yield* writable(call);
        yield* validateBatch(call.entries);
        for (const input of call.entries) {
          const type = context.types.find((candidate) => candidate.id === input.typeId);
          if (!type)
            return yield* Effect.fail(
              new CorpusInvalid({ message: `Unknown entry type: ${input.typeId}` }),
            );
          yield* validateSourceEntry(call.sourceId, input, type);
        }
        const sources = yield* Sources;
        return yield* sources.saveEntries({ ...context, entries: call.entries });
      }),
      this.#runtime.runPromiseExit,
    );
  }

  deleteEntries(value: typeof DeleteEntriesCall.Type) {
    return runReply(
      Effect.gen(function* () {
        const call = yield* decodeCall(DeleteEntriesCall, value);
        const context = yield* writable(call);
        yield* validateBatch(call.ids);
        for (const id of call.ids) {
          if (parseEntryId(id)?.source !== call.sourceId)
            return yield* Effect.fail(
              new CorpusInvalid({ message: "Cannot delete an entry from another source" }),
            );
        }
        const sources = yield* Sources;
        return yield* sources.deleteEntries({ ...context, ids: call.ids });
      }),
      this.#runtime.runPromiseExit,
    );
  }

  publish(value: SourceCall) {
    return runReply(
      Effect.gen(function* () {
        const call = yield* decodeCall(SourceCall, value);
        const context = yield* writable(call);
        const sources = yield* Sources;
        return yield* sources.publish(context);
      }),
      this.#runtime.runPromiseExit,
    );
  }

  getLatest(value: SourceCall) {
    return runReply(
      Effect.gen(function* () {
        const call = yield* decodeCall(SourceCall, value);
        const source = yield* readable(call);
        const registry = yield* Registry;
        return source?.latestVersion === undefined
          ? null
          : yield* registry.getManifest(source.id, source.latestVersion);
      }),
      this.#runtime.runPromiseExit,
    );
  }

  getManifest(value: typeof ManifestCall.Type) {
    return runReply(
      Effect.gen(function* () {
        const call = yield* decodeCall(ManifestCall, value);
        if (call.version < 1 || call.version > snapshotLimits.version)
          return yield* Effect.fail(new CorpusInvalid({ message: "Invalid source version" }));
        const source = yield* readable(call);
        const registry = yield* Registry;
        return source ? yield* registry.getManifest(source.id, call.version) : null;
      }),
      this.#runtime.runPromiseExit,
    );
  }
}
