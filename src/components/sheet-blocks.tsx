import * as stylex from "@stylexjs/stylex";
import {
  For,
  Match,
  Show,
  Switch,
  createMemo,
  createSignal,
  createUniqueId,
  onCleanup,
  onSettled,
} from "solid-js";
import {
  blockShown,
  blockVariants,
  layoutTrackers,
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
import type { CompendiumEntry, EntryType, IndexRow } from "../domain/compendium";
import type { CompendiumStore } from "../client/compendium-store";
import { applyRowUpdate, rowUpdate, type RowUpdate } from "../domain/entry-diff";
import {
  entryFieldsForDisplay,
  rowFromEntry,
  revOf,
  rowsFromEntryList,
  sourceOf,
} from "../domain/compendium-rows";
import { searchEntries } from "../domain/compendium-search";
import type { Scalar } from "../domain/derived";
import {
  formulaHolds,
  refValues,
  sheetDerived,
  sheetScope,
  trackerMaxOf,
  type EntryFields,
} from "../domain/sheet-refs";
import { formatNumber, WhyValue, whyOf, type Why } from "./why-value";
import {
  PROGRESS_BOXES,
  TICKS_PER_BOX,
  clampTicks,
  progressBoxes,
  progressScore,
} from "../domain/progress";
import { slotLayout } from "../domain/slots";
import { rowsUpToLevel } from "../domain/progression";
import { acceptedFills, fillOffers, withRows } from "../domain/entry-fill";
import { allBlocks, findBlock } from "../domain/layout-edit";
import { colors, fonts, radii, skin } from "../theme/tokens.stylex";
import { useTheme } from "../theme/theme-context";
import { moveIndex } from "../client/sortable";
import { DropLine, SortHandle, createSortable } from "./sortable";
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
  picker: { position: "relative" },
  pickerButton: { cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "3px" },
  pickerEnd: { left: "auto", right: 0, maxWidth: "calc(100vw - 24px)" },
  pickerPanel: {
    position: "absolute",
    zIndex: 30,
    top: "calc(100% + 4px)",
    left: 0,
    width: "280px",
    maxHeight: "420px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "4px",
    ...hair,
    borderColor: colors.borderStrong,
    borderRadius: skin.controlRadius,
    backgroundColor: colors.surface,
    backgroundImage: skin.paper,
    backgroundSize: skin.paperSize,
    boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
  },
  pickerOption: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: "3px",
    padding: "4px 6px 6px",
    ...hair,
    borderRadius: skin.controlRadius,
    backgroundColor: { default: "transparent", ":hover": colors.surfaceHover },
    color: colors.text,
    textAlign: "left",
    cursor: "pointer",
  },
  pickerOptionOn: { borderColor: colors.accent, boxShadow: `inset 0 0 0 1px ${colors.accent}` },
  pickerName: {
    fontFamily: fonts.display,
    fontSize: "10px",
    textTransform: skin.headTransform,
    letterSpacing: skin.headTracking,
    color: colors.accent,
  },
  // Clipped so a long list previews as a few rows; inert, so nothing inside is clickable.
  pickerPreview: {
    display: "block",
    maxHeight: "110px",
    overflow: "hidden",
    pointerEvents: "none",
    fontSize: "12px",
    maskImage: "linear-gradient(to bottom, #000 75%, transparent)",
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
  // Label/value rows share their block's columns (subgrid), so values line up even
  // when a theme's letter-spaced labels outgrow the minimum width.
  labelled: {
    display: "grid",
    gridTemplateColumns: "minmax(52px, max-content) minmax(0, 1fr)",
    gap: "3px 6px",
  },
  trackerLine: {
    gridColumn: "1 / -1",
    display: "grid",
    gridTemplateColumns: "subgrid",
    alignItems: "center",
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
    height: "12px",
    ...hair,
    backgroundColor: skin.meterTrack,
    overflow: "hidden",
  },
  barFill: { position: "absolute", insetBlock: 0, left: 0, backgroundImage: skin.meterFill },
  // Numbers sit beside bars, not on them: ink on a solid fill isn't legible in every theme.
  barValue: {
    flexShrink: 0,
    minWidth: "34px",
    textAlign: "right",
    fontFamily: fonts.numeric,
    fontSize: "13px",
    fontWeight: 700,
  },
  clock: { cursor: "pointer", display: "block", color: colors.accent },
  progress: { display: "inline-flex", alignItems: "center", gap: "5px", flexWrap: "wrap" },
  progressBoxes: { display: "inline-flex", gap: "2px" },
  progressBox: {
    display: "block",
    ...hair,
    borderColor: colors.borderStrong,
    color: colors.accent,
    backgroundColor: colors.surface,
  },
  progressBoxLive: { cursor: "pointer" },
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
  input: {
    width: "100%",
    minWidth: 0,
    height: "24px",
    paddingInline: "5px",
    ...hair,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: "12px",
    boxSizing: "border-box",
    ":focus": { borderColor: colors.accent, outline: "none" },
  },
  textarea: { height: "auto", minHeight: "64px", paddingBlock: "4px", resize: "vertical" },
  maxEdit: {
    gridColumn: "1 / -1",
    display: "flex",
    alignItems: "center",
    gap: "4px",
    fontSize: "11px",
    color: colors.textMuted,
  },
  maxInput: { width: "64px" },
  editRow: { display: "flex", alignItems: "center", gap: "3px" },
  sortTable: { position: "relative" },
  sortCell: { display: "flex", alignItems: "center", paddingBlock: 0 },
  rowButton: {
    flexShrink: 0,
    width: "20px",
    height: "20px",
    padding: 0,
    ...hair,
    borderRadius: radii.sm,
    backgroundColor: { default: "transparent", ":hover": colors.surfaceHover },
    color: colors.textMuted,
    cursor: "pointer",
  },
  addRow: {
    alignSelf: "flex-start",
    paddingInline: "6px",
    paddingBlock: "1px",
    ...hair,
    borderStyle: "dashed",
    borderRadius: radii.sm,
    backgroundColor: "transparent",
    color: colors.textMuted,
    fontSize: "11px",
    cursor: "pointer",
  },
  statBar: {
    gridColumn: "1 / -1",
    display: "grid",
    gridTemplateColumns: "subgrid",
    alignItems: "center",
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
    gridTemplateColumns: "minmax(16px, auto) minmax(0, 1fr)",
    alignItems: "baseline",
    gap: "4px",
    minHeight: "21px",
    paddingBlock: "1px",
    ...underline,
  },
  slotNumber: { fontFamily: fonts.numeric, fontSize: "11px", color: colors.textFaint },
  slotCount: {
    alignSelf: "flex-end",
    fontFamily: fonts.numeric,
    fontSize: "11px",
    color: colors.textMuted,
  },
  slotOver: { color: colors.danger },
  progression: { display: "flex", flexDirection: "column", gap: "1px", fontSize: "13px" },
  progressionRow: {
    display: "grid",
    gridTemplateColumns: "2em minmax(0, 1fr)",
    gap: "6px",
    ...underline,
  },
  progressionNow: { fontWeight: 700 },
  progressionLevel: { fontFamily: fonts.numeric, color: colors.textMuted, textAlign: "right" },
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
  // compendium entries
  entry: { display: "flex", flexDirection: "column", gap: "3px" },
  entryHead: { display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "6px" },
  entryName: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: "13px",
    fontWeight: 700,
    textAlign: "left",
    textDecorationLine: { default: "none", ":hover": "underline" },
    textDecorationStyle: "dotted",
    textUnderlineOffset: "3px",
    cursor: "pointer",
  },
  entryLinked: { fontWeight: "inherit" },
  linkedCell: { display: "inline-flex", alignItems: "baseline", gap: "4px" },
  updateBadge: {
    padding: "0 3px",
    ...hair,
    borderColor: colors.accent,
    borderRadius: skin.controlRadius,
    backgroundColor: { default: colors.accentMuted, ":hover": colors.surfaceHover },
    color: colors.accent,
    fontSize: "11px",
    lineHeight: 1.3,
    cursor: "pointer",
  },
  review: { flexDirection: "column", alignItems: "stretch", marginTop: "4px" },
  change: { display: "block" },
  reviewActions: { display: "flex", gap: "6px" },
  entrySpacer: { flex: 1 },
  entryField: { display: "flex", flexDirection: "column", gap: "1px" },
  entryText: { fontFamily: fonts.body, whiteSpace: "pre-wrap", lineHeight: 1.35 },
  entryRows: { display: "flex", flexDirection: "column" },
  entryMissing: { color: colors.textFaint, fontStyle: "italic" },
  offer: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "6px",
    padding: "4px 6px",
    ...hair,
    borderColor: colors.accent,
    borderRadius: skin.controlRadius,
    backgroundColor: colors.accentMuted,
    fontSize: "12px",
  },
  search: { marginBottom: "2px" },
  option: {
    display: "flex",
    alignItems: "baseline",
    gap: "6px",
    padding: "4px 6px",
    borderWidth: 0,
    borderRadius: skin.controlRadius,
    backgroundColor: { default: "transparent", ":hover": colors.surfaceHover },
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: "13px",
    textAlign: "left",
    cursor: "pointer",
  },
  optionTags: { marginLeft: "auto", fontSize: "11px", color: colors.textFaint },
  hint: { padding: "4px 6px", fontSize: "12px", color: colors.textFaint, fontStyle: "italic" },
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
  // A label that rolls: the stat or tracker keeps its look, with a dotted underline as the cue.
  rollLabel: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    textAlign: "start",
    cursor: "pointer",
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
    textUnderlineOffset: "2px",
    color: { default: colors.textMuted, ":hover": colors.accent },
  },
  rowRoll: {
    paddingInline: "4px",
    paddingBlock: 0,
    ...hair,
    borderRadius: skin.controlRadius,
    backgroundColor: { default: "transparent", ":hover": colors.surfaceHover },
    color: colors.accent,
    fontSize: "12px",
    lineHeight: 1.4,
    cursor: "pointer",
  },
  derivedCell: { fontFamily: fonts.numeric, color: colors.textMuted },
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
  /** `row` is the list row `@row.column` refers to. */
  onRoll: (label: string, dice: string, row?: RollRow) => void;
  /** Overrides the active theme's header style (the lab renders several themes at once). */
  header?: "centered" | "band";
  /** Controlled page id (the layout editor keeps its outline and preview in step). */
  page?: string;
  onPage?: (pageId: string) => void;
  /** Hide the name header (the character sheet draws its own, with the portrait). */
  showName?: boolean;
  /** Fields, text, plain stats, and list rows become inputs; trackers show a max input. */
  editing?: boolean;
  /** Tracker values when they live outside `values` (Character.tickers). */
  trackerValue?: (item: TrackerItem) => number;
  /**
   * The character's own maximum, if it has one (an override, or a draft while
   * editing). The sheet works out the rest: the item's `maxFrom`, or its max.
   */
  trackerMax?: (item: TrackerItem) => number | undefined;
  onTracker?: (key: string, value: number) => void;
  /** Per-character maximum while editing; `null` restores the layout's. */
  onTrackerMax?: (key: string, max: number | null) => void;
  /** Stats derived from other values (legacy formulas); these are never edited directly. */
  computed?: (key: string) => Scalar | undefined;
  /** Viewers who can't edit this character: compendium pickers are hidden. */
  readOnly?: boolean;
  /** The world's compendium, for entry blocks and lists with a source. */
  compendium?: CompendiumLookup;
  /** Show an entry's full card (the sheet only shows a summary). */
  onOpenEntry?: (entryId: string) => void;
  /**
   * Only these blocks, by id and in this order, without page tabs (a character
   * builder step). The whole layout still feeds derived values, tracker refs
   * and copy targets; unknown ids are skipped.
   */
  blocks?: readonly string[];
};

