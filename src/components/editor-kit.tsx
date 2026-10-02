import * as stylex from "@stylexjs/stylex";
import { For, Show } from "solid-js";
import type { Expr, Scalar, Term } from "../domain/derived";
import type { RefSuggestion } from "../domain/formula-help";
import type { LayoutBlock } from "../domain/sheet-layout";
import { moveIndex } from "../client/sortable";
import { colors, fonts, radii, skin } from "../theme/tokens.stylex";
import { sx } from "../theme/sx";
import { FormulaInput } from "./formula-input";
import { DropLine, SortHandle, createSortable } from "./sortable";
import { styles } from "./styles.stylex";

/*
 * Pieces the editors share: styles, item tables (rows of inputs with add,
 * remove and reorder), labelled text inputs, block summaries.
 */

const hair = { borderWidth: "1px", borderStyle: "solid", borderColor: colors.border } as const;

/** The editors' shared styles (template, block and builder editors). */
export const e = stylex.create({
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
  stepCard: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "8px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
  },
  partCard: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    paddingLeft: "8px",
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    borderLeftColor: colors.border,
  },
  checkList: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    maxHeight: "160px",
    overflowY: "auto",
  },
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

/** A block's one-line description in the outline and pickers. */
export const summarize = (block: LayoutBlock): string => {
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

export type Column = {
  key: string;
  label: string;
  /** `csv`: a string array edited as comma-separated text; `formula`: a {@link FormulaInput}. */
  kind?: "text" | "number" | "select" | "csv" | "formula";
  /** For `formula`: what it can read, and its value on the preview sheet (per item). */
  formula?: {
    suggestions: (item: Record<string, unknown>) => readonly RefSuggestion[];
    preview?: (
      expr: Expr,
      item: Record<string, unknown>,
    ) => { value: Scalar; terms: readonly Term[]; problem?: string } | undefined;
  };
  options?: readonly string[];
  width?: string;
  placeholder?: string;
  /** Clearing it keeps an empty string instead of removing the property. */
  required?: boolean;
};

/** A compact table of inputs for a block's items, with add and remove. */
export function ItemRows<T extends Record<string, unknown>>(props: {
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
                      <Show
                        when={column.kind === "formula" && column.formula}
                        fallback={
                          <input
                            {...sx(styles.input, e.small)}
                            aria-label={`${props.title} ${index + 1} ${column.label}`}
                            type={column.kind === "number" ? "number" : "text"}
                            placeholder={column.placeholder}
                            value={(() => {
                              const value = (props.items[index] as Record<string, unknown>)[
                                column.key
                              ];
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
                        {(formula) => {
                          const item = () => props.items[index] as Record<string, unknown>;
                          return (
                            <FormulaInput
                              label={`${props.title} ${index + 1} ${column.label}`}
                              placeholder={column.placeholder}
                              value={String(item()[column.key] ?? "")}
                              suggestions={formula().suggestions(item())}
                              preview={
                                formula().preview
                                  ? (expr) => formula().preview!(expr, item())
                                  : undefined
                              }
                              onInput={(value) => set(index, column.key, value, column.kind)}
                            />
                          );
                        }}
                      </Show>
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

/** Comma-separated items; saved when you leave the field, so a typed comma isn't tidied away. */
export function ListInput(props: {
  label: string;
  value: readonly (string | number)[];
  placeholder?: string;
  onChange: (items: string[]) => void;
}) {
  return (
    <label {...sx(e.field)}>
      {props.label}
      <input
        {...sx(styles.input, e.small)}
        value={props.value.join(", ")}
        placeholder={props.placeholder}
        onChange={(event) =>
          props.onChange(
            event.currentTarget.value
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
          )
        }
      />
    </label>
  );
}

export function TextInput(props: {
  label: string;
  value: string;
  onInput: (value: string) => void;
}) {
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
