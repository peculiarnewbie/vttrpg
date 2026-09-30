/*
 * Entry ids: `<source>/<type>/<slug>`, e.g. `world/knight/the-rust-knight` or
 * (from phase 4, libraries) `srd52/spell/fireball`. Fixed when the entry is
 * created — renaming changes the name, never the id — so links, sheet picks
 * and copied rows keep pointing at the same entry. Unlike names, ids tell
 * "Shield" the spell from "Shield" the item.
 *
 * Each part is a slug: lowercase ASCII letters and digits in runs joined by
 * single hyphens (or underscores, which type ids already use), at most 60
 * characters. `world` is the source of every entry a world writes itself.
 */

export const WORLD_SOURCE = "world";

export const SLUG_MAX = 60;

export type EntryIdParts = {
  readonly source: string;
  readonly typeId: string;
  readonly slug: string;
};

/** `source/type/slug`. Throws if a part isn't a valid slug (a programming error). */
export const entryId = (_source: string, _typeId: string, _slug: string): string => {
  throw new Error("not implemented");
};

/** The parts of a valid entry id, else `undefined` (old `ent_…` ids included). */
export const parseEntryId = (_id: string): EntryIdParts | undefined => {
  throw new Error("not implemented");
};

export const isEntryId = (id: string): boolean => parseEntryId(id) !== undefined;

/**
 * A slug from a name: accents dropped (NFD), lowercased, every run of other
 * characters becomes one hyphen, trimmed of hyphens, cut to {@link SLUG_MAX}
 * without leaving a trailing hyphen. Names with nothing usable ("???", "竜")
 * give "entry".
 */
export const slugify = (_name: string): string => {
  throw new Error("not implemented");
};

/** `base`, else `base-2`, `base-3`… — the first that isn't `taken` (still within SLUG_MAX). */
export const uniqueSlug = (_base: string, _taken: (slug: string) => boolean): string => {
  throw new Error("not implemented");
};