/** A list row a roll reads `@row.column` from. */
export type RollRow = { key: string; index: number };
/** The character a roll's `@refs` resolve against, on the server. */
export type SheetRoll = { characterId: string; row?: RollRow };

/**
 * What the sheet reads from the world's compendium (src/client/compendium.ts
 * provides it): names and revisions from the index, fields when loaded.
 */
export type CompendiumLookup = Pick<
  CompendiumStore,
  "entry" | "missing" | "row" | "rowsOfType" | "typeById" | "load"
>;

const scalar = (value: SheetValues[string]) =>
  typeof value === "string" || typeof value === "number" ? value : "";

const num = (value: SheetValues[string], fallback = 0) =>
  typeof value === "number" ? value : Number(value ?? fallback) || fallback;
const clamp = (value: number, item: TrackerItem) => Math.max(item.min, Math.min(item.max, value));

/** Derived values can be fractional; sheets show at most two decimals. */
/** A computed value as shown: text as is, numbers to at most two places. */
/** A block item's label, which rolls its notation when the author gave it one. */
function ItemLabel(props: { text: string; roll?: string; onRoll: (dice: string) => void }) {
  return (
    <Show when={props.roll} fallback={<span {...sx(s.label)}>{props.text}</span>}>
      {(roll) => (
        <button
          type="button"
          {...sx(s.label, s.rollLabel)}
          title={`Roll ${roll()}`}
          onClick={() => props.onRoll(roll())}
        >
          {props.text}
        </button>
      )}
    </Show>
  );
}

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
  // Segment i stands for the value min + i + 1, so a clock needn't start at 0.
  const valueAt = (i: number) => props.item.min + i + 1;
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
            fill={valueAt(i) <= props.value ? "currentColor" : "transparent"}
            stroke="currentColor"
            stroke-width="1.5"
            role="button"
            aria-label={`Set ${props.item.label} to ${valueAt(i)}`}
            onClick={() => props.set(valueAt(i) === props.value ? valueAt(i) - 1 : valueAt(i))}
          />
        )}
      </For>
    </svg>
  );
}

/**
 * An Ironsworn-style progress track: ten boxes of four ticks. Ticks draw as
 * strokes (/ then X, then the box's sides); clicking a box fills up to it and
 * the steppers mark a single tick. The score is the number of full boxes.
 */
