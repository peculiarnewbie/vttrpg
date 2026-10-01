import { Effect, Schema } from "effect";
import { expect, it } from "vitest";
import {
  CorpusConflict,
  CorpusError,
  CorpusForbidden,
  CorpusInvalid,
  CorpusNotFound,
  CorpusUnavailable,
} from "../../../src/domain/corpus-errors";
import { fromReply, runReply } from "./effects";

it("round trips every tagged failure through both RPC edges", async () => {
  const errors = [
    new CorpusNotFound({ message: "Missing" }),
    new CorpusForbidden({ message: "Owner required" }),
    new CorpusInvalid({ message: "Invalid input" }),
    new CorpusConflict({ message: "Id taken" }),
    new CorpusUnavailable({ message: "Unavailable" }),
  ];
  for (const error of errors) {
    const wire = await runReply(Effect.fail(error), Effect.runPromiseExit);
    expect(wire).toEqual({ ok: false, error: Schema.encodeSync(CorpusError)(error) });
    const decoded = await Effect.runPromise(Effect.flip(fromReply(wire)));
    expect(decoded).toBeInstanceOf(error.constructor);
    expect(decoded._tag).toBe(error._tag);
  }
});

it("turns an unexpected defect into an unavailable reply", async () => {
  await expect(
    runReply(Effect.die(new Error("Unexpected fault")), Effect.runPromiseExit),
  ).resolves.toMatchObject({ ok: false, error: { _tag: "CorpusUnavailable" } });
});
