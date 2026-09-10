import { useNavigate, useParams } from "@solidjs/router";
import { For, Show, createSignal, onCleanup, onSettled } from "solid-js";
import { api, ApiError, type WorldBootstrap } from "../client/api";
import { connectWorld, type RealtimeController, type RealtimeStatus } from "../client/realtime";
import { useSession } from "../client/session";
import { BuilderPanel } from "../components/builder";
import { CharacterSheets } from "../components/character-sheets";
import { Chat } from "../components/chat";
import { MembersPanel } from "../components/members";
import { NotesPanel } from "../components/notes";
import { styles } from "../components/styles.stylex";
import { Badge, Button, ErrorBanner, Spinner, TopBar } from "../components/ui";
import type {
  Character,
  ChatMessage,
  NoteSummary,
  PresenceMember,
  SaveCharacterInput,
  SheetTemplate,
  Visibility,
  WorldMember,
} from "../domain/schemas";
import { sx } from "../theme/sx";

type Tab = "chat" | "sheets" | "notes" | "members" | "builder";

const upsert = <T extends { id: string }>(items: T[], item: T) => {
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index === -1) return [...items, item];
  const copy = [...items];
  copy[index] = item;
  return copy;
};

export default function WorldPage() {
  const params = useParams<{ id: string }>();
  const session = useSession();
  const navigate = useNavigate();

  const [boot, setBoot] = createSignal<WorldBootstrap | null>(null);
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [characters, setCharacters] = createSignal<Character[]>([]);
  const [templates, setTemplates] = createSignal<SheetTemplate[]>([]);
  const [notes, setNotes] = createSignal<NoteSummary[]>([]);
  const [members, setMembers] = createSignal<WorldMember[]>([]);
  const [presence, setPresence] = createSignal<PresenceMember[]>([]);
  const [tab, setTab] = createSignal<Tab>("chat");
  const [error, setError] = createSignal("");
  const [status, setStatus] = createSignal<RealtimeStatus>("connecting");

  let controller: RealtimeController | undefined;

  onSettled(() => {
    void (async () => {
      if (!session.user()) {
        navigate("/", { replace: true });
        return;
      }
      try {
        const bootstrap = await api.bootstrapWorld(params.id);
        setBoot(bootstrap);
        setMessages(bootstrap.messages);
        setCharacters(bootstrap.characters);
        setTemplates(bootstrap.templates);
        setNotes(bootstrap.notes);
        setMembers(bootstrap.members);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load world");
        return;
      }
      controller = connectWorld(params.id, {
        onStatus: setStatus,
        onFrame: (frame) => {
          switch (frame.type) {
            case "message":
              setMessages((prev) => [...prev, frame.message]);
              break;
            case "character":
              setCharacters((prev) => upsert(prev, frame.character));
              break;
            case "presence":
            case "hello":
              setPresence([...frame.members]);
              break;
            case "error":
              if (frame.message) setError(frame.message);
              break;
          }
        },
      });
    })();
  });

  onCleanup(() => controller?.close());

  const me = () => boot()?.member;
  const isDm = () => me()?.role === "dm";

  const sendChat = (input: {
    content: string;
    kind: "ic" | "ooc";
    visibility: Visibility;
    recipientMemberIds: string[];
  }) => {
    controller?.send({ type: "chat", ...input });
  };

  const roll = (characterId: string, rollId: string, visibility: Visibility) => {
    controller?.send({ type: "roll", characterId, rollId, visibility, recipientMemberIds: [] });
  };

  const ticker = (characterId: string, tickerId: string, value: number) => {
    controller?.send({ type: "ticker.set", characterId, tickerId, value });
  };

  const saveCharacter = async (input: SaveCharacterInput) => {
    const character = await api.saveCharacter(params.id, input);
    setCharacters((prev) => upsert(prev, character));
  };

  const deleteCharacter = async (characterId: string) => {
    await api.deleteCharacter(params.id, characterId);
    setCharacters((prev) => prev.filter((character) => character.id !== characterId));
  };

  const tabs = (): { id: Tab; label: string }[] => [
    { id: "chat", label: "Chat" },
    { id: "sheets", label: "Sheets" },
    { id: "notes", label: "Notes" },
    ...(isDm()
      ? ([
          { id: "members", label: "Members" },
          { id: "builder", label: "Builder" },
        ] as const)
      : []),
  ];

  const onlineCount = () => presence().filter((member) => member.online).length;

  return (
    <div {...sx(styles.app)}>
      <TopBar>
        <Button variant="ghost" small onClick={() => navigate("/dashboard")}>
          ← Worlds
        </Button>
        <span {...sx(styles.muted)}>{session.user()?.displayName}</span>
      </TopBar>

      <div {...sx(styles.container)}>
        <Show when={error()}>
          <div {...sx(styles.col)}>
            <ErrorBanner message={error()} />
          </div>
        </Show>

        <Show
          when={boot()}
          fallback={
            <div {...sx(styles.center)}>
              <Spinner label="Loading world..." />
            </div>
          }
        >
          {(world) => (
            <div {...sx(styles.worldShell)}>
              <aside {...sx(styles.sidebar)}>
                <div {...sx(styles.col)}>
                  <h1 {...sx(styles.h2)}>{world().world.name}</h1>
                  <p {...sx(styles.faint)}>Owner: {world().world.ownerName}</p>
                  <div {...sx(styles.row)}>
                    <Badge tone={isDm() ? "tag" : "accent"}>{world().member.role}</Badge>
                    <span {...sx(styles.statusPill)}>
                      <span
                        {...sx(
                          styles.presenceDot,
                          status() !== "open" && styles.presenceDotOffline,
                        )}
                      />
                      {status() === "open" ? `${onlineCount()} online` : status()}
                    </span>
                  </div>
                </div>

                <div {...sx(styles.divider)} />

                <nav {...sx(styles.navList)}>
                  <For each={tabs()}>
                    {(item) => (
                      <button
                        {...sx(styles.navItem, tab() === item.id && styles.navItemActive)}
                        onClick={() => setTab(item.id)}
                      >
                        <span>{item.label}</span>
                      </button>
                    )}
                  </For>
                </nav>

                <div {...sx(styles.divider)} />

                <div {...sx(styles.col)}>
                  <span {...sx(styles.eyebrow)}>At the table</span>
                  <For each={presence()}>
                    {(member) => (
                      <div {...sx(styles.row)}>
                        <span
                          {...sx(styles.presenceDot, !member.online && styles.presenceDotOffline)}
                        />
                        <span {...sx(styles.grow)}>{member.displayName}</span>
                        <Show when={member.role === "dm"}>
                          <Badge tone="tag">dm</Badge>
                        </Show>
                      </div>
                    )}
                  </For>
                  <Show when={presence().length === 0}>
                    <span {...sx(styles.faint)}>No one connected.</span>
                  </Show>
                </div>
              </aside>

              <main {...sx(styles.window)}>
                <div {...sx(styles.windowTitle)}>
                  <span>{tabs().find((item) => item.id === tab())?.label ?? "World"}</span>
                  <div {...sx(styles.spacer)} />
                  <span>{world().world.slug}</span>
                </div>
                <div {...sx(styles.windowBody)}>
                  <Show when={tab() === "chat"}>
                    <Chat
                      messages={messages()}
                      members={members()}
                      me={world().member}
                      onSend={sendChat}
                    />
                  </Show>
                  <Show when={tab() === "sheets"}>
                    <CharacterSheets
                      me={world().member}
                      isDm={isDm()}
                      characters={characters()}
                      templates={templates()}
                      members={members()}
                      onRoll={roll}
                      onTicker={ticker}
                      onSave={saveCharacter}
                      onDelete={deleteCharacter}
                    />
                  </Show>
                  <Show when={tab() === "notes"}>
                    <NotesPanel
                      worldId={params.id}
                      me={world().member}
                      notes={notes()}
                      onNotes={setNotes}
                    />
                  </Show>
                  <Show when={tab() === "members" && isDm()}>
                    <MembersPanel
                      worldId={params.id}
                      me={world().member}
                      members={members()}
                      onMembers={setMembers}
                    />
                  </Show>
                  <Show when={tab() === "builder" && isDm()}>
                    <BuilderPanel
                      worldId={params.id}
                      templates={templates()}
                      onTemplates={setTemplates}
                    />
                  </Show>
                </div>
              </main>
            </div>
          )}
        </Show>

        <Show when={!boot() && !error()}>
          <div {...sx(styles.center)} />
        </Show>
      </div>
    </div>
  );
}
