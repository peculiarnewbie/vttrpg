import * as Schema from "effect/Schema";
import { CharacterValue } from "./schemas";
import { ListColumn } from "./sheet-layout";
import { EntryVisibility, IndexRow } from "./compendium-index";
import { Licence } from "./licence";

export { EntryVisibility, IndexRow };

/*
 * The compendium: a world's game content, typed up by its DM (Knights and their
 * abilities, spells, items, monsters). The app ships entry *types* for premade
 * systems, never copyrighted content; groups share their own entries as packs.
 *
 * Types are data like sheet layouts: a name and a list of fields. Entries fill
 * those fields, carry a markdown body, and are either revealed to everyone or
 * DM-only. Sheets link single entries live (`entry` blocks) and copy entries
 * into list rows (lists with a `source`).
 */

/**
 * - `select` one of `options` (a spell's school); `set` any of them (a
 *   monster's senses).
 * - `reference` other entries by id (a class's features, a monster's spells),
 *   of the types in `ref.typeIds`; one id, or several with `ref.multiple`.
 * - `actions` rows of `{name, roll?, text?}` — attacks, moves, abilities; each
 *   roll is clickable wherever the entry shows.
 * - `progression` rows keyed by `level` (a number) plus the field's `columns`
 *   (e.g. `features`, `proficiency`); sheets show the rows up to a level.
 * - `oracle` a rollable table: `dice` notation and rows `{min, max, text}`;
 *   rolling shows the row the dice landed on — the table decides what it means.
 */
export const EntryFieldKind = Schema.Literals([
  "text",
  "longtext",
  "number",
  "dice",
  "tags",
  "list",
  "select",
  "set",
  "reference",
  "actions",
  "progression",
  "oracle",
]);
export type EntryFieldKind = typeof EntryFieldKind.Type;

export const EntryField = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  kind: EntryFieldKind,
  /** Row shape for `list` fields (a Knight's starting Property) and extra `progression` columns. */
  columns: Schema.optional(Schema.Array(ListColumn)),
  /** Choices for `select` and `set`. */
  options: Schema.optional(Schema.Array(Schema.String)),
  /** What a `reference` field may point at. */
  ref: Schema.optional(
    Schema.Struct({
      typeIds: Schema.Array(Schema.String),
      multiple: Schema.optional(Schema.Boolean),
    }),
  ),
  /** Notation an `oracle` field rolls, e.g. `1d100`. */
  dice: Schema.optional(Schema.String),
});
export type EntryField = typeof EntryField.Type;

export const EntryType = Schema.Struct({
  /** Stable id referenced by layouts (`entry.entryType`, `list.source.entryType`), e.g. "knight". */
  id: Schema.String,
  /** Singular, e.g. "Knight". */
  name: Schema.String,
  /** Plural for headings, e.g. "Knights"; defaults to `name`. */
  plural: Schema.optional(Schema.String),
  fields: Schema.Array(EntryField),
  /**
   * Fields people filter this type by (a spell's level and school): they're
   * copied into index rows as `facets`, so pickers and the compendium page can
   * filter without loading entries. `range` for numbers, `set` for
   * select/set/tags, `flag` for a field that's filled or not.
   */
  filters: Schema.optional(
    Schema.Array(
      Schema.Struct({
        key: Schema.String,
        kind: Schema.Literals(["range", "set", "flag"]),
      }),
    ),
  ),
});
export type EntryType = typeof EntryType.Type;

/**
 * `id` is `<source>/<type>/<slug>` (see entry-id.ts), fixed at creation — a
 * rename changes only `name`, so links and copies keep pointing at the entry.
 * World entries use the `world` source; older worlds had `ent_…` ids, which the
 * server migrates once and keeps as aliases.
 */
