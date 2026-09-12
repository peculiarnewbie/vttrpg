import { createVirtualizer } from "../client/virtual";
import { For, Show, createEffect, createSignal } from "solid-js";
import { api } from "../client/api";
import { parseRollCommand } from "../domain/dice";
import type { ChatMessage, Visibility, WorldMember } from "../domain/schemas";
import { Avatar, Badge, Button } from "./ui";
import { styles } from "./styles.stylex";
import { boardStyles } from "./board.stylex";
import { sx } from "../theme/sx";

const DICE_SIDES = [4, 6, 8, 10, 12, 20];
const MAX_DICE = 10;

export function DiceView(props: { message: ChatMessage }) {
  return (
    <Show when={props.message.roll}>
      {(roll) => (
        <div {...sx(styles.rollResult)}>
          <span {...sx(styles.rollTotal)}>{roll().total}</span>
          <div {...sx(styles.rowWrap)}>
            <For each={roll().dice}>
              {(die) => (
                <For each={die.results}>{(value) => <span {...sx(styles.die)}>{value}</span>}</For>
              )}
            </For>
          </div>
          <span {...sx(styles.mono)}>
            {roll().notation}
            {roll().modifiers.length > 0
              ? ` (${roll()
                  .modifiers.map(
                    (modifier) =>
                      `${modifier.label} ${modifier.value >= 0 ? "+" : ""}${modifier.value}`,
                  )
                  .join(", ")})`
              : ""}
          </span>
        </div>
      )}
    </Show>
  );
}

function MessageCard(props: { message: ChatMessage; me: WorldMember; worldId: string }) {
  const message = props.message;
  const avatarSrc = () =>
    message.authorAvatarKey && message.characterId
      ? api.avatarUrl(props.worldId, message.characterId, message.authorAvatarKey)
      : undefined;
  return (
    <article
      {...sx(
        styles.message,
        message.kind === "ooc" && styles.messageOoc,
        message.kind === "system" && styles.messageSystem,
      )}
    >
      <div {...sx(styles.row)}>
        <Show when={avatarSrc()} fallback={<Avatar name={message.authorName} />}>
          <img src={avatarSrc()} alt="" {...sx(styles.avatarImage)} />
        </Show>
        <div {...sx(styles.grow)}>
          <div {...sx(styles.messageMeta)}>
            <span {...sx(styles.messageAuthor)}>{message.authorName}</span>
            <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
            <Show when={message.kind === "roll"}>
              <Badge tone="accent">roll</Badge>
            </Show>
            <Show when={message.kind === "ooc"}>
              <Badge tone="plain">OOC</Badge>
            </Show>
            <Show when={message.visibility === "private"}>
              <Badge tone="private">private</Badge>
            </Show>
            <Show when={message.visibility === "dm"}>
              <Badge tone="dm">DM only</Badge>
            </Show>
            <Show when={message.recipientMemberIds.length > 0}>
              <Badge tone="plain">whisper</Badge>
            </Show>
          </div>
          <div {...sx(styles.messageBody)}>{message.content}</div>
          <DiceView message={message} />
        </div>
      </div>
    </article>
  );
}

