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

/** `progress`: ten boxes of four ticks (Ironsworn); the value counts ticks, so `max` is 40. */
export const TrackerDisplay = Schema.Literals([
  "auto",
  "pips",
  "bar",
  "number",
  "clock",
  "progress",
]);
export type TrackerDisplay = typeof TrackerDisplay.Type;

/**
 * `derived` columns are computed per row from `expr` (e.g. `@row.qty * @row.weight`)
 * and not editable. `select` picks one of `options`. `progress` is a ten-box
 * track counted in ticks (0–40), like a Starforged vow.
 */
export const ListColumnKind = Schema.Literals([
  "text",
  "number",
  "dice",
  "tags",
  "check",
  "derived",
  "select",
  "progress",
]);
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
  entry: ["card", "line", "progression"],
  group: ["plain", "framed"],
} as const;
export type BlockType = keyof typeof blockVariants;
export type BlockVariant<T extends BlockType> = (typeof blockVariants)[T][number];

const Span = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: GRID_COLUMNS }));

/**
 * Show a block only while a value is empty or filled, or while a formula
 * (derived.ts) holds, e.g. `@level >= 3`. Hidden blocks still show while
 * editing.
 */
export const BlockCondition = Schema.Union([
  Schema.Struct({ key: Schema.String, is: Schema.Literals(["empty", "filled"]) }),
  Schema.Struct({ expr: Schema.String.check(Schema.isMaxLength(400)) }),
]);
export type BlockCondition = typeof BlockCondition.Type;

const common = {
  id: Schema.String,
  /** Columns out of 6 in the side panel; defaults to the full row. */
  span: Schema.optional(Span),
  /** Columns out of 6 when the sheet is shown wide; defaults to `span`. */
  wide: Schema.optional(Span),
  /** e.g. a free-text Ability only until a Knight is linked. */
  when: Schema.optional(BlockCondition),
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
  /** Dice notation rolled when the label is clicked, e.g. `(@hunt)d6khz`. */
  roll: Schema.optional(Schema.String),
});
export type TrackerItem = typeof TrackerItem.Type;

export const StatItem = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  /** Enables the `bars` variant: the stat is drawn as a fill against this maximum. */
  max: Schema.optional(Schema.Number),
  /** Dice notation rolled when the stat is clicked, e.g. `1d20 + @str_mod`. */
  roll: Schema.optional(Schema.String),
});
export type StatItem = typeof StatItem.Type;

export const ListColumn = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  kind: ListColumnKind,
  /** For `derived` columns: an expression over `@row.column` and sheet values. */
  expr: Schema.optional(Schema.String),
  /** For `select` columns. */
  options: Schema.optional(Schema.Array(Schema.String)),
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
     * A number column holding how many slots a row takes (Cairn's bulky items
     * take 2). The slots variant draws the row across that many slots and
     * counts them; a row without a size takes 1. Display only — nothing stops
     * a player from overfilling.
     */
    slotSize: Schema.optional(Schema.String),
    /**
     * Rows can be added from compendium entries of this type: the entry's name
     * fills a `name` column and fields fill columns with the same key. Rows are
     * copies (players may change them) that remember their entry in `_entry`.
     */
    source: Schema.optional(Schema.Struct({ entryType: Schema.String })),
    /** Dice notation each row can roll, e.g. `1d20 + @row.bonus | @row.damage + @str_mod`. */
    roll: Schema.optional(Schema.String),
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
    /** `dice` is notation and may use `@refs` (see dice-notation.ts). */
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
    /**
     * For the `progression` variant: the entry's progression field and the
     * sheet value holding the character's level. The sheet shows that field's
     * rows up to the level; `fill` from the same field offers to copy the rows
     * a level-up adds. Nothing is applied or checked on its own.
     */
    progression: Schema.optional(Schema.Struct({ field: Schema.String, level: Schema.String })),
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

/**
 * A number computed from other values (see derived.ts): shown wherever a block
 * item uses its key, and usable as `@key` in expressions and roll notation.
 * Never stored on the character.
 */
export const DerivedValue = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  expr: Schema.String,
});
export type DerivedValue = typeof DerivedValue.Type;

/*
 * An optional step-by-step way to fill in the same character the sheet edits.
 * It holds no data of its own: `blocks` parts show sheet blocks edited as on
 * the sheet, `choose` picks compendium entries into an entry block or a
 * sourced list (with the same copy offers), and `rolls`/`tables` are plain
 * chat rolls — nothing a roll lands on is ever written to the character.
 * Counts are hints; nothing is checked (see docs/v1-scope.md).
 */

/** An entry chosen earlier (the value of entry block `entry`) and a reference field on it. */
const FromEntry = Schema.Struct({ entry: Schema.String, field: Schema.String });
const StepText = (maximum: number) => Schema.String.check(Schema.isMaxLength(maximum));
/** A formula (derived.ts); the step or part applies while it's true, e.g. `@level >= 3`. */
const Condition = StepText(400);
/** Every part can apply only sometimes. */
const partFields = { when: Schema.optional(Condition) };

