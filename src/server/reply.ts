import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ApiError, Unavailable } from "./services";

/*
 * Class instances don't survive a Durable Object RPC call, so every WorldDO
 * RPC method resolves to a Reply: the DO encodes its typed failure, the caller
 * decodes it back into the same class and fails its Effect with it.
 */

export type Reply<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: typeof ApiError.Encoded };

/** Run once at an RPC edge. Typed failures are encoded; defects are logged and become Unavailable. */
export const toReply = async <A, R>(
  effect: Effect.Effect<A, ApiError, R>,
  run: (effect: Effect.Effect<A, ApiError, R>) => Promise<Exit.Exit<A, ApiError>>,
): Promise<Reply<A>> => {
  const exit = await run(
    effect.pipe(
      Effect.catchCause((cause) => {
        const error = Cause.findErrorOption(cause);
        return Option.isSome(error) && !Cause.hasDies(cause)
          ? Effect.fail(error.value)
          : Effect.logError(cause).pipe(
              Effect.andThen(
                Effect.fail(new Unavailable({ message: "World service unavailable" })),
              ),
            );
      }),
    ),
  );
  if (Exit.isSuccess(exit)) return { ok: true, value: exit.value };
  const error = Cause.findErrorOption(exit.cause);
  return {
    ok: false,
    error: Schema.encodeSync(ApiError)(
      Option.isSome(error)
        ? error.value
        : new Unavailable({ message: "World service unavailable" }),
    ),
  };
};

/** The caller's side: call the stub, decode a failure back into its class. */
export const fromReply = <A>(call: () => Promise<Reply<A>>): Effect.Effect<A, ApiError> =>
  Effect.tryPromise({ try: call, catch: (cause) => cause }).pipe(
    Effect.catch((cause) =>
      Effect.logError(cause).pipe(
        Effect.andThen(Effect.fail(new Unavailable({ message: "World service unavailable" }))),
      ),
    ),
    Effect.flatMap((reply) =>
      reply.ok
        ? Effect.succeed(reply.value)
        : Effect.fail(Schema.decodeUnknownSync(ApiError)(reply.error)),
    ),
  );
