import { createCharacterUpdates } from "../client/character-updates";
import { trackerDefinitions } from "../domain/trackers-definitions";
import { useNavigate, useParams } from "@solidjs/router";
import { For, Show, createSignal, onCleanup, onSettled } from "solid-js";
import { api, ApiError, type WorldBootstrap } from "../client/api";
import { connectWorld, type RealtimeController, type RealtimeStatus } from "../client/realtime";
import { useSession } from "../client/session";
import { CharacterSheets } from "../components/character-sheets";
import type { SheetRoll } from "../components/sheet-blocks";
import { CompendiumPanel, EntryCard } from "../components/compendium";
import { createCompendium } from "../client/compendium";
import { Chat } from "../components/chat";
import { DiceLanes } from "../components/dice-lanes";
import { NotesPanel } from "../components/notes";
import { MoodBoard } from "../components/mood-board";
import { boardStyles as b } from "../components/board.stylex";
import { emptyBoard, type BoardSnapshot, type SceneList } from "../domain/board";
import { loadWorldPanels, saveWorldPanels } from "../client/world-panels";
import { loadLiveCursors, saveLiveCursors } from "../client/live-cursors";
import { styles } from "../components/styles.stylex";
import { showDiceTotals, setShowDiceTotals } from "../client/dice-display";
import {
  Badge,
  ErrorBanner,
  Menu,
  MenuItem,
  MenuToggle,
  Modal,
  Spinner,
  ThemeMenuItems,
} from "../components/ui";
import type {
  BoardFocus,
  Character,
  CharacterValue,
  ChatMessage,
  LiveCursor,
  NoteSummary,
  PresenceMember,
  SaveCharacterInput,
  SheetTemplate,
  Visibility,
  WorldMember,
} from "../domain/schemas";
import { sx } from "../theme/sx";

