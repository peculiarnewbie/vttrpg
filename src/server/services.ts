import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { AuthUser } from "../domain/schemas";

export class D1 extends Context.Service<D1, D1Database>()("ttrpg/D1") {}

export class Bucket extends Context.Service<Bucket, R2Bucket>()("ttrpg/Bucket") {}

export class WorldNamespace extends Context.Service<WorldNamespace, DurableObjectNamespace>()(
  "ttrpg/Worlds",
) {}

export class CurrentUser extends Context.Service<CurrentUser, AuthUser | null>()(
  "ttrpg/CurrentUser",
) {}

export class Unauthorized extends Data.TaggedError("Unauthorized")<{ message: string }> {}
export class Forbidden extends Data.TaggedError("Forbidden")<{ message: string }> {}
export class NotFound extends Data.TaggedError("NotFound")<{ message: string }> {}
export class BadRequest extends Data.TaggedError("BadRequest")<{ message: string }> {}

export type ApiError = Unauthorized | Forbidden | NotFound | BadRequest;

export const requireUser = Effect.gen(function* () {
  const user = yield* CurrentUser;
  if (!user) return yield* Effect.fail(new Unauthorized({ message: "Sign in required" }));
  return user;
});
