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

export const modifierText = (modifiers: readonly RollModifierPart[]) =>
  modifiers
    .filter((part) => part.value !== 0 || part.label !== "static")
    .map((part) =>
      part.label === "static" ? signed(part.value) : `${part.label} ${signed(part.value)}`,
    )
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
  sides: { fontFamily: fonts.numeric, fontSize: fontSize.micro, color: colors.textMuted },
});