export const CompendiumEntry = Schema.Struct({
  id: Schema.String,
  typeId: Schema.String,
  name: Schema.String,
  tags: Schema.Array(Schema.String),
  /** Markdown description, rendered like notes. */
  body: Schema.String,
  /** Values by the type's field keys; the same value shapes as character values. */
  fields: Schema.Record(Schema.String, CharacterValue),
  visibility: EntryVisibility,
  updatedAt: Schema.String,
  /** The world's compendium revision when this entry last changed; copies remember it. */
  rev: Schema.optional(Schema.Int),
  /** Source rights and provenance survive world overrides and exports. */
  licence: Schema.optional(Licence),
  sourceVersion: Schema.optional(Schema.Int),
  sourceRev: Schema.optional(Schema.Int),
});
export type CompendiumEntry = typeof CompendiumEntry.Type;

/**
 * GET compendium/index?since=<rev>: what changed for this member after `since`.
 * `full` means "replace everything you have" (since = 0, or older than the
 * server's tombstones). `types` is always the whole list — there are few.
 * An entry a player can no longer see (hidden again, deleted) is in `deletes`.
 */
export const IndexDelta = Schema.Struct({
  rev: Schema.Int,
  full: Schema.Boolean,
  types: Schema.Array(EntryType),
  upserts: Schema.Array(IndexRow),
  deletes: Schema.Array(Schema.String),
});
export type IndexDelta = typeof IndexDelta.Type;

/** POST compendium/bodies: at most `compendiumLimits.bodiesPerRequest` ids. */
export const EntryBodiesInput = Schema.Struct({ ids: Schema.Array(Schema.String) });
export type EntryBodiesInput = typeof EntryBodiesInput.Type;

/**
 * Full entries by id. `missing` lists ids that don't exist or this member
 * can't see (clients remember misses too). `aliases` maps old ids (`ent_…`)
 * that were asked for to the entry's current id.
 */
export const EntryBodies = Schema.Struct({
  entries: Schema.Array(CompendiumEntry),
  missing: Schema.Array(Schema.String),
  aliases: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export type EntryBodies = typeof EntryBodies.Type;

/** Create (no id) or update (id) an entry. DM only. */
export const SaveEntryInput = Schema.Struct({
  id: Schema.optional(Schema.String),
  typeId: Schema.String,
  name: Schema.String,
  tags: Schema.Array(Schema.String),
  body: Schema.String,
  fields: Schema.Record(Schema.String, CharacterValue),
  visibility: EntryVisibility,
});
export type SaveEntryInput = typeof SaveEntryInput.Type;

/** What GET /compendium returns: every type, and the entries this member may see. */
export const Compendium = Schema.Struct({
  types: Schema.Array(EntryType),
  entries: Schema.Array(CompendiumEntry),
});
export type Compendium = typeof Compendium.Type;

/**
 * A pack entry keeps its id so re-importing an updated pack updates in place.
 * Version 2 packs carry `world/<type>/<slug>` ids; version 1 packs carry
 * `ent_…` ids, which import as new slug ids remembered as aliases.
 */
export const PackEntry = Schema.Struct({
  id: Schema.String,
  typeId: Schema.String,
  name: Schema.String,
  tags: Schema.Array(Schema.String),
  body: Schema.String,
  fields: Schema.Record(Schema.String, CharacterValue),
  visibility: EntryVisibility,
  licence: Schema.optional(Licence),
});
export type PackEntry = typeof PackEntry.Type;

/** A shareable file of types and entries (`*.ttrpg-pack.json`). */
export const CompendiumPack = Schema.Struct({
  format: Schema.Literal("ttrpg-pack"),
  version: Schema.Literals([1, 2]),
  name: Schema.String,
  types: Schema.Array(EntryType),
  entries: Schema.Array(PackEntry),
});
export type CompendiumPack = typeof CompendiumPack.Type;

export const ImportPackResult = Schema.Struct({
  types: Schema.Number,
  created: Schema.Number,
  updated: Schema.Number,
});
export type ImportPackResult = typeof ImportPackResult.Type;

/** Enforced by the server and checked by the client before sending. */
export const compendiumLimits = {
  types: 50,
  fieldsPerType: 40,
  entries: 10_000,
  bodiesPerRequest: 100,
  /** Search results per query. */
  searchResults: 50,
  /** JSON size of one entry. */
  entryBytes: 16 * 1024,
  body: 12_000,
  tags: 20,
  name: 120,
  /** Raw JSON size of an imported pack. */
  packBytes: 4 * 1024 * 1024,
} as const;
