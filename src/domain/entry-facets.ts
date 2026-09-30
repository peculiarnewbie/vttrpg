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
  entry: Pick<CompendiumEntry, "fields" | "tags">,
  type: EntryType,
): Facets | undefined => {
  if (!type.filters?.length) return undefined;
  const facets: Record<string, Facets[string]> = {};
  for (const filter of type.filters) {
    const field = type.fields.find((candidate) => candidate.key === filter.key);
    if (!field) continue;
    const value = entry.fields[field.key];
    switch (filter.kind) {
      case "range": {
        if (field.kind !== "number") break;
        const number = typeof value === "string" && value.trim() ? Number(value) : value;
        if (typeof number === "number" && Number.isFinite(number)) facets[filter.key] = number;
        break;
      }
      case "set": {
        if (field.kind === "select" && typeof value === "string" && value.trim())
          facets[filter.key] = value.trim();
        else if ((field.kind === "set" || field.kind === "tags") && Array.isArray(value)) {
          const strings = value.flatMap((item) =>
            typeof item === "string" && item.trim() ? [item.trim()] : [],
          );
          if (strings.length) facets[filter.key] = strings;
        }
        break;
      }
      case "flag":
        facets[filter.key] =
          value !== undefined &&
          value !== false &&
          !(typeof value === "string" && !value.trim()) &&
          !(
            Array.isArray(value) && value.every((item) => typeof item === "string" && !item.trim())
          );
        break;
    }
  }
  return facets;
};
