import { Context, Effect, Layer } from "effect";
import { describe, expect, it } from "vite-plus/test";

class Name extends Context.Service<Name, string>()("Name") {}

const greet = Effect.gen(function* () {
  const name = yield* Name;
  return `Hello, ${name}!`;
});

describe("example", () => {
  it("should greet with a provided name", async () => {
    const result = await Effect.runPromise(greet.pipe(Effect.provideService(Name, "World")));
    expect(result).toBe("Hello, World!");
  });

  it("should use a provided layer", async () => {
    const result = await Effect.runPromise(
      greet.pipe(Effect.provide(Layer.succeed(Name, "Layer"))),
    );
    expect(result).toBe("Hello, Layer!");
  });

  it("should compose effects without dependency", async () => {
    const result = await Effect.runPromise(Effect.succeed("standalone"));
    expect(result).toBe("standalone");
  });
});
