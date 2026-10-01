import * as Schema from "effect/Schema";

/*
 * Why a corpus call failed, as values. Class instances don't survive a service
 * binding, so every CorpusApi method resolves to a CorpusReply: the corpus
 * encodes its error, the table decodes it back into the same tagged class and
 * fails its Effect with it. HTTP status and wording are decided once, at the
 * table's edge, from the tag — never from the message.
 */

/** The source, system, version or entry doesn't exist (or isn't visible to this account). */
export class CorpusNotFound extends Schema.TaggedError<CorpusNotFound>()("CorpusNotFound", {
  message: Schema.String,
}) {}
/** The account may not do this (not the owner). */
export class CorpusForbidden extends Schema.TaggedError<CorpusForbidden>()("CorpusForbidden", {
  message: Schema.String,
}) {}
/** The input broke a rule (schema, limit, identity). The message is safe to show. */
export class CorpusInvalid extends Schema.TaggedError<CorpusInvalid>()("CorpusInvalid", {
  message: Schema.String,
}) {}
/** The input is valid but clashes with current state (id taken, type changed, stale revision). */
export class CorpusConflict extends Schema.TaggedError<CorpusConflict>()("CorpusConflict", {
  message: Schema.String,
}) {}
/** Storage or the binding failed, or stored content didn't verify. Logged where it happens. */
export class CorpusUnavailable extends Schema.TaggedError<CorpusUnavailable>()(
  "CorpusUnavailable",
  { message: Schema.String },
) {}

export const CorpusError = Schema.Union([
  CorpusNotFound,
  CorpusForbidden,
  CorpusInvalid,
  CorpusConflict,
  CorpusUnavailable,
]);
export type CorpusError = typeof CorpusError.Type;

/** What every CorpusApi method resolves to; `error` is `CorpusError`'s encoded form. */
export type CorpusReply<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: typeof CorpusError.Encoded };
