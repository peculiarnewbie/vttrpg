import DiceBox from "@3d-dice/dice-box-threejs";
import { For, Show, createEffect, createSignal, onCleanup, onSettled } from "solid-js";
import type { ChatMessage, RollResult } from "../domain/schemas";

const PALETTE = [
  { colorset: "white", hex: "#f5f5f5" },
  { colorset: "fire", hex: "#ff6a2a" },
  { colorset: "ice", hex: "#5ac8fa" },
  { colorset: "poison", hex: "#6aa84f" },
  { colorset: "thunder", hex: "#f1a82c" },
  { colorset: "force", hex: "#b06cff" },
  { colorset: "psychic", hex: "#ff68c6" },
  { colorset: "water", hex: "#2f80fa" },
  { colorset: "earth", hex: "#b17816" },
  { colorset: "astralsea", hex: "#8ea1d2" },
  { colorset: "dragons", hex: "#d23401" },
  { colorset: "bronze", hex: "#cd7f32" },
  { colorset: "radiant", hex: "#ffe066" },
];

const colorByMember = new Map<string, (typeof PALETTE)[number]>();
const colorFor = (memberId: string) => {
  let color = colorByMember.get(memberId);
  if (!color) {
    color = PALETTE[colorByMember.size % PALETTE.length];
    colorByMember.set(memberId, color);
  }
  return color;
};

const predeterminedNotation = (roll: RollResult) =>
  roll.dice
    .map((group) => `${group.results.length}d${group.sides}@${group.results.join(",")}`)
    .join("+");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function DiceLane(props: {
  memberId: string;
  memberName: string;
  colorset: string;
  hex: string;
  messages: ChatMessage[];
  onReveal: (message: ChatMessage) => void;
  onDone: (id: string) => void;
}) {
  const [ready, setReady] = createSignal(false);
  const [total, setTotal] = createSignal<number | null>(null);
  const [notation, setNotation] = createSignal("");
  const [queue, setQueue] = createSignal<ChatMessage[]>([]);
  let box: DiceBox | undefined;
  let busy = false;

  onSettled(() => {
    try {
      box = new DiceBox(`#ttrpg-dice-lane-${props.memberId}`, {
        assetPath: "/dice/",
        sounds: false,
        shadows: true,
        theme_colorset: props.colorset,
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

  onCleanup(() => {
    try {
      box?.clearDice();
      box?.renderer?.domElement?.remove();
    } catch {
      // ignore teardown failures
    }
  });

  const waitReady = async (timeoutMs = 4000) => {
    const start = Date.now();
    while (!ready() && Date.now() - start < timeoutMs) await sleep(50);
    return ready();
  };

  const pump = async () => {
    if (busy) return;
    const current = queue()[0];
    if (!current) return;
    busy = true;
    try {
      const isReady = await waitReady();
      if (isReady && box && current.roll) {
        try {
          await box.roll(predeterminedNotation(current.roll));
        } catch {
          // fall through and reveal anyway
        }
      }
      if (current.roll) {
        setTotal(current.roll.total);
        setNotation(current.roll.notation);
      }
      props.onReveal(current);
      // Linger, then sweep the dice away.
      await sleep(10000);
      try {
        box?.clearDice();
      } catch {
        // ignore
      }
      setTotal(null);
      props.onDone(current.id);
      setQueue((prev) => prev.slice(1));
    } finally {
      busy = false;
      void pump();
    }
  };

  createEffect(
    () => props.messages.map((message) => message.id).join(","),
    () => {
      setQueue((prev) => {
        const known = new Set(prev.map((message) => message.id));
        const added = props.messages.filter((message) => !known.has(message.id));
        return added.length > 0 ? [...prev, ...added] : prev;
      });
      void pump();
    },
  );

  return (
    <div
      id={`ttrpg-dice-lane-${props.memberId}`}
      class="ttrpg-dice-lane"
      style={{ "--lane-color": props.hex }}
    >
      <div class="ttrpg-dice-lane-head">{props.memberName}</div>
      <Show when={total() !== null}>
        <div class="ttrpg-dice-total ttrpg-dice-lane-total">
          <span class="ttrpg-dice-total-value">{total()}</span>
          <span class="ttrpg-dice-total-label">{notation()}</span>
        </div>
      </Show>
    </div>
  );
}

export function DiceLanes(props: {
  rolls: ChatMessage[];
  onReveal: (message: ChatMessage) => void;
  onDone: (id: string) => void;
}) {
  const memberIds = () => {
    const ids: string[] = [];
    for (const roll of props.rolls) {
      if (!ids.includes(roll.authorMemberId)) ids.push(roll.authorMemberId);
    }
    return ids;
  };

  return (
    <div class="ttrpg-dice-lanes">
      <For each={memberIds()}>
        {(memberId) => {
          const messages = () => props.rolls.filter((roll) => roll.authorMemberId === memberId);
          const color = colorFor(memberId);
          return (
            <DiceLane
              memberId={memberId}
              memberName={messages()[0]?.authorName ?? "Player"}
              colorset={color.colorset}
              hex={color.hex}
              messages={messages()}
              onReveal={props.onReveal}
              onDone={props.onDone}
            />
          );
        }}
      </For>
    </div>
  );
}
