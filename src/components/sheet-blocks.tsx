import * as stylex from "@stylexjs/stylex";
import { For, Match, Show, Switch, createSignal, onCleanup, onSettled } from "solid-js";
import {
  blockVariants,
  gridMode,
  resolveSpan,
  resolveTrackerDisplay,
  resolveVariant,
  type GridMode,
  type GroupBlock,
  type LayoutBlock,
  type LeafBlock,
  type ListColumn,
  type ListRow,
  type SheetLayout,
  type SheetValues,
  type StatItem,
  type TrackerItem,
  type VariantOverrides,
} from "../domain/sheet-layout";
import { colors, fonts, radii, skin } from "../theme/tokens.stylex";
import { useTheme } from "../theme/theme-context";
import { sx } from "../theme/sx";

/*
 * Generic, themed renderer for data-defined sheet layouts. Every game system is
 * the same handful of blocks on a 6-column flow grid; each block has a few visual
 * variants, and the theme tokens give every variant its look. The grid measures
 * its own width: narrow containers stack, wide ones use each block's wide span.
 */

const hair = { borderWidth: "1px", borderStyle: "solid", borderColor: colors.border } as const;
const underline = {
  borderBottomWidth: "1px",
  borderBottomStyle: "dotted",
  borderBottomColor: colors.border,
} as const;

