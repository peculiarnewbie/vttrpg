import * as stylex from "@stylexjs/stylex";
import { For, Show } from "solid-js";
import type { RollGroup, RollModifierPart, RollResult, RolledDie } from "../domain/schemas";
import { colors, fontSize, fonts, space } from "../theme/tokens.stylex";
import { styles } from "./styles.stylex";
import { sx } from "../theme/sx";

/** Past this many dice, chips shrink and drop their per-die label so a pool stays a few lines. */
const COMPACT_AT = 20;

export const rollGroups = (roll: RollResult): readonly RollGroup[] =>
  roll.groups?.length ? roll.groups : [roll];

export const rolledDiceCount = (roll: RollResult) =>
  rollGroups(roll).reduce(
    (total, group) => total + group.dice.reduce((sum, die) => sum + die.results.length, 0),
    0,
  );

const signed = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value)}`;

/** Named modifiers ("STR mod +2"); flat numbers already read in the notation. */
export const modifierText = (modifiers: readonly RollModifierPart[]) =>
  modifiers
    .filter((part) => part.label !== "static")
    .map((part) => `${part.label} ${signed(part.value)}`)
    .join(", ");

function Dice(props: { die: RolledDie; compact: boolean }) {
  return (
    <>
      <Show when={props.die.negative}>
        <span {...sx(v.sign)}>−</span>
      </Show>
      <Show when={props.compact}>
        <span {...sx(v.sides)}>d{props.die.sides}</span>
      </Show>
      <For each={props.die.results}>
        {(value, index) => {
          const dropped = () => props.die.kept?.[index()] === false;
          return (
            <span
              {...sx(styles.die, props.compact && v.compact, dropped() && v.dropped)}
              title={dropped() ? "Dropped" : undefined}
            >
              <span>{value}</span>
              <Show when={!props.compact}>
                <sub {...sx(styles.dieLabel)}>d{props.die.sides}</sub>
              </Show>
            </span>
          );
        }}
      </For>
    </>
  );
}

/**
 * A roll's dice and totals — every `|` group on its own line, dropped dice
 * dimmed, subtracted dice after a minus. Only numbers: what they mean is the
 * table's call.
 */
export function RollView(props: { roll: RollResult; showTotal: boolean }) {
  const compact = () => rolledDiceCount(props.roll) > COMPACT_AT;
  const several = () => rollGroups(props.roll).length > 1;
  return (
    <div {...sx(v.roll)}>
      <Show when={props.roll.table}>
        {(table) => (
          <div {...sx(v.table)}>
            <span {...sx(v.tableName)}>
              {table().entryName} · {table().fieldLabel}
            </span>
            <Show
              when={table().row}
              fallback={<span {...sx(v.tableNone)}>No row for {props.roll.total}</span>}
            >
              {(row) => (
                <span>
                  <span {...sx(v.tableRange)}>
                    {row().min === row().max ? row().min : `${row().min}–${row().max}`}
                  </span>{" "}
                  {row().text}
                </span>
              )}
            </Show>
          </div>
        )}
      </Show>
      <For each={rollGroups(props.roll)}>
        {(group) => (
          <div {...sx(styles.rollResult)}>
            <div {...sx(v.dice, compact() && v.diceCompact)}>
              <For each={group.dice}>{(die) => <Dice die={die} compact={compact()} />}</For>
            </div>
            <Show when={props.showTotal}>
              <span {...sx(styles.rollTotal)}>Total {group.total}</span>
            </Show>
            <span {...sx(styles.mono)}>
              {several() ? group.notation : props.roll.notation}
              <Show when={modifierText(group.modifiers)}>{(text) => ` (${text()})`}</Show>
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

const v = stylex.create({
  roll: { display: "flex", flexDirection: "column", gap: space.x1 },
  dice: { display: "flex", alignItems: "center", gap: space.x2, flexWrap: "wrap" },
  diceCompact: { gap: "3px" },
  compact: {
    fontSize: fontSize.caption,
    minWidth: "22px",
    padding: "1px 3px",
  },
  dropped: {
    opacity: 0.4,
    textDecorationLine: "line-through",
    borderStyle: "dashed",
  },
  sign: { fontFamily: fonts.numeric, color: colors.textMuted },
  // The oracle's row reads first: it is what people rolled for.
  table: { display: "flex", flexDirection: "column", gap: "1px", fontSize: fontSize.body },
  tableName: { fontSize: fontSize.micro, color: colors.textMuted },
  tableRange: { fontFamily: fonts.numeric, color: colors.textMuted },
  tableNone: { color: colors.textMuted, fontStyle: "italic" },
  sides: { fontFamily: fonts.numeric, fontSize: fontSize.micro, color: colors.textMuted },
});
