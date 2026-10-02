import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import { explain, parseExpr } from "../../domain/derived";
import { formulaRefs } from "../../domain/formula-help";
import { colors, fontSize, fonts, space } from "../../theme/tokens.stylex";
import { sx } from "../../theme/sx";
import { ItemRows } from "../editor-kit";
import { formatNumber, WhyValue, whyOf } from "../why-value";
import type { PartEditorProps, PartViewProps } from "./types";

/*
 * Readouts: labelled formulas (a total, a value at a level) shown as a
 * compact label → value list. Values come from `context.scope()` and are
 * never written anywhere; clicking one shows where it comes from, and a
 * formula that doesn't parse shows "?" with the reason.
 */

export function ShowView(props: PartViewProps<"show">) {
  return (
    <div {...sx(show.list)} role="group" aria-label="Readouts">
      <For each={props.part.items}>
        {(item) => {
          const value = () => {
            const parsed = parseExpr(item.expr);
            if (!parsed.ok) return "?";
            const result = explain(parsed.value, props.context.scope()).value;
            return result === "" ? "—" : formatNumber(result);
          };
          return (
            <div {...sx(show.row)}>
              <span {...sx(show.label)}>{item.label}</span>
              <span {...sx(show.value)}>
                <WhyValue why={whyOf(props.context.layout, item.expr, props.context.scope())}>
                  {value()}
                </WhyValue>
              </span>
            </div>
          );
        }}
      </For>
    </div>
  );
}

const show = stylex.create({
  list: { display: "flex", flexDirection: "column", gap: "2px" },
  row: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.x2,
    fontSize: fontSize.caption,
  },
  label: { color: colors.textMuted },
  value: { fontFamily: fonts.numeric, fontWeight: 600 },
});

export function ShowEditor(props: PartEditorProps<"show">) {
  return (
    <ItemRows
      title={`${props.label} readouts`}
      items={props.part.items}
      columns={[
        { key: "label", label: "Label", width: "minmax(0, 1fr)" },
        {
          key: "expr",
          label: "Formula",
          kind: "formula",
          placeholder: "floor((@str - 10) / 2)",
          width: "minmax(0, 1.2fr)",
          required: true,
          formula: { suggestions: () => formulaRefs(props.layout) },
        },
      ]}
      onChange={(items) => props.onChange({ ...props.part, items })}
      make={() => ({ label: "Value", expr: "1" })}
    />
  );
}
