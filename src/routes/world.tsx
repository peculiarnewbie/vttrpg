import { useNavigate, useParams } from "@solidjs/router";
import { For, Show, createSignal, onCleanup, onSettled } from "solid-js";
import { api, ApiError, type WorldBootstrap } from "../client/api";
import { connectWorld, type RealtimeController, type RealtimeStatus } from "../client/realtime";
import { useSession } from "../client/session";
import { BuilderPanel } from "../components/builder";
import { CharacterSheets } from "../components/character-sheets";
import { Chat } from "../components/chat";
import { DiceLanes } from "../components/dice-lanes";
import { MembersPanel } from "../components/members";
import { NotesPanel } from "../components/notes";
import { MoodBoard } from "../components/mood-board";
import { boardStyles as b } from "../components/board.stylex";
import { emptyBoard, type BoardSnapshot } from "../domain/board";
import { loadWorldPanels, saveWorldPanels } from "../client/world-panels";
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

type Tab = "sheets" | "notes" | "members" | "builder";

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

  const [board, setBoard] = createSignal<BoardSnapshot>(emptyBoard());
  const [panels, setPanels] = createSignal(loadWorldPanels(params.id));
  const togglePanel = (panel: "chat" | "tools") => {
    const next = { ...panels(), [panel]: !panels()[panel] };
    if (window.innerWidth <= 700 && next[panel]) next[panel === "chat" ? "tools" : "chat"] = false;
    setPanels(next);
    saveWorldPanels(params.id, next);
  };
  const acceptBoard = (next: BoardSnapshot) =>
    setBoard((previous) => (next.revision >= previous.revision ? next : previous));
  const [boot, setBoot] = createSignal<WorldBootstrap | null>(null);
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [hasMore, setHasMore] = createSignal(false);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [characters, setCharacters] = createSignal<Character[]>([]);
  const [templates, setTemplates] = createSignal<SheetTemplate[]>([]);
  const [notes, setNotes] = createSignal<NoteSummary[]>([]);
  const [members, setMembers] = createSignal<WorldMember[]>([]);
  const [presence, setPresence] = createSignal<PresenceMember[]>([]);
  const [activeRolls, setActiveRolls] = createSignal<ChatMessage[]>([]);
  const [tab, setTab] = createSignal<Tab>("sheets");
  const [error, setError] = createSignal("");
  const [status, setStatus] = createSignal<RealtimeStatus>("connecting");

  let controller: RealtimeController | undefined;

  onSettled(() => {
    void (async () => {
      const sessionStart = Date.now();
      while (session.loading() && Date.now() - sessionStart < 5000) {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      if (!session.user()) {
        navigate("/", { replace: true });
        return;
      }
      try {
        const bootstrap = await api.bootstrapWorld(params.id);
        setBoot(bootstrap);
        acceptBoard(bootstrap.board);
        setMessages(bootstrap.messages);
        setHasMore(bootstrap.hasMoreMessages);
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
            case "board":
              acceptBoard(frame.board);
              break;
            case "message":
              if (frame.message.kind === "roll" && frame.message.roll) {
                setActiveRolls((prev) => [...prev, frame.message]);
              } else {
                setMessages((prev) => [...prev, frame.message]);
              }
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

  const loadMore = async () => {
    if (loadingMore() || !hasMore()) return;
    const first = messages()[0];
    setLoadingMore(true);
    try {
      const page = await api.fetchMessages(params.id, {
        before: first?.createdAt,
        beforeId: first?.id,
        limit: 50,
      });
      setMessages((prev) => [...page.messages, ...prev]);
      setHasMore(page.hasMore);
    } catch {
      // keep the current view on failure
    } finally {
      setLoadingMore(false);
    }
  };

  const sendChat = (input: {
    content: string;
    kind: "ic" | "ooc";
    visibility: Visibility;
    recipientMemberIds: string[];
  }) => {
    controller?.send({ type: "chat", ...input });
  };

  const rollDice = (notation: string, visibility: Visibility) => {
    controller?.send({ type: "roll.dice", notation, visibility });
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

  const uploadAvatar = async (characterId: string, file: File) => {
    const character = await api.uploadAvatar(params.id, characterId, file);
    setCharacters((prev) => upsert(prev, character));
  };

  const tabs = (): { id: Tab; label: string }[] => [
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
    <div {...sx(styles.app, b.world)}>
      <DiceLanes
        members={presence().map((member) => ({ id: member.id, displayName: member.displayName }))}
        rolls={activeRolls()}
        onReveal={(message) =>
          setMessages((prev) =>
            prev.some((existing) => existing.id === message.id) ? prev : [...prev, message],
          )
        }
        onDone={(id) => setActiveRolls((prev) => prev.filter((message) => message.id !== id))}
      />

      <TopBar>
        <Button variant="ghost" small onClick={() => navigate("/dashboard")}>
          ← Worlds
        </Button>
        <span {...sx(styles.muted)}>{session.user()?.displayName}</span>
      </TopBar>

      <div {...sx(b.content)}>
        <ErrorBanner message={error()} />

        <Show
          when={boot()}
          fallback={
            <div {...sx(styles.center)}>
              <Spinner label="Loading world..." />
            </div>
          }
        >
          {(world) => (
            <>
              <div {...sx(styles.worldHeader, b.header)}>
                <h1 {...sx(styles.h2)}>{world().world.name}</h1>
                <Badge tone={isDm() ? "tag" : "accent"}>{world().member.role}</Badge>
                <span {...sx(styles.statusPill)}>
                  <span
                    {...sx(styles.presenceDot, status() !== "open" && styles.presenceDotOffline)}
                  />
                  {status() === "open" ? `${onlineCount()} online` : status()}
                </span>
                <div {...sx(styles.grow)} />
                <button
                  type="button"
                  {...sx(styles.button, styles.buttonSmall)}
                  aria-expanded={panels().chat ? "true" : "false"}
                  aria-controls="world-chat"
                  onClick={() => togglePanel("chat")}
                >
                  {panels().chat ? "Hide chat" : "Show chat"}
                </button>
                <button
                  type="button"
                  {...sx(styles.button, styles.buttonSmall)}
                  aria-expanded={panels().tools ? "true" : "false"}
                  aria-controls="world-tools"
                  onClick={() => togglePanel("tools")}
                >
                  {panels().tools ? "Hide tools" : "Show tools"}
                </button>
                <div {...sx(styles.rowWrap)}>
                  <For each={presence()}>
                    {(member) => (
                      <span {...sx(styles.statusPill)}>
                        <span
                          {...sx(styles.presenceDot, !member.online && styles.presenceDotOffline)}
                        />
                        {member.displayName}
                      </span>
                    )}
                  </For>
                </div>
              </div>

              <div {...sx(b.stage)}>
                <MoodBoard
                  worldId={params.id}
                  isDm={isDm()}
                  snapshot={board()}
                  onPublished={acceptBoard}
                />
                <section
                  id="world-chat"
                  aria-label="World chat"
                  {...sx(b.panel, b.left, !panels().chat && b.hidden)}
                >
                  <Chat
                    worldId={params.id}
                    overlay
                    messages={messages()}
                    hasMore={hasMore()}
                    loadingMore={loadingMore()}
                    members={members()}
                    me={world().member}
                    onLoadMore={() => void loadMore()}
                    onSend={sendChat}
                    onRollDice={rollDice}
                  />
                </section>
                <aside
                  id="world-tools"
                  aria-label="World tools"
                  {...sx(b.panel, b.right, !panels().tools && b.hidden)}
                >
                  <div {...sx(styles.menuColumn, b.tools)}>
                    <div {...sx(styles.tabBar)}>
                      <For each={tabs()}>
                        {(item) => (
                          <button
                            {...sx(styles.tab, tab() === item.id && styles.tabActive)}
                            onClick={() => setTab(item.id)}
                          >
                            {item.label}
                          </button>
                        )}
                      </For>
                    </div>

                    <div {...sx(styles.window)}>
                      <div {...sx(styles.windowTitle)}>
                        <span>{tabs().find((item) => item.id === tab())?.label ?? "World"}</span>
                        <div {...sx(styles.spacer)} />
                        <span>{world().world.slug}</span>
                      </div>
                      <div {...sx(styles.windowBody)}>
                        <Show when={tab() === "sheets"}>
                          <CharacterSheets
                            worldId={params.id}
                            me={world().member}
                            isDm={isDm()}
                            characters={characters()}
                            templates={templates()}
                            members={members()}
                            onRoll={roll}
                            onTicker={ticker}
                            onSave={saveCharacter}
                            onDelete={deleteCharacter}
                            onUploadAvatar={uploadAvatar}
                          />
                        </Show>
                        <Show when={tab() === "notes"}>
                          <NotesPanel
                            worldId={params.id}
                            me={world().member}
                            members={members()}
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
                    </div>
                  </div>
                </aside>
              </div>
            </>
          )}
        </Show>
      </div>
    </div>
  );
}
