import { For, Show, createSignal, onCleanup, onSettled } from "solid-js";
import type { RollResult } from "../domain/schemas";

export type RollSummary = {
  id: string;
  roll: RollResult;
  content: string;
  authorName: string;
  avatarUrl?: string;
};

const FACES = ["front", "back", "right", "left", "top", "bottom"] as const;

function DiceOverlayInner(props: { summary: RollSummary; onDone: () => void }) {
  const dice = () =>
    props.summary.roll.dice.flatMap((group) =>
      group.results.map((value) => ({ sides: group.sides, value })),
    );
  const [showTotal, setShowTotal] = createSignal(false);
  const [leaving, setLeaving] = createSignal(false);
  const timers: ReturnType<typeof setTimeout>[] = [];

  onSettled(() => {
    const diceDuration = 1150 + props.summary.roll.dice.length * 90;
    timers.push(setTimeout(() => setShowTotal(true), diceDuration + 120));
    timers.push(setTimeout(() => setLeaving(true), diceDuration + 1500));
    timers.push(setTimeout(() => props.onDone(), diceDuration + 2050));
  });

  onCleanup(() => timers.forEach(clearTimeout));

  return (
    <div class="ttrpg-dice-overlay" data-leaving={leaving() ? "true" : "false"}>
      <div class="ttrpg-dice-label">
        {props.summary.authorName} · {props.summary.content}
      </div>
      <div class="ttrpg-dice-tray">
        <For each={dice()}>
          {(die, index) => (
            <div class="ttrpg-die" style={{ "animation-delay": `${index() * 90}ms` }}>
              <For each={FACES}>
                {(side) => (
                  <div class="ttrpg-die-face" data-side={side}>
                    {die.value}
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
      <Show when={showTotal()}>
        <div class="ttrpg-dice-total">
          <span class="ttrpg-dice-total-value">{props.summary.roll.total}</span>
          <span class="ttrpg-dice-total-label">
            {props.summary.roll.notation}
            {props.summary.roll.modifiers.length > 0
              ? ` ${props.summary.roll.modifiers
                  .map((modifier) => `${modifier.value >= 0 ? "+" : ""}${modifier.value}`)
                  .join(" ")}`
              : ""}
          </span>
        </div>
      </Show>
    </div>
  );
}

export function DiceOverlay(props: { roll: RollSummary | null; onDone: () => void }) {
  return (
    <Show when={props.roll} keyed>
      {(summary) => <DiceOverlayInner summary={summary} onDone={props.onDone} />}
    </Show>
  );
}
