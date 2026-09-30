import * as Schema from "effect/Schema";
import { CompendiumEntry, EntryVisibility } from "./compendium";
import { Licence } from "./licence";

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
