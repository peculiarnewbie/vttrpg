import DiceBox from "@3d-dice/dice-box-threejs";
import { Show, createEffect, createSignal, onCleanup, onSettled } from "solid-js";
import type { ChatMessage, RollResult } from "../domain/schemas";

export type RollSummary = {
  id: string;
  roll: RollResult;
  content: string;
  authorName: string;
  avatarUrl?: string;
};

const predeterminedNotation = (roll: RollResult) =>
  roll.dice
    .map((group) => `${group.results.length}d${group.sides}@${group.results.join(",")}`)
    .join("+");

export function DiceOverlay(props: { message: ChatMessage | null; onDone: () => void }) {
  const [ready, setReady] = createSignal(false);
  const [showTotal, setShowTotal] = createSignal(false);
  const [leaving, setLeaving] = createSignal(false);
  let box: DiceBox | undefined;
  let timers: ReturnType<typeof setTimeout>[] = [];

  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };

  onSettled(() => {
    try {
      box = new DiceBox("#ttrpg-dice-stage", {
        assetPath: "/dice/",
        sounds: false,
        shadows: true,
        theme_colorset: "white",
        theme_texture: "",
        theme_material: "glass",
        theme_surface: "green-felt",
        baseScale: 100,
        gravity_multiplier: 400,
        light_intensity: 0.75,
        strength: 1,
      });
      box
        .initialize()
        .then(() => setReady(true))
        .catch(() => setReady(false));
    } catch {
      setReady(false);
    }
  });

  onCleanup(() => clearTimers());

  const waitReady = async (timeoutMs = 4000) => {
    const start = Date.now();
    while (!ready() && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return ready();
  };

  const play = async (message: ChatMessage) => {
    clearTimers();
    const isReady = await waitReady();
    if (isReady && box && message.roll) {
      try {
        await box.roll(predeterminedNotation(message.roll));
      } catch {
        // fall through to the total reveal even if the physics fails
      }
    }
    setShowTotal(true);
    timers.push(
      setTimeout(
        () => {
          setLeaving(true);
          timers.push(setTimeout(() => props.onDone(), 480));
        },
        isReady ? 1600 : 500,
      ),
    );
  };

  createEffect(
    () => props.message?.id,
    () => {
      const message = props.message;
      if (!message) return;
      setShowTotal(false);
      setLeaving(false);
      void play(message);
    },
  );

  const label = () => {
    const message = props.message;
    if (!message) return "";
    return message.content ? `${message.authorName} · ${message.content}` : message.authorName;
  };

  return (
    <>
      <div id="ttrpg-dice-stage" class="ttrpg-dice-stage" />
      <Show when={props.message}>
        {(message) => (
          <div class="ttrpg-dice-ui" data-leaving={leaving() ? "true" : "false"}>
            <div class="ttrpg-dice-label">{label()}</div>
            <Show when={showTotal() && message().roll}>
              {(roll) => (
                <div class="ttrpg-dice-total">
                  <span class="ttrpg-dice-total-value">{roll().total}</span>
                  <span class="ttrpg-dice-total-label">
                    {roll().notation}
                    {roll().modifiers.length > 0
                      ? ` ${roll()
                          .modifiers.map(
                            (modifier) => `${modifier.value >= 0 ? "+" : ""}${modifier.value}`,
                          )
                          .join(" ")}`
                      : ""}
                  </span>
                </div>
              )}
            </Show>
          </div>
        )}
      </Show>
    </>
  );
}