function ProgressTrack(props: {
  label: string;
  ticks: number;
  set?: (ticks: number) => void;
  small?: boolean;
}) {
  const size = () => (props.small ? 11 : 18);
  const strokes = (ticks: number) => {
    const s = size() - 3;
    return [
      `M 2 ${s + 1} L ${s + 1} 2`,
      `M 2 2 L ${s + 1} ${s + 1}`,
      `M ${size() / 2} 1 L ${size() / 2} ${s + 2}`,
      `M 1 ${size() / 2} L ${s + 2} ${size() / 2}`,
    ].slice(0, ticks);
  };
  const setTo = (ticks: number) => props.set?.(clampTicks(ticks));
  return (
    <span {...sx(s.progress)}>
      <Show when={props.set && !props.small}>
        <Stepper label={props.label} glyph="−" onClick={() => setTo(props.ticks - 1)} />
      </Show>
      <span
        {...sx(s.progressBoxes)}
        role="group"
        aria-label={`${props.label} progress, ${progressScore(props.ticks)} of ${PROGRESS_BOXES}`}
      >
        <For each={progressBoxes(props.ticks)}>
          {(ticks, box) => (
            <svg
              {...sx(s.progressBox, props.set && s.progressBoxLive)}
              width={size()}
              height={size()}
              viewBox={`0 0 ${size()} ${size()}`}
              role={props.set ? "button" : undefined}
              aria-label={props.set ? `Fill ${props.label} to box ${box() + 1}` : undefined}
              onClick={() => {
                const full = (box() + 1) * TICKS_PER_BOX;
                setTo(props.ticks === full ? full - TICKS_PER_BOX : full);
              }}
            >
              <For each={strokes(ticks)}>
                {(d) => <path d={d} stroke="currentColor" stroke-width="1.6" fill="none" />}
              </For>
            </svg>
          )}
        </For>
      </span>
      <Show when={props.set && !props.small}>
        <Stepper label={props.label} glyph="+" onClick={() => setTo(props.ticks + 1)} />
      </Show>
      <span {...sx(s.ofMax)}>{progressScore(props.ticks)}</span>
    </span>
  );
}

function Tracker(props: {
  item: TrackerItem;
  boxed: boolean;
  value: number;
  set: (n: number) => void;
  /** Editing: the layout's own maximum as a placeholder, and a setter for this character's. */
  maxEdit?: { layoutMax: number; set: (max: number | null) => void };
  onRoll: (dice: string) => void;
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
      <Match when={display() === "progress"}>
        <ProgressTrack label={props.item.label} ticks={props.value} set={props.set} />
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
          </span>
          <span {...sx(s.barValue)}>
            {props.value}
            <span {...sx(s.ofMax)}>/{props.item.max}</span>
          </span>
          <Stepper label={props.item.label} glyph="+" onClick={() => props.set(props.value + 1)} />
        </span>
      </Match>
    </Switch>
  );
  const maxInput = () => (
    <Show when={props.maxEdit}>
      {(edit) => (
        <label {...sx(s.maxEdit)}>
          max
          <input
            {...sx(s.input, s.maxInput)}
            type="number"
            step="1"
            min={props.item.min}
            aria-label={`${props.item.label} maximum`}
            title="Blank uses the layout's maximum"
            placeholder={String(edit().layoutMax)}
            value={props.item.max === edit().layoutMax ? "" : props.item.max}
            onChange={(event) => {
              const raw = event.currentTarget.value.trim();
              const n = Number(raw);
              edit().set(raw && Number.isSafeInteger(n) ? Math.max(props.item.min, n) : null);
            }}
          />
        </label>
      )}
    </Show>
  );
  return (
    <Show
      when={props.boxed}
      fallback={
        <div {...sx(s.trackerLine)}>
          <ItemLabel text={props.item.label} roll={props.item.roll} onRoll={props.onRoll} />
          {body()}
          {maxInput()}
        </div>
      }
    >
      <div {...sx(s.trackerBox)}>
        <ItemLabel
          text={props.item.short ?? props.item.label}
          roll={props.item.roll}
          onRoll={props.onRoll}
        />
        {body()}
        <Show when={props.item.short}>
          <span {...sx(s.ofMax)}>{props.item.label}</span>
        </Show>
        {maxInput()}
      </div>
    </Show>
  );
}

