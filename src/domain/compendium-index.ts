import * as Schema from "effect/Schema";

/*
 * The parts of the compendium that WebSocket frames carry. Kept apart from
 * compendium.ts, which depends on schemas.ts, so schemas.ts can use them
 * without an import cycle.
 */

/** `public` entries are visible to every member; `dm` entries only to DMs until revealed. */
export const EntryVisibility = Schema.Literals(["public", "dm"]);
export type EntryVisibility = typeof EntryVisibility.Type;

/**
 * What clients keep of every entry they may see: enough to list, pick, link
 * and notice changes. Bodies and fields load on demand (POST compendium/bodies).
 */
export const IndexRow = Schema.Struct({
  id: Schema.String,
  typeId: Schema.String,
  name: Schema.String,
  tags: Schema.Array(Schema.String),
  visibility: EntryVisibility,
  rev: Schema.Int,
  updatedAt: Schema.String,
});
export type IndexRow = typeof IndexRow.Type;
