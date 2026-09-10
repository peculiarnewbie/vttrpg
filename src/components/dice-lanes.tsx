import DiceBox from "@3d-dice/dice-box-threejs";
import { For, createEffect, createSignal, onCleanup, onSettled } from "solid-js";
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
  const processed = new Set<string>();
  let box: DiceBox | undefined;
  let busy = false;
  let clearTimer: ReturnType<typeof setTimeout> | undefined;

  // Pre-warm the physics box as soon as the lane exists, so its first roll
  // starts instantly instead of waiting on WebGL/theme initialisation.
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
    if (clearTimer) clearTimeout(clearTimer);
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
    const message = queue()[0];
    if (!message) return;
    busy = true;
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = undefined;
    }
    try {
      box?.clearDice();
    } catch {
      // ignore
    }
    setTotal(null);
    try {
      const isReady = await waitReady();
      if (isReady && box && message.roll) {
        try {
          await box.roll(predeterminedNotation(message.roll));
        } catch {
          // reveal anyway
        }
      }
      if (message.roll) {
        setTotal(message.roll.total);
        setNotation(message.roll.notation);
      }
      props.onReveal(message);
      // The message is in chat now; the lane keeps the dice on screen a little
      // longer below. Releasing it here keeps the active list small and lets
      // other rolls start immediately.
      props.onDone(message.id);
    } finally {
      processed.add(message.id);
      setQueue((prev) => prev.slice(1));
      busy = false;
      // Keep the dice on the table for a while, then sweep them away.
      clearTimer = setTimeout(() => {
        try {
          box?.clearDice();
        } catch {
          // ignore
        }
        setTotal(null);
      }, 10000);
      if (queue().length > 0) void pump();
    }
  };

  createEffect(
    () => props.messages.map((message) => message.id).join(","),
    () => {
      setQueue((prev) => {
        const queued = new Set(prev.map((message) => message.id));
        const added = props.messages.filter(
          (message) => !processed.has(message.id) && !queued.has(message.id),
        );
        return added.length > 0 ? [...prev, ...added] : prev;
      });
      void pump();
    },
  );

  const active = () => queue().length > 0 || total() !== null;

  return (
    <div
      id={`ttrpg-dice-lane-${props.memberId}`}
      class="ttrpg-dice-lane"
      data-active={active() ? "true" : "false"}
      style={{ "--lane-color": props.hex }}
    >
      <div class="ttrpg-dice-lane-head">{props.memberName}</div>
      {total() !== null ? (
        <div class="ttrpg-dice-total ttrpg-dice-lane-total">
          <span class="ttrpg-dice-total-value">{total()}</span>
          <span class="ttrpg-dice-total-label">{notation()}</span>
        </div>
      ) : null}
    </div>
  );
}

export function DiceLanes(props: {
  members: { id: string; displayName: string }[];
  rolls: ChatMessage[];
  onReveal: (message: ChatMessage) => void;
  onDone: (id: string) => void;
}) {
  const memberIds = () => {
    const ids: string[] = [];
    const names = new Map<string, string>();
    for (const member of props.members) {
      if (!ids.includes(member.id)) {
        ids.push(member.id);
        names.set(member.id, member.displayName);
      }
    }
    for (const roll of props.rolls) {
      if (!ids.includes(roll.authorMemberId)) {
        ids.push(roll.authorMemberId);
        names.set(roll.authorMemberId, roll.authorName);
      }
    }
    // Bound the number of live WebGL contexts.
    return ids.slice(0, 8).map((id) => ({ id, name: names.get(id) ?? "Player" }));
  };

  return (
    <div class="ttrpg-dice-lanes">
      <For each={memberIds()}>
        {(member) => (
          <DiceLane
            memberId={member.id}
            memberName={member.name}
            colorset={colorFor(member.id).colorset}
            hex={colorFor(member.id).hex}
            messages={props.rolls.filter((roll) => roll.authorMemberId === member.id)}
            onReveal={props.onReveal}
            onDone={props.onDone}
          />
        )}
      </For>
    </div>
  );
}