const s = stylex.create({
  sheet: { display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px" },
  nameBlock: { textAlign: "center", paddingBlock: "2px" },
  nameBand: {
    textAlign: "left",
    padding: "8px 10px",
    backgroundColor: colors.accent,
    backgroundImage: skin.band,
    backgroundSize: skin.bandSize,
    borderBottomWidth: "3px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.text,
  },
  name: {
    margin: 0,
    fontFamily: fonts.display,
    fontSize: "24px",
    fontWeight: skin.headWeight,
    lineHeight: 1.05,
    textTransform: skin.nameTransform,
    letterSpacing: skin.nameTracking,
    color: colors.accent,
  },
  nameOnBand: { color: colors.text, fontSize: "30px" },
  subtitle: { fontSize: "12px", color: colors.textMuted, fontStyle: "italic" },
  tabs: { display: "flex", gap: "2px", ...underline },
  tab: {
    paddingInline: "8px",
    paddingBlock: "3px",
    borderWidth: 0,
    backgroundColor: "transparent",
    color: colors.textMuted,
    fontFamily: fonts.display,
    fontSize: "12px",
    textTransform: skin.headTransform,
    letterSpacing: skin.headTracking,
    cursor: "pointer",
  },
  tabOn: { color: colors.accent, boxShadow: `inset 0 -2px 0 ${colors.accent}` },
  grid: {
    display: "grid",
    // GRID_COLUMNS; StyleX needs a literal here.
    gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
    gap: "8px 10px",
    alignItems: "start",
  },
  blockCol: { display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 },
  framed: {
    padding: "6px 7px 7px",
    ...hair,
    borderRadius: skin.controlRadius,
  },
  // customize mode
  editable: {
    position: "relative",
    outlineWidth: "1px",
    outlineStyle: "dashed",
    outlineColor: colors.borderStrong,
    outlineOffset: "3px",
  },
  editBar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "3px",
    marginBottom: "2px",
    fontFamily: fonts.body,
    fontSize: "10px",
    color: colors.textMuted,
  },
  editSelect: {
    height: "20px",
    paddingInline: "2px",
    fontSize: "10px",
    ...hair,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    color: colors.text,
  },
  editKind: {
    fontFamily: fonts.display,
    textTransform: skin.headTransform,
    letterSpacing: skin.headTracking,
    color: colors.accent,
  },
  head: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginTop: "2px",
    fontFamily: fonts.display,
    fontSize: "12px",
    fontWeight: skin.headWeight,
    textTransform: skin.headTransform,
    letterSpacing: skin.headTracking,
    color: colors.accent,
    "::before": { content: skin.ornament, fontSize: "10px" },
  },
  rule: { flex: 1, height: skin.ruleHeight, backgroundImage: skin.rule },
  label: {
    fontFamily: fonts.display,
    fontSize: "10px",
    textTransform: skin.headTransform,
    letterSpacing: skin.headTracking,
    color: colors.textMuted,
    whiteSpace: "nowrap",
  },
  // trackers
  trackerRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(0, 1fr))",
    gridAutoFlow: "column",
    gap: "6px",
  },
  trackerBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "2px",
    paddingBlock: "5px",
    ...hair,
    borderRadius: skin.controlRadius,
  },
  trackerLine: {
    display: "grid",
    gridTemplateColumns: "minmax(52px, max-content) minmax(0, 1fr)",
    alignItems: "center",
    gap: "6px",
    minHeight: "22px",
  },
  bigNumber: { fontFamily: fonts.numeric, fontSize: "26px", fontWeight: 700, lineHeight: 1 },
  ofMax: { fontFamily: fonts.numeric, fontSize: "12px", color: colors.textMuted },
  numberLine: { display: "flex", alignItems: "center", gap: "5px" },
  step: {
    width: "20px",
    height: "20px",
    padding: 0,
    ...hair,
    borderColor: colors.borderStrong,
    borderRadius: skin.stepperRadius,
    transform: `rotate(${skin.stepperRotate}) scale(0.9)`,
    backgroundColor: { default: colors.surface, ":hover": colors.surfaceHover },
    color: colors.text,
    fontSize: "12px",
    lineHeight: 1,
    cursor: "pointer",
  },
  stepGlyph: { display: "inline-block", transform: `rotate(calc(-1 * ${skin.stepperRotate}))` },
  pips: { display: "flex", flexWrap: "wrap", gap: "3px", alignItems: "center" },
  pip: {
    width: skin.pipSize,
    height: skin.pipSize,
    padding: 0,
    borderWidth: "2px",
    borderStyle: "solid",
    borderColor: skin.pipBorder,
    borderRadius: skin.pipRadius,
    backgroundColor: "transparent",
    cursor: "pointer",
  },
  pipOn: { backgroundColor: skin.pipOn },
  bar: {
    position: "relative",
    flex: 1,
    height: "18px",
    ...hair,
    backgroundColor: skin.meterTrack,
    overflow: "hidden",
  },
  barFill: { position: "absolute", insetBlock: 0, left: 0, backgroundImage: skin.meterFill },
  barText: {
    position: "relative",
    display: "block",
    textAlign: "center",
    fontFamily: fonts.numeric,
    fontSize: "12px",
    lineHeight: "16px",
    textShadow: `0 0 2px ${colors.surface}, 0 0 3px ${colors.surface}`,
  },
  clock: { cursor: "pointer", display: "block", color: colors.accent },
  // stats and fields
  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(58px, 1fr))",
    ...hair,
    borderRadius: skin.controlRadius,
  },
  stat: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingBlock: "3px",
    borderRightWidth: "1px",
    borderRightStyle: "solid",
    borderRightColor: colors.border,
    ":last-child": { borderRightWidth: 0 },
  },
  statValue: { fontFamily: fonts.numeric, fontSize: "17px", fontWeight: 700, lineHeight: 1.1 },
  statBars: { display: "flex", flexDirection: "column", gap: "3px" },
  statBar: {
    display: "grid",
    gridTemplateColumns: "minmax(52px, max-content) minmax(0, 1fr)",
    alignItems: "center",
    gap: "6px",
  },
  statBoxes: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(62px, 1fr))",
    gap: "5px",
  },
  statBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingBlock: "4px",
    ...hair,
    borderColor: colors.borderStrong,
    borderRadius: skin.controlRadius,
    boxShadow: skin.controlShadow,
  },
  statBoxValue: { fontFamily: fonts.numeric, fontSize: "22px", fontWeight: 700, lineHeight: 1 },
  statList: { display: "flex", flexDirection: "column" },
  statLine: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "6px",
    paddingBlock: "1px",
    ...underline,
  },
  statLineValue: { fontFamily: fonts.numeric, fontSize: "14px", fontWeight: 700 },
  fields1: { display: "grid", gridTemplateColumns: "1fr", columnGap: "10px" },
  fields2: { display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: "10px" },
  fields3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", columnGap: "10px" },
  field: {
    display: "flex",
    flexDirection: "column",
    paddingBlock: "2px",
    minWidth: 0,
    ...underline,
  },
  fieldValue: {
    fontFamily: fonts.body,
    fontSize: "13px",
    fontWeight: 600,
    overflowWrap: "anywhere",
  },
  fieldInline: { flexDirection: "row", alignItems: "baseline", gap: "6px" },
  fieldInlineValue: { flex: 1, textAlign: "right" },
  fieldBoxed: {
    padding: "3px 5px",
    marginBottom: "4px",
    ...hair,
    borderRadius: skin.controlRadius,
  },
  // lists
  table: { display: "grid", columnGap: "6px", alignItems: "center" },
  th: { paddingBottom: "1px", ...underline, borderBottomStyle: "solid" },
  td: { minHeight: "21px", paddingBlock: "2px", ...underline, overflowWrap: "anywhere" },
  dice: {
    paddingInline: "5px",
    paddingBlock: "1px",
    ...hair,
    borderColor: colors.borderStrong,
    borderRadius: skin.controlRadius,
    boxShadow: skin.controlShadow,
    backgroundColor: { default: colors.surface, ":hover": colors.surfaceHover },
    color: colors.accent,
    fontFamily: fonts.numeric,
    fontSize: "12px",
    cursor: "pointer",
  },
  tag: {
    display: "inline-block",
    marginRight: "3px",
    paddingInline: "4px",
    fontSize: "10px",
    borderRadius: radii.sm,
    backgroundColor: colors.accentMuted,
    color: colors.text,
  },
  cards: { display: "flex", flexDirection: "column", gap: "4px" },
  card: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "4px 8px",
    padding: "4px 6px",
    ...hair,
    borderRadius: skin.controlRadius,
  },
  cardTitle: { flex: 1, minWidth: "90px", fontWeight: 700 },
  cardMeta: { display: "inline-flex", alignItems: "baseline", gap: "3px" },
  slots: { display: "flex", flexDirection: "column" },
  slot: {
    display: "grid",
    gridTemplateColumns: "16px minmax(0, 1fr)",
    alignItems: "baseline",
    gap: "4px",
    minHeight: "21px",
    paddingBlock: "1px",
    ...underline,
  },
  slotNumber: { fontFamily: fonts.numeric, fontSize: "11px", color: colors.textFaint },
  slotBody: { display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px" },
  // checks, text, rolls
  chips: { display: "flex", flexWrap: "wrap", gap: "3px" },
  chip: {
    paddingInline: "6px",
    paddingBlock: "1px",
    ...hair,
    borderRadius: skin.controlRadius,
    backgroundColor: "transparent",
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: "11px",
    cursor: "pointer",
  },
  chipOn: {
    backgroundColor: skin.pipOn,
    borderColor: skin.pipOn,
    color: colors.surface,
  },
  checks: { display: "flex", flexWrap: "wrap", gap: "3px 10px" },
  check: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    fontSize: "12px",
    cursor: "pointer",
  },
  box: {
    width: "11px",
    height: "11px",
    borderWidth: "1.5px",
    borderStyle: "solid",
    borderColor: skin.pipBorder,
    borderRadius: radii.sm,
  },
  boxOn: { backgroundColor: skin.pipOn },
  text: { fontFamily: fonts.body, whiteSpace: "pre-wrap", ...underline, paddingBottom: "3px" },
  rolls: { display: "flex", flexWrap: "wrap", gap: "4px" },
  roll: {
    display: "inline-flex",
    alignItems: "baseline",
    gap: "6px",
    paddingInline: "7px",
    paddingBlock: "3px",
    ...hair,
    borderRadius: skin.controlRadius,
    boxShadow: skin.controlShadow,
    backgroundColor: { default: colors.surface, ":hover": colors.surfaceHover },
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: "12px",
    cursor: "pointer",
  },
  rollDice: { fontFamily: fonts.numeric, color: colors.accent },
  empty: { color: colors.textFaint },
});

