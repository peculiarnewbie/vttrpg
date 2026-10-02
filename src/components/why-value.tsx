import * as stylex from "@stylexjs/stylex";
import type { JSX } from "@solidjs/web";
import { For, Show, createSignal } from "solid-js";
import { explain, parseExpr, type Scope } from "../domain/derived";
import { refLabel } from "../domain/sheet-refs";
import type { SheetLayout } from "../domain/sheet-layout";
import { colors, fonts, skin } from "../theme/tokens.stylex";
import { sx } from "../theme/sx";

/*
 * "Where this number comes from": a computed value that opens, on click, its
 * formula and the value of each thing it read. A formula that fails shows
 * "?" and why, instead of a silent 0. The sheet's derived values and the
 * builder's readouts both use it.
 */

/** A computed value as shown: text as is, numbers to at most two places. */
export const formatNumber = (value: number | string) =>
  typeof value === "string"
    ? value
    : Number.isInteger(value)
      ? String(value)
      : String(Math.round(value * 100) / 100);

export type Why = {
  readonly formula: string;
  readonly error?: string;
  readonly terms: readonly { readonly label: string; readonly value: string }[];
};

/** A formula's {@link Why} on this scope; `error` is a failure found elsewhere (a cycle). */
export const whyOf = (layout: SheetLayout, formula: string, scope: Scope, error?: string): Why => {
  const parsed = parseExpr(formula);
  if (!parsed.ok) return { formula, error: error ?? parsed.error, terms: [] };
  const terms = explain(parsed.value, scope).terms.map((term) => ({
    label: refLabel(layout, term.ref),
    value: term.value === undefined ? (term.ref.column ? "—" : "list") : formatNumber(term.value),
  }));
  return { formula, error, terms };
};

const POPOVER_WIDTH = 240;

/** `children` (the value) as a button that shows its {@link Why}; plain without one. */
export function WhyValue(props: { why: Why | undefined; children: JSX.Element }) {
  // Placed against the viewport, so a narrow panel doesn't clip it.
  const [open, setOpen] = createSignal<{ top: number; left: number }>();
  const toggle = (button: HTMLElement) => {
    if (open()) return setOpen(undefined);
    const rect = button.getBoundingClientRect();
    // It stays where it opened, so scrolling closes it.
    window.addEventListener("scroll", () => setOpen(undefined), { capture: true, once: true });
    setOpen({
      top: rect.bottom + 4,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8)),
    });
  };
  return (
    <Show when={props.why} fallback={props.children}>
      {(info) => (
        <span
          {...sx(w.why)}
          onFocusOut={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setOpen(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(undefined);
          }}
        >
          <button
            type="button"
            {...sx(w.button, info().error !== undefined && w.error)}
            aria-expanded={open() ? "true" : "false"}
            aria-label={info().error === undefined ? undefined : `Formula problem: ${info().error}`}
            onClick={(event) => toggle(event.currentTarget)}
          >
            {info().error === undefined ? props.children : "?"}
          </button>
          <Show when={open()}>
            {(at) => (
              <span
                {...sx(w.pop)}
                role="note"
                style={{
                  top: `${at().top}px`,
                  left: `${at().left}px`,
                  width: `${POPOVER_WIDTH}px`,
                }}
              >
                <code {...sx(w.formula)}>{info().formula}</code>
                <Show when={info().error}>
                  {(error) => <span {...sx(w.problem)}>{error()}</span>}
                </Show>
                <For each={info().terms}>
                  {(term) => (
                    <span {...sx(w.term)}>
                      <span>{term.label}</span>
                      <span {...sx(w.termValue)}>{term.value}</span>
                    </span>
                  )}
                </For>
              </span>
            )}
          </Show>
        </span>
      )}
    </Show>
  );
}

const w = stylex.create({
  why: { position: "relative", display: "inline-flex" },
  button: {
    font: "inherit",
    color: "inherit",
    backgroundColor: "transparent",
    borderWidth: 0,
    padding: 0,
    cursor: "help",
    textDecorationLine: { default: "none", ":hover": "underline" },
    textDecorationStyle: "dotted",
    textUnderlineOffset: "3px",
  },
  error: { color: colors.danger },
  pop: {
    position: "fixed",
    zIndex: 30,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    boxSizing: "border-box",
    paddingInline: "8px",
    paddingBlock: "6px",
    backgroundColor: colors.surfaceRaised,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.borderStrong,
    borderRadius: skin.controlRadius,
    boxShadow: "0 4px 12px rgb(0 0 0 / 0.18)",
    fontFamily: fonts.body,
    fontSize: "12px",
    fontWeight: 400,
    color: colors.text,
    textAlign: "left",
    whiteSpace: "normal",
  },
  formula: { fontFamily: fonts.mono, fontSize: "11px", overflowWrap: "anywhere" },
  problem: { color: colors.danger },
  term: { display: "flex", justifyContent: "space-between", gap: "12px" },
  termValue: { fontFamily: fonts.numeric, fontWeight: 600 },
});
