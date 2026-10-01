import { Effect, Schema } from "effect";
import {
  compendiumLimits,
  type CompendiumEntry,
  type EntryType,
  type SaveEntryInput,
} from "../../../src/domain/compendium";
import { typeError, entryError } from "../../../src/domain/compendium-rules";
import { parseEntryId, WORLD_SOURCE } from "../../../src/domain/entry-id";
import type { CorpusCall, SystemInput, SourceInput } from "../../../src/domain/corpus-rpc";
import { CorpusInvalid } from "../../../src/domain/corpus-errors";
import { licenceError, type Licence } from "../../../src/domain/licence";
import { snapshotLimits } from "../../../src/domain/snapshot";
import { layoutLimitsError } from "../../../src/domain/template-io";

const invalid = (message: string) => Effect.fail(new CorpusInvalid({ message }));
const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

export const safeId = (id: string) =>
  id !== WORLD_SOURCE && parseEntryId(`${id}/entry/entry`)
    ? Effect.void
    : invalid("Invalid corpus id: use a lowercase slug; world is reserved");

export const decodeCall = <
  S extends Schema.Top & { readonly Type: CorpusCall; readonly DecodingServices: never },
>(
  schema: S,
  value: unknown,
) =>
  Effect.gen(function* () {
    const call = yield* Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError((cause) => new CorpusInvalid({ message: cause.message })),
    );
    if (!call.accountId.trim()) return yield* invalid("An authenticated account is required");
    if ("sourceId" in call && typeof call.sourceId === "string") yield* safeId(call.sourceId);
    return call;
  });

export const validateSystem = Effect.fn("Corpus.validateSystem")(function* (system: SystemInput) {
  yield* safeId(system.id);
  if (!system.name.trim() || system.name.length > compendiumLimits.name)
    return yield* invalid("Invalid system name");
  if (system.entryTypes.length > compendiumLimits.types)
    return yield* invalid("Too many entry types");
  if (new Set(system.entryTypes.map((type) => type.id)).size !== system.entryTypes.length)
    return yield* invalid("Entry type ids must be unique");
  for (const type of system.entryTypes) {
    const error = typeError(type, system.entryTypes);
    if (error) return yield* invalid(error);
  }
  for (const layout of system.layouts ?? []) {
    const error = layoutLimitsError(layout);
    if (error) return yield* invalid(error);
  }
  if (jsonBytes(system) > compendiumLimits.packBytes)
    return yield* invalid("System metadata exceeds 4 MB");
});

export const validateSource = Effect.fn("Corpus.validateSource")(function* (source: SourceInput) {
  yield* safeId(source.id);
  yield* safeId(source.systemId);
  if (!source.name.trim() || source.name.length > compendiumLimits.name)
    return yield* invalid("Invalid source name");
  const error = licenceError(source.licence);
  if (error) return yield* invalid(error);
});

export const validateSourceEntry = Effect.fn("Corpus.validateSourceEntry")(function* (
  sourceId: string,
  input: SaveEntryInput,
  type: EntryType,
) {
  if (input.id !== undefined) {
    const parts = parseEntryId(input.id);
    if (!parts || parts.source !== sourceId || parts.typeId !== input.typeId)
      return yield* invalid("Entry id must belong to this source and type");
  }
  const { id: _id, ...values } = input;
  const error = entryError(values, type);
  if (error) return yield* invalid(error);
});

export const validateBatch = (items: readonly unknown[]) =>
  items.length > compendiumLimits.bodiesPerRequest
    ? invalid("Batch exceeds 100 entries")
    : jsonBytes(items) > compendiumLimits.packBytes
      ? invalid("Batch exceeds 4 MB")
      : Effect.void;

/** Reserve the full published shape so version/revision growth stays within 16 KB. */
export const validatePublishedEntrySize = (entry: CompendiumEntry, licence: Licence) => {
  const published = {
    ...entry,
    rev: Number.MAX_SAFE_INTEGER,
    licence,
    sourceVersion: snapshotLimits.version,
    sourceRev: Number.MAX_SAFE_INTEGER,
  };
  return jsonBytes(published) > compendiumLimits.entryBytes
    ? invalid("Published entry JSON must be at most 16 KB including licence and provenance")
    : Effect.void;
};
