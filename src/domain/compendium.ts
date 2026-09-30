import * as Schema from "effect/Schema";
import { CharacterValue } from "./schemas";
import { ListColumn } from "./sheet-layout";

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

export const EntryFieldKind = Schema.Literals([
  "text",
  "longtext",
  "number",
  "dice",
  "tags",
  "list",
]);
export type EntryFieldKind = typeof EntryFieldKind.Type;

export const EntryField = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  kind: EntryFieldKind,
  /** Row shape for `list` fields (a Knight's starting Property). */
  columns: Schema.optional(Schema.Array(ListColumn)),
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
});
export type EntryType = typeof EntryType.Type;

/** `public` entries are visible to every member; `dm` entries only to DMs until revealed. */
export const EntryVisibility = Schema.Literals(["public", "dm"]);
export type EntryVisibility = typeof EntryVisibility.Type;

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
});
export type CompendiumEntry = typeof CompendiumEntry.Type;

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

/** A pack entry keeps its id so re-importing an updated pack updates in place. */
export const PackEntry = Schema.Struct({
  id: Schema.String,
  typeId: Schema.String,
  name: Schema.String,
  tags: Schema.Array(Schema.String),
  body: Schema.String,
  fields: Schema.Record(Schema.String, CharacterValue),
  visibility: EntryVisibility,
});
export type PackEntry = typeof PackEntry.Type;

/** A shareable file of types and entries (`*.ttrpg-pack.json`). */
export const CompendiumPack = Schema.Struct({
  format: Schema.Literal("ttrpg-pack"),
  version: Schema.Literal(1),
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
  entries: 2000,
  /** JSON size of one entry. */
  entryBytes: 16 * 1024,
  body: 12_000,
  tags: 20,
  name: 120,
  /** Raw JSON size of an imported pack. */
  packBytes: 4 * 1024 * 1024,
} as const;