type Props = {
  layout: SheetLayout;
  /** The viewer's own variant choices, by block id. */
  overrides?: VariantOverrides;
  /** Show variant and span controls on every block. */
  customize?: boolean;
  onVariant?: (blockId: string, variant: string) => void;
  onSpan?: (blockId: string, span: number) => void;
  name: string;
  subtitle?: string;
  values: SheetValues;
  onChange: (key: string, value: SheetValues[string]) => void;
  onRoll: (label: string, dice: string) => void;
  /** Overrides the active theme's header style (the lab renders several themes at once). */
  header?: "centered" | "band";
};

const num = (value: SheetValues[string], fallback = 0) =>
  typeof value === "number" ? value : Number(value ?? fallback) || fallback;
const clamp = (value: number, item: TrackerItem) => Math.max(item.min, Math.min(item.max, value));

function Stepper(props: { label: string; glyph: "−" | "+"; onClick: () => void }) {
  return (
    <button
      {...sx(s.step)}
      aria-label={`${props.glyph === "−" ? "Decrease" : "Increase"} ${props.label}`}
      onClick={props.onClick}
    >
      <span {...sx(s.stepGlyph)}>{props.glyph}</span>
    </button>
  );
}

function Pips(props: { item: TrackerItem; value: number; set: (n: number) => void }) {
  return (
    <span {...sx(s.pips)} role="group" aria-label={props.item.label}>
      <For
        each={Array.from(
          { length: props.item.max - props.item.min },
          (_, i) => props.item.min + i + 1,
        )}
      >
        {(n) => (
          <button
            {...sx(s.pip, n <= props.value && s.pipOn)}
            aria-label={`Set ${props.item.label} to ${n}`}
            onClick={() => props.set(n === props.value ? n - 1 : n)}
          />
        )}
      </For>
    </span>
  );
}

