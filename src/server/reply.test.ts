import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { fromReply, toReply } from "./reply";
import { Conflict, Unavailable } from "./services";

it.each([
  new Conflict({ message: "World revision changed" }),
  new Unavailable({ message: "World storage unavailable" }),
])("restores a serialized $_tag RPC failure as its tagged class", async (error) => {
  const reply = await toReply(Effect.fail(error), Effect.runPromiseExit);
  // RPC preserves JSON data, not the error's prototype.
  const transported = JSON.parse(JSON.stringify(reply));
  const restored = await Effect.runPromise(fromReply(async () => transported).pipe(Effect.flip));
  expect(restored).toBeInstanceOf(error.constructor);
  expect(restored.message).toBe(error.message);
});

it("turns a rejected RPC transport into Unavailable", async () => {
  const failure = await Effect.runPromise(
    fromReply(() => Promise.reject(new Error("Disconnected"))).pipe(Effect.flip),
  );
  expect(failure).toBeInstanceOf(Unavailable);
  expect(failure.message).toBe("World service unavailable");
});
