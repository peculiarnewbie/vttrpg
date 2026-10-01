import { Effect } from "effect";
import { expect, it } from "vitest";
import { Registry, registryLayer } from "./registry";
import { runReply } from "./effects";

it("returns CorpusUnavailable when a D1 binding rejects", async () => {
  const cause = new Error("Injected D1 failure");
  const statement: D1PreparedStatement = {
    bind: () => statement,
    first: async () => Promise.reject(cause),
    all: async () => Promise.reject(cause),
    run: async () => Promise.reject(cause),
    raw: async () => Promise.reject(cause),
  };
  const layer = registryLayer({
    prepare: () => statement,
    batch: async () => Promise.reject(cause),
  });
  const effect = Effect.gen(function* () {
    const registry = yield* Registry;
    return yield* registry.listSystems();
  }).pipe(Effect.provide(layer));
  await expect(runReply(effect, Effect.runPromiseExit)).resolves.toMatchObject({
    ok: false,
    error: { _tag: "CorpusUnavailable" },
  });
});
