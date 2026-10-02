import * as stylex from "@stylexjs/stylex";
import { For, Show } from "solid-js";
import { evaluateNumber, parseExpr, toNumber, type Scope } from "../../domain/derived";
import { formulaRefs } from "../../domain/formula-help";
import { refLabel } from "../../domain/sheet-refs";
import { colors, fontSize, fonts, space } from "../../theme/tokens.stylex";
import { sx } from "../../theme/sx";
import { e, ItemRows, TextInput } from "../editor-kit";
import { FormulaInput } from "../formula-input";
import { formatNumber } from "../why-value";
import { parts } from "./parts.stylex";
import type { PartEditorProps, PartViewProps } from "./types";

/** A formula's value on this character, or `undefined` when it doesn't parse. */
const tally = (expr: string, scope: () => Scope): number | undefined => {
  const parsed = parseExpr(expr);
  return parsed.ok ? evaluateNumber(parsed.value, scope()) : undefined;
};

/**
 * A live tally ("Spent 7 of 10 · 3 left"): both formulas evaluated on the
 * character, with each listed value and its cap hint underneath. Display only
 * — it writes nothing and never blocks anything.
 */
export function BudgetView(props: PartViewProps<"budget">) {
  const scope = () => props.context.scope();
  const spent = () => tally(props.part.spent, scope);
  const total = () => tally(props.part.total, scope);
  const left = () => {
    const used = spent();
    const have = total();
    return used === undefined || have === undefined ? undefined : have - used;
  };
  const remaining = () => {
    const rest = left();
    if (rest === undefined) return undefined;
    return rest < 0 ? `${formatNumber(-rest)} over` : `${formatNumber(rest)} left`;
  };
  return (
    <div {...sx(b.wrap)} role="group" aria-label={props.part.label || "Budget"}>
      <div {...sx(b.line)}>
        <strong {...sx(parts.label)}>{props.part.label || "Budget"}</strong>
        <span>
          Spent {spent() === undefined ? "—" : formatNumber(spent()!)} of{" "}
          {total() === undefined ? "—" : formatNumber(total()!)}
        </span>
        <Show when={remaining()}>
          {(text) => (
            <span {...sx(b.left, left() === 0 && b.exact, (left() ?? 0) < 0 && b.over)}>
              {text()}
            </span>
          )}
        </Show>
      </div>
      <Show when={(props.part.items ?? []).length}>
        <ul {...sx(b.items)}>
          <For each={props.part.items ?? []}>
            {(item) => {
              const value = () => scope().value({ key: item.key });
              const over = () => item.cap !== undefined && toNumber(value()) > item.cap;
              return (
                <li {...sx(b.row)}>
                  <span>{refLabel(props.context.layout, { key: item.key })}</span>
                  <span {...sx(b.value, over() && b.valueOver)}>
                    {value() === undefined ? "—" : formatNumber(value()!)}
                  </span>
                  <Show when={item.cap !== undefined}>
                    <span {...sx(b.cap)}>max {item.cap}</span>
                  </Show>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
    </div>
  );
}

export function BudgetEditor(props: PartEditorProps<"budget">) {
  return (
    <>
      <TextInput
        label="Label"
        value={props.part.label}
        onInput={(label) => props.onChange({ ...props.part, label })}
      />
      <div {...sx(e.bar)}>
        <label {...sx(e.field)}>
          Spent
          <FormulaInput
            label={`${props.label} spent`}
            value={props.part.spent}
            placeholder="@str + @dex"
            suggestions={formulaRefs(props.layout)}
            onInput={(spent) => props.onChange({ ...props.part, spent })}
          />
        </label>
        <label {...sx(e.field)}>
          Total
          <FormulaInput
            label={`${props.label} total`}
            value={props.part.total}
            placeholder="10"
            suggestions={formulaRefs(props.layout)}
            onInput={(total) => props.onChange({ ...props.part, total })}
          />
        </label>
      </div>
      <ItemRows
        title={`${props.label} items`}
        items={props.part.items ?? []}
        columns={[
          { key: "key", label: "Value", placeholder: "str" },
          { key: "cap", label: "Max", kind: "number", placeholder: "no max" },
        ]}
        onChange={(items) =>
          props.onChange({ ...props.part, items: items.length ? items : undefined })
        }
        make={() => ({ key: "" })}
      />
    </>
  );
}

const b = stylex.create({
  wrap: { display: "flex", flexDirection: "column", gap: space.x1 },
  line: {
    display: "flex",
    flexWrap: "wrap",
    gap: space.x2,
    alignItems: "baseline",
    fontSize: fontSize.caption,
  },
  left: { color: colors.textMuted },
  exact: { color: colors.success },
  over: { color: colors.warning },
  items: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: space.x1,
    fontSize: fontSize.caption,
  },
  row: { display: "flex", gap: space.x2, alignItems: "baseline" },
  value: { fontFamily: fonts.numeric },
  valueOver: { color: colors.warning },
  cap: { color: colors.textMuted },
});
