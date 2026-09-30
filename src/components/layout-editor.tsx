import * as stylex from "@stylexjs/stylex";
import * as Schema from "effect/Schema";
import { For, Match, Show, Switch, createSignal, onCleanup } from "solid-js";
import {
  addPage,
  blockTypes,
  duplicateBlock,
  findBlock,
  insertBlock,
  type BlockDestination,
  moveBlock,
  moveBlockTo,
  newBlock,
  removeBlock,
  removePage,
  renamePage,
  slugKey,
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
  items: { display: "grid", gap: "4px", alignItems: "center" },
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
  kind?: "text" | "number" | "select";
  options?: readonly string[];
  width?: string;
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
    [...props.columns.map((c) => c.width ?? "minmax(0, 1fr)"), "22px"].join(" ");
  const set = (index: number, key: string, raw: string, kind?: string) =>
    props.onChange(
      props.items.map((item, i) => {
        if (i !== index) return item;
        const next = { ...item } as Record<string, unknown>;
        if (kind === "number") {
          if (raw.trim() === "") delete next[key];
          else next[key] = Math.trunc(Number(raw));
        } else if (raw === "" && key !== "label" && key !== "key") delete next[key];
        else next[key] = raw;
        return next as T;
      }),
    );
  return (
    <div {...sx(e.column)}>
      <span {...sx(e.itemHead)}>{props.title}</span>
      <div {...sx(e.items)} style={{ "grid-template-columns": template() }}>
        <For each={props.columns}>
          {(column) => <span {...sx(e.itemHead)}>{column.label}</span>}
        </For>
        <span />
        <For each={props.items.map((_, i) => i)}>
          {(index) => (
            <>
              <For each={props.columns}>
                {(column) => (
                  <Show
                    when={column.kind === "select"}
                    fallback={
                      <input
                        {...sx(styles.input, e.small)}
                        aria-label={`${props.title} ${index + 1} ${column.label}`}
                        type={column.kind === "number" ? "number" : "text"}
                        value={String(
                          (props.items[index] as Record<string, unknown>)[column.key] ?? "",
                        )}
                        onInput={(event) =>
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

function Inspector(props: { block: LayoutBlock; onChange: (block: LayoutBlock) => void }) {
  const b = () => props.block;
  const patch = (partial: Record<string, unknown>) =>
    props.onChange({ ...props.block, ...partial } as LayoutBlock);
  const variants = () => blockVariants[b().type] as readonly string[];
  const spans = ["", "1", "2", "3", "4", "5", "6"];
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
            <TextInput
              label="Title (optional)"
              value={(block() as { title?: string }).title ?? ""}
              onInput={(title) => patch({ title: title || undefined })}
            />
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
                  ]}
                  onChange={(columns) => patch({ columns })}
                  make={() => ({ key: `col_${Date.now() % 10000}`, label: "Column", kind: "text" })}
                />
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
                { key: "label", label: "Label", width: "minmax(0, 1.6fr)" },
                { key: "dice", label: "Dice", width: "80px" },
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
}) {
  const [pageId, setPageId] = createSignal(props.layout.pages[0]?.id ?? "");
  const [selected, setSelected] = createSignal<string | null>(null);
  const [wide, setWide] = createSignal(false);
  const [json, setJson] = createSignal<string | null>(null);
  const [jsonError, setJsonError] = createSignal("");
  const [values, setValues] = createSignal<SheetValues>({});
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
          if (selected() === rowProps.item.id) setSelected(null);
          props.onChange(removeBlock(props.layout, rowProps.item.id));
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
                onChange={(next) =>
                  props.onChange(updateBlock(props.layout, current().id, () => next))
                }
              />
            )}
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
