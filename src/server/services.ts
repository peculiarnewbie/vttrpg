import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { AuthUser } from "../domain/schemas";
import type { CorpusApi } from "../domain/corpus-rpc";

export class D1 extends Context.Service<D1, D1Database>()("ttrpg/D1") {}

export class Bucket extends Context.Service<Bucket, R2Bucket>()("ttrpg/Bucket") {}

export class WorldNamespace extends Context.Service<WorldNamespace, DurableObjectNamespace>()(
  "ttrpg/Worlds",
) {}

export class CurrentUser extends Context.Service<CurrentUser, AuthUser | null>()(
  "ttrpg/CurrentUser",
) {}

/** The corpus for management routes; null unless `corpus-admin` is on. */
export class CorpusBinding extends Context.Service<CorpusBinding, CorpusApi | null>()(
  "ttrpg/Corpus",
) {}

export class Features extends Context.Service<Features, { corpus: boolean }>()("ttrpg/Features") {}

/*
 * Why a request failed, as values. Schema-backed so they cross the world
 * Durable Object's RPC boundary (see reply.ts); the HTTP edge maps each tag to
 * a status in one place.
 */
const message = { message: Schema.String };
export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", message) {}
export class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", message) {}
export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", message) {}
export class BadRequest extends Schema.TaggedError<BadRequest>()("BadRequest", message) {}
/** Valid, but clashes with current state (stale revision, id taken, type in use). */
export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", message) {}
/** Storage, a binding or another Worker failed. Logged where it happens. */
export class Unavailable extends Schema.TaggedError<Unavailable>()("Unavailable", message) {}

export const ApiError = Schema.Union([
  Unauthorized,
  Forbidden,
  NotFound,
  BadRequest,
  Conflict,
  Unavailable,
]);
export type ApiError = typeof ApiError.Type;

export const requireUser = Effect.gen(function* () {
  const user = yield* CurrentUser;
  if (!user) return yield* Effect.fail(new Unauthorized({ message: "Sign in required" }));
  return user;
});
