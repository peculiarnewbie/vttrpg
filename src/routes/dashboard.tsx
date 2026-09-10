import { useNavigate } from "@solidjs/router";
import { createSignal, For, onSettled, Show } from "solid-js";
import { api, ApiError } from "../client/api";
import { useSession } from "../client/session";
import { Badge, Button, EmptyState, ErrorBanner, Input, Modal, TopBar } from "../components/ui";
import { styles } from "../components/styles.stylex";
import { sx } from "../theme/sx";

export default function Dashboard() {
  const session = useSession();
  const navigate = useNavigate();
  const [creating, setCreating] = createSignal(false);
  const [name, setName] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  onSettled(() => {
    if (!session.loading() && !session.user()) navigate("/", { replace: true });
  });

  const createWorld = async (event: Event) => {
    event.preventDefault();
    if (!name().trim()) return;
    setBusy(true);
    setError("");
    try {
      const world = await api.createWorld(name().trim());
      await session.refresh();
      navigate(`/worlds/${world.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create world");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div {...sx(styles.app)}>
      <TopBar>
        <span {...sx(styles.muted)}>{session.user()?.displayName}</span>
        <Button
          variant="ghost"
          small
          onClick={() => void session.signOut().then(() => navigate("/"))}
        >
          Sign out
        </Button>
      </TopBar>

      <div {...sx(styles.container)}>
        <div {...sx(styles.row)}>
          <div>
            <h1 {...sx(styles.h2)}>Your worlds</h1>
            <p {...sx(styles.muted)}>Each world is its own Durable Object with isolated storage.</p>
          </div>
          <div {...sx(styles.spacer)} />
          <Button variant="primary" onClick={() => setCreating(true)}>
            New world
          </Button>
        </div>

        <div {...sx(styles.divider)} />

        <Show
          when={session.worlds().length > 0}
          fallback={
            <EmptyState>
              No worlds yet. Create one to get a Durable Object, a file prefix, and a place to play.
            </EmptyState>
          }
        >
          <div {...sx(styles.grid)}>
            <For each={session.worlds()}>
              {(world) => (
                <button
                  {...sx(styles.card, styles.cardInteractive)}
                  onClick={() => navigate(`/worlds/${world.id}`)}
                >
                  <div {...sx(styles.row)}>
                    <h3 {...sx(styles.h4)}>{world.name}</h3>
                    <div {...sx(styles.spacer)} />
                    <Badge tone={world.role === "dm" ? "tag" : "accent"}>
                      {world.role === "dm" ? "DM" : "Player"}
                    </Badge>
                  </div>
                  <p {...sx(styles.muted)}>Owner: {world.ownerName}</p>
                  <p {...sx(styles.faint)}>Playing as {world.memberName}</p>
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>

      <Modal when={creating()} title="Create a world" onClose={() => setCreating(false)}>
        <form {...sx(styles.col)} onSubmit={createWorld}>
          <ErrorBanner message={error()} />
          <label {...sx(styles.field)}>
            <span {...sx(styles.label)}>World name</span>
            <Input value={name()} onInput={setName} placeholder="The Shattered Coast" />
          </label>
          <Button type="submit" variant="primary" disabled={busy()}>
            {busy() ? "Creating..." : "Create world"}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