/** Blades-style progress clock: click a segment to fill up to it. */
function Clock(props: { item: TrackerItem; value: number; set: (n: number) => void }) {
  const size = 46;
  const r = size / 2 - 3;
  const c = size / 2;
  const segments = () => props.item.max - props.item.min;
  const point = (i: number) => {
    const angle = (i / segments()) * 2 * Math.PI - Math.PI / 2;
    return `${c + r * Math.cos(angle)} ${c + r * Math.sin(angle)}`;
  };
  return (
    <svg
      {...sx(s.clock)}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="group"
      aria-label={`${props.item.label} clock, ${props.value} of ${props.item.max}`}
    >
      <For each={Array.from({ length: segments() }, (_, i) => i)}>
        {(i) => (
          <path
            d={`M ${c} ${c} L ${point(i)} A ${r} ${r} 0 0 1 ${point(i + 1)} Z`}
            fill={i < props.value ? "currentColor" : "transparent"}
            stroke="currentColor"
            stroke-width="1.5"
            role="button"
            aria-label={`Set ${props.item.label} to ${i + 1}`}
            onClick={() => props.set(i + 1 === props.value ? i : i + 1)}
          />
        )}
      </For>
    </svg>
  );
}

function Tracker(props: {
  item: TrackerItem;
  boxed: boolean;
  value: number;
  set: (n: number) => void;
}) {
  const display = () => resolveTrackerDisplay(props.item);
  const body = () => (
    <Switch>
      <Match when={display() === "number"}>
        <span {...sx(s.numberLine)}>
          <Stepper label={props.item.label} glyph="−" onClick={() => props.set(props.value - 1)} />
          <span>
            <span {...sx(s.bigNumber)}>{props.value}</span>
            <span {...sx(s.ofMax)}>/{props.item.max}</span>
          </span>
          <Stepper label={props.item.label} glyph="+" onClick={() => props.set(props.value + 1)} />
        </span>
      </Match>
      <Match when={display() === "pips"}>
        <Pips item={props.item} value={props.value} set={props.set} />
      </Match>
      <Match when={display() === "clock"}>
        <Clock item={props.item} value={props.value} set={props.set} />
      </Match>
      <Match when={display() === "bar"}>
        <span {...sx(s.numberLine)} style={{ flex: 1 }}>
          <Stepper label={props.item.label} glyph="−" onClick={() => props.set(props.value - 1)} />
          <span {...sx(s.bar)}>
            <span
              {...sx(s.barFill)}
              style={{
                width: `${((props.value - props.item.min) / Math.max(1, props.item.max - props.item.min)) * 100}%`,
              }}
            />
            <span {...sx(s.barText)}>
              {props.value}/{props.item.max}
            </span>
          </span>
          <Stepper label={props.item.label} glyph="+" onClick={() => props.set(props.value + 1)} />
        </span>
      </Match>
    </Switch>
  );
  return (
    <Show
      when={props.boxed}
      fallback={
        <div {...sx(s.trackerLine)}>
          <span {...sx(s.label)}>{props.item.label}</span>
          {body()}
        </div>
      }
    >
      <div {...sx(s.trackerBox)}>
        <span {...sx(s.label)}>{props.item.short ?? props.item.label}</span>
        {body()}
        <Show when={props.item.short}>
          <span {...sx(s.ofMax)}>{props.item.label}</span>
        </Show>
      </div>
    </Show>
  );
}

