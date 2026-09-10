import { createSignal, For, onSettled, Show } from "solid-js";
import {
  appStyles,
  headingStyles,
  formStyles,
  inputStyles,
  buttonStyles,
  messageListStyles,
  messageCardStyles,
  messageContentStyles,
  messageTimeStyles,
  emptyStateStyles,
  errorBannerStyles,
} from "../styles";

type Message = {
  id: string;
  content: string;
  created_at: string;
};

export default function Home() {
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [content, setContent] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  async function loadMessages() {
    try {
      const res = await fetch("/api/messages");
      if (!res.ok) throw new Error(await res.text());
      setMessages(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load messages");
    }
  }

  async function addMessage(e: Event) {
    e.preventDefault();
    const text = content().trim();
    if (!text) return;

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok) throw new Error(await res.text());
      const msg = (await res.json()) as Message;
      setMessages((prev) => [msg, ...prev]);
      setContent("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add message");
    } finally {
      setLoading(false);
    }
  }

  onSettled(() => {
    loadMessages();
  });

  return (
    <div style={appStyles}>
      <h1 style={headingStyles}>Guestbook</h1>

      <form style={formStyles} onSubmit={addMessage}>
        <input
          style={inputStyles}
          type="text"
          placeholder="Write a message..."
          value={content()}
          onInput={(e) => setContent(e.currentTarget.value)}
          maxlength={500}
          disabled={loading()}
          autofocus
        />
        <button style={buttonStyles} type="submit" disabled={loading() || !content().trim()}>
          Send
        </button>
      </form>

      <Show when={error()}>
        <div style={errorBannerStyles}>{error()}</div>
      </Show>

      <Show
        when={messages().length > 0}
        fallback={<div style={emptyStateStyles}>No messages yet. Say something!</div>}
      >
        <ul style={messageListStyles}>
          <For each={messages()}>
            {(msg) => (
              <li style={messageCardStyles}>
                <div style={messageContentStyles}>{msg.content}</div>
                <div style={messageTimeStyles}>{new Date(msg.created_at).toLocaleString()}</div>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
