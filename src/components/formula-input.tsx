import * as stylex from "@stylexjs/stylex";
import { For, Show, createMemo, createSignal, createUniqueId } from "solid-js";
import { parseExpr, type Expr, type Scalar, type Term } from "../domain/derived";
import {
  FUNCTION_HELP,
  errorAt,
  matchRefs,
  refAtCursor,
  type RefSuggestion,
} from "../domain/formula-help";
import { colors, fonts, skin } from "../theme/tokens.stylex";
import { sx } from "../theme/sx";
import { styles } from "./styles.stylex";

/*
 * One field for every formula an author writes (derived values, computed
 * columns, builder tallies): "@" suggests the sheet's values by label, a
 * mistake is named in plain words where it is, and the value for the preview
 * character shows as you type, with the values it read.
 */

const MAX_SUGGESTIONS = 8;

const shown = (value: Scalar | undefined) =>
  value === undefined
    ? "—"
    : typeof value === "string"
      ? `“${value}”`
      : Number.isInteger(value)
        ? String(value)
        : String(Math.round(value * 100) / 100);

export function FormulaInput(props: {
  label: string;
  value: string;
  placeholder?: string;
  suggestions: readonly RefSuggestion[];
  /** The formula's value for the preview character, what it read, and any problem beyond syntax. */
  preview?: (expr: Expr) => { value: Scalar; terms: readonly Term[]; problem?: string } | undefined;
  onInput: (value: string) => void;
}) {
  const id = createUniqueId();
  let input: HTMLInputElement | undefined;
  const [cursor, setCursor] = createSignal<number>();
  const [active, setActive] = createSignal(0);
  const [dismissed, setDismissed] = createSignal(false);
  const [help, setHelp] = createSignal(false);
  const parsed = createMemo(() => (props.value.trim() ? parseExpr(props.value) : undefined));
  const error = () => {
    const result = parsed();
    return result && !result.ok ? errorAt(result.error) : undefined;
  };
  const result = () => {
    const value = parsed();
    return value?.ok ? props.preview?.(value.value) : undefined;
  };
  const typing = () => {
    const at = cursor();
    return at === undefined ? undefined : refAtCursor(props.value, at);
  };
  const matches = createMemo(() => {
    const ref = typing();
    return ref && !dismissed()
      ? matchRefs(props.suggestions, ref.typed).slice(0, MAX_SUGGESTIONS)
      : [];
  });
  const track = () => {
    setCursor(input?.selectionStart ?? undefined);
    setActive(0);
  };
  const insert = (suggestion: RefSuggestion) => {
    const ref = typing();
    const at = cursor();
    if (!ref || at === undefined) return;
    const next = props.value.slice(0, ref.start) + suggestion.text + props.value.slice(at);
    props.onInput(next);
    const caret = ref.start + suggestion.text.length;
    queueMicrotask(() => {
      input?.focus();
      input?.setSelectionRange(caret, caret);
      setCursor(caret);
    });
  };
  const unfinished = (position: number | undefined) =>
    position !== undefined && position >= props.value.trimEnd().length && cursor() !== undefined;
  const near = (position: number) => {
    const text = props.value.slice(position, position + 12).trim();
    return text ? ` near “${text}”` : " at the end";
  };
  return (
    <div {...sx(f.root)}>
      <div {...sx(f.row)}>
        <input
          ref={(element) => (input = element)}
          {...sx(styles.input, f.input, error() && f.invalid)}
          role="combobox"
          aria-label={props.label}
          aria-invalid={error() ? "true" : undefined}
          aria-describedby={`${id}-status`}
          aria-autocomplete="list"
          aria-expanded={matches().length ? "true" : "false"}
          aria-controls={`${id}-refs`}
          aria-activedescendant={matches().length ? `${id}-ref-${active()}` : undefined}
          spellcheck={false}
          autocomplete="off"
          placeholder={props.placeholder}
          value={props.value}
          onInput={(event) => {
            setDismissed(false);
            props.onInput(event.currentTarget.value);
            track();
          }}
          onClick={track}
          onKeyUp={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") track();
          }}
          onBlur={() => setCursor(undefined)}
          onKeyDown={(event) => {
            const list = matches();
            if (!list.length) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setActive((index) => (index + step + list.length) % list.length);
            } else if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              insert(list[active()]);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setDismissed(true);
            }
          }}
        />
        <button
          type="button"
          {...sx(f.helpButton)}
          aria-label="Formula functions"
          aria-expanded={help() ? "true" : "false"}
          onClick={() => setHelp(!help())}
        >
          ƒ
        </button>
      </div>
      <Show when={matches().length}>
        <ul {...sx(f.refs)} id={`${id}-refs`} role="listbox" aria-label="Values to use">
          <For each={matches()}>
            {(suggestion, index) => (
              <li
                id={`${id}-ref-${index()}`}
                role="option"
                aria-selected={index() === active() ? "true" : "false"}
                {...sx(f.ref, index() === active() && f.refActive)}
                // Keep focus in the input so the caret stays where the ref goes.
                onMouseDown={(event) => {
                  event.preventDefault();
                  insert(suggestion);
                }}
              >
                <code {...sx(f.code)}>{suggestion.text}</code>
                <span>{suggestion.label}</span>
                <span {...sx(f.muted)}>{suggestion.detail}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <div id={`${id}-status`} {...sx(f.status)} role="status">
        <Show
          when={error()}
          fallback={
            <Show
              when={!result()?.problem}
              fallback={<span {...sx(f.error)}>{result()?.problem}</span>}
            >
              <Show when={result()}>
                {(value) => (
                  <span {...sx(f.muted)}>
                    = {shown(value().value)}
                    <Show when={value().terms.some((term) => term.value !== undefined)}>
                      {"  ·  "}
                      {value()
                        .terms.filter((term) => term.value !== undefined)
                        .map(
                          (term) =>
                            `@${term.ref.key}${term.ref.column ? `.${term.ref.column}` : ""} ${shown(term.value)}`,
                        )
                        .join(", ")}
                    </Show>
                  </span>
                )}
              </Show>
            </Show>
          }
        >
          {(problem) => (
            // Still being typed: a formula that just isn't finished yet isn't shouted about.
            <span {...sx(unfinished(problem().position) ? f.muted : f.error)}>
              {problem().message}
              {problem().position === undefined ? "" : near(problem().position!)}
            </span>
          )}
        </Show>
      </div>
      <Show when={help()}>
        <table {...sx(f.help)} aria-label="Formula functions">
          <tbody>
            <For each={FUNCTION_HELP}>
              {(item) => (
                <tr>
                  <th {...sx(f.helpName)} scope="row">
                    {item.name}
                  </th>
                  <td>
                    <code {...sx(f.code)}>{item.example}</code>
                  </td>
                  <td {...sx(f.muted)}>{item.does}</td>
                </tr>
              )}
            </For>
            <tr>
              <th {...sx(f.helpName)} scope="row">
                values
              </th>
              <td>
                <code {...sx(f.code)}>@str @gear.weight @row.qty</code>
              </td>
              <td {...sx(f.muted)}>type @ to pick one; no dice in formulas (put those in rolls)</td>
            </tr>
          </tbody>
        </table>
      </Show>
    </div>
  );
}