function Cell(props: {
  column: ListColumn;
  row: ListRow | undefined;
  onRoll: (dice: string) => void;
  onToggle: () => void;
}) {
  const value = () => props.row?.[props.column.key];
  return (
    <Switch fallback={<span>{value() === undefined ? "" : String(value())}</span>}>
      <Match when={props.column.kind === "dice" && typeof value() === "string" && value()}>
        <button
          {...sx(s.dice)}
          title={`Roll ${value()}`}
          onClick={() => props.onRoll(String(value()))}
        >
          {String(value())}
        </button>
      </Match>
      <Match when={props.column.kind === "tags" && Array.isArray(value())}>
        <span>
          <For each={value() as readonly string[]}>
            {(tag) => <span {...sx(s.tag)}>{tag}</span>}
          </For>
        </span>
      </Match>
      <Match when={props.column.kind === "check" && props.row}>
        <button
          {...sx(s.box, value() === true && s.boxOn)}
          style={{ padding: 0, cursor: "pointer" }}
          aria-label="Toggle"
          aria-pressed={value() === true ? "true" : "false"}
          onClick={props.onToggle}
        />
      </Match>
    </Switch>
  );
}

type Ctx = Omit<Props, "layout" | "name" | "subtitle" | "header"> & { mode: GridMode };

const Heading = (props: { text: string }) => (
  <div {...sx(s.head)}>
    {props.text}
    <span {...sx(s.rule)} />
  </div>
);

/** Customize-mode controls: pick a variant and how many of the 6 columns to span. */
function EditBar(props: { block: LayoutBlock; ctx: Ctx; nested?: boolean }) {
  const variants = () => blockVariants[props.block.type] as readonly string[];
  const spanKey = () => (props.ctx.mode === "wide" ? "wide" : "span");
  return (
    <div {...sx(s.editBar)}>
      <span {...sx(s.editKind)}>{props.block.type}</span>
      <Show when={variants().length > 1}>
        <select
          {...sx(s.editSelect)}
          aria-label={`${props.block.id} style`}
          value={resolveVariant(props.block, props.ctx.overrides)}
          onChange={(event) => props.ctx.onVariant?.(props.block.id, event.currentTarget.value)}
        >
          <For each={variants()}>{(variant) => <option value={variant}>{variant}</option>}</For>
        </select>
      </Show>
      <Show when={!props.nested && props.ctx.mode !== "narrow"}>
        <select
          {...sx(s.editSelect)}
          aria-label={`${props.block.id} width`}
          title={spanKey() === "wide" ? "Columns when wide" : "Columns in the panel"}
          value={resolveSpan(props.block, props.ctx.mode)}
          onChange={(event) =>
            props.ctx.onSpan?.(props.block.id, Number(event.currentTarget.value))
          }
        >
          <For each={[1, 2, 3, 4, 5, 6]}>
            {(n) => <option value={n}>{n === 6 ? "full" : `${n}/6`}</option>}
          </For>
        </select>
      </Show>
    </div>
  );
}