export const BuilderPart = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("blocks"),
    /** Sheet block ids, shown in this order. */
    blocks: Schema.Array(Schema.String).check(Schema.isMaxLength(30)),
    ...partFields,
  }),
  Schema.Struct({
    type: Schema.Literal("choose"),
    /** An entry block (one pick) or a list with a `source` (rows added). */
    key: Schema.String,
    /** Offer only the entries this reference field lists (a playbook's moves). */
    from: Schema.optional(FromEntry),
    /** Shown as "Pick N"; never enforced. */
    pick: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
    ...partFields,
  }),
  Schema.Struct({
    type: Schema.Literal("rolls"),
    items: Schema.Array(Schema.Struct({ label: StepText(60), dice: Schema.String })).check(
      Schema.isMaxLength(12),
    ),
    ...partFields,
  }),
  Schema.Struct({
    type: Schema.Literal("tables"),
    /** Oracle entries listed by a reference field of an entry chosen earlier (a background's tables)… */
    from: Schema.optional(FromEntry),
    /** …or fixed oracle entries by id (name tables). */
    entries: Schema.optional(Schema.Array(Schema.String).check(Schema.isMaxLength(20))),
    ...partFields,
  }),
  Schema.Struct({
    type: Schema.Literal("review"),
    ...partFields,
  }),
]);
export type BuilderPart = typeof BuilderPart.Type;

/** The part kinds this version knows; the record makes adding one to the union a compile error until listed. */
const knownPartTypes: Record<BuilderPart["type"], true> = {
  blocks: true,
  choose: true,
  rolls: true,
  tables: true,
  review: true,
};
export const isKnownPartType = (type: string): type is BuilderPart["type"] =>
  Object.hasOwn(knownPartTypes, type);

/**
 * A part of a kind this version doesn't know (from a newer version, or an
 * extension later): kept whole, so saving the layout doesn't lose it, and
 * shown as "not supported here".
 */
export const UnknownBuilderPart = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.String.check(
      Schema.makeFilter((type: string) => !isKnownPartType(type), {
        message: "Known part kinds must match their schema",
      }),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
export type UnknownBuilderPart = typeof UnknownBuilderPart.Type;

export const StoredBuilderPart = Schema.Union([BuilderPart, UnknownBuilderPart]);
export type StoredBuilderPart = typeof StoredBuilderPart.Type;

/** A part this version can show and edit. */
export const isKnownPart = (part: StoredBuilderPart): part is BuilderPart =>
  isKnownPartType(part.type);

export const BuilderStep = Schema.Struct({
  id: Schema.String,
  /** Shown as "Step N" while empty. */
  title: StepText(60),
  /** Our own short guidance — never rules text copied from a closed book. */
  hint: Schema.optional(StepText(400)),
  /** The step applies while this formula is true (otherwise it's shown as not needed). */
  when: Schema.optional(Condition),
  /** Ticked in the step list while this formula is true — a hint, never a gate. */
  done: Schema.optional(Condition),
  parts: Schema.Array(StoredBuilderPart).check(Schema.isMaxLength(8)),
});
export type BuilderStep = typeof BuilderStep.Type;

export const SheetBuilder = Schema.Struct({
  steps: Schema.Array(BuilderStep).check(Schema.isMaxLength(20)),
});
export type SheetBuilder = typeof SheetBuilder.Type;

export const SheetLayout = Schema.Struct({
  /**
   * `shared`: sheets that belong to the table rather than one player — a crew,
   * a steading, a ship. Every member can edit them unless the DM locks one.
   */
  subject: Schema.optional(Schema.Literals(["character", "shared"])),
  system: Schema.String,
  /** Name of this arrangement, e.g. "Classic" or "Compact"; a system can ship several. */
  name: Schema.String,
  pages: Schema.Array(SheetPage),
  derived: Schema.optional(Schema.Array(DerivedValue)),
  builder: Schema.optional(SheetBuilder),
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

/** Whether a value counts as filled in: blank text, no rows or ticks, false and missing don't. */
export const valueFilled = (value: SheetValues[string]) =>
  typeof value === "string"
    ? value.trim() !== ""
    : Array.isArray(value)
      ? value.length > 0
      : value !== undefined && value !== false;

/**
 * Whether a block's `when` condition holds for these values (always true
 * without one). A formula condition needs `holds` (sheet-refs evaluates it);
 * without it, the block shows.
 */
export const blockShown = (
  block: { when?: BlockCondition },
  values: SheetValues,
  holds?: (expr: string) => boolean,
) => {
  const when = block.when;
  if (!when) return true;
  if ("expr" in when) return holds?.(when.expr) ?? true;
  return valueFilled(values[when.key]) === (when.is === "filled");
};

/** Every tracker item in a layout, groups included, in sheet order. */
export const layoutTrackers = (layout: SheetLayout): TrackerItem[] =>
  layout.pages.flatMap((page) =>
    page.blocks.flatMap((block) => {
      const blocks = block.type === "group" ? block.blocks : [block];
      return blocks.flatMap((inner) => (inner.type === "trackers" ? inner.items : []));
    }),
  );
