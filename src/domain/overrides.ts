import * as Schema from "effect/Schema";
import { CompendiumEntry, EntryVisibility, compendiumLimits } from "./compendium";
import { Licence, inheritLicence } from "./licence";

/** Replacement values only; identity and source rights cannot be patched. */
export const EntryPatch = Schema.Struct({
  name: Schema.optional(CompendiumEntry.fields.name),
  tags: Schema.optional(CompendiumEntry.fields.tags),
  body: Schema.optional(CompendiumEntry.fields.body),
  fields: Schema.optional(CompendiumEntry.fields.fields),
  removeFields: Schema.optional(Schema.Array(Schema.String)),
  visibility: Schema.optional(EntryVisibility),
});
export type EntryPatch = typeof EntryPatch.Type;

export const EntryOverride = Schema.Struct({
  entryId: Schema.String,
  baseRev: Schema.Int,
  patch: EntryPatch,
  licence: Licence,
  updatedAt: Schema.String,
});
export type EntryOverride = typeof EntryOverride.Type;

export const SaveOverrideInput = Schema.Struct({ baseRev: Schema.Int, patch: EntryPatch });
export type SaveOverrideInput = typeof SaveOverrideInput.Type;

const finiteValues = (value: unknown): boolean => {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteValues);
  if (typeof value === "object" && value !== null) return Object.values(value).every(finiteValues);
  return true;
};

/** Bounds apply before accepting replacement values; type-specific checks stay with the caller. */
export const overrideError = (patch: EntryPatch): string | undefined => {
  const result = Schema.decodeUnknownResult(EntryPatch, { onExcessProperty: "error" })(patch);
  if (result._tag === "Failure") return "Invalid override patch";
  if (!finiteValues(patch.fields)) return "Override numbers must be finite";
  if (patch.name !== undefined && (!patch.name.trim() || patch.name.length > compendiumLimits.name))
    return "Entry name must be 1–120 characters";
  if (
    patch.tags !== undefined &&
    (patch.tags.length > compendiumLimits.tags ||
      patch.tags.some((tag) => !tag.trim() || tag.length > 40) ||
      new Set(patch.tags).size !== patch.tags.length)
  )
    return "Entries may have at most 20 unique tags of 1–40 characters";
  if (patch.body !== undefined && patch.body.length > compendiumLimits.body)
    return "Entry body must be at most 12000 characters";
  const fields = Object.keys(patch.fields ?? {});
  const removed = patch.removeFields ?? [];
  if (
    fields.length > compendiumLimits.fieldsPerType ||
    removed.length > compendiumLimits.fieldsPerType
  )
    return "An override may change at most 40 fields";
  if ([...fields, ...removed].some((key) => !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(key)))
    return "Field keys must be lowercase slugs of 1–40 characters";
  if (new Set(removed).size !== removed.length) return "Removed field keys must be unique";
  if (removed.some((key) => fields.includes(key)))
    return "Cannot replace and remove the same field";
  if (new TextEncoder().encode(JSON.stringify(patch)).byteLength > compendiumLimits.entryBytes)
    return "Override JSON must be at most 16 KB";
  return undefined;
};

/** Resolve on read. A changed base revision offers an update; it never discards the authored patch. */
export const applyOverride = (entry: CompendiumEntry, override: EntryOverride): CompendiumEntry => {
  Schema.decodeUnknownSync(CompendiumEntry)(entry);
  Schema.decodeUnknownSync(EntryOverride, { onExcessProperty: "error" })(override);
  if (override.entryId !== entry.id) throw new Error("Override entry identity does not match");
  if (!Number.isSafeInteger(override.baseRev) || override.baseRev < 1)
    throw new Error("Invalid override base revision");
  const error = overrideError(override.patch);
  if (error) throw new Error(error);
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
    licence: inheritLicence(entry.licence ?? override.licence, override.licence),
  };
  const resolvedError = overrideError({
    name: result.name,
    tags: result.tags,
    body: result.body,
    fields,
  });
  if (resolvedError) throw new Error(resolvedError);
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > compendiumLimits.entryBytes)
    throw new Error("Overridden entry JSON must be at most 16 KB");
  return result;
};