/** Text input that reports its value when you leave it (or press Enter), not per keystroke. */
function CommitInput(props: {
  value: string | number;
  label: string;
  numeric?: boolean;
  multiline?: boolean;
  onCommit: (value: string | number) => void;
}) {
  // Memoized, so an update elsewhere on the character (another player's edit, the ack of an
  // earlier one) leaves the input alone: Solid re-applies all of an element's dynamic
  // attributes when one of them re-runs, and rewriting `value` would clear what's typed here
  // and not yet committed.
  const value = createMemo(() => props.value);
  const type = createMemo(() => (props.numeric ? "number" : "text"));
  const commit = (raw: string) => {
    const next =
      props.numeric && raw.trim() !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw;
    if (next !== props.value) props.onCommit(next);
  };
  return (
    <Show
      when={props.multiline}
      fallback={
        <input
          {...sx(s.input)}
          aria-label={props.label}
          type={type()}
          value={value()}
          onChange={(event) => commit(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      }
    >
      <textarea
        {...sx(s.input, s.textarea)}
        aria-label={props.label}
        value={String(value())}
        onChange={(event) => commit(event.currentTarget.value)}
      />
    </Show>
  );
}

function Cell(props: {
  column: ListColumn;
  row: ListRow | undefined;
  onRoll: (dice: string) => void;
  onToggle: () => void;
  derived: (column: ListColumn, row: ListRow) => Scalar | undefined;
  /** Set this cell's value in place (progress tracks mark ticks without editing the sheet). */
  onSet?: (value: number) => void;
}) {
  const value = () => props.row?.[props.column.key];
  return (
    <Switch fallback={<span>{value() === undefined ? "" : String(value())}</span>}>
      <Match when={props.column.kind === "progress" && props.row}>
        <ProgressTrack
          small
          label={props.column.label}
          ticks={clampTicks(value())}
          set={props.onSet}
        />
      </Match>
      <Match when={props.column.kind === "derived"}>
        <span {...sx(s.derivedCell)}>
          {props.row ? formatNumber(props.derived(props.column, props.row) ?? 0) : ""}
        </span>
      </Match>
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

type Ctx = Omit<
  Props,
  "layout" | "name" | "subtitle" | "header" | "showName" | "page" | "onPage"
> & {
  mode: GridMode;
  /** The layout's list at `key`, for filling it from an entry. */
  listBlock: (key: string) => Extract<LeafBlock, { type: "list" }> | undefined;
  /** A derived list column's value for one row. */
  derivedCell: (column: ListColumn, row: ListRow) => Scalar | undefined;
  /** Where a derived value comes from: its formula, what it read, or why it failed. */
  why: (key: string) => Why | undefined;
  /** Whether a condition formula holds on this character (a block's `when`). */
  holds: (formula: string) => boolean;
  /** A tracker's maximum without the character's own: its `maxFrom` formula's, or its max. */
  defaultMax: (item: TrackerItem) => number;
};

const Heading = (props: { text: string }) => (
  <div {...sx(s.head)}>
    {props.text}
    <span {...sx(s.rule)} />
  </div>
);

/** Customize-mode controls: pick a variant and how many of the 6 columns to span. */
/**
 * Style picker: each option is the block itself, rendered small and inert with
 * that variant, in the current theme and with the character's real values.
 */
function VariantPicker(props: { block: LayoutBlock; ctx: Ctx }) {
  const [open, setOpen] = createSignal(false);
  const id = createUniqueId();
  let root: HTMLDivElement | undefined;
  const current = () => resolveVariant(props.block, props.ctx.overrides);
  const variants = () => blockVariants[props.block.type] as readonly string[];
  onSettled(() => {
    const outside = (event: PointerEvent) => {
      if (open() && root && !root.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (open() && event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    onCleanup(() => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    });
  });
  const preview = (variant: string): Ctx => ({
    ...props.ctx,
    customize: false,
    overrides: { ...props.ctx.overrides, [props.block.id]: variant },
    onChange: () => {},
    onRoll: () => {},
  });
  const choose = (variant: string) => {
    props.ctx.onVariant?.(props.block.id, variant);
    setOpen(false);
  };
  return (
    <div {...sx(s.picker)} ref={(element) => (root = element)}>
      <button
        {...sx(s.editSelect, s.pickerButton)}
        aria-label={`${props.block.id} style`}
        aria-haspopup="listbox"
        aria-expanded={open() ? "true" : "false"}
        aria-controls={id}
        onClick={() => setOpen(!open())}
      >
        {current()} <span aria-hidden="true">▾</span>
      </button>
      <Show when={open()}>
        <div id={id} {...sx(s.pickerPanel)} role="listbox" aria-label={`${props.block.id} styles`}>
          <For each={variants()}>
            {(variant) => (
              <button
                role="option"
                aria-selected={variant === current() ? "true" : "false"}
                {...sx(s.pickerOption, variant === current() && s.pickerOptionOn)}
                onClick={() => choose(variant)}
              >
                <span {...sx(s.pickerName)}>{variant}</span>
                <span {...sx(s.pickerPreview)} aria-hidden="true" inert>
                  <Show
                    when={props.block.type === "group" && (props.block as GroupBlock)}
                    fallback={<Leaf block={props.block as LeafBlock} ctx={preview(variant)} />}
                  >
                    {(group) => <Group block={group()} ctx={preview(variant)} />}
                  </Show>
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function EditBar(props: { block: LayoutBlock; ctx: Ctx; nested?: boolean }) {
  const variants = () => blockVariants[props.block.type] as readonly string[];
  const spanKey = () => (props.ctx.mode === "wide" ? "wide" : "span");
  return (
    <div {...sx(s.editBar)}>
      <span {...sx(s.editKind)}>{props.block.type}</span>
      <Show when={variants().length > 1}>
        <VariantPicker block={props.block} ctx={props.ctx} />
      </Show>
      <Show when={!props.nested && props.ctx.onSpan && props.ctx.mode !== "narrow"}>
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

function Stats(props: { items: readonly StatItem[]; variant: string; ctx: Ctx }) {
  const value = (item: StatItem) => props.ctx.computed?.(item.key) ?? props.ctx.values[item.key];
  const plain = (item: StatItem) => {
    const v = value(item);
    return typeof v === "string" || typeof v === "number" ? v : "";
  };
  const shown = (item: StatItem) => {
    const v = plain(item);
    return v === "" ? "—" : typeof v === "number" ? formatNumber(v) : v;
  };
  const wrap = (item: StatItem, text: string) => (
    <WhyValue why={props.ctx.why(item.key)}>{text}</WhyValue>
  );
  const label = (item: StatItem) => (
    <ItemLabel
      text={item.label}
      roll={item.roll}
      onRoll={(dice) => props.ctx.onRoll(item.label, dice)}
    />
  );
  // While editing, stats that aren't derived from other values become inputs.
  const editor = () => (
    <div {...sx(s.fields3)}>
      <For each={props.items}>
        {(item) => (
          <label {...sx(s.field)}>
            <span {...sx(s.label)}>{item.label}</span>
            <Show
              when={props.ctx.computed?.(item.key) === undefined}
              fallback={<span {...sx(s.statLineValue)}>{wrap(item, shown(item))}</span>}
            >
              <CommitInput
                label={item.label}
                value={plain(item)}
                numeric={typeof value(item) !== "string"}
                onCommit={(next) => props.ctx.onChange(item.key, next)}
              />
            </Show>
          </label>
        )}
      </For>
    </div>
  );
  return (
    <Show when={!props.ctx.editing} fallback={editor()}>
      <Switch>
        <Match when={props.variant === "bars"}>
          <div {...sx(s.labelled)}>
            <For each={props.items}>
              {(item) => (
                <div {...sx(s.statBar)}>
                  {label(item)}
                  <Show
                    when={item.max && typeof value(item) === "number"}
                    fallback={<span {...sx(s.statLineValue)}>{wrap(item, shown(item))}</span>}
                  >
                    <span {...sx(s.numberLine)}>
                      <span {...sx(s.bar)}>
                        <span
                          {...sx(s.barFill)}
                          style={{
                            width: `${Math.min(100, ((value(item) as number) / item.max!) * 100)}%`,
                          }}
                        />
                      </span>
                      <span {...sx(s.barValue)}>{wrap(item, shown(item))}</span>
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
                  {label(item)}
                  <span {...sx(s.statBoxValue)}>{wrap(item, shown(item))}</span>
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
                  {label(item)}
                  <span {...sx(s.statLineValue)}>{wrap(item, shown(item))}</span>
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
                  {label(item)}
                  <span {...sx(s.statValue)}>{wrap(item, shown(item))}</span>
                </div>
              )}
            </For>
          </div>
        </Match>
      </Switch>
    </Show>
  );
}

const emptyCell = (column: ListColumn): ListRow[string] =>
  column.kind === "progress"
    ? 0
    : column.kind === "number"
      ? ""
      : column.kind === "tags"
        ? []
        : column.kind === "check"
          ? false
          : "";

/**
 * Edits a list block's rows in place: every cell is an input that commits on
 * blur; rows can be added and removed. Always a table, whatever the variant.
 */
export function ListEditor(props: {
  block: Pick<Extract<LeafBlock, { type: "list" }>, "key" | "title" | "columns">;
  rows: readonly ListRow[];
  onSave: (rows: readonly ListRow[]) => void;
  /** Values for derived columns, which are shown but never edited. */
  derived?: (column: ListColumn, row: ListRow) => Scalar | undefined;
}) {
  const save = (rows: readonly ListRow[]) => props.onSave(rows);
  const setCell = (index: number, key: string, value: ListRow[string]) =>
    save(props.rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  const blank = (): ListRow =>
    Object.fromEntries(
      props.block.columns
        .filter((column) => column.kind !== "derived")
        .map((column) => [column.key, emptyCell(column)]),
    );
  const template = () =>
    [
      "14px",
      ...props.block.columns.map((column) =>
        column.kind === "check"
          ? "auto"
          : column.kind === "text"
            ? "minmax(0, 2fr)"
            : "minmax(0, 1fr)",
      ),
      "20px",
    ].join(" ");
  const label = (column: ListColumn, index: number) =>
    `${props.block.title ?? props.block.key} row ${index + 1} ${column.label || column.key}`;
  const sortable = createSortable({
    count: () => props.rows.length,
    onMove: (from, to) => save(moveIndex(props.rows, from, to)),
  });
  return (
    <>
      <div
        {...sx(s.table, s.sortTable)}
        style={{ "grid-template-columns": template() }}
        ref={sortable.container}
      >
        <span {...sx(s.th)} />
        <For each={props.block.columns}>
          {(column) => <span {...sx(s.label, s.th)}>{column.label}</span>}
        </For>
        <span {...sx(s.th)} />
        <For each={props.rows.map((_, i) => i)}>
          {(index) => (
            <>
              <span {...sx(s.td, s.sortCell)} {...sortable.item(index)}>
                <SortHandle
                  sortable={sortable}
                  index={index}
                  label={`${props.block.title ?? props.block.key} row ${index + 1}`}
                />
              </span>
              <For each={props.block.columns}>
                {(column) => {
                  const value = () => props.rows[index]?.[column.key];
                  return (
                    <span {...sx(s.td)}>
                      <Switch
                        fallback={
                          <CommitInput
                            label={label(column, index)}
                            value={
                              typeof value() === "string" || typeof value() === "number"
                                ? (value() as string | number)
                                : ""
                            }
                            numeric={column.kind === "number"}
                            onCommit={(next) => setCell(index, column.key, next)}
                          />
                        }
                      >
                        <Match when={column.kind === "derived"}>
                          <span {...sx(s.derivedCell)} aria-label={label(column, index)}>
                            {formatNumber(
                              (props.rows[index] && props.derived?.(column, props.rows[index])) ??
                                0,
                            )}
                          </span>
                        </Match>
                        <Match when={column.kind === "select"}>
                          <select
                            {...sx(s.input)}
                            aria-label={label(column, index)}
                            value={typeof value() === "string" ? (value() as string) : ""}
                            onChange={(event) =>
                              setCell(index, column.key, event.currentTarget.value)
                            }
                          >
                            <option value="">—</option>
                            <For each={column.options ?? []}>
                              {(option) => <option value={option}>{option}</option>}
                            </For>
                          </select>
                        </Match>
                        <Match when={column.kind === "progress"}>
                          <ProgressTrack
                            small
                            label={label(column, index)}
                            ticks={clampTicks(value())}
                            set={(ticks) => setCell(index, column.key, ticks)}
                          />
                        </Match>
                        <Match when={column.kind === "check"}>
                          <button
                            {...sx(s.box, value() === true && s.boxOn)}
                            style={{ padding: 0, cursor: "pointer" }}
                            aria-label={label(column, index)}
                            aria-pressed={value() === true ? "true" : "false"}
                            onClick={() => setCell(index, column.key, value() !== true)}
                          />
                        </Match>
                        <Match when={column.kind === "tags"}>
                          <CommitInput
                            label={`${label(column, index)} (comma separated)`}
                            value={Array.isArray(value()) ? (value() as string[]).join(", ") : ""}
                            onCommit={(next) =>
                              setCell(
                                index,
                                column.key,
                                String(next)
                                  .split(",")
                                  .map((tag) => tag.trim())
                                  .filter(Boolean),
                              )
                            }
                          />
                        </Match>
                      </Switch>
                    </span>
                  );
                }}
              </For>
              <span {...sx(s.td)}>
                <button
                  {...sx(s.rowButton)}
                  aria-label={`Remove ${props.block.title ?? props.block.key} row ${index + 1}`}
                  onClick={() => save(props.rows.filter((_, i) => i !== index))}
                >
                  ×
                </button>
              </span>
            </>
          )}
        </For>
        <DropLine sortable={sortable} />
      </div>
      <button {...sx(s.addRow)} onClick={() => save([...props.rows, blank()])}>
        + Add {props.block.title ? props.block.title.toLowerCase() : "row"}
      </button>
    </>
  );
}

function List(props: { block: Extract<LeafBlock, { type: "list" }>; variant: string; ctx: Ctx }) {
  const rows = () => (props.ctx.values[props.block.key] as readonly ListRow[] | undefined) ?? [];
  const count = () => Math.max(rows().length, props.block.slots ?? 0);
  // Bulky rows take several slots; the count is shown, never enforced.
  const slots = () => slotLayout(rows(), props.block.slotSize);
  const emptySlots = () =>
    Array.from(
      { length: Math.max(0, (props.block.slots ?? 0) - slots().used) },
      (_, i) => slots().used + i,
    );
  const indexes = () => Array.from({ length: count() }, (_, i) => i);
  const [first, ...rest] = props.block.columns;
  // What names a row: its `name` column, else the first text column (a "Prep." check may come first).
  const labelColumn =
    props.block.columns.find((column) => column.key === "name") ??
    props.block.columns.find((column) => column.kind === "text") ??
    first;
  const rowLabel = (index: number) => String(rows()[index]?.[labelColumn.key] ?? "");
  const rollRow = (index: number) => (dice: string) =>
    props.ctx.onRoll(rowLabel(index), dice, { key: props.block.key, index });
  // The block's own roll, offered on every filled row ("1d20 + @row.bonus").
  const rowRoll = (index: number) => (
    <Show when={props.block.roll && rows()[index]}>
      <button
        type="button"
        {...sx(s.rowRoll)}
        title={`Roll ${props.block.roll}`}
        aria-label={`Roll ${rowLabel(index) || `row ${index + 1}`}`}
        onClick={() => rollRow(index)(props.block.roll!)}
      >
        ⚄
      </button>
    </Show>
  );
  const toggle = (index: number, key: string) =>
    props.ctx.onChange(
      props.block.key,
      rows().map((row, i) => (i === index ? { ...row, [key]: row[key] !== true } : row)),
    );
  // A row copied from the compendium links back to its entry from its label cell.
  const linked = (index: number) => {
    const row = rows()[index];
    const id = row && sourceOf(row);
    return id && props.ctx.onOpenEntry && props.ctx.compendium?.row(id) ? id : undefined;
  };
  // The entry changed since the row was copied: offered, never applied on its own.
  const stale = (index: number) => {
    const row = rows()[index];
    const id = row && sourceOf(row);
    const copied = row && revOf(row);
    const current = id ? props.ctx.compendium?.row(id)?.rev : undefined;
    return !props.ctx.readOnly && copied !== undefined && current !== undefined && current > copied;
  };
  const [review, setReview] = createSignal<{
    index: number;
    entry: CompendiumEntry;
    update: RowUpdate;
  } | null>(null);
  const openReview = async (index: number) => {
    const id = sourceOf(rows()[index] ?? {});
    const [entry] = id ? ((await props.ctx.compendium?.load([id])) ?? []) : [];
    const row = rows()[index];
    const update = entry && row ? rowUpdate(row, entry, props.block.columns) : undefined;
    setReview(entry && update ? { index, entry, update } : null);
  };
  const settle = (apply: boolean) => {
    const current = review();
    if (!current) return;
    props.ctx.onChange(
      props.block.key,
      rows().map((row, i) =>
        i !== current.index
          ? row
          : apply
            ? applyRowUpdate(row, current.entry, props.block.columns)
            : { ...row, _rev: current.update.rev },
      ),
    );
    setReview(null);
  };
  const cellText = (value: ListRow[string] | undefined) =>
    value === undefined || value === ""
      ? "—"
      : Array.isArray(value)
        ? value.join(", ")
        : String(value);
  const cell = (index: number, column: ListColumn) => (
    <Show
      when={column === labelColumn && linked(index)}
      fallback={
        <Cell
          column={column}
          row={rows()[index]}
          onRoll={rollRow(index)}
          onToggle={() => toggle(index, column.key)}
          derived={props.ctx.derivedCell}
          onSet={
            props.ctx.readOnly
              ? undefined
              : (next) =>
                  props.ctx.onChange(
                    props.block.key,
                    rows().map((row, i) => (i === index ? { ...row, [column.key]: next } : row)),
                  )
          }
        />
      }
    >
      {(id) => (
        <span {...sx(s.linkedCell)}>
          <button
            {...sx(s.entryName, s.entryLinked)}
            title="Open in the compendium"
            onClick={() => props.ctx.onOpenEntry?.(id())}
          >
            {String(rows()[index]?.[column.key] ?? "")}
          </button>
          <Show when={stale(index)}>
            <button
              type="button"
              {...sx(s.updateBadge)}
              title="Changed in the compendium since it was added — review"
              aria-label={`Review changes to ${String(rows()[index]?.[column.key] ?? "this row")}`}
              onClick={() => void openReview(index)}
            >
              ↻
            </button>
          </Show>
        </span>
      )}
    </Show>
  );
  const source = () =>
    props.block.source && props.ctx.compendium && !props.ctx.readOnly
      ? props.block.source.entryType
      : undefined;
  const template = () =>
    [
      ...props.block.columns.map((column) =>
        column.kind === "text"
          ? "minmax(0, 1fr)"
          : column.kind === "tags"
            ? "minmax(0, 0.8fr)"
            : "auto",
      ),
      ...(props.block.roll ? ["auto"] : []),
    ].join(" ");
  return (
    <>
      <Show when={props.block.title}>{(title) => <Heading text={title()} />}</Show>
      <Switch>
        <Match when={props.ctx.editing}>
          <ListEditor
            block={props.block}
            rows={rows()}
            onSave={(next) => props.ctx.onChange(props.block.key, next)}
            derived={props.ctx.derivedCell}
          />
        </Match>
        <Match when={props.variant === "cards"}>
          <div {...sx(s.cards)}>
            <For each={rows().map((_, i) => i)}>
              {(index) => (
                <div {...sx(s.card)}>
                  <span {...sx(s.cardTitle)}>
                    {String(rows()[index]?.[first.key] ?? "")} {rowRoll(index)}
                  </span>
                  <For each={rest}>
                    {(column) => (
                      <Show when={(rows()[index]?.[column.key] ?? "") !== ""}>
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
            <Show when={props.block.slotSize}>
              <span
                {...sx(s.slotCount, slots().used > (props.block.slots ?? Infinity) && s.slotOver)}
              >
                {slots().used}
                {props.block.slots ? ` / ${props.block.slots}` : ""} slots
              </span>
            </Show>
            <For each={slots().placed}>
              {(place) => (
                <div
                  {...sx(s.slot)}
                  style={{ "min-height": `${21 * place.size}px` }}
                  data-size={place.size}
                >
                  <span {...sx(s.slotNumber)}>
                    {place.size > 1
                      ? `${place.start + 1}–${place.start + place.size}`
                      : place.start + 1}
                  </span>
                  <span {...sx(s.slotBody)}>
                    <For each={props.block.columns}>{(column) => cell(place.index, column)}</For>
                    {rowRoll(place.index)}
                  </span>
                </div>
              )}
            </For>
            <For each={emptySlots()}>
              {(slot) => (
                <div {...sx(s.slot)}>
                  <span {...sx(s.slotNumber)}>{slot + 1}</span>
                  <span {...sx(s.slotBody)} />
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
            <Show when={props.block.roll}>
              <span {...sx(s.th)} />
            </Show>
            <For each={indexes()}>
              {(index) => (
                <>
                  <For each={props.block.columns}>
                    {(column) => <span {...sx(s.td)}>{cell(index, column)}</span>}
                  </For>
                  <Show when={props.block.roll}>
                    <span {...sx(s.td)}>{rowRoll(index)}</span>
                  </Show>
                </>
              )}
            </For>
          </div>
        </Match>
      </Switch>
      <Show when={review()}>
        {(current) => (
          <div
            {...sx(s.offer, s.review)}
            role="dialog"
            aria-label={`Changes to ${current().entry.name}`}
          >
            <span>
              {current().entry.name} has changed in the compendium
              {current().update.changes.length
                ? ":"
                : ", but not in the columns this sheet copies."}
            </span>
            <For each={current().update.changes}>
              {(change) => (
                <span {...sx(s.change)}>
                  <span {...sx(s.label)}>{change.label}</span> <del>{cellText(change.from)}</del> →{" "}
                  <ins>{cellText(change.to)}</ins>
                </span>
              )}
            </For>
            <span {...sx(s.reviewActions)}>
              <button {...sx(s.addRow)} onClick={() => settle(true)}>
                Update the row
              </button>
              <button {...sx(s.addRow)} onClick={() => settle(false)}>
                Keep mine
              </button>
            </span>
          </div>
        )}
      </Show>
      <Show when={source()}>
        {(typeId) => (
          <EntryPicker
            trigger="+ From compendium"
            label={props.ctx.compendium?.typeById(typeId())?.plural ?? "Entries"}
            entries={props.ctx.compendium?.rowsOfType(typeId()) ?? []}
            onPick={async (picked) => {
              const [entry] = (await props.ctx.compendium?.load([picked.id])) ?? [];
              if (entry)
                props.ctx.onChange(props.block.key, [
                  ...rows(),
                  rowFromEntry(entry, props.block.columns),
                ]);
            }}
          />
        )}
      </Show>
    </>
  );
}

/** A searchable popover of compendium entries. */
function EntryPicker(props: {
  trigger: string;
  label: string;
  /** Open leftward from the button (it sits at the right edge of the block). */
  alignEnd?: boolean;
  entries: readonly IndexRow[];
  onPick: (entry: IndexRow) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const id = createUniqueId();
  let root: HTMLDivElement | undefined;
  onSettled(() => {
    const outside = (event: PointerEvent) => {
      if (open() && root && !root.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (open() && event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    onCleanup(() => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    });
  });
  const results = () => searchEntries(props.entries, query()).slice(0, 60);
  return (
    <div {...sx(s.picker)} ref={(element) => (root = element)}>
      <button
        {...sx(s.addRow)}
        aria-haspopup="dialog"
        aria-expanded={open() ? "true" : "false"}
        aria-controls={id}
        onClick={() => {
          setQuery("");
          setOpen(!open());
        }}
      >
        {props.trigger}
      </button>
      <Show when={open()}>
        <div
          id={id}
          {...sx(s.pickerPanel, props.alignEnd && s.pickerEnd)}
          role="dialog"
          aria-label={props.label}
        >
          <input
            {...sx(s.input, s.search)}
            ref={(element) => queueMicrotask(() => element.focus())}
            aria-label={`Search ${props.label.toLowerCase()}`}
            placeholder={`Search ${props.label.toLowerCase()}…`}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && results()[0]) {
                props.onPick(results()[0]);
                setOpen(false);
              }
            }}
          />
          <div role="listbox" aria-label={props.label}>
            <For each={results()}>
              {(entry) => (
                <button
                  role="option"
                  aria-selected="false"
                  {...sx(s.option)}
                  onClick={() => {
                    props.onPick(entry);
                    setOpen(false);
                  }}
                >
                  {entry.name}
                  <Show when={entry.tags.length}>
                    <span {...sx(s.optionTags)}>{entry.tags.join(" · ")}</span>
                  </Show>
                </button>
              )}
            </For>
            <Show when={!results().length}>
              <span {...sx(s.hint)}>
                {props.entries.length
                  ? "No matches."
                  : `No ${props.label.toLowerCase()} in the compendium yet.`}
              </span>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}

/** One entry field on a sheet: text as prose, tags inline, list rows as short lines. */
function EntryValue(props: {
  field: EntryType["fields"][number];
  value: CompendiumEntry["fields"][string];
}) {
  const rows = () => (Array.isArray(props.value) ? props.value : []) as readonly ListRow[];
  return (
    <Switch fallback={<span {...sx(s.entryText)}>{String(props.value)}</span>}>
      <Match when={props.field.kind === "tags" && Array.isArray(props.value)}>
        <span>
          <For each={props.value as readonly string[]}>
            {(tag) => <span {...sx(s.tag)}>{tag}</span>}
          </For>
        </span>
      </Match>
      <Match when={props.field.kind === "list"}>
        <span {...sx(s.entryRows)}>
          <For each={rows()}>
            {(row) => (
              <span>
                {(props.field.columns ?? [])
                  .map((column) => row[column.key])
                  .filter((value) => value !== undefined && value !== "" && value !== false)
                  .map((value) => (Array.isArray(value) ? value.join(", ") : String(value)))
                  .join(" · ")}
              </span>
            )}
          </For>
        </span>
      </Match>
    </Switch>
  );
}

/**
 * A compendium entry picked for this character, shown live: edits to the entry
 * show up here. Picking can offer to copy the entry's lists (a Knight's starting
 * Property) into the sheet; it never does so on its own.
 */
function EntryBlock(props: {
  block: Extract<LeafBlock, { type: "entry" }>;
  variant: string;
  ctx: Ctx;
}) {
  const [offer, setOffer] = createSignal<CompendiumEntry | null>(null);
  const row = () => (id() ? lookup()?.row(id()!) : undefined);
  const id = () => {
    const value = props.ctx.values[props.block.key];
    return typeof value === "string" && value ? value : undefined;
  };
  const lookup = () => props.ctx.compendium;
  const entry = () => (id() ? lookup()?.entry(id()!) : undefined);
  const type = () => lookup()?.typeById(props.block.entryType);
  const label = () => props.block.label ?? type()?.name ?? "Entry";
  const canPick = () => !props.ctx.readOnly && !!lookup() && !!type();
  const fills = (picked: CompendiumEntry) =>
    fillOffers(picked, props.block, props.ctx.listBlock, props.ctx.values);
  const pick = async (picked: IndexRow) => {
    props.ctx.onChange(props.block.key, picked.id);
    setOffer(null);
    const [entry] = (await lookup()?.load([picked.id])) ?? [];
    if (entry && fills(entry).length) setOffer(entry);
  };
  const acceptOffer = () => {
    const picked = offer();
    if (!picked) return;
    for (const [key, rows] of acceptedFills(fills(picked), props.ctx.values))
      props.ctx.onChange(key, rows);
    setOffer(null);
  };
  // The progression variant: rows up to the character's level, read from the sheet.
  const progression = () => {
    const spec = props.block.progression;
    const current = entry();
    const field = spec && type()?.fields.find((item) => item.key === spec.field);
    if (!spec || !current || !field) return undefined;
    const level = num(props.ctx.values[spec.level], 0);
    const all = (
      Array.isArray(current.fields[field.key]) ? current.fields[field.key] : []
    ) as readonly ListRow[];
    return {
      label: field.label,
      level,
      columns: field.columns ?? [],
      rows: rowsUpToLevel(all, level),
      all,
    };
  };
  // Offered, never automatic: copy this level's rows into a list the block fills.
  const levelFills = () =>
    props.ctx.readOnly
      ? []
      : (props.block.fill ?? []).flatMap((fill) => {
          const list = fill.from === props.block.progression?.field && props.ctx.listBlock(fill.to);
          return list ? [{ to: fill.to, title: list.title ?? fill.to, columns: list.columns }] : [];
        });
  const addLevel = (to: string) => {
    const table = progression();
    const current = entry();
    const fill = levelFills().find((item) => item.to === to);
    if (!table || !current || !fill) return;
    const field = props.block.progression!.field;
    const rows = rowsFromEntryList(
      withRows(
        current,
        field,
        table.all.filter((row) => row.level === table.level),
      ),
      field,
      fill.columns,
    );
    const existing = (props.ctx.values[to] as readonly ListRow[] | undefined) ?? [];
    props.ctx.onChange(to, [...existing, ...rows]);
  };
  const offerText = () => {
    const picked = offer();
    if (!picked) return "";
    const parts = fills(picked).map((fill) => `${fill.title} (${fill.rows.length})`);
    return `Add ${picked.name}'s ${parts.join(" and ")} to the sheet?`;
  };
  const name = () => (
    <Show
      when={row() ?? entry()}
      fallback={
        <span {...sx(s.entryMissing)}>{id() ? "Not in the compendium" : canPick() ? "" : "—"}</span>
      }
    >
      {(current) => (
        <button
          {...sx(s.entryName)}
          title="Open in the compendium"
          onClick={() => props.ctx.onOpenEntry?.(current().id)}
        >
          {current().name}
        </button>
      )}
    </Show>
  );
  const picker = () => (
    <Show when={canPick()}>
      <EntryPicker
        trigger={row() ? "Change" : `Choose ${label().toLowerCase()}…`}
        alignEnd
        label={type()?.plural ?? type()?.name ?? label()}
        entries={lookup()?.rowsOfType(props.block.entryType) ?? []}
        onPick={(picked) => void pick(picked)}
      />
    </Show>
  );
  return (
    <div {...sx(s.entry)}>
      <div {...sx(s.entryHead)}>
        <span {...sx(s.label)}>{label()}</span>
        {name()}
        <span {...sx(s.entrySpacer)} />
        {picker()}
      </div>
      <Show when={lookup() && !type() && !props.ctx.readOnly}>
        <span {...sx(s.entryMissing)}>
          This world's compendium has no “{props.block.entryType}” entry type yet.
        </span>
      </Show>
      <Show when={props.variant === "progression" && progression()}>
        {(table) => (
          <div {...sx(s.progression)} role="table" aria-label={table().label}>
            <span {...sx(s.label)}>
              {table().label} · up to level {table().level}
            </span>
            <For each={table().rows}>
              {(row) => (
                <div
                  {...sx(s.progressionRow, row.level === table().level && s.progressionNow)}
                  role="row"
                >
                  <span {...sx(s.progressionLevel)} role="cell">
                    {String(row.level)}
                  </span>
                  <span role="cell">
                    {table()
                      .columns.map((column) => row[column.key])
                      .filter((value) => value !== undefined && value !== "")
                      .map((value) => (Array.isArray(value) ? value.join(", ") : String(value)))
                      .join(" · ")}
                  </span>
                </div>
              )}
            </For>
            <Show when={!table().rows.length}>
              <span {...sx(s.entryMissing)}>Nothing up to level {table().level}.</span>
            </Show>
            <For each={levelFills()}>
              {(fill) => (
                <button {...sx(s.addRow)} onClick={() => addLevel(fill.to)}>
                  Add level {table().level} to {fill.title}
                </button>
              )}
            </For>
          </div>
        )}
      </Show>
      <Show when={props.variant === "card" && entry() && type()}>
        {(current) => (
          <For each={entryFieldsForDisplay(entry()!, current(), props.block.show)}>
            {(item) => (
              <div {...sx(s.entryField)}>
                <span {...sx(s.label)}>{item.field.label}</span>
                <EntryValue field={item.field} value={item.value} />
              </div>
            )}
          </For>
        )}
      </Show>
      <Show when={offer()}>
        <div {...sx(s.offer)} role="status">
          <span {...sx(s.entrySpacer)}>{offerText()}</span>
          <button {...sx(s.addRow)} onClick={acceptOffer}>
            Add
          </button>
          <button {...sx(s.addRow)} onClick={() => setOffer(null)}>
            No thanks
          </button>
        </div>
      </Show>
    </div>
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
          <div {...sx(variant() === "boxes" ? s.trackerRow : s.labelled)}>
            <For each={block().items}>
              {(item) => {
                // Display comes from the layout's range, so a personal maximum can't flip pips to a bar.
                const effective = () => ({
                  ...item,
                  display: resolveTrackerDisplay(item),
                  max: props.ctx.trackerMax?.(item) ?? props.ctx.defaultMax(item),
                });
                const value = () =>
                  props.ctx.trackerValue?.(item) ?? num(values()[item.key], item.start ?? item.max);
                return (
                  <Tracker
                    item={effective()}
                    boxed={variant() === "boxes"}
                    value={value()}
                    set={(n) =>
                      props.ctx.onTracker
                        ? props.ctx.onTracker(item.key, clamp(n, effective()))
                        : props.ctx.onChange(item.key, clamp(n, effective()))
                    }
                    onRoll={(dice) => props.ctx.onRoll(item.label, dice)}
                    maxEdit={
                      props.ctx.editing && props.ctx.onTrackerMax
                        ? {
                            layoutMax: props.ctx.defaultMax(item),
                            set: (max) => props.ctx.onTrackerMax!(item.key, max),
                          }
                        : undefined
                    }
                  />
                );
              }}
            </For>
          </div>
        )}
      </Match>
      <Match when={b.type === "stats" && b}>
        {(block) => <Stats items={block().items} variant={variant()} ctx={props.ctx} />}
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
                  <Show
                    when={props.ctx.editing && props.ctx.computed?.(item.key) === undefined}
                    fallback={
                      <Show
                        when={props.ctx.computed?.(item.key) !== undefined}
                        fallback={
                          <span
                            {...sx(
                              s.fieldValue,
                              variant() === "inline" && s.fieldInlineValue,
                              !values()[item.key] && s.empty,
                            )}
                          >
                            {String(values()[item.key] ?? "—")}
                          </span>
                        }
                      >
                        <span {...sx(s.fieldValue, variant() === "inline" && s.fieldInlineValue)}>
                          <WhyValue why={props.ctx.why(item.key)}>
                            {formatNumber(props.ctx.computed?.(item.key) ?? 0)}
                          </WhyValue>
                        </span>
                      </Show>
                    }
                  >
                    <CommitInput
                      label={item.label}
                      value={scalar(values()[item.key])}
                      numeric={typeof values()[item.key] === "number"}
                      onCommit={(next) => props.ctx.onChange(item.key, next)}
                    />
                  </Show>
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
            <Show
              when={props.ctx.editing}
              fallback={
                <p {...sx(s.text)} style={{ margin: 0 }}>
                  {String(values()[block().key] ?? "")}
                </p>
              }
            >
              <CommitInput
                multiline
                label={block().label ?? block().key}
                value={scalar(values()[block().key])}
                onCommit={(next) => props.ctx.onChange(block().key, next)}
              />
            </Show>
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
      <Match when={b.type === "entry" && b}>
        {(block) => <EntryBlock block={block()} variant={variant()} ctx={props.ctx} />}
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
          <Show when={shown(child, props.ctx)}>
            <div {...sx(s.blockCol, props.ctx.customize && s.editable)}>
              <Show when={props.ctx.customize}>
                <EditBar block={child} ctx={props.ctx} nested />
              </Show>
              <Leaf block={child} ctx={props.ctx} />
            </div>
          </Show>
        )}
      </For>
    </div>
  );
}

/** Conditional blocks hide on the sheet but stay reachable while editing or styling. */
const shown = (block: LayoutBlock, ctx: Ctx) =>
  ctx.editing || ctx.customize || blockShown(block, ctx.values, ctx.holds);

function BlockCell(props: { block: LayoutBlock; ctx: Ctx }) {
  return (
    <Show when={shown(props.block, props.ctx)}>
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
    </Show>
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
    props.layout.pages.find((item) => item.id === (props.page ?? page())) ?? props.layout.pages[0];
  const band = () => (props.header ?? themeSkin().header) === "band";
  // Derived values are computed here, from the layout and the values, and never stored.
  // Trackers can live outside `values`; refs read them as the sheet shows them, no
  // higher than a maximum formula allows. `@class.hit_die` reads the chosen entry.
  const entries: EntryFields = (id) => props.compendium?.entry(id)?.fields;
  const refSource = createMemo(() => {
    const tickers: Record<string, number> = {};
    const tickerMax: Record<string, number> = {};
    for (const item of layoutTrackers(props.layout)) {
      tickers[item.key] =
        props.trackerValue?.(item) ?? num(props.values[item.key], item.start ?? item.max);
      const own = props.trackerMax?.(item);
      if (own !== undefined) tickerMax[item.key] = own;
    }
    return refValues(props.layout, props.values, tickers, { tickerMax, entries });
  });
  const derived = createMemo(() => sheetDerived(props.layout, refSource(), entries));
  const scope = createMemo(() =>
    sheetScope(props.layout, refSource(), undefined, entries, derived()),
  );
  const computed = (key: string) =>
    key in derived().values ? derived().values[key] : props.computed?.(key);
  // A computed column reads its row, the sheet's derived values and other computed columns.
  const derivedCell = (column: ListColumn, row: ListRow) => {
    const list = allBlocks(props.layout).find(
      (block) => block.type === "list" && block.columns.includes(column),
    );
    if (!column.expr || list?.type !== "list") return undefined;
    return sheetScope(props.layout, refSource(), { row, list: list.key }, entries, derived()).value(
      {
        key: "row",
        column: column.key,
      },
    );
  };
  const why = (key: string): Why | undefined => {
    const item = props.layout.derived?.find((value) => value.key === key);
    return item ? whyOf(props.layout, item.expr, scope(), derived().errors[key]) : undefined;
  };
  const ctx = (): Ctx => ({
    values: props.values,
    onChange: props.onChange,
    onRoll: props.onRoll,
    overrides: props.overrides,
    customize: props.customize,
    onVariant: props.onVariant,
    onSpan: props.onSpan,
    editing: props.editing,
    trackerValue: (item) => num(refSource()[item.key], item.start ?? item.max),
    trackerMax: (item) => trackerMaxOf(item, props.trackerMax?.(item), scope()),
    defaultMax: (item) => trackerMaxOf(item, undefined, scope()),
    onTracker: props.onTracker,
    onTrackerMax: props.onTrackerMax,
    computed,
    derivedCell,
    why,
    holds: (formula) => formulaHolds(formula, scope()),
    readOnly: props.readOnly,
    compendium: props.compendium,
    onOpenEntry: props.onOpenEntry,
    mode: gridMode(width()),
    listBlock: (key) => {
      for (const page of props.layout.pages)
        for (const block of page.blocks)
          for (const inner of block.type === "group" ? block.blocks : [block])
            if (inner.type === "list" && inner.key === key) return inner;
      return undefined;
    },
  });
  return (
    <div {...sx(s.sheet)} ref={(element) => (root = element)} data-grid-mode={ctx().mode}>
      <Show when={props.showName !== false}>
        <header {...sx(band() ? s.nameBand : s.nameBlock)}>
          <h2 {...sx(s.name, band() && s.nameOnBand)}>{props.name}</h2>
          <Show when={props.subtitle}>
            <div {...sx(s.subtitle)}>{props.subtitle}</div>
          </Show>
        </header>
      </Show>
      <Show when={!props.blocks && props.layout.pages.length > 1}>
        <div {...sx(s.tabs)} role="tablist">
          <For each={props.layout.pages}>
            {(item) => (
              <button
                role="tab"
                aria-selected={item.id === current()?.id ? "true" : "false"}
                {...sx(s.tab, item.id === current()?.id && s.tabOn)}
                onClick={() => {
                  setPage(item.id);
                  props.onPage?.(item.id);
                }}
              >
                {item.title}
              </button>
            )}
          </For>
        </div>
      </Show>
      <div {...sx(s.grid)}>
        <For
          each={
            props.blocks
              ? props.blocks.flatMap((id) => findBlock(props.layout, id) ?? [])
              : (current()?.blocks ?? [])
          }
        >
          {(block) => <BlockCell block={block} ctx={ctx()} />}
        </For>
      </div>
    </div>
  );
}
