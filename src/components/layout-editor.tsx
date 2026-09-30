import * as stylex from "@stylexjs/stylex";
import * as Schema from "effect/Schema";
import { For, Match, Show, Switch, createSignal, onCleanup } from "solid-js";
import type { EntryType } from "../domain/compendium";
import {
  addPage,
  allBlocks,
  blockTypes,
  duplicateBlock,
  findBlock,
  insertBlock,
  layoutKeys,
  type BlockDestination,
  moveBlock,
  moveBlockTo,
  newBlock,
  removeBlock,
  removePage,
  renamePage,
  slugKey,
  ungroupBlock,
  updateBlock,
} from "../domain/layout-edit";
import {
  ListColumnKind,
  SheetLayout,
  TrackerDisplay,
  blockVariants,
  type BlockType,
  type LayoutBlock,
  type SheetValues,
} from "../domain/sheet-layout";
import { layoutLimitsError } from "../domain/template-io";
import { layoutProblems } from "../domain/sheet-refs";
import { moveIndex } from "../client/sortable";
import { DropLine, SortHandle, createSortable } from "./sortable";
import { colors, fonts, radii, skin } from "../theme/tokens.stylex";
import { sx } from "../theme/sx";
import { SheetBlocks } from "./sheet-blocks";
import { styles } from "./styles.stylex";

/*
 * DM editor for a template's sheet layout: an outline of pages and blocks on the
 * left (reorder, duplicate, remove, add), an inspector for the selected block,
 * and a live preview at panel or wide width where each block's style and width
 * set the layout's defaults. A JSON view covers anything the forms don't.
 */

const hair = { borderWidth: "1px", borderStyle: "solid", borderColor: colors.border } as const;

const e = stylex.create({
  root: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(300px, 400px) minmax(0, 1fr)",
      "@media (max-width: 900px)": "1fr",
    },
    gap: "16px",
    alignItems: "start",
  },
  column: { display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 },
  bar: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px" },
  pageTab: {
    paddingInline: "8px",
    paddingBlock: "3px",
    ...hair,
    borderRadius: skin.controlRadius,
    backgroundColor: { default: "transparent", ":hover": colors.surfaceHover },
    color: colors.textMuted,
    fontFamily: fonts.display,
    fontSize: "12px",
    textTransform: skin.headTransform,
    letterSpacing: skin.headTracking,
    cursor: "pointer",
  },
  pageTabOn: { borderColor: colors.accent, color: colors.accent },
  pageTabDrop: { borderColor: colors.accent, backgroundColor: colors.accentMuted },
  outline: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    ...hair,
    borderRadius: skin.controlRadius,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    paddingInline: "6px",
    paddingBlock: "4px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    cursor: { default: "pointer", "@media (pointer: fine)": "grab" },
    userSelect: "none",
    ":hover": { backgroundColor: colors.surfaceHover },
  },
  rowDragging: { opacity: 0.35 },
  confirm: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "6px",
    paddingInline: "8px",
    paddingBlock: "6px",
    fontSize: "12px",
    backgroundColor: colors.dangerMuted,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  confirmText: { flex: 1, minWidth: "140px" },
  handle: {
    flexShrink: 0,
    width: "16px",
    height: "22px",
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: colors.textFaint,
    fontSize: "13px",
    lineHeight: 1,
    cursor: "grab",
    touchAction: "none",
    ":hover": { color: colors.text },
  },
  // Where the dragged block will land; indented when it lands inside a group.
  dropLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: "2px",
    marginTop: "-1px",
    backgroundColor: colors.accent,
    pointerEvents: "none",
    zIndex: 2,
  },
  dropLineInside: { left: "14px" },
  ghost: {
    position: "fixed",
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    gap: "6px",
    maxWidth: "280px",
    paddingInline: "8px",
    paddingBlock: "4px",
    ...hair,
    borderColor: colors.accent,
    borderRadius: skin.controlRadius,
    backgroundColor: colors.surfaceRaised,
    boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
    pointerEvents: "none",
    fontSize: "13px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  // A group is scaffolding, not content: a quiet header and a bracket around its blocks.
  groupKind: { color: colors.textFaint },
  groupTitle: { fontStyle: "italic", color: colors.textMuted },
  groupCount: { flexShrink: 0, fontSize: "11px", color: colors.textFaint },
  groupKids: {
    display: "flex",
    flexDirection: "column",
    marginLeft: "12px",
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    borderLeftColor: colors.borderStrong,
  },
  groupEmpty: {
    paddingInline: "8px",
    paddingBlock: "5px",
    fontSize: "12px",
    fontStyle: "italic",
    color: colors.textFaint,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  rowOn: { backgroundColor: colors.accentMuted },
  kind: {
    flexShrink: 0,
    width: "80px",
    overflow: "hidden",
    whiteSpace: "nowrap",
    fontFamily: fonts.display,
    fontSize: "10px",
    textTransform: skin.headTransform,
    letterSpacing: skin.headTracking,
    color: colors.accent,
  },
  summary: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: "13px",
  },
  icon: {
    flexShrink: 0,
    width: "22px",
    height: "22px",
    padding: 0,
    borderWidth: 0,
    borderRadius: radii.sm,
    backgroundColor: { default: "transparent", ":hover": colors.surfaceMuted },
    color: colors.textMuted,
    cursor: "pointer",
    ":disabled": { opacity: 0.3, cursor: "default" },
  },
  inspector: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "10px",
    ...hair,
    borderRadius: skin.controlRadius,
    backgroundColor: colors.surfaceRaised,
  },
  heading: {
    fontFamily: fonts.display,
    fontSize: "13px",
    textTransform: skin.headTransform,
    letterSpacing: skin.headTracking,
    color: colors.accent,
  },
  pair: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" },
  field: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, fontSize: "11px" },
  items: { position: "relative", display: "grid", gap: "4px", alignItems: "center" },
  handleCell: { display: "flex", alignItems: "center", alignSelf: "stretch" },
  itemHead: { fontSize: "10px", color: colors.textMuted },
  small: {
    height: "26px",
    paddingInline: "5px",
    paddingBlock: 0,
    fontSize: "12px",
    lineHeight: 1.2,
  },
  preview: {
    padding: "12px",
    ...hair,
    borderRadius: skin.controlRadius,
    backgroundColor: colors.surface,
    backgroundImage: skin.paper,
    backgroundSize: skin.paperSize,
    boxShadow: skin.panelShadow,
  },
  json: { minHeight: "360px", fontFamily: fonts.mono, fontSize: "12px" },
  error: { color: colors.danger, fontSize: "12px" },
  hint: { fontSize: "12px", color: colors.textMuted },
  problems: {
    margin: 0,
    paddingBlock: "6px",
    paddingInline: "22px 8px",
    ...hair,
    borderColor: colors.warning,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  check: { display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px" },
});

