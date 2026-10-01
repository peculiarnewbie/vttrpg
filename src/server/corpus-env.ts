import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import {
  CorpusError,
  CorpusNotFound,
  CorpusForbidden,
  CorpusInvalid,
  CorpusConflict,
  CorpusUnavailable,
  type CorpusReply,
} from "../domain/corpus-errors";
import { CORPUS_API_VERSION, type CorpusApi, type CorpusCall } from "../domain/corpus-rpc";
import type { CorpusEntrypoint } from "../../workers/corpus/src/entrypoint";
import { featureFlags } from "../domain/flags";

/** Optional until the independently deployed corpus is bound to the table. */
export type CorpusBindings = {
  CORPUS?: Service<CorpusEntrypoint>;
  CORPUS_BUCKET?: R2Bucket;
  FLAGS?: string;
};

export const corpusEnabled = (env: CorpusBindings): boolean =>
  featureFlags(env.FLAGS).corpus && !!env.CORPUS && !!env.CORPUS_BUCKET;

/** The `/api/corpus` management routes; see `corpus-admin` in domain/flags. */
export const corpusAdminEnabled = (env: CorpusBindings): boolean =>
  corpusEnabled(env) && featureFlags(env.FLAGS).corpusAdmin;

/** All table callers use the same RPC envelope and transport mapping. */
export class CorpusClient extends Context.Service<
  CorpusClient,
  {
    readonly available: boolean;
    readonly call: <T>(
      action: (api: CorpusApi, context: CorpusCall) => Promise<CorpusReply<T>>,
      accountId: string,
    ) => Effect.Effect<T, CorpusError>;
  }
>()("ttrpg/CorpusClient") {}

export const corpusClient = (binding?: CorpusApi | null): typeof CorpusClient.Service => ({
  available: !!binding,
  call: (action, accountId) =>
    Effect.gen(function* () {
      if (!binding || !accountId)
        return yield* Effect.fail(new CorpusUnavailable({ message: "Libraries are unavailable" }));
      const reply = yield* corpusIO(() =>
        action(binding, { apiVersion: CORPUS_API_VERSION, accountId }),
      );
      if (reply.ok) return reply.value;
      const error = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(CorpusError)(reply.error),
        catch: () => new CorpusUnavailable({ message: "Invalid corpus reply" }),
      }).pipe(Effect.tapError(Effect.logError));
      return yield* Effect.fail(error);
    }),
});

export const corpusIO = <T>(operation: () => Promise<T>): Effect.Effect<T, CorpusUnavailable> =>
  Effect.tryPromise({ try: operation, catch: (error) => error }).pipe(
    Effect.catch((error) =>
      Effect.logError(error).pipe(
        Effect.andThen(
          Effect.fail(
            new CorpusUnavailable({ message: "Library operation is temporarily unavailable" }),
          ),
        ),
      ),
    ),
  );

export const corpusStatus = (error: CorpusError): number => {
  switch (error._tag) {
    case "CorpusNotFound":
      return 404;
    case "CorpusForbidden":
      return 403;
    case "CorpusInvalid":
      return 400;
    case "CorpusConflict":
      return 409;
    case "CorpusUnavailable":
      return 503;
  }
};

/** Translate failures only at a table transport edge; defects are logged before hiding them. */
export const corpusEdge = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  failure: (error: CorpusError) => A,
): Effect.Effect<A, never, R> =>
  effect.pipe(
    Effect.catchCause((cause) => {
      const error = Cause.squash(cause);
      if (
        error instanceof CorpusNotFound ||
        error instanceof CorpusForbidden ||
        error instanceof CorpusInvalid ||
        error instanceof CorpusConflict ||
        error instanceof CorpusUnavailable
      )
        return error instanceof CorpusUnavailable
          ? Effect.logError(error).pipe(Effect.as(failure(error)))
          : Effect.succeed(failure(error));
      return Effect.logError(cause).pipe(
        Effect.as(
          failure(
            new CorpusUnavailable({ message: "Library operation is temporarily unavailable" }),
          ),
        ),
      );
    }),
  );