function Stats(props: { items: readonly StatItem[]; variant: string; values: SheetValues }) {
  const value = (item: StatItem) => props.values[item.key];
  const shown = (item: StatItem) => String(value(item) ?? "—");
  return (
    <Switch>
      <Match when={props.variant === "bars"}>
        <div {...sx(s.statBars)}>
          <For each={props.items}>
            {(item) => (
              <div {...sx(s.statBar)}>
                <span {...sx(s.label)}>{item.label}</span>
                <Show
                  when={item.max && typeof value(item) === "number"}
                  fallback={<span {...sx(s.statLineValue)}>{shown(item)}</span>}
                >
                  <span {...sx(s.bar)}>
                    <span
                      {...sx(s.barFill)}
                      style={{
                        width: `${Math.min(100, ((value(item) as number) / item.max!) * 100)}%`,
                      }}
                    />
                    <span {...sx(s.barText)}>{shown(item)}</span>
                  </span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Match>
      <Match when={props.variant === "boxes"}>
        <div {...sx(s.statBoxes)}>
          <For each={props.items}>
            {(item) => (
              <div {...sx(s.statBox)}>
                <span {...sx(s.label)}>{item.label}</span>
                <span {...sx(s.statBoxValue)}>{shown(item)}</span>
              </div>
            )}
          </For>
        </div>
      </Match>
      <Match when={props.variant === "list"}>
        <div {...sx(s.statList)}>
          <For each={props.items}>
            {(item) => (
              <div {...sx(s.statLine)}>
                <span {...sx(s.label)}>{item.label}</span>
                <span {...sx(s.statLineValue)}>{shown(item)}</span>
              </div>
            )}
          </For>
        </div>
      </Match>
      <Match when={true}>
        <div {...sx(s.stats)}>
          <For each={props.items}>
            {(item) => (
              <div {...sx(s.stat)}>
                <span {...sx(s.label)}>{item.label}</span>
                <span {...sx(s.statValue)}>{shown(item)}</span>
              </div>
            )}
          </For>
        </div>
      </Match>
    </Switch>
  );
}

function List(props: { block: Extract<LeafBlock, { type: "list" }>; variant: string; ctx: Ctx }) {
  const rows = () => (props.ctx.values[props.block.key] as readonly ListRow[] | undefined) ?? [];
  const count = () => Math.max(rows().length, props.block.slots ?? 0);
  const indexes = () => Array.from({ length: count() }, (_, i) => i);
  const [first, ...rest] = props.block.columns;
  const rollRow = (index: number) => (dice: string) =>
    props.ctx.onRoll(String(rows()[index]?.[first.key] ?? ""), dice);
  const toggle = (index: number, key: string) =>
    props.ctx.onChange(
      props.block.key,
      rows().map((row, i) => (i === index ? { ...row, [key]: row[key] !== true } : row)),
    );
  const cell = (index: number, column: ListColumn) => (
    <Cell
      column={column}
      row={rows()[index]}
      onRoll={rollRow(index)}
      onToggle={() => toggle(index, column.key)}
    />
  );
  const template = () =>
    props.block.columns
      .map((column) =>
        column.kind === "text"
          ? "minmax(0, 1fr)"
          : column.kind === "tags"
            ? "minmax(0, 0.8fr)"
            : "auto",
      )
      .join(" ");
  return (
    <>
      <Show when={props.block.title}>{(title) => <Heading text={title()} />}</Show>
      <Switch>
        <Match when={props.variant === "cards"}>
          <div {...sx(s.cards)}>
            <For each={rows().map((_, i) => i)}>
              {(index) => (
                <div {...sx(s.card)}>
                  <span {...sx(s.cardTitle)}>{String(rows()[index]?.[first.key] ?? "")}</span>
                  <For each={rest}>
                    {(column) => (
                      <Show when={rows()[index]?.[column.key] !== ""}>
                        <span {...sx(s.cardMeta)}>
                          <span {...sx(s.label)}>{column.label}</span>
                          {cell(index, column)}
                        </span>
                      </Show>
                    )}
                  </For>
                </div>
              )}
            </For>
          </div>
        </Match>
        <Match when={props.variant === "slots"}>
          <div {...sx(s.slots)}>
            <For each={indexes()}>
              {(index) => (
                <div {...sx(s.slot)}>
                  <span {...sx(s.slotNumber)}>{index + 1}</span>
                  <span {...sx(s.slotBody)}>
                    <For each={props.block.columns}>{(column) => cell(index, column)}</For>
                  </span>
                </div>
              )}
            </For>
          </div>
        </Match>
        <Match when={true}>
          <div {...sx(s.table)} style={{ "grid-template-columns": template() }} role="table">
            <For each={props.block.columns}>
              {(column) => <span {...sx(s.label, s.th)}>{column.label}</span>}
            </For>
            <For each={indexes()}>
              {(index) => (
                <For each={props.block.columns}>
                  {(column) => <span {...sx(s.td)}>{cell(index, column)}</span>}
                </For>
              )}
            </For>
          </div>
        </Match>
      </Switch>
    </>
  );
}

function Checks(props: {
  block: Extract<LeafBlock, { type: "checks" }>;
  variant: string;
  ctx: Ctx;
}) {
  const on = () => (props.ctx.values[props.block.key] as readonly string[] | undefined) ?? [];
  const flip = (option: string) =>
    props.ctx.onChange(
      props.block.key,
      on().includes(option) ? on().filter((item) => item !== option) : [...on(), option],
    );
  return (
    <>
      <Show when={props.block.label}>
        <span {...sx(s.label)}>{props.block.label}</span>
      </Show>
      <Show
        when={props.variant === "tags"}
        fallback={
          <div {...sx(s.checks)}>
            <For each={props.block.options}>
              {(option) => (
                <label {...sx(s.check)}>
                  <button
                    {...sx(s.box, on().includes(option) && s.boxOn)}
                    style={{ padding: 0 }}
                    aria-pressed={on().includes(option) ? "true" : "false"}
                    aria-label={option}
                    onClick={() => flip(option)}
                  />
                  {option}
                </label>
              )}
            </For>
          </div>
        }
      >
        <div {...sx(s.chips)}>
          <For each={props.block.options}>
            {(option) => (
              <button
                {...sx(s.chip, on().includes(option) && s.chipOn)}
                aria-pressed={on().includes(option) ? "true" : "false"}
                onClick={() => flip(option)}
              >
                {option}
              </button>
            )}
          </For>
        </div>
      </Show>
    </>
  );
}

function Leaf(props: { block: LeafBlock; ctx: Ctx }) {
  const b = props.block;
  const variant = () => resolveVariant(b, props.ctx.overrides);
  const values = () => props.ctx.values;
  return (
    <Switch>
      <Match when={b.type === "heading" && b}>{(block) => <Heading text={block().text} />}</Match>
      <Match when={b.type === "trackers" && b}>
        {(block) => (
          <div {...sx(variant() === "boxes" ? s.trackerRow : s.blockCol)}>
            <For each={block().items}>
              {(item) => (
                <Tracker
                  item={item}
                  boxed={variant() === "boxes"}
                  value={num(values()[item.key], item.min)}
                  set={(n) => props.ctx.onChange(item.key, clamp(n, item))}
                />
              )}
            </For>
          </div>
        )}
      </Match>
      <Match when={b.type === "stats" && b}>
        {(block) => <Stats items={block().items} variant={variant()} values={values()} />}
      </Match>
      <Match when={b.type === "fields" && b}>
        {(block) => (
          <div
            {...sx(
              block().columns === 1 ? s.fields1 : block().columns === 3 ? s.fields3 : s.fields2,
            )}
          >
            <For each={block().items}>
              {(item) => (
                <div
                  {...sx(
                    s.field,
                    variant() === "inline" && s.fieldInline,
                    variant() === "boxed" && s.fieldBoxed,
                  )}
                >
                  <span {...sx(s.label)}>{item.label}</span>
                  <span
                    {...sx(
                      s.fieldValue,
                      variant() === "inline" && s.fieldInlineValue,
                      !values()[item.key] && s.empty,
                    )}
                  >
                    {String(values()[item.key] ?? "—")}
                  </span>
                </div>
              )}
            </For>
          </div>
        )}
      </Match>
      <Match when={b.type === "list" && b}>
        {(block) => <List block={block()} variant={variant()} ctx={props.ctx} />}
      </Match>
      <Match when={b.type === "checks" && b}>
        {(block) => <Checks block={block()} variant={variant()} ctx={props.ctx} />}
      </Match>
      <Match when={b.type === "text" && b}>
        {(block) => (
          <>
            <Show when={block().label}>
              <span {...sx(s.label)}>{block().label}</span>
            </Show>
            <p {...sx(s.text)} style={{ margin: 0 }}>
              {String(values()[block().key] ?? "")}
            </p>
          </>
        )}
      </Match>
      <Match when={b.type === "rolls" && b}>
        {(block) => (
          <div {...sx(s.rolls)}>
            <For each={block().items}>
              {(roll) => (
                <button {...sx(s.roll)} onClick={() => props.ctx.onRoll(roll.label, roll.dice)}>
                  {roll.label}
                  <span {...sx(s.rollDice)}>{roll.dice}</span>
                </button>
              )}
            </For>
          </div>
        )}
      </Match>
    </Switch>
  );
}

function Group(props: { block: GroupBlock; ctx: Ctx }) {
  const framed = () => resolveVariant(props.block, props.ctx.overrides) === "framed";
  return (
    <div {...sx(s.blockCol, framed() && s.framed)}>
      <Show when={props.block.title}>{(title) => <Heading text={title()} />}</Show>
      <For each={props.block.blocks}>
        {(child) => (
          <div {...sx(s.blockCol, props.ctx.customize && s.editable)}>
            <Show when={props.ctx.customize}>
              <EditBar block={child} ctx={props.ctx} nested />
            </Show>
            <Leaf block={child} ctx={props.ctx} />
          </div>
        )}
      </For>
    </div>
  );
}

function BlockCell(props: { block: LayoutBlock; ctx: Ctx }) {
  return (
    <div
      {...sx(s.blockCol, props.ctx.customize && s.editable)}
      style={{ "grid-column": `span ${resolveSpan(props.block, props.ctx.mode)}` }}
    >
      <Show when={props.ctx.customize}>
        <EditBar block={props.block} ctx={props.ctx} />
      </Show>
      <Show
        when={props.block.type === "group" && (props.block as GroupBlock)}
        fallback={<Leaf block={props.block as LeafBlock} ctx={props.ctx} />}
      >
        {(group) => <Group block={group()} ctx={props.ctx} />}
      </Show>
    </div>
  );
}

export function SheetBlocks(props: Props) {
  const { skin: themeSkin } = useTheme();
  const [page, setPage] = createSignal(props.layout.pages[0]?.id ?? "");
  const [width, setWidth] = createSignal(340);
  let root: HTMLDivElement | undefined;
  onSettled(() => {
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(root);
    onCleanup(() => observer.disconnect());
  });
  const current = () =>
    props.layout.pages.find((item) => item.id === page()) ?? props.layout.pages[0];
  const band = () => (props.header ?? themeSkin().header) === "band";
  const ctx = (): Ctx => ({
    values: props.values,
    onChange: props.onChange,
    onRoll: props.onRoll,
    overrides: props.overrides,
    customize: props.customize,
    onVariant: props.onVariant,
    onSpan: props.onSpan,
    mode: gridMode(width()),
  });
  return (
    <div {...sx(s.sheet)} ref={(element) => (root = element)} data-grid-mode={ctx().mode}>
      <header {...sx(band() ? s.nameBand : s.nameBlock)}>
        <h2 {...sx(s.name, band() && s.nameOnBand)}>{props.name}</h2>
        <Show when={props.subtitle}>
          <div {...sx(s.subtitle)}>{props.subtitle}</div>
        </Show>
      </header>
      <Show when={props.layout.pages.length > 1}>
        <div {...sx(s.tabs)} role="tablist">
          <For each={props.layout.pages}>
            {(item) => (
              <button
                role="tab"
                aria-selected={item.id === current()?.id ? "true" : "false"}
                {...sx(s.tab, item.id === current()?.id && s.tabOn)}
                onClick={() => setPage(item.id)}
              >
                {item.title}
              </button>
            )}
          </For>
        </div>
      </Show>
      <div {...sx(s.grid)}>
        <For each={current()?.blocks ?? []}>
          {(block) => <BlockCell block={block} ctx={ctx()} />}
        </For>
      </div>
    </div>
  );
}
