import { createVirtualizer } from "../client/virtual";
import { For, Show, createEffect, createSignal } from "solid-js";
import { showDiceTotals } from "../client/dice-display";
import { api } from "../client/api";
import { MAX_DICE, parseRollCommand } from "../domain/dice";
import { findEntryByName, splitEntryLinks } from "../domain/entry-links";
import type { CompendiumStore } from "./compendium";
import { createLinkSuggest } from "./entry-link-suggest";
import type { ChatMessage, Visibility, WorldMember } from "../domain/schemas";
import { Avatar, Button } from "./ui";
import { RollView } from "./roll-view";
import { styles } from "./styles.stylex";
import { boardStyles } from "./board.stylex";
import { sx } from "../theme/sx";

const DICE_SIDES = [4, 6, 8, 10, 12, 20];

export function DiceView(props: { message: ChatMessage }) {
  return (
    <Show when={props.message.roll}>
      {(roll) => <RollView roll={roll()} showTotal={showDiceTotals()} />}
    </Show>
  );
}

/** Message text with `[[Entry]]` links the reader can open; others stay as plain names. */
function MessageText(props: {
  content: string;
  compendium?: CompendiumStore;
  onOpenEntry?: (entryId: string) => void;
}) {
  return (
    <For each={splitEntryLinks(props.content)}>
      {(part) => (
        <Show when={part.kind === "link" && part} fallback={(part as { text: string }).text}>
          {(link) => (
            <Show
              when={props.compendium && findEntryByName(props.compendium.entries(), link().name)}
              fallback={link().name}
            >
              {(entry) => (
                <button
                  type="button"
                  class="ttrpg-entry-link"
                  onClick={() => props.onOpenEntry?.(entry().id)}
                >
                  {entry().name}
                </button>
              )}
            </Show>
          )}
        </Show>
      )}
    </For>
  );
}

function MessageCard(props: {
  message: ChatMessage;
  me: WorldMember;
  worldId: string;
  compendium?: CompendiumStore;
  onOpenEntry?: (entryId: string) => void;
}) {
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
      <div {...sx(styles.messageRow)}>
        <Show when={message.kind !== "system"}>
          <Show when={avatarSrc()} fallback={<Avatar name={message.authorName} small />}>
            <img src={avatarSrc()} alt="" {...sx(styles.avatarImage, styles.chatAvatar)} />
          </Show>
        </Show>
        <div {...sx(styles.grow)}>
          <div {...sx(styles.messageMeta, message.kind === "system" && styles.messageMetaCentered)}>
            <span {...sx(styles.messageAuthor)}>{message.authorName}</span>
            <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
            <Show when={message.kind === "roll"}>
              <span {...sx(styles.messageMark)}>roll</span>
            </Show>
            <Show when={message.kind === "ooc"}>
              <span {...sx(styles.messageMark)}>OOC</span>
            </Show>
            <Show when={message.visibility === "private"}>
              <span {...sx(styles.messageMark)}>private</span>
            </Show>
            <Show when={message.visibility === "dm"}>
              <span {...sx(styles.messageMark)}>DM only</span>
            </Show>
            <Show when={message.recipientMemberIds.length > 0}>
              <span {...sx(styles.messageMark)}>whisper</span>
            </Show>
          </div>
          <div {...sx(styles.messageBody, message.kind === "ooc" && styles.messageQuiet)}>
            <MessageText
              content={message.content}
              compendium={props.compendium}
              onOpenEntry={props.onOpenEntry}
            />
          </div>
          <DiceView message={message} />
        </div>
      </div>
    </article>
  );
}