const f = stylex.create({
  root: { position: "relative", display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
  row: { display: "flex", gap: "2px", minWidth: 0 },
  input: { fontFamily: fonts.mono, fontSize: "12px", paddingBlock: "3px", minWidth: 0 },
  invalid: { borderColor: colors.danger },
  helpButton: {
    flexShrink: 0,
    width: "22px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: skin.controlRadius,
    backgroundColor: { default: "transparent", ":hover": colors.surfaceHover },
    color: colors.textMuted,
    fontFamily: fonts.mono,
    cursor: "pointer",
  },
  refs: {
    position: "absolute",
    top: "100%",
    left: 0,
    zIndex: 20,
    marginBlock: 0,
    paddingInline: 0,
    paddingBlock: "2px",
    listStyle: "none",
    minWidth: "260px",
    maxWidth: "420px",
    backgroundColor: colors.surfaceRaised,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.borderStrong,
    borderRadius: skin.controlRadius,
    boxShadow: "0 4px 12px rgb(0 0 0 / 0.18)",
  },
  ref: {
    display: "grid",
    gridTemplateColumns: "minmax(0, auto) minmax(0, 1fr) auto",
    gap: "8px",
    alignItems: "baseline",
    paddingInline: "6px",
    paddingBlock: "2px",
    fontSize: "12px",
    cursor: "pointer",
    backgroundColor: { default: "transparent", ":hover": colors.surfaceHover },
  },
  refActive: { backgroundColor: colors.accentMuted },
  code: { fontFamily: fonts.mono, fontSize: "11px", whiteSpace: "pre" },
  status: { minHeight: "14px", fontSize: "11px", lineHeight: 1.3, overflowWrap: "anywhere" },
  muted: { color: colors.textMuted },
  error: { color: colors.danger },
  help: {
    fontSize: "11px",
    borderCollapse: "collapse",
    backgroundColor: colors.surfaceMuted,
    borderRadius: skin.controlRadius,
  },
  helpName: { textAlign: "left", fontWeight: 600, paddingInlineEnd: "8px", whiteSpace: "nowrap" },
});
