import * as stylex from "@stylexjs/stylex";
import { Show, createSignal, createUniqueId } from "solid-js";
import { dropIndex } from "../client/sortable";
import { colors } from "../theme/tokens.stylex";
import { sx } from "../theme/sx";

/*
 * Drag-to-reorder for short vertical lists: entry fields, list columns, item
 * rows, a sheet's list rows. Pointer events so touch works; each handle also
 * moves its item with the arrow keys. Items are measured by the elements that
 * carry `item(index)` — a row, or in grid layouts the handle's cell — so the
 * list's container needs `position: relative` for the drop line.
 */
export function createSortable(options: {
  count: () => number;
  onMove: (from: number, to: number) => void;
}) {
  const id = createUniqueId();
  let container: HTMLElement | undefined;
  let start: { index: number; y: number } | undefined;
  const [dragging, setDragging] = createSignal<number | null>(null);
  const [target, setTarget] = createSignal<{ index: number; top: number } | null>(null);

  const measure = () =>
    container
      ? [...container.querySelectorAll<HTMLElement>(`[data-sort="${id}"]`)]
          .sort((a, b) => Number(a.dataset.sortIndex) - Number(b.dataset.sortIndex))
          .map((element) => element.getBoundingClientRect())
      : [];

  const locate = (from: number, y: number) => {
    const spans = measure();
    const box = container?.getBoundingClientRect();
    if (!box || !spans.length) return null;
    const index = dropIndex(spans, from, y);
    const others = spans.filter((_, i) => i !== from);
    const top = index < others.length ? others[index].top : others[others.length - 1].bottom;
    return { index, top: top - box.top };
  };

  const finish = (commit: boolean) => {
    const from = dragging();
    const to = target();
    start = undefined;
    setDragging(null);
    setTarget(null);
    if (commit && from !== null && to && to.index !== from) options.onMove(from, to.index);
  };

  return {
    container: (element: HTMLElement) => (container = element),
    /** Marks the element measured for item `index`. */
    item: (index: number) => ({ "data-sort": id, "data-sort-index": index }),
    dragging,
    target,
    handle: (index: number) => ({
      onPointerDown: (event: PointerEvent) => {
        if (event.button !== 0) return;
        start = { index, y: event.clientY };
        (event.currentTarget as Element).setPointerCapture(event.pointerId);
        event.preventDefault();
      },
      onPointerMove: (event: PointerEvent) => {
        if (!start) return;
        if (dragging() === null && Math.abs(event.clientY - start.y) < 4) return;
        setDragging(start.index);
        setTarget(locate(start.index, event.clientY));
      },
      onPointerUp: () => finish(true),
      onPointerCancel: () => finish(false),
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === "Escape" && dragging() !== null) return finish(false);
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        const to = index + (event.key === "ArrowUp" ? -1 : 1);
        if (to >= 0 && to < options.count()) options.onMove(index, to);
      },
    }),
  };
}

export type Sortable = ReturnType<typeof createSortable>;

export function SortHandle(props: { sortable: Sortable; index: number; label: string }) {
  return (
    <button
      type="button"
      {...sx(h.handle)}
      aria-label={`Reorder ${props.label}`}
      title="Drag to reorder · arrow keys move"
      {...props.sortable.handle(props.index)}
    >
      ⠿
    </button>
  );
}

/** The accent line where a dragged item will land. */
export function DropLine(props: { sortable: Sortable }) {
  return (
    <Show when={props.sortable.target()}>
      {(target) => <div {...sx(h.line)} style={{ top: `${target().top}px` }} aria-hidden="true" />}
    </Show>
  );
}

const h = stylex.create({
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
    userSelect: "none",
    ":hover": { color: colors.text },
  },
  line: {
    position: "absolute",
    left: 0,
    right: 0,
    height: "2px",
    marginTop: "-1px",
    backgroundColor: colors.accent,
    pointerEvents: "none",
    zIndex: 2,
  },
});
