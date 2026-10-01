import * as Context from "effect/Context";
import type { MemberRole, ServerFrame } from "../domain/schemas";

/**
 * Who is calling a WorldDO RPC method — resolved and authorised as a member by
 * the HTTP edge (D1), passed as an argument rather than in headers.
 */
export type Caller = {
  readonly memberId: string;
  readonly role: MemberRole;
  readonly displayName: string;
};

/** The world DO's SQLite storage. Writes stay synchronous inside `transactionSync`. */
export class WorldStorage extends Context.Service<
  WorldStorage,
  {
    readonly sql: SqlStorage;
    readonly transactionSync: <T>(closure: () => T) => T;
    readonly storage: DurableObjectStorage;
  }
>()("ttrpg/WorldStorage") {}

/** The world's R2 bucket (notes, uploads, compendium backups). */
export class WorldBucket extends Context.Service<WorldBucket, R2Bucket>()("ttrpg/WorldBucket") {}

/** Sends a frame to every connected socket (filtered per member by the caller). */
export class Broadcast extends Context.Service<Broadcast, (frame: ServerFrame) => void>()(
  "ttrpg/Broadcast",
) {}

/** The world this Durable Object holds. */
export class WorldId extends Context.Service<WorldId, string>()("ttrpg/WorldId") {}