type Tab = "sheets" | "notes" | "compendium";

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

  const [boardFocus, setBoardFocus] = createSignal<BoardFocus | null>(null);
  const [sceneList, setSceneList] = createSignal<SceneList>({ scenes: [], activeSceneId: "" });
  const [board, setBoard] = createSignal<BoardSnapshot>(emptyBoard());
  const [panels, setPanels] = createSignal(loadWorldPanels(params.id));
  const [unreadChat, setUnreadChat] = createSignal(0);
  const [cursorsEnabled, setCursorsEnabled] = createSignal(
    loadLiveCursors() &&
      (typeof matchMedia === "undefined" || matchMedia("(any-pointer: fine)").matches),
  );
  const [cursors, setCursors] = createSignal<LiveCursor[]>([]);
  // Cursors are pointer-only; on touch devices sharing them is meaningless.
  const finePointer =
    typeof matchMedia === "undefined" || matchMedia("(any-pointer: fine)").matches;
  const toggleCursors = () => {
    const enabled = !cursorsEnabled();
    setCursorsEnabled(enabled);
    saveLiveCursors(enabled);
    setCursors([]);
    controller?.send({ type: "cursors.subscribe", enabled });
  };
  const togglePanel = (panel: "chat" | "tools") => {
    const next = { ...panels(), [panel]: !panels()[panel] };
    if (window.innerWidth <= 700 && next[panel]) next[panel === "chat" ? "tools" : "chat"] = false;
    setPanels(next);
    if (next.chat) setUnreadChat(0);
    saveWorldPanels(params.id, next);
  };
  const acceptBoard = (next: BoardSnapshot) => setBoard(next);
  const [boot, setBoot] = createSignal<WorldBootstrap | null>(null);
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [hasMore, setHasMore] = createSignal(false);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [characters, setCharacters] = createSignal<Character[]>([]);
  const [templates, setTemplates] = createSignal<SheetTemplate[]>([]);
  const [notes, setNotes] = createSignal<NoteSummary[]>([]);
  let notesRefresh = 0;
  const refreshNotes = async () => {
    const revision = ++notesRefresh;
    try {
      const next = await api.listNotes(params.id);
      if (revision === notesRefresh) setNotes(next);
    } catch {
      setError("Could not refresh notes");
    }
  };
  const [members, setMembers] = createSignal<WorldMember[]>([]);
  const [presence, setPresence] = createSignal<PresenceMember[]>([]);
  const [activeRolls, setActiveRolls] = createSignal<ChatMessage[]>([]);
  const [tab, setTab] = createSignal<Tab>("sheets");
  const compendium = createCompendium(params.id);
  // An entry opened from a sheet shows over the table; the Compendium tab keeps its own place.
  const [openEntry, setOpenEntry] = createSignal<string | null>(null);
  const [error, setError] = createSignal("");
  const [status, setStatus] = createSignal<RealtimeStatus>("connecting");

  let controller: RealtimeController | undefined;
  const characterUpdates = createCharacterUpdates();
  const resetCharacterUpdates = () => {
    for (const character of characterUpdates.reset())
      setCharacters((prev) => upsert(prev, character));
  };

  onSettled(() => {
    const narrow = window.matchMedia("(max-width: 700px)");
    const resizePanels = () => {
      if (narrow.matches && panels().chat && panels().tools) {
        const next = { ...panels(), tools: false };
        setPanels(next);
        saveWorldPanels(params.id, next);
      }
    };
    narrow.addEventListener("change", resizePanels);
    onCleanup(() => narrow.removeEventListener("change", resizePanels));
  });

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
        setSceneList({
          scenes: bootstrap.scenes ?? [],
          activeSceneId: bootstrap.activeSceneId ?? bootstrap.board.sceneId ?? "",
        });
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
        onStatus: (next) => {
          setStatus(next);
          if (next !== "open") resetCharacterUpdates();
          setCursors([]);
          if (next === "open") {
            controller?.send({ type: "cursors.subscribe", enabled: cursorsEnabled() });
            void refreshNotes();
            void compendium.refresh();
          }
        },
        onFrame: (frame) => {
          switch (frame.type) {
            case "notes.updated":
              void refreshNotes();
              break;
            case "compendium.updated":
              void compendium.refresh();
              break;
            case "cursor":
              if (cursorsEnabled()) {
                setCursors((previous) =>
                  frame.cursor.position
                    ? upsert(previous, frame.cursor)
                    : previous.filter((cursor) => cursor.id !== frame.cursor.id),
                );
              }
              break;
            case "board.focus":
              setBoardFocus(frame);
              break;
            case "scenes":
              setSceneList({ scenes: frame.scenes, activeSceneId: frame.activeSceneId });
              break;
            case "board":
              setSceneList((previous) => ({ ...previous, activeSceneId: frame.activeSceneId }));
              acceptBoard(frame.board);
              break;
            case "message":
              if (
                messages().some((message) => message.id === frame.message.id) ||
                activeRolls().some((message) => message.id === frame.message.id)
              )
                break;
              if (!panels().chat && frame.message.authorMemberId !== boot()?.member.id)
                setUnreadChat((count) => count + 1);
              if (frame.message.kind === "roll" && frame.message.roll) {
                setActiveRolls((prev) => [...prev, frame.message]);
              } else {
                setMessages((prev) => [...prev, frame.message]);
              }
              break;
            case "character":
              setCharacters((prev) =>
                upsert(prev, characterUpdates.reconcile(frame.character, frame.requestId)),
              );
              break;
            case "presence":
            case "hello":
              setPresence([...frame.members]);
              break;
            case "error":
              // A roll that failed to parse leaves sheet edits alone.
              if (frame.code !== "roll") resetCharacterUpdates();
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
    if (status() !== "open") return;
    controller?.send({ type: "chat", ...input });
  };

  const rollDice = (notation: string, visibility: Visibility, recipientMemberIds: string[]) => {
    if (status() !== "open") return;
    controller?.send({ type: "roll.dice", notation, visibility, recipientMemberIds });
  };

  const roll = (characterId: string, rollId: string, visibility: Visibility) => {
    controller?.send({ type: "roll", characterId, rollId, visibility, recipientMemberIds: [] });
  };

  const ticker = (characterId: string, tickerId: string, value: number) => {
    if (status() !== "open" || !controller) return;
    const character = characters().find((item) => item.id === characterId);
    const template =
      templates().find((item) => item.id === character?.templateId) ?? templates()[0];
    const definition = trackerDefinitions(template).find((item) => item.id === tickerId);
    if (!character || !definition) return;
    const requestId = crypto.randomUUID();
    const updated = characterUpdates.stageTracker(character, definition, value, requestId);
    setCharacters((prev) => upsert(prev, updated));
    controller.send({
      type: "ticker.set",
      characterId,
      tickerId,
      value: updated.tickers[tickerId],
      requestId,
    });
  };

  const setCharacterValue = (characterId: string, key: string, value: CharacterValue) => {
    if (status() !== "open" || !controller) return;
    const character = characters().find((item) => item.id === characterId);
    if (!character) return;
    const requestId = crypto.randomUUID();
    setCharacters((prev) =>
      upsert(prev, characterUpdates.stageValue(character, key, value, requestId)),
    );
    controller.send({ type: "character.value", characterId, key, value, requestId });
  };

  const setLayoutPref = (characterId: string, blockId: string, variant: string | null) => {
    if (status() !== "open" || !controller) return;
    const character = characters().find((item) => item.id === characterId);
    if (!character) return;
    setCharacters((prev) => upsert(prev, characterUpdates.stagePref(character, blockId, variant)));
    controller.send({ type: "character.prefs", characterId, blockId, variant });
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

  const tabs: { id: Tab; label: string }[] = [
    { id: "sheets", label: "Characters" },
    { id: "notes", label: "Notes" },
    { id: "compendium", label: "Compendium" },
  ];
  /**
   * A labelled public roll from a sheet or compendium card ("Longsword · d8").
   * `sheet` lets the server resolve `@refs` against that character (and a list row).
   */
  const rollLabelled = (notation: string, label: string, sheet?: SheetRoll) => {
    if (status() === "open")
      controller?.send({ type: "roll.dice", notation, label, visibility: "public", ...sheet });
  };

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
              <header {...sx(b.header)}>
                <button
                  type="button"
                  {...sx(styles.iconButton)}
                  aria-label="All worlds"
                  title="All worlds"
                  onClick={() => navigate("/dashboard")}
                >
                  <span aria-hidden="true">←</span>
                </button>
                <h1 {...sx(b.worldName)}>{world().world.name}</h1>
                <Show when={isDm()}>
                  <Badge tone="tag">DM</Badge>
                </Show>
                <Show when={status() !== "open"}>
                  <span {...sx(styles.statusPill)} role="status">
                    <span {...sx(styles.presenceDot, styles.presenceDotOffline)} />
                    {status() === "connecting" ? "Connecting…" : "Reconnecting…"}
                  </span>
                </Show>
                <div {...sx(styles.grow)} />
                <ul {...sx(b.presence)} aria-label="Who is here">
                  <For each={presence()}>
                    {(member) => (
                      <li
                        {...sx(b.presenceMember, !member.online && b.presenceAway)}
                        title={`${member.displayName}${member.online ? "" : " (away)"}`}
                      >
                        <span
                          {...sx(styles.presenceDot, !member.online && styles.presenceDotOffline)}
                        />
                        <span {...sx(b.presenceName)}>{member.displayName}</span>
                      </li>
                    )}
                  </For>
                </ul>
                <Menu label="Table settings" trigger={<span aria-hidden="true">⚙</span>}>
                  <ThemeMenuItems />
                  <div {...sx(styles.menuDivider)} />
                  <MenuToggle checked={showDiceTotals()} onChange={setShowDiceTotals}>
                    Show dice totals
                  </MenuToggle>
                  <Show when={finePointer}>
                    <MenuToggle checked={cursorsEnabled()} onChange={toggleCursors}>
                      Share live cursors
                    </MenuToggle>
                  </Show>
                  <div {...sx(styles.menuDivider)} />
                  <Show when={isDm()}>
                    <MenuItem onClick={() => navigate(`/worlds/${params.id}/settings`)}>
                      World settings…
                    </MenuItem>
                  </Show>
                  <MenuItem onClick={() => navigate("/dashboard")}>All worlds</MenuItem>
                  <MenuItem onClick={() => void session.signOut().then(() => navigate("/"))}>
                    Sign out {session.user()?.displayName}
                  </MenuItem>
                </Menu>
              </header>

              <div {...sx(b.stage)}>
                <MoodBoard
                  worldId={params.id}
                  isDm={isDm()}
                  snapshot={board()}
                  sceneList={sceneList()}
                  onSceneList={setSceneList}
                  focus={boardFocus()}
                  onFocus={(rect, sceneId) =>
                    controller?.send({ type: "board.focus", sceneId, rect })
                  }
                  onPublished={acceptBoard}
                  cursors={cursors()}
                  cursorsEnabled={cursorsEnabled() && status() === "open"}
                  onCursor={(position) => controller?.send({ type: "cursor", position })}
                />
                <Show when={!panels().chat}>
                  <button
                    type="button"
                    {...sx(b.panelTab, b.leftTab)}
                    aria-label={`Open chat${unreadChat() ? `, ${unreadChat()} unread messages` : ""}`}
                    aria-expanded="false"
                    aria-controls="world-chat"
                    onClick={() => togglePanel("chat")}
                  >
                    Chat
                    <Show when={unreadChat() > 0}>
                      <span {...sx(b.unread)} aria-live="polite">
                        {unreadChat()}
                      </span>
                    </Show>
                    <span aria-hidden="true">›</span>
                  </button>
                </Show>
                <Show when={!panels().tools}>
                  <button
                    type="button"
                    {...sx(b.panelTab, b.rightTab)}
                    aria-label="Open tools"
                    aria-expanded="false"
                    aria-controls="world-tools"
                    onClick={() => togglePanel("tools")}
                  >
                    <span aria-hidden="true">‹</span> Tools
                  </button>
                </Show>
                <section
                  id="world-chat"
                  aria-label="World chat"
                  {...sx(b.panel, b.left, !panels().chat && b.hidden)}
                >
                  <div {...sx(b.panelHeader)}>
                    <span>Chat</span>
                    <button
                      type="button"
                      {...sx(b.control)}
                      aria-label="Collapse chat"
                      title="Collapse chat"
                      aria-expanded="true"
                      aria-controls="world-chat"
                      onClick={() => togglePanel("chat")}
                    >
                      <span aria-hidden="true">‹</span>
                    </button>
                  </div>
                  <Chat
                    connected={status() === "open"}
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
                    compendium={compendium}
                    onOpenEntry={setOpenEntry}
                  />
                </section>
                <aside
                  id="world-tools"
                  aria-label="World tools"
                  {...sx(b.panel, b.right, !panels().tools && b.hidden)}
                >
                  <div {...sx(b.panelHeader, b.panelHeaderTabs)}>
                    <div {...sx(b.panelTabs)} role="tablist" aria-label="Tools">
                      <For each={tabs}>
                        {(item) => (
                          <button
                            type="button"
                            role="tab"
                            aria-selected={tab() === item.id ? "true" : "false"}
                            {...sx(styles.tab, b.toolsTab, tab() === item.id && styles.tabActive)}
                            onClick={() => setTab(item.id)}
                          >
                            {item.label}
                          </button>
                        )}
                      </For>
                    </div>
                    <button
                      type="button"
                      {...sx(b.control)}
                      aria-label="Collapse tools"
                      title="Collapse tools"
                      aria-expanded="true"
                      aria-controls="world-tools"
                      onClick={() => togglePanel("tools")}
                    >
                      <span aria-hidden="true">›</span>
                    </button>
                  </div>
                  <div {...sx(b.tools)}>
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
                        onValue={setCharacterValue}
                        onLayoutPref={setLayoutPref}
                        onRollDice={rollLabelled}
                        compendium={compendium}
                        onOpenEntry={setOpenEntry}
                        onSave={saveCharacter}
                        onDelete={deleteCharacter}
                        onUploadAvatar={uploadAvatar}
                      />
                    </Show>
                    <div hidden={tab() !== "notes"}>
                      <NotesPanel
                        worldId={params.id}
                        me={world().member}
                        members={members()}
                        notes={notes()}
                        onNotes={setNotes}
                        compendium={compendium}
                        onOpenEntry={setOpenEntry}
                      />
                    </div>
                    <Show when={tab() === "compendium"}>
                      <CompendiumPanel
                        worldId={params.id}
                        isDm={isDm()}
                        compendium={compendium}
                        onRoll={(label, dice) => rollLabelled(dice, label)}
                        onSetup={() => navigate(`/worlds/${params.id}/settings?section=compendium`)}
                        onShare={(entry) =>
                          sendChat({
                            content: `[[${entry.name}]]`,
                            kind: "ic",
                            visibility: "public",
                            recipientMemberIds: [],
                          })
                        }
                      />
                    </Show>
                  </div>
                </aside>
              </div>
            </>
          )}
        </Show>
      </div>
      <Modal
        when={!!openEntry() && !!compendium.entry(openEntry()!)}
        title={compendium.typeById(compendium.entry(openEntry()!)?.typeId ?? "")?.name ?? "Entry"}
        onClose={() => setOpenEntry(null)}
      >
        <Show when={compendium.entry(openEntry() ?? "")}>
          {(entry) => (
            <Show when={compendium.typeById(entry().typeId)}>
              {(type) => (
                <EntryCard
                  entry={entry()}
                  type={type()}
                  onRoll={(label, dice) => rollLabelled(dice, label)}
                  entries={compendium.entries()}
                  onOpenEntry={setOpenEntry}
                />
              )}
            </Show>
          )}
        </Show>
      </Modal>
    </div>
  );
}
