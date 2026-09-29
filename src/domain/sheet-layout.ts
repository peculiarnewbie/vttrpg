import * as Schema from "effect/Schema";

/*
 * Sheet layouts as data (proposal, proven in /lab/systems).
 *
 * A game system's sheet is an ordered list of generic blocks on one or more
 * pages; blocks refer to character values by `key`. New games need new data, not
 * new code — a new block type or display is added only when no existing one fits,
 * and then every system can use it.
 */

export const TrackerDisplay = Schema.Literals(["auto", "pips", "bar", "number", "clock"]);
export type TrackerDisplay = typeof TrackerDisplay.Type;

export const ListColumnKind = Schema.Literals(["text", "number", "dice", "tags", "check"]);
export type ListColumnKind = typeof ListColumnKind.Type;

const block = {
  id: Schema.String,
  /** Half-width blocks pair up side by side; everything stacks on phones. */
  width: Schema.optional(Schema.Literals(["full", "half"])),
};

const Keyed = Schema.Struct({ key: Schema.String, label: Schema.String });

export const TrackerItem = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  short: Schema.optional(Schema.String),
  min: Schema.Int,
  max: Schema.Int,
  display: Schema.optional(TrackerDisplay),
});
export type TrackerItem = typeof TrackerItem.Type;

export const ListColumn = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  kind: ListColumnKind,
});
export type ListColumn = typeof ListColumn.Type;

export const LayoutBlock = Schema.Union([
  Schema.Struct({ ...block, type: Schema.Literal("heading"), text: Schema.String }),
  Schema.Struct({
    ...block,
    type: Schema.Literal("trackers"),
    /** "row" lays items side by side as boxes (Bastionland's Virtues); "column" stacks rows. */
    arrange: Schema.Literals(["row", "column"]),
    items: Schema.Array(TrackerItem),
  }),
  Schema.Struct({ ...block, type: Schema.Literal("stats"), items: Schema.Array(Keyed) }),
  Schema.Struct({
    ...block,
    type: Schema.Literal("fields"),
    columns: Schema.Literals([1, 2, 3]),
    items: Schema.Array(Keyed),
  }),
  Schema.Struct({
    ...block,
    type: Schema.Literal("list"),
    key: Schema.String,
    title: Schema.optional(Schema.String),
    columns: Schema.Array(ListColumn),
    /** Render this many rows even when empty (inventory slots, harm lines). */
    slots: Schema.optional(Schema.Int),
  }),
  Schema.Struct({
    ...block,
    type: Schema.Literal("checks"),
    key: Schema.String,
    label: Schema.optional(Schema.String),
    options: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    ...block,
    type: Schema.Literal("text"),
    key: Schema.String,
    label: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    ...block,
    type: Schema.Literal("rolls"),
    items: Schema.Array(Schema.Struct({ label: Schema.String, dice: Schema.String })),
  }),
]);
export type LayoutBlock = typeof LayoutBlock.Type;

export const SheetPage = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  blocks: Schema.Array(LayoutBlock),
});
export type SheetPage = typeof SheetPage.Type;

export const SheetLayout = Schema.Struct({
  system: Schema.String,
  pages: Schema.Array(SheetPage),
});
export type SheetLayout = typeof SheetLayout.Type;

/** Per-character values addressed by block keys. */
export type ListRow = Record<string, string | number | boolean | readonly string[]>;
export type SheetValues = Record<
  string,
  string | number | readonly string[] | readonly ListRow[] | undefined
>;

/** Pips for small ranges, a bar for large ones; explicit displays win. */
export const resolveTrackerDisplay = (item: Pick<TrackerItem, "display" | "min" | "max">) =>
  item.display && item.display !== "auto"
    ? item.display
    : item.max - item.min <= 12
      ? "pips"
      : "bar";
