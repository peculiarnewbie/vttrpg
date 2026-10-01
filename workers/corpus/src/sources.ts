import { Context, Effect, Layer } from "effect";
import type { CorpusReply } from "../../../src/domain/corpus-errors";
import type { CompendiumEntry } from "../../../src/domain/compendium";
import type { SnapshotManifest } from "../../../src/domain/snapshot";
import type { SourceDO, SaveDraftCall, DeleteDraftCall, DraftContext } from "./source-do";
import { bindingCall, fromReply } from "./effects";

const makeSources = (namespace: DurableObjectNamespace<SourceDO>) => ({
  saveEntries: Effect.fn("Sources.saveEntries")(function* (call: SaveDraftCall) {
    const reply = yield* bindingCall<CorpusReply<readonly CompendiumEntry[]>>(
      "Corpus draft storage unavailable",
      () => namespace.getByName(call.source.id).saveEntries(call),
    );
    return yield* fromReply(reply);
  }),
  deleteEntries: Effect.fn("Sources.deleteEntries")(function* (call: DeleteDraftCall) {
    const reply = yield* bindingCall<CorpusReply<void>>("Corpus draft storage unavailable", () =>
      namespace.getByName(call.source.id).deleteEntries(call),
    );
    return yield* fromReply(reply);
  }),
  publish: Effect.fn("Sources.publish")(function* (call: DraftContext) {
    const reply = yield* bindingCall<CorpusReply<SnapshotManifest>>(
      "Corpus draft storage unavailable",
      () => namespace.getByName(call.source.id).publish(call),
    );
    return yield* fromReply(reply);
  }),
});

export class Sources extends Context.Service<Sources, ReturnType<typeof makeSources>>()(
  "ttrpg/corpus/Sources",
) {}

export const sourcesLayer = (namespace: DurableObjectNamespace<SourceDO>) =>
  Layer.succeed(Sources, makeSources(namespace));
