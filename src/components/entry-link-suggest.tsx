import * as stylex from "@stylexjs/stylex";
import { For, Show, createSignal } from "solid-js";
import type { IndexRow } from "../domain/compendium";
import { searchEntries } from "../domain/compendium-search";
import { insertLink, linkQueryAt } from "../domain/entry-links";
import { colors, fonts, skin } from "../theme/tokens.stylex";
import { sx } from "../theme/sx";

/*
 * Typing `[[` in a textarea suggests compendium entries; picking one writes
 * `[[ref:<id>|Entry name]]`, which survives renames. The textarea's wrapper needs `position: relative`.
 */
export function createLinkSuggest(options: {
  entries: () => readonly IndexRow[];
  typeName?: (typeId: string) => string | undefined;
  setText: (text: string) => void;
}) {
  let field: HTMLTextAreaElement | undefined;
  const [query, setQuery] = createSignal<{ start: number; query: string } | null>(null);
  const [active, setActive] = createSignal(0);
  const results = () => {
    const current = query();
    return current ? searchEntries(options.entries(), current.query).slice(0, 6) : [];
  };
  const update = () => {
    if (!field) return;
    const found = linkQueryAt(field.value, field.selectionStart ?? field.value.length);
    setQuery(found && options.entries().length ? found : null);
    setActive(0);
  };
  const pick = (entry: IndexRow) => {
    const current = query();
    if (!current || !field) return;
    const next = insertLink(
      field.value,
      field.selectionStart ?? field.value.length,
      current.start,
      entry.name,
      entry.id,
    );
    options.setText(next.text);
    setQuery(null);
    const target = field;
    queueMicrotask(() => {
      target.value = next.text;
      target.focus();
      target.setSelectionRange(next.caret, next.caret);
    });
  };
  return {
    ref: (element: HTMLTextAreaElement) => (field = element),
    /** Call after the textarea's own input handling. */
    onInput: update,
    /** Returns true when the key drove the suggestions (skip sending, etc.). */
    onKeyDown: (event: KeyboardEvent) => {
      const list = results();
      if (!list.length) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        setActive((active() + (event.key === "ArrowDown" ? 1 : list.length - 1)) % list.length);
      } else if (event.key === "Enter" || event.key === "Tab") {
        pick(list[active()]);
      } else if (event.key === "Escape") {
        setQuery(null);
      } else return false;
      event.preventDefault();
      return true;
    },
    close: () => setQuery(null),
    Popover: (props: { above?: boolean }) => (
      <Show when={results().length}>
        <div
          {...sx(l.popover, props.above ? l.above : l.below)}
          role="listbox"
          aria-label="Compendium entries"
        >
          <For each={results()}>
            {(entry, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index() === active() ? "true" : "false"}
                {...sx(l.option, index() === active() && l.optionOn)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(entry);
                }}
              >
                {entry.name}
                <span {...sx(l.type)}>{options.typeName?.(entry.typeId) ?? ""}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    ),
  };
}

export type LinkSuggest = ReturnType<typeof createLinkSuggest>;

const l = stylex.create({
  popover: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 40,
    display: "flex",
    flexDirection: "column",
    padding: "3px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.borderStrong,
    borderRadius: skin.controlRadius,
    backgroundColor: colors.surfaceRaised,
    boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
  },
  above: { bottom: "calc(100% + 4px)" },
  below: { top: "calc(100% + 4px)" },
  option: {
    display: "flex",
    alignItems: "baseline",
    gap: "8px",
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
  optionOn: { backgroundColor: colors.accentMuted },
  type: { marginLeft: "auto", fontSize: "11px", color: colors.textFaint },
});