const summarize = (block: LayoutBlock): string => {
  switch (block.type) {
    case "heading":
      return block.text;
    case "group":
      return block.title || "Untitled group";
    case "list":
      return block.title ?? block.key;
    case "checks":
    case "text":
    case "entry":
      return block.label ?? block.key;
    case "trackers":
    case "stats":
    case "fields":
    case "rolls":
      return block.items.map((item) => item.label).join(", ") || "(empty)";
  }
};

type Column = {
  key: string;
  label: string;
  /** `csv`: a string array edited as comma-separated text. */
  kind?: "text" | "number" | "select" | "csv";
  options?: readonly string[];
  width?: string;
  placeholder?: string;
  /** Clearing it keeps an empty string instead of removing the property. */
  required?: boolean;
};

/** A compact table of inputs for a block's items, with add and remove. */
function ItemRows<T extends Record<string, unknown>>(props: {
  title: string;
  items: readonly T[];
  columns: Column[];
  onChange: (items: T[]) => void;
  make: () => T;
}) {
  const template = () =>
    ["16px", ...props.columns.map((c) => c.width ?? "minmax(0, 1fr)"), "22px"].join(" ");
  const sortable = createSortable({
    count: () => props.items.length,
    onMove: (from, to) => props.onChange(moveIndex(props.items, from, to)),
  });
  const set = (index: number, key: string, raw: string, kind?: string) =>
    props.onChange(
      props.items.map((item, i) => {
        if (i !== index) return item;
        const next = { ...item } as Record<string, unknown>;
        if (kind === "number") {
          if (raw.trim() === "") delete next[key];
          else next[key] = Math.trunc(Number(raw));
        } else if (kind === "csv") {
          const items = raw
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
          if (items.length) next[key] = items;
          else delete next[key];
        } else if (
          raw === "" &&
          key !== "label" &&
          key !== "key" &&
          !props.columns.find((column) => column.key === key)?.required
        )
          delete next[key];
        else next[key] = raw;
        return next as T;
      }),
    );
  return (
    <div {...sx(e.column)}>
      <span {...sx(e.itemHead)}>{props.title}</span>
      <div
        {...sx(e.items)}
        style={{ "grid-template-columns": template() }}
        ref={sortable.container}
      >
        <span />
        <For each={props.columns}>
          {(column) => <span {...sx(e.itemHead)}>{column.label}</span>}
        </For>
        <span />
        <For each={props.items.map((_, i) => i)}>
          {(index) => (
            <>
              <span {...sx(e.handleCell)} {...sortable.item(index)}>
                <SortHandle
                  sortable={sortable}
                  index={index}
                  label={`${props.title} ${index + 1}`}
                />
              </span>
              <For each={props.columns}>
                {(column) => (
                  <Show
                    when={column.kind === "select"}
                    fallback={
                      <input
                        {...sx(styles.input, e.small)}
                        aria-label={`${props.title} ${index + 1} ${column.label}`}
                        type={column.kind === "number" ? "number" : "text"}
                        placeholder={column.placeholder}
                        value={(() => {
                          const value = (props.items[index] as Record<string, unknown>)[column.key];
                          return Array.isArray(value) ? value.join(", ") : String(value ?? "");
                        })()}
                        onInput={(event) =>
                          column.kind !== "csv" &&
                          set(index, column.key, event.currentTarget.value, column.kind)
                        }
                        onChange={(event) =>
                          column.kind === "csv" &&
                          set(index, column.key, event.currentTarget.value, column.kind)
                        }
                      />
                    }
                  >
                    <select
                      {...sx(styles.select, e.small)}
                      aria-label={`${props.title} ${index + 1} ${column.label}`}
                      value={String(
                        (props.items[index] as Record<string, unknown>)[column.key] ??
                          column.options?.[0] ??
                          "",
                      )}
                      onChange={(event) => set(index, column.key, event.currentTarget.value)}
                    >
                      <For each={column.options ?? []}>
                        {(option) => <option value={option}>{option}</option>}
                      </For>
                    </select>
                  </Show>
                )}
              </For>
              <button
                {...sx(e.icon)}
                aria-label={`Remove ${props.title} ${index + 1}`}
                onClick={() => props.onChange(props.items.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </>
          )}
        </For>
        <DropLine sortable={sortable} />
      </div>
      <button
        {...sx(styles.button, styles.buttonSmall)}
        onClick={() => props.onChange([...props.items, props.make()])}
      >
        + Add
      </button>
    </div>
  );
}

function TextInput(props: { label: string; value: string; onInput: (value: string) => void }) {
  return (
    <label {...sx(e.field)}>
      {props.label}
      <input
        {...sx(styles.input, e.small)}
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
    </label>
  );
}

function Inspector(props: {
  block: LayoutBlock;
  onChange: (block: LayoutBlock) => void;
  onUngroup: () => void;
  entryTypes: readonly EntryType[];
  /** The layout's lists, for an entry block's "fill" targets. */
  lists: readonly { key: string; title?: string }[];
  /** Every value key in the layout, for "only show when". */
  keys: readonly string[];
}) {
  const b = () => props.block;
  const patch = (partial: Record<string, unknown>) =>
    props.onChange({ ...props.block, ...partial } as LayoutBlock);
  const variants = () => blockVariants[b().type] as readonly string[];
  const spans = ["", "1", "2", "3", "4", "5", "6"];
  const entryTypeSelect = (
    label: string,
    value: string,
    onChange: (id: string) => void,
    none?: string,
  ) => (
    <label {...sx(e.field)}>
      {label}
      <select
        {...sx(styles.select, e.small)}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        <Show when={none !== undefined}>
          <option value="">{none}</option>
        </Show>
        <Show when={none === undefined && !value}>
          <option value="">Choose a type…</option>
        </Show>
        <For each={props.entryTypes}>{(type) => <option value={type.id}>{type.name}</option>}</For>
        <Show when={value && !props.entryTypes.some((type) => type.id === value)}>
          <option value={value}>{value} (not in the compendium)</option>
        </Show>
      </select>
    </label>
  );
  const spanSelect = (key: "span" | "wide", label: string) => (
    <label {...sx(e.field)}>
      {label}
      <select
        {...sx(styles.select, e.small)}
        value={b()[key] === undefined ? "" : String(b()[key])}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          patch({ [key]: raw === "" ? undefined : Number(raw) });
        }}
      >
        <For each={spans}>
          {(n) => (
            <option value={n}>
              {n === ""
                ? key === "wide"
                  ? "same as panel"
                  : "full"
                : n === "6"
                  ? "full (6/6)"
                  : `${n}/6`}
            </option>
          )}
        </For>
      </select>
    </label>
  );
  return (
    <div {...sx(e.inspector)} role="group" aria-label={`Edit ${b().type} block`}>
      <span {...sx(e.heading)}>
        {blockTypes.find((item) => item.type === b().type)?.label} · {b().id}
      </span>
      <div {...sx(e.pair)}>
        {spanSelect("span", "Width in panel")}
        {spanSelect("wide", "Width when wide")}
      </div>
      <Show when={variants().length > 1}>
        <label {...sx(e.field)}>
          Default style (players can change it)
          <select
            {...sx(styles.select, e.small)}
            value={b().variant ?? variants()[0]}
            onChange={(event) => patch({ variant: event.currentTarget.value })}
          >
            <For each={variants()}>{(variant) => <option value={variant}>{variant}</option>}</For>
          </select>
        </label>
      </Show>
      <div {...sx(e.pair)}>
        <label {...sx(e.field)}>
          Only show when
          <select
            {...sx(styles.select, e.small)}
            value={b().when?.key ?? ""}
            onChange={(event) => {
              const key = event.currentTarget.value;
              patch({ when: key ? { key, is: b().when?.is ?? "empty" } : undefined });
            }}
          >
            <option value="">Always shown</option>
            <For each={props.keys}>{(key) => <option value={key}>{key}</option>}</For>
          </select>
        </label>
        <Show when={b().when}>
          {(when) => (
            <label {...sx(e.field)}>
              is
              <select
                {...sx(styles.select, e.small)}
                value={when().is}
                onChange={(event) =>
                  patch({
                    when: { key: when().key, is: event.currentTarget.value as "empty" | "filled" },
                  })
                }
              >
                <option value="empty">empty</option>
                <option value="filled">filled in</option>
              </select>
            </label>
          )}
        </Show>
      </div>
      <Switch>
        <Match when={b().type === "heading" && b()}>
          {(block) => (
            <TextInput
              label="Text"
              value={(block() as { text: string }).text}
              onInput={(text) => patch({ text })}
            />
          )}
        </Match>
        <Match when={b().type === "group" && b()}>
          {(block) => (
            <>
              <TextInput
                label="Title (optional)"
                value={(block() as { title?: string }).title ?? ""}
                onInput={(title) => patch({ title: title || undefined })}
              />
              <span {...sx(e.hint)}>
                A group stacks its blocks in one grid cell, so a tall column can sit beside a short
                one.
              </span>
              <div {...sx(e.bar)}>
                <button {...sx(styles.button, styles.buttonSmall)} onClick={props.onUngroup}>
                  Ungroup (keep its blocks)
                </button>
              </div>
            </>
          )}
        </Match>
        <Match when={b().type === "trackers" && b()}>
          {(block) => (
            <ItemRows
              title="Trackers"
              items={(block() as Extract<LayoutBlock, { type: "trackers" }>).items}
              columns={[
                { key: "label", label: "Label", width: "minmax(0, 1.6fr)" },
                { key: "short", label: "Short", width: "48px" },
                { key: "key", label: "Key" },
                { key: "min", label: "Min", kind: "number", width: "46px" },
                { key: "max", label: "Max", kind: "number", width: "46px" },
                { key: "start", label: "Start", kind: "number", width: "46px" },
                {
                  key: "display",
                  label: "Show as",
                  kind: "select",
                  options: TrackerDisplay.literals,
                  width: "70px",
                },
                { key: "roll", label: "Roll", placeholder: "optional", width: "80px" },
              ]}
              onChange={(items) => patch({ items })}
              make={() => ({
                key: `tracker_${Date.now() % 10000}`,
                label: "Tracker",
                min: 0,
                max: 6,
              })}
            />
          )}
        </Match>
        <Match when={b().type === "stats" && b()}>
          {(block) => (
            <ItemRows
              title="Stats"
              items={(block() as Extract<LayoutBlock, { type: "stats" }>).items}
              columns={[
                { key: "label", label: "Label", width: "minmax(0, 1.6fr)" },
                { key: "key", label: "Key" },
                { key: "max", label: "Bar max", kind: "number", width: "60px" },
                {
                  key: "roll",
                  label: "Roll on click",
                  placeholder: "optional",
                  width: "minmax(0, 1.4fr)",
                },
              ]}
              onChange={(items) => patch({ items })}
              make={() => ({ key: `stat_${Date.now() % 10000}`, label: "Stat" })}
            />
          )}
        </Match>
        <Match when={b().type === "fields" && b()}>
          {(block) => (
            <>
              <label {...sx(e.field)}>
                Columns
                <select
                  {...sx(styles.select, e.small)}
                  value={String((block() as { columns: number }).columns)}
                  onChange={(event) => patch({ columns: Number(event.currentTarget.value) })}
                >
                  <For each={["1", "2", "3"]}>{(n) => <option value={n}>{n}</option>}</For>
                </select>
              </label>
              <ItemRows
                title="Fields"
                items={(block() as Extract<LayoutBlock, { type: "fields" }>).items}
                columns={[
                  { key: "label", label: "Label", width: "minmax(0, 1.6fr)" },
                  { key: "key", label: "Key" },
                ]}
                onChange={(items) => patch({ items })}
                make={() => ({ key: `field_${Date.now() % 10000}`, label: "Field" })}
              />
            </>
          )}
        </Match>
        <Match when={b().type === "list" && b()}>
          {(block) => {
            const list = () => block() as Extract<LayoutBlock, { type: "list" }>;
            return (
              <>
                <div {...sx(e.pair)}>
                  <TextInput
                    label="Title"
                    value={list().title ?? ""}
                    onInput={(title) => patch({ title: title || undefined })}
                  />
                  <TextInput label="Key" value={list().key} onInput={(key) => patch({ key })} />
                </div>
                <label {...sx(e.field)}>
                  Always show this many rows (0 = only filled rows)
                  <input
                    {...sx(styles.input, e.small)}
                    type="number"
                    min="0"
                    max="100"
                    value={list().slots ?? 0}
                    onInput={(event) => {
                      const n = Math.max(0, Math.trunc(Number(event.currentTarget.value)));
                      patch({ slots: n > 0 ? n : undefined });
                    }}
                  />
                </label>
                <ItemRows
                  title="Columns"
                  items={list().columns}
                  columns={[
                    { key: "label", label: "Label", width: "minmax(0, 1.4fr)" },
                    { key: "key", label: "Key" },
                    {
                      key: "kind",
                      label: "Kind",
                      kind: "select",
                      options: ListColumnKind.literals,
                      width: "80px",
                    },
                    {
                      key: "expr",
                      label: "Formula (derived)",
                      placeholder: "@row.qty * 2",
                      width: "minmax(0, 1.2fr)",
                    },
                    {
                      key: "options",
                      label: "Choices (select)",
                      kind: "csv",
                      placeholder: "a, b, c",
                      width: "minmax(0, 1fr)",
                    },
                  ]}
                  onChange={(columns) => patch({ columns })}
                  make={() => ({ key: `col_${Date.now() % 10000}`, label: "Column", kind: "text" })}
                />
                <label {...sx(e.field)}>
                  In the slots style, rows take as many slots as
                  <select
                    {...sx(styles.select, e.small)}
                    value={list().slotSize ?? ""}
                    onChange={(event) =>
                      patch({ slotSize: event.currentTarget.value || undefined })
                    }
                  >
                    <option value="">one each</option>
                    <For each={list().columns.filter((column) => column.kind === "number")}>
                      {(column) => <option value={column.key}>their “{column.label}”</option>}
                    </For>
                  </select>
                </label>
                <label {...sx(e.field)}>
                  Each row rolls (optional)
                  <input
                    {...sx(styles.input, e.small)}
                    placeholder="1d20 + @row.bonus"
                    value={list().roll ?? ""}
                    onInput={(event) => patch({ roll: event.currentTarget.value || undefined })}
                  />
                </label>
                {entryTypeSelect(
                  "Add rows from the compendium",
                  list().source?.entryType ?? "",
                  (id) => patch({ source: id ? { entryType: id } : undefined }),
                  "No",
                )}
                <Show when={list().source}>
                  <span {...sx(e.hint)}>
                    Rows copy the entry's name into a “name” column and fields into columns with the
                    same key. Players can change their copy.
                  </span>
                </Show>
              </>
            );
          }}
        </Match>
        <Match when={b().type === "entry" && b()}>
          {(block) => {
            const entry = () => block() as Extract<LayoutBlock, { type: "entry" }>;
            const type = () => props.entryTypes.find((item) => item.id === entry().entryType);
            const shown = () => entry().show ?? type()?.fields.map((field) => field.key) ?? [];
            const toggleShown = (key: string) => {
              const next = shown().includes(key)
                ? shown().filter((item) => item !== key)
                : (type()?.fields ?? [])
                    .map((field) => field.key)
                    .filter((item) => item === key || shown().includes(item));
              patch({ show: next });
            };
            const fillFor = (from: string) =>
              entry().fill?.find((fill) => fill.from === from)?.to ?? "";
            const setFill = (from: string, to: string) => {
              const rest = (entry().fill ?? []).filter((fill) => fill.from !== from);
              const next = to ? [...rest, { from, to }] : rest;
              patch({ fill: next.length ? next : undefined });
            };
            return (
              <>
                <div {...sx(e.pair)}>
                  {entryTypeSelect("Entry type", entry().entryType, (id) =>
                    patch({ entryType: id, show: undefined, fill: undefined }),
                  )}
                  <TextInput
                    label="Label"
                    value={entry().label ?? ""}
                    onInput={(label) => patch({ label: label || undefined })}
                  />
                </div>
                <TextInput label="Key" value={entry().key} onInput={(key) => patch({ key })} />
                <Show
                  when={type()}
                  fallback={
                    <span {...sx(e.hint)}>
                      Pick an entry type. Set types up in World settings → Compendium.
                    </span>
                  }
                >
                  {(current) => (
                    <>
                      <div {...sx(e.field)}>
                        Show on the sheet
                        <div {...sx(e.bar)}>
                          <For each={current().fields}>
                            {(field) => (
                              <label {...sx(e.check)}>
                                <input
                                  type="checkbox"
                                  checked={shown().includes(field.key)}
                                  onChange={() => toggleShown(field.key)}
                                />
                                {field.label}
                              </label>
                            )}
                          </For>
                        </div>
                      </div>
                      <Show when={current().fields.some((field) => field.kind === "progression")}>
                        <div {...sx(e.pair)}>
                          <label {...sx(e.field)}>
                            Progression (the “progression” style)
                            <select
                              {...sx(styles.select, e.small)}
                              value={entry().progression?.field ?? ""}
                              onChange={(event) => {
                                const field = event.currentTarget.value;
                                patch({
                                  progression: field
                                    ? { field, level: entry().progression?.level ?? "level" }
                                    : undefined,
                                });
                              }}
                            >
                              <option value="">None</option>
                              <For
                                each={current().fields.filter(
                                  (field) => field.kind === "progression",
                                )}
                              >
                                {(field) => <option value={field.key}>{field.label}</option>}
                              </For>
                            </select>
                          </label>
                          <Show when={entry().progression}>
                            {(spec) => (
                              <TextInput
                                label="Level is the sheet value"
                                value={spec().level}
                                onInput={(level) => patch({ progression: { ...spec(), level } })}
                              />
                            )}
                          </Show>
                        </div>
                      </Show>
                      <For
                        each={current().fields.filter(
                          (field) => field.kind === "list" || field.kind === "progression",
                        )}
                      >
                        {(field) => (
                          <label {...sx(e.field)}>
                            After picking, offer to copy {field.label} into
                            <select
                              {...sx(styles.select, e.small)}
                              value={fillFor(field.key)}
                              onChange={(event) => setFill(field.key, event.currentTarget.value)}
                            >
                              <option value="">Don't offer</option>
                              <For each={props.lists}>
                                {(list) => (
                                  <option value={list.key}>{list.title ?? list.key}</option>
                                )}
                              </For>
                            </select>
                          </label>
                        )}
                      </For>
                    </>
                  )}
                </Show>
              </>
            );
          }}
        </Match>
        <Match when={b().type === "checks" && b()}>
          {(block) => {
            const checks = () => block() as Extract<LayoutBlock, { type: "checks" }>;
            return (
              <>
                <div {...sx(e.pair)}>
                  <TextInput
                    label="Label"
                    value={checks().label ?? ""}
                    onInput={(label) => patch({ label: label || undefined })}
                  />
                  <TextInput label="Key" value={checks().key} onInput={(key) => patch({ key })} />
                </div>
                <TextInput
                  label="Options (comma separated)"
                  value={checks().options.join(", ")}
                  onInput={(raw) =>
                    patch({
                      options: raw
                        .split(",")
                        .map((option) => option.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </>
            );
          }}
        </Match>
        <Match when={b().type === "text" && b()}>
          {(block) => {
            const text = () => block() as Extract<LayoutBlock, { type: "text" }>;
            return (
              <div {...sx(e.pair)}>
                <TextInput
                  label="Label"
                  value={text().label ?? ""}
                  onInput={(label) => patch({ label: label || undefined })}
                />
                <TextInput label="Key" value={text().key} onInput={(key) => patch({ key })} />
              </div>
            );
          }}
        </Match>
        <Match when={b().type === "rolls" && b()}>
          {(block) => (
            <ItemRows
              title="Rolls"
              items={(block() as Extract<LayoutBlock, { type: "rolls" }>).items}
              columns={[
                { key: "label", label: "Label", width: "minmax(0, 1fr)" },
                {
                  key: "dice",
                  label: "Dice",
                  placeholder: "1d20 + @key",
                  width: "minmax(0, 1.4fr)",
                },
              ]}
              onChange={(items) => patch({ items })}
              make={() => ({ label: "Roll", dice: "d20" })}
            />
          )}
        </Match>
      </Switch>
    </div>
  );
}

export function LayoutEditor(props: {
  layout: SheetLayout;
  onChange: (layout: SheetLayout) => void;
  /** The world's compendium types, for entry blocks and list sources. */
  entryTypes?: readonly EntryType[];
}) {
  const [pageId, setPageId] = createSignal(props.layout.pages[0]?.id ?? "");
  const [selected, setSelected] = createSignal<string | null>(null);
  const [wide, setWide] = createSignal(false);
  const [json, setJson] = createSignal<string | null>(null);
  const [jsonError, setJsonError] = createSignal("");
  const [values, setValues] = createSignal<SheetValues>({});
  const problems = () => [
    ...(layoutLimitsError(props.layout) ? [layoutLimitsError(props.layout)!] : []),
    ...layoutProblems(props.layout),
  ];
  const page = () =>
    props.layout.pages.find((item) => item.id === pageId()) ?? props.layout.pages[0];
  const block = () => {
    const id = selected();
    return id ? findBlock(props.layout, id) : undefined;
  };
  const selectedGroup = () => {
    const current = block();
    return current?.type === "group" ? current.id : undefined;
  };
  const [confirmRemove, setConfirmRemove] = createSignal<string | null>(null);
  const remove = (id: string) => {
    const gone = findBlock(props.layout, id);
    const ids = gone?.type === "group" ? [id, ...gone.blocks.map((child) => child.id)] : [id];
    setConfirmRemove(null);
    if (ids.includes(selected() ?? "")) setSelected(null);
    props.onChange(removeBlock(props.layout, id));
  };
  const ungroup = (id: string) => {
    const group = findBlock(props.layout, id);
    setConfirmRemove(null);
    props.onChange(ungroupBlock(props.layout, id));
    setSelected(group?.type === "group" ? (group.blocks[0]?.id ?? null) : null);
  };
  const add = (type: BlockType) => {
    const created = newBlock(props.layout, type);
    props.onChange(insertBlock(props.layout, page().id, created, selectedGroup()));
    setSelected(created.id);
  };
  const applyJson = () => {
    const decoded = Schema.decodeUnknownResult(SheetLayout)(
      (() => {
        try {
          return JSON.parse(json() ?? "");
        } catch {
          return undefined;
        }
      })(),
    );
    if (decoded._tag === "Failure") return setJsonError("That isn't a valid layout.");
    const limit = layoutLimitsError(decoded.success);
    if (limit) return setJsonError(limit);
    setJsonError("");
    setJson(null);
    props.onChange(decoded.success);
    setPageId(decoded.success.pages[0]?.id ?? "");
  };

  /*
   * Drag to reorder. Pointer events (not HTML5 drag and drop) so touch works:
   * a mouse can grab anywhere on a row, touch uses the handle so the list still
   * scrolls. Rows carry data attributes the drop maths reads back from the DOM.
   */
  let outline: HTMLDivElement | undefined;
  type Drop = { dest: BlockDestination; top?: number; inside?: boolean };
  const [dragging, setDragging] = createSignal<{ id: string; x: number; y: number } | null>(null);
  const [drop, setDrop] = createSignal<Drop | null>(null);
  let pending: { id: string; x: number; y: number } | undefined;
  let swallowClick = false;
  let scrollSpeed = 0;
  let scrollFrame = 0;

  const autoScroll = () => {
    if (scrollSpeed) window.scrollBy(0, scrollSpeed);
    scrollFrame = requestAnimationFrame(autoScroll);
  };

  const findDrop = (id: string, x: number, y: number): Drop | null => {
    const tab = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-page-tab]");
    if (tab) {
      const target = tab.dataset.pageTab!;
      return target === page().id ? null : { dest: { pageId: target } };
    }
    if (!outline) return null;
    const box = outline.getBoundingClientRect();
    const isGroup = findBlock(props.layout, id)?.type === "group";
    const rows = [...outline.querySelectorAll<HTMLElement>("[data-row]")]
      .filter((row) => row.dataset.row !== id && row.dataset.group !== id)
      .map((row) => ({
        row: row.dataset.row ?? "",
        group: row.dataset.group || undefined,
        kind: row.dataset.kind,
        rect: row.getBoundingClientRect(),
      }));
    const pageId = page().id;
    if (isGroup) {
      // A group moves as a unit among top-level blocks.
      const units = rows
        .filter((row) => !row.group)
        .map((row) => {
          const kids = rows.filter((kid) => kid.group === row.row);
          const bottom = kids.length ? kids[kids.length - 1].rect.bottom : row.rect.bottom;
          return { id: row.row, top: row.rect.top, bottom };
        });
      const next = units.find((unit) => y < (unit.top + unit.bottom) / 2);
      const last = units[units.length - 1];
      return {
        dest: { pageId, beforeId: next?.id },
        top: (next ? next.top : (last?.bottom ?? box.top)) - box.top,
      };
    }
    const index = rows.findIndex((row) => y < (row.rect.top + row.rect.bottom) / 2);
    const next = index < 0 ? undefined : rows[index];
    const prev = index < 0 ? rows[rows.length - 1] : rows[index - 1];
    if (next?.group)
      return {
        dest: {
          pageId,
          groupId: next.group,
          beforeId: next.kind === "empty" ? undefined : next.row,
        },
        top: next.rect.top - box.top,
        inside: true,
      };
    // Between a group's last block and the next top-level block: over the lower
    // half of the group's last row keeps it in the group, over the next row's
    // upper half (or below everything) takes it out.
    const openGroup = prev?.group || (prev?.kind === "group" ? prev.row : undefined);
    if (prev && openGroup && y < prev.rect.bottom)
      return {
        dest: { pageId, groupId: openGroup },
        top: prev.rect.bottom - box.top,
        inside: true,
      };
    return {
      dest: { pageId, beforeId: next?.row },
      top: (next ? next.rect.top : (prev?.rect.bottom ?? box.top)) - box.top,
    };
  };

  const endDrag = (commit: boolean) => {
    const current = dragging();
    const target = drop();
    pending = undefined;
    setDragging(null);
    setDrop(null);
    scrollSpeed = 0;
    cancelAnimationFrame(scrollFrame);
    document.body.style.cursor = "";
    if (!current) return;
    swallowClick = true;
    setTimeout(() => (swallowClick = false));
    if (!commit || !target) return;
    props.onChange(moveBlockTo(props.layout, current.id, target.dest));
    setSelected(current.id);
    if (target.dest.pageId !== page().id) setPageId(target.dest.pageId);
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && dragging()) endDrag(false);
  };
  window.addEventListener("keydown", onKey);
  onCleanup(() => {
    window.removeEventListener("keydown", onKey);
    cancelAnimationFrame(scrollFrame);
  });

  const dragHandlers = (id: string) => ({
    onPointerDown: (event: PointerEvent) => {
      const target = event.target as Element;
      if (event.button !== 0 || target.closest("button:not([data-handle])")) return;
      if (event.pointerType !== "mouse" && !target.closest("[data-handle]")) return;
      pending = { id, x: event.clientX, y: event.clientY };
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent) => {
      if (!pending) return;
      if (!dragging()) {
        if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < 4) return;
        document.body.style.cursor = "grabbing";
        scrollFrame = requestAnimationFrame(autoScroll);
      }
      setDragging({ id: pending.id, x: event.clientX, y: event.clientY });
      setDrop(findDrop(pending.id, event.clientX, event.clientY));
      const edge = 48;
      scrollSpeed =
        event.clientY < edge
          ? -Math.ceil((edge - event.clientY) / 4)
          : event.clientY > window.innerHeight - edge
            ? Math.ceil((event.clientY - window.innerHeight + edge) / 4)
            : 0;
    },
    onPointerUp: () => (pending ? endDrag(true) : undefined),
    onPointerCancel: () => endDrag(false),
  });

  const Row = (rowProps: { item: LayoutBlock; group?: string }) => (
    <div
      {...sx(
        e.row,
        selected() === rowProps.item.id && e.rowOn,
        dragging()?.id === rowProps.item.id && e.rowDragging,
      )}
      role="button"
      tabindex={0}
      aria-pressed={selected() === rowProps.item.id ? "true" : "false"}
      data-row={rowProps.item.id}
      data-group={rowProps.group}
      data-kind={rowProps.item.type === "group" ? "group" : "leaf"}
      {...dragHandlers(rowProps.item.id)}
      onClick={() => {
        if (!swallowClick) setSelected(rowProps.item.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") setSelected(rowProps.item.id);
        if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
          event.preventDefault();
          props.onChange(
            moveBlock(props.layout, rowProps.item.id, event.key === "ArrowUp" ? -1 : 1),
          );
        }
      }}
    >
      <button
        {...sx(e.handle)}
        data-handle
        aria-label={`Reorder ${rowProps.item.id}`}
        title="Drag to move · arrow keys reorder"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          event.stopPropagation();
          props.onChange(
            moveBlock(props.layout, rowProps.item.id, event.key === "ArrowUp" ? -1 : 1),
          );
        }}
      >
        ⠿
      </button>
      <span {...sx(e.kind, rowProps.item.type === "group" && e.groupKind)}>
        {rowProps.item.type}
      </span>
      <span {...sx(e.summary, rowProps.item.type === "group" && e.groupTitle)}>
        {summarize(rowProps.item)}
      </span>
      <Show when={rowProps.item.type === "group" && rowProps.item}>
        {(group) => (
          <span {...sx(e.groupCount)}>
            {group().blocks.length} {group().blocks.length === 1 ? "block" : "blocks"}
          </span>
        )}
      </Show>
      <button
        {...sx(e.icon)}
        aria-label={`Duplicate ${rowProps.item.id}`}
        onClick={(event) => {
          event.stopPropagation();
          props.onChange(duplicateBlock(props.layout, rowProps.item.id));
        }}
      >
        ⎘
      </button>
      <button
        {...sx(e.icon)}
        aria-label={`Remove ${rowProps.item.id}`}
        onClick={(event) => {
          event.stopPropagation();
          const item = rowProps.item;
          // Deleting a group takes its blocks with it, so ask first.
          if (item.type === "group" && item.blocks.length) setConfirmRemove(item.id);
          else remove(item.id);
        }}
      >
        ×
      </button>
    </div>
  );

  return (
    <Show
      when={json() === null}
      fallback={
        <div {...sx(e.column)}>
          <span {...sx(e.hint)}>
            The whole layout as JSON. Apply checks it against the same rules as saving.
          </span>
          <textarea
            {...sx(styles.textarea, e.json)}
            aria-label="Layout JSON"
            value={json() ?? ""}
            onInput={(event) => setJson(event.currentTarget.value)}
          />
          <Show when={jsonError()}>
            <span {...sx(e.error)} role="alert">
              {jsonError()}
            </span>
          </Show>
          <div {...sx(e.bar)}>
            <button
              {...sx(styles.button, styles.buttonSmall, styles.buttonPrimary)}
              onClick={applyJson}
            >
              Apply JSON
            </button>
            <button {...sx(styles.button, styles.buttonSmall)} onClick={() => setJson(null)}>
              Cancel
            </button>
          </div>
        </div>
      }
    >
      <div {...sx(e.root)}>
        <div {...sx(e.column)}>
          <div {...sx(e.bar)} role="tablist" aria-label="Pages">
            <For each={props.layout.pages}>
              {(item) => (
                <button
                  role="tab"
                  aria-selected={item.id === page().id ? "true" : "false"}
                  data-page-tab={item.id}
                  {...sx(
                    e.pageTab,
                    item.id === page().id && e.pageTabOn,
                    drop()?.dest.pageId === item.id && item.id !== page().id && e.pageTabDrop,
                  )}
                  onClick={() => setPageId(item.id)}
                >
                  {item.title || "Untitled"}
                </button>
              )}
            </For>
            <button
              {...sx(e.icon)}
              aria-label="Add page"
              title="Add page"
              onClick={() => {
                const next = addPage(props.layout, `Page ${props.layout.pages.length + 1}`);
                props.onChange(next);
                setPageId(next.pages[next.pages.length - 1].id);
              }}
            >
              +
            </button>
          </div>
          <label {...sx(e.check)}>
            <input
              type="checkbox"
              checked={props.layout.subject === "shared"}
              onChange={(event) =>
                props.onChange({
                  ...props.layout,
                  subject: event.currentTarget.checked ? "shared" : undefined,
                })
              }
            />
            Shared sheet — a crew, a steading, a ship: every member can edit it (the DM can lock it)
          </label>
          <div {...sx(e.pair)}>
            <TextInput
              label="Page title"
              value={page().title}
              onInput={(title) => props.onChange(renamePage(props.layout, page().id, title))}
            />
            <label {...sx(e.field)}>
              &nbsp;
              <button
                {...sx(styles.button, styles.buttonSmall, styles.buttonDanger)}
                disabled={props.layout.pages.length <= 1}
                onClick={() => {
                  const next = removePage(props.layout, page().id);
                  props.onChange(next);
                  setPageId(next.pages[0].id);
                }}
              >
                Remove page
              </button>
            </label>
          </div>
          <div {...sx(e.outline)} aria-label="Blocks" ref={(el) => (outline = el)}>
            <For each={page().blocks}>
              {(item) => (
                <>
                  <Row item={item} />
                  <Show when={confirmRemove() === item.id && item.type === "group" && item}>
                    {(group) => (
                      <div {...sx(e.confirm)} role="alertdialog" aria-label="Delete group">
                        <span {...sx(e.confirmText)}>
                          Delete {group().title ? `“${group().title}”` : "this group"} and its{" "}
                          {group().blocks.length} {group().blocks.length === 1 ? "block" : "blocks"}
                          ?
                        </span>
                        <button
                          {...sx(styles.button, styles.buttonSmall)}
                          onClick={() => ungroup(group().id)}
                        >
                          Ungroup instead
                        </button>
                        <button
                          {...sx(styles.button, styles.buttonSmall, styles.buttonDanger)}
                          onClick={() => remove(group().id)}
                        >
                          Delete all
                        </button>
                        <button
                          {...sx(styles.button, styles.buttonSmall)}
                          onClick={() => setConfirmRemove(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </Show>
                  <Show when={item.type === "group" && item}>
                    {(group) => (
                      <div {...sx(e.groupKids)}>
                        <For each={group().blocks}>
                          {(child) => <Row item={child} group={group().id} />}
                        </For>
                        <Show when={!group().blocks.length}>
                          <span
                            {...sx(e.groupEmpty)}
                            data-row=""
                            data-group={group().id}
                            data-kind="empty"
                          >
                            Empty. Drag blocks here, or select the group and add one.
                          </span>
                        </Show>
                      </div>
                    )}
                  </Show>
                </>
              )}
            </For>
            <Show when={!page().blocks.length}>
              <span {...sx(e.hint)} style={{ padding: "8px" }}>
                No blocks on this page yet.
              </span>
            </Show>
            <Show when={drop()?.top !== undefined && drop()}>
              {(target) => (
                <div
                  {...sx(e.dropLine, target().inside && e.dropLineInside)}
                  style={{ top: `${target().top}px` }}
                />
              )}
            </Show>
            <Show when={dragging()}>
              {(drag) => (
                <Show when={findBlock(props.layout, drag().id)}>
                  {(item) => (
                    <div
                      {...sx(e.ghost)}
                      style={{ left: `${drag().x + 14}px`, top: `${drag().y + 10}px` }}
                    >
                      <span {...sx(e.kind)} style={{ width: "auto" }}>
                        {item().type}
                      </span>
                      {summarize(item())}
                    </div>
                  )}
                </Show>
              )}
            </Show>
          </div>
          <div {...sx(e.bar)}>
            <label {...sx(e.field)}>
              {selectedGroup() ? "Add to the selected group" : "Add a block"}
              <select
                {...sx(styles.select, e.small)}
                aria-label="Add a block"
                value=""
                onChange={(event) => {
                  const type = event.currentTarget.value as BlockType;
                  event.currentTarget.value = "";
                  if (type) add(type);
                }}
              >
                <option value="">Choose a type…</option>
                <For
                  each={blockTypes.filter((item) => !(selectedGroup() && item.type === "group"))}
                >
                  {(item) => <option value={item.type}>{item.label}</option>}
                </For>
              </select>
            </label>
            <div {...sx(styles.spacer)} />
            <button
              {...sx(styles.button, styles.buttonSmall)}
              onClick={() => setJson(JSON.stringify(props.layout, null, 2))}
            >
              Edit as JSON
            </button>
          </div>
          <Show
            when={block()}
            fallback={<span {...sx(e.hint)}>Select a block to edit its contents.</span>}
          >
            {(current) => (
              <Inspector
                block={current()}
                entryTypes={props.entryTypes ?? []}
                lists={allBlocks(props.layout).flatMap((item) =>
                  item.type === "list" ? [{ key: item.key, title: item.title }] : [],
                )}
                keys={[...new Set(layoutKeys(props.layout))].filter(
                  (key) => (current() as { key?: string }).key !== key,
                )}
                onUngroup={() => ungroup(current().id)}
                onChange={(next) =>
                  props.onChange(updateBlock(props.layout, current().id, () => next))
                }
              />
            )}
          </Show>
          <ItemRows
            title="Derived values"
            items={props.layout.derived ?? []}
            columns={[
              { key: "label", label: "Label", width: "minmax(0, 1fr)" },
              { key: "key", label: "Key", width: "minmax(0, 0.8fr)" },
              {
                key: "expr",
                label: "Formula",
                placeholder: "floor((@str - 10) / 2)",
                required: true,
                width: "minmax(0, 1.8fr)",
              },
            ]}
            onChange={(derived) =>
              props.onChange({ ...props.layout, derived: derived.length ? derived : undefined })
            }
            make={() => ({ key: `value_${Date.now() % 10000}`, label: "Value", expr: "0" })}
          />
          <span {...sx(e.hint)}>
            Numbers computed from other values, shown wherever a stat or field uses the key and
            usable as @key in rolls. They're never stored: change the values they come from.
          </span>
          <Show when={problems().length}>
            <ul {...sx(e.problems)} aria-label="Layout problems">
              <For each={problems()}>{(problem) => <li>{problem}</li>}</For>
            </ul>
          </Show>
        </div>
        <div {...sx(e.column)}>
          <div {...sx(e.bar)}>
            <span {...sx(e.hint)}>
              Preview · style and width controls set this layout's defaults
            </span>
            <div {...sx(styles.spacer)} />
            <button
              {...sx(styles.button, styles.buttonSmall, !wide() && styles.buttonPrimary)}
              aria-pressed={!wide() ? "true" : "false"}
              onClick={() => setWide(false)}
            >
              Panel
            </button>
            <button
              {...sx(styles.button, styles.buttonSmall, wide() && styles.buttonPrimary)}
              aria-pressed={wide() ? "true" : "false"}
              onClick={() => setWide(true)}
            >
              Wide
            </button>
          </div>
          <div
            {...sx(e.preview)}
            style={{ width: wide() ? "720px" : "340px", "max-width": "100%" }}
          >
            <SheetBlocks
              layout={props.layout}
              name="Sample character"
              subtitle={props.layout.system}
              values={values()}
              page={page().id}
              onPage={setPageId}
              customize
              onVariant={(id, variant) =>
                props.onChange(
                  updateBlock(props.layout, id, (item) => ({ ...item, variant }) as LayoutBlock),
                )
              }
              onSpan={(id, span) =>
                props.onChange(
                  updateBlock(
                    props.layout,
                    id,
                    (item) => ({ ...item, [wide() ? "wide" : "span"]: span }) as LayoutBlock,
                  ),
                )
              }
              onChange={(key, value) => setValues((previous) => ({ ...previous, [key]: value }))}
              onRoll={() => {}}
            />
          </div>
          <span {...sx(e.hint)}>
            Keys connect blocks to character values: renaming a key on a template that's in use
            hides the old value. New keys are made from labels, e.g. “{slugKey("Max Clarity")}”.
          </span>
        </div>
      </div>
    </Show>
  );
}
