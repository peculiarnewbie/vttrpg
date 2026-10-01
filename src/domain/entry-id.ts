import * as Schema from "effect/Schema";

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

// As loose as type ids (compendium-rules.ts), so every existing type can own entries.
const validPart = (part: string) => part.length <= SLUG_MAX && /^[a-z0-9][a-z0-9_-]*$/.test(part);

/** `source/type/slug`. Throws if a part isn't a valid slug (a programming error). */
export const entryId = (source: string, typeId: string, slug: string): string => {
  if (![source, typeId, slug].every(validPart)) throw new Error("Invalid entry id parts");
  return `${source}/${typeId}/${slug}`;
};

/** The parts of a valid entry id, else `undefined` (old `ent_…` ids included). */
export const parseEntryId = (id: string): EntryIdParts | undefined => {
  const parts = id.split("/");
  if (parts.length !== 3 || !parts.every(validPart)) return undefined;
  const [source, typeId, slug] = parts;
  return { source, typeId, slug };
};

export const isEntryId = (id: string): boolean => parseEntryId(id) !== undefined;

/**
 * A slug from a name: accents dropped (NFD), lowercased, every run of other
 * characters becomes one hyphen, trimmed of hyphens, cut to {@link SLUG_MAX}
 * without leaving a trailing hyphen. Names with nothing usable ("???", "竜")
 * give "entry".
 */
export const slugify = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "") || "entry";

/** `base`, else `base-2`, `base-3`… — the first that isn't `taken` (still within SLUG_MAX). */
export const uniqueSlug = (base: string, taken: (slug: string) => boolean): string => {
  if (!taken(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = base.slice(0, SLUG_MAX - suffix.length).replace(/[-_]+$/g, "") + suffix;
    if (!taken(candidate)) return candidate;
  }
};

/** The source of a library entry; world and legacy ids have no library source. */
export const librarySource = (id: string): string | undefined => {
  const source = parseEntryId(id)?.source;
  return source === WORLD_SOURCE ? undefined : source;
};

/** Reuse the entry-id part rule at library management boundaries. */
export const LibrarySourceId = Schema.String.check(
  Schema.makeFilter((source) => validPart(source) && source !== WORLD_SOURCE),
);
