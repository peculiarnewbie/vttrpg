import type { CompendiumEntry, EntryType } from "./compendium";
import type { IndexRow } from "./compendium-index";

/*
 * Facets: the values of an entry type's `filters`, copied into index rows so
 * pickers and the compendium page filter without loading entries.
 */

export type Facets = NonNullable<IndexRow["facets"]>;

/**
 * An entry's facet values, by filter key. `range`: a finite number (numeric
 * strings count). `set`: a string (select) or strings (set/tags), trimmed,
 * empty ones dropped. `flag`: whether the field is filled (true/false, always
 * present). Filters naming unknown fields, and empty values, are skipped.
 * Returns `undefined` when the type has no filters.
 */
export const entryFacets = (
  _entry: Pick<CompendiumEntry, "fields" | "tags">,
  _type: EntryType,
): Facets | undefined => {
  throw new Error("not implemented");
};
