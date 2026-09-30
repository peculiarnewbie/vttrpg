import * as Schema from "effect/Schema";

/*
 * Sheet layouts as data (proposal, proven in /lab/systems).
 *
 * A game system's sheet is pages of generic blocks on a 6-column flow grid.
 * Blocks refer to character values by `key`; each block type has a few visual
 * variants over the same data. New games need new data, not new code — a new
 * block type or variant is added only when no existing one fits, and then every
 * system can use it.
 */

export const GRID_COLUMNS = 6;

export const TrackerDisplay = Schema.Literals(["auto", "pips", "bar", "number", "clock"]);
export type TrackerDisplay = typeof TrackerDisplay.Type;

export const ListColumnKind = Schema.Literals(["text", "number", "dice", "tags", "check"]);
export type ListColumnKind = typeof ListColumnKind.Type;

/** Visual alternatives per block type. The first entry is the default. */
export const blockVariants = {
  heading: ["rule"],
  trackers: ["rows", "boxes"],
  stats: ["strip", "bars", "boxes", "list"],
  fields: ["rows", "inline", "boxed"],
  list: ["table", "cards", "slots"],
  checks: ["boxes", "tags"],
  text: ["plain"],
  rolls: ["buttons"],
  entry: ["card", "line"],
  group: ["plain", "framed"],
} as const;
export type BlockType = keyof typeof blockVariants;
export type BlockVariant<T extends BlockType> = (typeof blockVariants)[T][number];

const Span = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: GRID_COLUMNS }));

const common = {
  id: Schema.String,
  /** Columns out of 6 in the side panel; defaults to the full row. */
  span: Schema.optional(Span),
  /** Columns out of 6 when the sheet is shown wide; defaults to `span`. */
  wide: Schema.optional(Span),
};
const variantOf = <T extends BlockType>(type: T) =>
  Schema.optional(Schema.Literals(blockVariants[type] as unknown as [string, ...string[]]));

const Keyed = Schema.Struct({ key: Schema.String, label: Schema.String });

export const TrackerItem = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  short: Schema.optional(Schema.String),
  min: Schema.Int,
  max: Schema.Int,
  /** Value for new characters; defaults to `max`. */
  start: Schema.optional(Schema.Int),
  display: Schema.optional(TrackerDisplay),
});
export type TrackerItem = typeof TrackerItem.Type;

export const StatItem = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  /** Enables the `bars` variant: the stat is drawn as a fill against this maximum. */
  max: Schema.optional(Schema.Number),
});
export type StatItem = typeof StatItem.Type;

export const ListColumn = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  kind: ListColumnKind,
});
export type ListColumn = typeof ListColumn.Type;

const leafBlocks = [
  Schema.Struct({
    ...common,
    type: Schema.Literal("heading"),
    variant: variantOf("heading"),
    text: Schema.String,
  }),
  Schema.Struct({
    ...common,
    type: Schema.Literal("trackers"),
    /** `boxes` sets items side by side (Bastionland's Virtues); `rows` stacks them. */
    variant: variantOf("trackers"),
    items: Schema.Array(TrackerItem),
  }),
  Schema.Struct({
    ...common,
    type: Schema.Literal("stats"),
    variant: variantOf("stats"),
    items: Schema.Array(StatItem),
  }),
  Schema.Struct({
    ...common,
    type: Schema.Literal("fields"),
    variant: variantOf("fields"),
    columns: Schema.Literals([1, 2, 3]),
    items: Schema.Array(Keyed),
  }),
  Schema.Struct({
    ...common,
    type: Schema.Literal("list"),
    variant: variantOf("list"),
    key: Schema.String,
    title: Schema.optional(Schema.String),
    columns: Schema.Array(ListColumn),
    /** Render this many rows even when empty (inventory slots, harm lines). */
    slots: Schema.optional(Schema.Int),
    /**
     * Rows can be added from compendium entries of this type: the entry's name
     * fills a `name` column and fields fill columns with the same key. Rows are
     * copies (players may change them) that remember their entry in `_entry`.
     */
    source: Schema.optional(Schema.Struct({ entryType: Schema.String })),
  }),
  Schema.Struct({
    ...common,
    type: Schema.Literal("checks"),
    variant: variantOf("checks"),
    key: Schema.String,
    label: Schema.optional(Schema.String),
    options: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    ...common,
    type: Schema.Literal("text"),
    variant: variantOf("text"),
    key: Schema.String,
    label: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    ...common,
    type: Schema.Literal("rolls"),
    variant: variantOf("rolls"),
    items: Schema.Array(Schema.Struct({ label: Schema.String, dice: Schema.String })),
  }),
  /**
   * One compendium entry picked for the character (a Knight, a class). The value
   * at `key` is the entry id; the sheet shows the entry live, so compendium edits
   * show up on every sheet that links it.
   */
  Schema.Struct({
    ...common,
    type: Schema.Literal("entry"),
    variant: variantOf("entry"),
    key: Schema.String,
    /** Compendium entry type id the picker offers, e.g. "knight". */
    entryType: Schema.String,
    label: Schema.optional(Schema.String),
    /** Entry field keys to show on the sheet, in order; defaults to all fields. */
    show: Schema.optional(Schema.Array(Schema.String)),
    /**
     * Offered, never automatic: after picking, copy an entry's list field into
     * the character's list at `to` (a Knight's starting Property).
     */
    fill: Schema.optional(Schema.Array(Schema.Struct({ from: Schema.String, to: Schema.String }))),
  }),
] as const;

