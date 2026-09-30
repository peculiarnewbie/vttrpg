import * as Schema from "effect/Schema";
import {
  compendiumLimits,
  type CompendiumEntry,
  type EntryType,
  type SaveEntryInput,
} from "../../../src/domain/compendium";
import { typeError, entryError } from "../../../src/domain/compendium-rules";
import { parseEntryId } from "../../../src/domain/entry-id";
import type { SystemInput, SourceInput } from "../../../src/domain/corpus-rpc";
import { licenceError, type Licence } from "../../../src/domain/licence";
import { layoutLimitsError } from "../../../src/domain/template-io";

export const safeId = (id: string): void => {
  if (!/^[a-z0-9][a-z0-9_-]{0,59}$/.test(id) || id === "world")
    throw new Error("Invalid corpus id: use a lowercase slug; world is reserved");
};

export const decodeCall = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  value: unknown,
): S["Type"] => {
  const decoded = Schema.decodeUnknownSync(schema)(value);
  const call = decoded as { accountId?: string; sourceId?: string };
  if (!call.accountId?.trim()) throw new Error("An authenticated account is required");
  if (call.sourceId !== undefined) safeId(call.sourceId);
  return decoded;
};

export const validateSystem = (system: SystemInput): void => {
  safeId(system.id);
  if (!system.name.trim() || system.name.length > 120) throw new Error("Invalid system name");
  if (system.entryTypes.length > compendiumLimits.types) throw new Error("Too many entry types");
  if (new Set(system.entryTypes.map((type) => type.id)).size !== system.entryTypes.length)
    throw new Error("Entry type ids must be unique");
  for (const type of system.entryTypes) {
    const error = typeError(type, system.entryTypes);
    if (error) throw new Error(error);
  }
  for (const layout of system.layouts ?? []) {
    const error = layoutLimitsError(layout);
    if (error) throw new Error(error);
  }
  if (new TextEncoder().encode(JSON.stringify(system)).byteLength > compendiumLimits.packBytes)
    throw new Error("System metadata exceeds 4 MB");
};

export const validateSource = (source: SourceInput): void => {
  safeId(source.id);
  safeId(source.systemId);
  if (!source.name.trim() || source.name.length > 120) throw new Error("Invalid source name");
  const error = licenceError(source.licence);
  if (error) throw new Error(error);
};

export const validateSourceEntry = (
  sourceId: string,
  input: SaveEntryInput,
  type: EntryType,
): void => {
  if (input.id !== undefined) {
    const parts = parseEntryId(input.id);
    if (!parts || parts.source !== sourceId || parts.typeId !== input.typeId)
      throw new Error("Entry id must belong to this source and type");
  }
  // Existing world validation owns field/value rules; source identity is checked above.
  const { id: _id, ...values } = input;
  const error = entryError(values, type);
  if (error) throw new Error(error);
};

export const validateBatch = (items: readonly unknown[]): void => {
  if (items.length > compendiumLimits.bodiesPerRequest)
    throw new Error("Batch exceeds 100 entries");
  if (new TextEncoder().encode(JSON.stringify(items)).byteLength > compendiumLimits.packBytes)
    throw new Error("Batch exceeds 4 MB");
};

/** Reserve the full published shape so later version/revision growth stays within 16 KB. */
export const validatePublishedEntrySize = (entry: CompendiumEntry, licence: Licence): void => {
  const published = {
    ...entry,
    rev: Number.MAX_SAFE_INTEGER,
    licence,
    sourceVersion: 2147483647,
    sourceRev: Number.MAX_SAFE_INTEGER,
  };
  if (new TextEncoder().encode(JSON.stringify(published)).byteLength > compendiumLimits.entryBytes)
    throw new Error("Published entry JSON must be at most 16 KB including licence and provenance");
};
