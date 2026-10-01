import * as Schema from "effect/Schema";
import { CompendiumEntry, EntryVisibility, compendiumLimits } from "./compendium";
import {
  FieldKey,
  NonEmptyTrimmed,
  Revision,
  isFieldKey,
  isFiniteJson,
  maxJsonBytes,
  jsonBytes,
} from "./constraints";
import { isEntryId } from "./entry-id";
import { Licence, mergeLicence } from "./licence";

const hasBoundedFields = (fields: object): boolean =>
  Object.keys(fields).length <= compendiumLimits.fieldsPerType;

/** Replacement values only; identity and source rights cannot be patched. */
export const EntryPatch = Schema.Struct({
  name: Schema.optional(NonEmptyTrimmed(compendiumLimits.name)),
  tags: Schema.optional(
    Schema.Array(NonEmptyTrimmed(40)).check(
      Schema.isMaxLength(compendiumLimits.tags),
      Schema.isUnique(),
    ),
  ),
  body: Schema.optional(Schema.String.check(Schema.isMaxLength(compendiumLimits.body))),
  fields: Schema.optional(
    Schema.Record(Schema.String, CompendiumEntry.fields.fields.value).check(
      isFiniteJson,
      Schema.makeFilter((fields) => Object.keys(fields).every(isFieldKey), {
        message: "Field keys must be lowercase slugs of 1–40 characters",
      }),
      Schema.makeFilter(hasBoundedFields, {
        message: "An override may change at most 40 fields",
      }),
    ),
  ),
  removeFields: Schema.optional(
    Schema.Array(FieldKey).check(
      Schema.isMaxLength(compendiumLimits.fieldsPerType),
      Schema.isUnique(),
    ),
  ),
  visibility: Schema.optional(EntryVisibility),
})
  .check(
    Schema.makeFilter((patch) =>
      (patch.removeFields ?? []).some((key) => Object.hasOwn(patch.fields ?? {}, key))
        ? "Cannot replace and remove the same field"
        : undefined,
    ),
    maxJsonBytes(compendiumLimits.entryBytes, "Override JSON must be at most 16 KB"),
  )
  .annotate({ parseOptions: { onExcessProperty: "error" } });
export type EntryPatch = typeof EntryPatch.Type;

export const EntryOverride = Schema.Struct({
  entryId: Schema.String.check(
    Schema.makeFilter(isEntryId, { message: "Invalid override entry id" }),
  ),
  baseRev: Revision,
  patch: EntryPatch,
  licence: Licence,
  updatedAt: Schema.String,
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type EntryOverride = typeof EntryOverride.Type;

export const SaveOverrideInput = Schema.Struct({ baseRev: Revision, patch: EntryPatch });
export type SaveOverrideInput = typeof SaveOverrideInput.Type;

/** Bounds apply before accepting replacement values; type-specific checks stay with the caller. */
export const overrideError = (patch: EntryPatch): string | undefined => {
  const result = Schema.decodeUnknownResult(EntryPatch)(patch);
  return result._tag === "Failure" ? result.failure.message : undefined;
};

/** Resolve on read. A changed base revision offers an update; it never discards the authored patch. */
export const applyOverride = (entry: CompendiumEntry, override: EntryOverride): CompendiumEntry => {
  // Identity relates two independently validated values.
  if (override.entryId !== entry.id) throw new Error("Override entry identity does not match");
  const resolved = structuredClone(entry);
  const patch = structuredClone(override.patch);
  const fields = { ...resolved.fields, ...patch.fields };
  for (const key of patch.removeFields ?? []) delete fields[key];
  const result: CompendiumEntry = {
    ...resolved,
    name: patch.name ?? resolved.name,
    tags: patch.tags ?? resolved.tags,
    body: patch.body ?? resolved.body,
    fields,
    visibility: entry.visibility === "dm" ? "dm" : (patch.visibility ?? entry.visibility),
    licence: mergeLicence(entry.licence ?? override.licence, override.licence),
  };
  // Merging independently bounded inputs can exceed the field and byte limits.
  if (!hasBoundedFields(fields)) throw new Error("An override may change at most 40 fields");
  if (jsonBytes(result).byteLength > compendiumLimits.entryBytes)
    throw new Error("Overridden entry JSON must be at most 16 KB");
  return result;
};