export function Chat(props: {
  overlay?: boolean;
  worldId: string;
  messages: ChatMessage[];
  hasMore: boolean;
  loadingMore: boolean;
  members: WorldMember[];
  me: WorldMember;
  onLoadMore: () => void;
  onSend: (input: {
    content: string;
    kind: "ic" | "ooc";
    visibility: Visibility;
    recipientMemberIds: string[];
  }) => void;
  onRollDice: (notation: string, visibility: Visibility) => void;
}) {
  let scrollRef: HTMLDivElement | undefined;
  let pendingPreserve: number | null = null;

  const [atBottom, setAtBottom] = createSignal(true);
  const [text, setText] = createSignal("");
  const [kind, setKind] = createSignal<"ic" | "ooc">("ic");
  const [visibility, setVisibility] = createSignal<Visibility>("public");
  const [whisperTo, setWhisperTo] = createSignal("");
  const [showDice, setShowDice] = createSignal(false);
  const [pending, setPending] = createSignal<Record<number, number>>({});

  const virtualizer = createVirtualizer({
    count: () => props.messages.length,
    getScrollElement: () => scrollRef,
    estimateSize: () => 104,
    overscan: 8,
  });

  const scrollToBottom = (instant = false) => {
    requestAnimationFrame(() => {
      if (!scrollRef) return;
      if (instant) scrollRef.scrollTop = scrollRef.scrollHeight;
      else if (props.messages.length > 0)
        virtualizer.scrollToIndex(props.messages.length - 1, { align: "end" });
      setAtBottom(true);
    });
  };

  const requestMore = () => {
    if (!scrollRef || !props.hasMore || props.loadingMore || pendingPreserve !== null) return;
    pendingPreserve = scrollRef.scrollHeight - scrollRef.scrollTop;
    props.onLoadMore();
  };

  const handleScroll = () => {
    const el = scrollRef;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtBottom(distance < 48);
    if (el.scrollTop < 240) requestMore();
  };

  // Preserve the viewport when older messages are prepended.
  createEffect(
    () => props.messages.length,
    (length, previous) => {
      if (previous !== undefined && length > previous && pendingPreserve !== null) {
        const distanceFromTop = pendingPreserve;
        requestAnimationFrame(() => {
          if (scrollRef) scrollRef.scrollTop = scrollRef.scrollHeight - distanceFromTop;
          pendingPreserve = null;
        });
      }
    },
  );

  // Initial jump to the newest message, and follow along when already at the bottom.
  let initialised = false;
  createEffect(
    () => ({ length: props.messages.length, id: props.messages[props.messages.length - 1]?.id }),
    (current, previous) => {
      if (current.length === 0) return;
      if (!initialised) {
        initialised = true;
        scrollToBottom(true);
        return;
      }
      if (previous && current.length > previous.length && atBottom() && pendingPreserve === null) {
        scrollToBottom();
      }
    },
  );

  const submit = (event: Event) => {
    event.preventDefault();
    const raw = text().trim();
    if (!raw) return;
    const command = parseRollCommand(raw);
    if (command) {
      props.onRollDice(command, visibility());
      setText("");
      return;
    }
    props.onSend({
      content: raw,
      kind: kind(),
      visibility: visibility(),
      recipientMemberIds: whisperTo() ? [whisperTo()] : [],
    });
    setText("");
  };

  const otherMembers = () => props.members.filter((member) => member.id !== props.me.id);
  const pendingCount = () => Object.values(pending()).reduce((total, count) => total + count, 0);
  const pendingNotation = () =>
    Object.entries(pending())
      .filter(([, count]) => count > 0)
      .map(([sides, count]) => `${count}d${sides}`)
      .join("+");

  const addDie = (sides: number) => {
    if (pendingCount() >= MAX_DICE) return;
    setPending((prev) => ({ ...prev, [sides]: (prev[sides] ?? 0) + 1 }));
  };

  const rollPending = () => {
    const notation = pendingNotation();
    if (!notation) return;
    props.onRollDice(notation, visibility());
    setPending({});
    setShowDice(false);
  };

  return (
    <div {...sx(styles.chatColumn, props.overlay && boardStyles.chat)}>
      <div
        {...sx(styles.chatScroll)}
        ref={(el) => {
          scrollRef = el;
        }}
        onScroll={handleScroll}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          <Show when={props.loadingMore}>
            <div {...sx(styles.loadMore)}>Loading earlier messages…</div>
          </Show>
          <For each={virtualizer.getVirtualItems()}>
            {(item) => (
              <div
                data-index={item.index}
                ref={(el) => virtualizer.measureElement(el)}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${item.start}px)`,
                  "padding-bottom": "12px",
                }}
              >
                <MessageCard
                  message={props.messages[item.index]}
                  me={props.me}
                  worldId={props.worldId}
                />
              </div>
            )}
          </For>
        </div>
      </div>

      <Show when={!atBottom()}>
        <button {...sx(styles.jumpToBottom)} onClick={() => scrollToBottom()}>
          ↓ New messages
        </button>
      </Show>

      <form {...sx(styles.composer)} onSubmit={submit}>
        <Show when={showDice()}>
          <div {...sx(styles.dicePicker)}>
            <div {...sx(styles.rowWrap)}>
              <For each={DICE_SIDES}>
                {(sides) => (
                  <button
                    type="button"
                    {...sx(styles.diceButton)}
                    disabled={pendingCount() >= MAX_DICE}
                    onClick={() => addDie(sides)}
                  >
                    d{sides}
                  </button>
                )}
              </For>
              <div {...sx(styles.spacer)} />
              <span {...sx(styles.mono)}>
                {pendingNotation() || "pick dice"} · {pendingCount()}/{MAX_DICE}
              </span>
              <Button small onClick={() => setPending({})} disabled={pendingCount() === 0}>
                Clear
              </Button>
              <Button small variant="primary" onClick={rollPending} disabled={pendingCount() === 0}>
                Roll
              </Button>
            </div>
          </div>
        </Show>
        <textarea
          {...sx(styles.input, styles.composerInput)}
          value={text()}
          placeholder="Speak, describe, or /roll 2d6 …"
          onInput={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit(event);
            }
          }}
        />
        <div {...sx(styles.rowWrap)}>
          <Button
            small
            variant={showDice() ? "primary" : "default"}
            onClick={() => setShowDice((value) => !value)}
          >
            🎲 Dice
          </Button>
          <select
            {...sx(styles.select)}
            value={kind()}
            onChange={(event) => setKind(event.currentTarget.value as "ic" | "ooc")}
          >
            <option value="ic">In character</option>
            <option value="ooc">Out of character</option>
          </select>
          <select
            {...sx(styles.select)}
            value={visibility()}
            onChange={(event) => setVisibility(event.currentTarget.value as Visibility)}
          >
            <option value="public">Public</option>
            <option value="private">Private (only me)</option>
            <option value="dm">DM only</option>
          </select>
          <select
            {...sx(styles.select)}
            value={whisperTo()}
            onChange={(event) => setWhisperTo(event.currentTarget.value)}
          >
            <option value="">Whisper: no one</option>
            <For each={otherMembers()}>
              {(member) => <option value={member.id}>{member.displayName}</option>}
            </For>
          </select>
          <div {...sx(styles.spacer)} />
          <Button type="submit" variant="primary" disabled={!text().trim()}>
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}
