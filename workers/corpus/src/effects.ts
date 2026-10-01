import { Cause, Effect, Exit, Option, Schema } from "effect";
import {
  CorpusError,
  CorpusUnavailable,
  type CorpusReply,
} from "../../../src/domain/corpus-errors";

export const unavailable = (cause: unknown, message: string) =>
  Effect.logError(cause).pipe(Effect.andThen(Effect.fail(new CorpusUnavailable({ message }))));

export const bindingCall = <A>(message: string, call: () => Promise<A>) =>
  Effect.tryPromise({ try: call, catch: (cause) => cause }).pipe(
    Effect.catch((cause) => unavailable(cause, message)),
  );

export const storageCall = <A>(message: string, call: () => A) =>
  Effect.try({ try: call, catch: (cause) => cause }).pipe(
    Effect.catch((cause) => unavailable(cause, message)),
  );

export const readStored = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  value: unknown,
) =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.catch((cause) => unavailable(cause, "Stored corpus content did not verify")),
  );

/** Both RPC edges run once and encode the same tagged failures. */
export const runReply = async <A, R>(
  effect: Effect.Effect<A, CorpusError, R>,
  runExit: (effect: Effect.Effect<A, CorpusError, R>) => Promise<Exit.Exit<A, CorpusError>>,
): Promise<CorpusReply<A>> => {
  const exit = await runExit(
    effect.pipe(
      Effect.catchCause((cause) => {
        const error = Cause.findErrorOption(cause);
        return Option.isSome(error) && !Cause.hasDies(cause)
          ? Effect.fail(error.value)
          : unavailable(cause, "Corpus service unavailable");
      }),
    ),
  );
  if (Exit.isSuccess(exit)) return { ok: true, value: exit.value };
  const error = Cause.findErrorOption(exit.cause);
  return {
    ok: false,
    error: Schema.encodeSync(CorpusError)(
      Option.isSome(error)
        ? error.value
        : new CorpusUnavailable({ message: "Corpus service unavailable" }),
    ),
  };
};

export const fromReply = <A>(reply: CorpusReply<A>) =>
  reply.ok
    ? Effect.succeed(reply.value)
    : readStored(CorpusError, reply.error).pipe(Effect.flatMap(Effect.fail));