export function Chat(props: {
  overlay?: boolean;
  connected: boolean;
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
  onRollDice: (notation: string, visibility: Visibility, recipientMemberIds: string[]) => void;
  /** For `[[Entry]]` links in messages and suggestions while typing. */
  compendium?: CompendiumStore;
  onOpenEntry?: (entryId: string) => void;
}) {
  let scrollRef: HTMLDivElement | undefined;
  let pendingPreserve: number | null = null;

  const [atBottom, setAtBottom] = createSignal(true);
  const [text, setText] = createSignal("");
  const [kind, setKind] = createSignal<"ic" | "ooc">("ic");
  // One "who hears this" choice: everyone, DM only, only me, or a whisper to one member.
  const [audience, setAudience] = createSignal("public");
  const whisperTo = () => (audience().startsWith("whisper:") ? audience().slice(8) : "");
  const visibility = (): Visibility =>
    audience() === "dm" ? "dm" : audience() === "private" ? "private" : "public";
  const recipients = () => (whisperTo() ? [whisperTo()] : []);
  const [showDice, setShowDice] = createSignal(false);
  const [lastTrayNotation, setLastTrayNotation] = createSignal("");
  const [pending, setPending] = createSignal<Record<number, number>>({});

  const virtualizer = createVirtualizer({
    count: () => props.messages.length,
    getScrollElement: () => scrollRef,
    estimateSize: () => 76,
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
    if (!props.connected || !raw) return;
    const command = parseRollCommand(raw);
    if (command) {
      props.onRollDice(command, visibility(), recipients());
      setText("");
      return;
    }
    props.onSend({
      content: raw,
      kind: kind(),
      visibility: visibility(),
      recipientMemberIds: recipients(),
    });
    setText("");
  };

  const suggest = createLinkSuggest({
    entries: () => props.compendium?.entries() ?? [],
    typeName: (typeId) => props.compendium?.typeById(typeId)?.name,
    setText,
  });

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
    if (!props.connected || !notation) return;
    props.onRollDice(notation, visibility(), recipients());
    setPending({});
    setLastTrayNotation(notation);
  };

  const restricted = () => audience() !== "public";
  const memberName = (id: string) =>
    props.members.find((member) => member.id === id)?.displayName ?? "selected player";

  return (
    <div {...sx(styles.chatColumn, props.overlay && boardStyles.chat)}>
      <div
        {...sx(styles.chatScroll)}
        ref={(el) => {
          scrollRef = el;
        }}
        onScroll={handleScroll}
      >
        <Show when={props.messages.length === 0 && !props.loadingMore}>
          <div {...sx(styles.chatEmpty)}>
            <strong>No messages yet</strong>
            <span>Say hello, or roll with the 🎲 tray or /roll 2d6.</span>
          </div>
        </Show>
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
                  "padding-bottom": "2px",
                }}
              >
                <MessageCard
                  message={props.messages[item.index]}
                  me={props.me}
                  worldId={props.worldId}
                  compendium={props.compendium}
                  onOpenEntry={props.onOpenEntry}
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
        <Show when={!props.connected}>
          <span {...sx(styles.faint)} role="status">
            Connecting…
          </span>
        </Show>
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
              <span {...sx(styles.numeric)}>
                {pendingNotation() || "pick dice"} · {pendingCount()}/{MAX_DICE}
              </span>
              <Button small onClick={() => setPending({})} disabled={pendingCount() === 0}>
                Clear
              </Button>
              <Button
                small
                variant="primary"
                onClick={rollPending}
                disabled={!props.connected || pendingCount() === 0}
              >
                Roll
              </Button>
              <Button
                small
                disabled={!props.connected || !lastTrayNotation()}
                onClick={() => {
                  if (!props.connected || !lastTrayNotation()) return;
                  props.onRollDice(lastTrayNotation(), visibility(), recipients());
                  setPending({});
                }}
              >
                Reroll last{lastTrayNotation() ? ` (${lastTrayNotation()})` : ""}
              </Button>
            </div>
          </div>
        </Show>
        <Show when={restricted()}>
          <div {...sx(styles.chatAudience)} role="status">
            <span>
              {whisperTo()
                ? `Whispering to ${memberName(whisperTo())}${
                    props.members.find((member) => member.id === whisperTo())?.role === "dm"
                      ? ""
                      : " (the DM also sees it)"
                  }`
                : visibility() === "dm"
                  ? "DM only"
                  : "Only you can see this"}
            </span>
            <div {...sx(styles.spacer)} />
            <Button small onClick={() => setAudience("public")}>
              × Everyone
            </Button>
          </div>
        </Show>
        <div {...sx(styles.composerField)}>
          <textarea
            {...sx(styles.input, styles.composerInput, restricted() && styles.chatAudienceInput)}
            ref={suggest.ref}
            value={text()}
            placeholder="Speak, describe, [[link an entry]], or /roll 2d6 …"
            onInput={(event) => {
              setText(event.currentTarget.value);
              suggest.onInput();
            }}
            onBlur={() => suggest.close()}
            onKeyDown={(event) => {
              if (suggest.onKeyDown(event)) return;
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit(event);
              }
            }}
          />
          <suggest.Popover above />
        </div>
        <div {...sx(styles.composerControls)}>
          <Button
            small
            variant={showDice() ? "primary" : "default"}
            onClick={() => setShowDice((value) => !value)}
          >
            🎲 Dice
          </Button>
          <button
            type="button"
            {...sx(styles.button, styles.buttonSmall, kind() === "ooc" && styles.buttonGhost)}
            title={
              kind() === "ic"
                ? "In character — click for out of character"
                : "Out of character — click for in character"
            }
            aria-label={kind() === "ic" ? "In character" : "Out of character"}
            onClick={() => setKind(kind() === "ic" ? "ooc" : "ic")}
          >
            {kind() === "ic" ? "IC" : "OOC"}
          </button>
          <label {...sx(styles.chatAudienceSelect)}>
            <span {...sx(styles.faint)}>To</span>
            <select
              {...sx(styles.select, styles.composerSelect)}
              aria-label="Who hears this"
              value={audience()}
              onChange={(event) => setAudience(event.currentTarget.value)}
            >
              <option value="public">Everyone</option>
              <option value="dm">DM only</option>
              <option value="private">Only me</option>
              <For each={otherMembers()}>
                {(member) => (
                  <option value={`whisper:${member.id}`}>Whisper {member.displayName}</option>
                )}
              </For>
            </select>
          </label>
          <Button type="submit" variant="primary" disabled={!props.connected || !text().trim()}>
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}
