import type { IndexRow } from "../../domain/compendium";
import type { Scope } from "../../domain/derived";
import { formulaHolds } from "../../domain/sheet-refs";
import type { ListRow } from "../../domain/sheet-layout";
import type { PartOf } from "../../domain/builder-parts";

/*
 * Filtering a choose part's options. An option is an index row — id, name,
 * tags and facet values (the entry type's declared `filters`) — so filtering
 * never loads full entries. The formula reads the row first (`@name` the
 * entry's name, `@tags` how many tags it has, any other key the row's facet
 * of that name when the type declares one) and anything else reads the
 * character, so `@level <= 1` and `@level <= @max_level` both work. A facet
 * that's a list of strings (a set field) reads as its length, and a flag
 * facet as 1 or 0, like string arrays and checks do on a sheet; a blank or
 * broken filter offers everything, like a broken step condition still applies
 * (character-builder.tsx).
 */

export type ChooseTags = NonNullable<PartOf<"choose">["tags"]>;
export type ChooseFilter = Pick<PartOf<"choose">, "filter" | "tags">;

const normalizeTag = (tag: string) => tag.trim().toLowerCase();

/** Whether the entry's tags satisfy all/any/none (case-insensitive); no spec offers. */
export const matchesChooseTags = (
  tags: readonly string[],
  spec: ChooseTags | undefined,
): boolean => {
  if (!spec) return true;
  const have = new Set(tags.map(normalizeTag));
  if (spec.all?.some((tag) => !have.has(normalizeTag(tag)))) return false;
  if (spec.any && spec.any.length > 0 && !spec.any.some((tag) => have.has(normalizeTag(tag))))
    return false;
  if (spec.none?.some((tag) => have.has(normalizeTag(tag)))) return false;
  return true;
};

/** A filter's scope for one option: the row's fields first, the character after. */
export const optionScope = (row: IndexRow, character: Scope): Scope => ({
  ...character,
  value: (ref) => {
    if (ref.column !== undefined) return character.value(ref);
    if (ref.key === "name") return row.name;
    if (ref.key === "tags") return row.tags.length;
    const facet =
      row.facets && Object.hasOwn(row.facets, ref.key) ? row.facets[ref.key] : undefined;
    if (facet !== undefined) {
      if (typeof facet === "number" || typeof facet === "string") return facet;
      if (typeof facet === "boolean") return Number(facet);
      return facet.length;
    }
    return character.value(ref);
  },
});

/** Whether the option is offered: tags first, then the filter. */
export const offersOption = (row: IndexRow, part: ChooseFilter, character: Scope): boolean => {
  if (!matchesChooseTags(row.tags, part.tags)) return false;
  return formulaHolds(part.filter, optionScope(row, character));
};

/** The options kept, in order. */
export const offeredOptions = (
  rows: readonly IndexRow[],
  part: ChooseFilter,
  character: Scope,
): IndexRow[] => rows.filter((row) => offersOption(row, part, character));

/** How many times the entry is already on the sheet (list rows remembering it in `_entry`). */
export const addedCount = (rows: readonly ListRow[], id: string): number =>
  rows.filter((row) => row._entry === id).length;

/** The rows left after removing every row copied from this entry. */
export const withoutEntry = (rows: readonly ListRow[], id: string): ListRow[] =>
  rows.filter((row) => row._entry !== id);
