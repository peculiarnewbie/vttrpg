import { For, Show, createSignal } from "solid-js";
import type { ChatMessage, Visibility, WorldMember } from "../domain/schemas";
import { Badge, Button } from "./ui";
import { styles } from "./styles.stylex";
import { sx } from "../theme/sx";

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
            d
            {roll()
              .dice.map((die) => die.sides)
              .join(",")}{" "}
            ={" "}
            {roll()
              .modifiers.map(
                (modifier) =>
                  `${modifier.label} ${modifier.value >= 0 ? "+" : ""}${modifier.value}`,
              )
              .join(" ")}
          </span>
        </div>
      )}
    </Show>
  );
}

function MessageCard(props: { message: ChatMessage; me: WorldMember }) {
  const message = props.message;
  return (
    <article
      {...sx(
        styles.message,
        message.kind === "ooc" && styles.messageOoc,
        message.kind === "system" && styles.messageSystem,
      )}
    >
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
        <Show
          when={message.recipientMemberIds.length > 0 || message.authorMemberId === props.me.id}
        >
          <Show when={message.visibility !== "public"}>
            <Badge tone="plain">whisper</Badge>
          </Show>
        </Show>
      </div>
      <div {...sx(styles.messageBody)}>{message.content}</div>
      <DiceView message={message} />
    </article>
  );
}

export function Chat(props: {
  messages: ChatMessage[];
  members: WorldMember[];
  me: WorldMember;
  onSend: (input: {
    content: string;
    kind: "ic" | "ooc";
    visibility: Visibility;
    recipientMemberIds: string[];
  }) => void;
}) {
  const [text, setText] = createSignal("");
  const [kind, setKind] = createSignal<"ic" | "ooc">("ic");
  const [visibility, setVisibility] = createSignal<Visibility>("public");
  const [whisperTo, setWhisperTo] = createSignal("");

  const submit = (event: Event) => {
    event.preventDefault();
    const content = text().trim();
    if (!content) return;
    props.onSend({
      content,
      kind: kind(),
      visibility: visibility(),
      recipientMemberIds: whisperTo() ? [whisperTo()] : [],
    });
    setText("");
  };

  const otherMembers = () => props.members.filter((member) => member.id !== props.me.id);

  return (
    <div {...sx(styles.chatLayout)}>
      <div {...sx(styles.messageList)}>
        <Show
          when={props.messages.length > 0}
          fallback={
            <div {...sx(styles.empty)}>The table is quiet. Say hello, or roll some dice.</div>
          }
        >
          <For each={props.messages}>
            {(message) => <MessageCard message={message} me={props.me} />}
          </For>
        </Show>
      </div>

      <form {...sx(styles.composer)} onSubmit={submit}>
        <textarea
          {...sx(styles.input, styles.composerInput)}
          value={text()}
          placeholder="Describe an action, speak in character, or talk out of character..."
          onInput={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit(event);
            }
          }}
        />
        <div {...sx(styles.rowWrap)}>
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