export const LeafBlock = Schema.Union(leafBlocks);
export type LeafBlock = typeof LeafBlock.Type;

/**
 * Blocks that stack inside one grid cell, so a tall column can sit beside a
 * short one. One level deep keeps the editor simple.
 */
export const GroupBlock = Schema.Struct({
  ...common,
  type: Schema.Literal("group"),
  variant: variantOf("group"),
  title: Schema.optional(Schema.String),
  blocks: Schema.Array(LeafBlock),
});
export type GroupBlock = typeof GroupBlock.Type;

export const LayoutBlock = Schema.Union([...leafBlocks, GroupBlock]);
export type LayoutBlock = typeof LayoutBlock.Type;

export const SheetPage = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  blocks: Schema.Array(LayoutBlock),
});
export type SheetPage = typeof SheetPage.Type;

export const SheetLayout = Schema.Struct({
  system: Schema.String,
  /** Name of this arrangement, e.g. "Classic" or "Compact"; a system can ship several. */
  name: Schema.String,
  pages: Schema.Array(SheetPage),
});
export type SheetLayout = typeof SheetLayout.Type;

/** Per-character values addressed by block keys. */
export type ListRow = Record<string, string | number | boolean | readonly string[]>;
export type SheetValues = Record<
  string,
  string | number | boolean | readonly string[] | readonly ListRow[] | undefined
>;

/** A viewer's own choice of variant for particular blocks, by block id. */
export type VariantOverrides = Record<string, string>;

/** Pips for small ranges, a bar for large ones; explicit displays win. */
export const resolveTrackerDisplay = (item: Pick<TrackerItem, "display" | "min" | "max">) =>
  item.display && item.display !== "auto"
    ? item.display
    : item.max - item.min <= 12
      ? "pips"
      : "bar";

/** The variant to render: the viewer's override if valid, else the layout's, else the default. */
export const resolveVariant = (
  block: { id: string; type: BlockType; variant?: string },
  overrides: VariantOverrides = {},
): string => {
  const allowed: readonly string[] = blockVariants[block.type];
  const chosen = overrides[block.id];
  if (chosen && allowed.includes(chosen)) return chosen;
  return block.variant && allowed.includes(block.variant) ? block.variant : allowed[0];
};

export type GridMode = "narrow" | "panel" | "wide";

/** Narrow containers stack everything; wide ones use each block's `wide` span. */
export const gridMode = (width: number): GridMode =>
  width < 300 ? "narrow" : width >= 600 ? "wide" : "panel";

export const resolveSpan = (block: { span?: number; wide?: number }, mode: GridMode) =>
  mode === "narrow"
    ? GRID_COLUMNS
    : mode === "wide"
      ? (block.wide ?? block.span ?? GRID_COLUMNS)
      : (block.span ?? GRID_COLUMNS);

/** Every tracker item in a layout, groups included, in sheet order. */
export const layoutTrackers = (layout: SheetLayout): TrackerItem[] =>
  layout.pages.flatMap((page) =>
    page.blocks.flatMap((block) => {
      const blocks = block.type === "group" ? block.blocks : [block];
      return blocks.flatMap((inner) => (inner.type === "trackers" ? inner.items : []));
    }),
  );
