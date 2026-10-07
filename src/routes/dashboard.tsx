import { useNavigate } from "@solidjs/router";
import { createEffect, createSignal, For, Show } from "solid-js";
import { api, ApiError } from "../client/api";
import { useSession } from "../client/session";
import { importWorld, readBackup } from "../client/world-backup";
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
  const [importing, setImporting] = createSignal<{ done: number; total: number } | null>(null);
  const [imported, setImported] = createSignal<{
    worldId: string;
    skippedLibraries: readonly string[];
    skippedEntries: number;
    missing: readonly string[];
  } | null>(null);

  createEffect(
    () => ({ loading: session.loading(), user: session.user() }),
    ({ loading, user }) => {
      if (!loading && !user) navigate("/", { replace: true });
    },
  );

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

  const restore = async (file: File) => {
    setError("");
    setImporting({ done: 0, total: 0 });
    try {
      const backup = await readBackup(file);
      const result = await importWorld(backup, (done, total) => setImporting({ done, total }));
      await session.refresh();
      const { skippedLibraries, skippedEntries } = result.status;
      if (skippedLibraries.length || result.missing.length)
        setImported({
          worldId: result.world.id,
          skippedLibraries,
          skippedEntries,
          missing: result.missing,
        });
      else navigate(`/worlds/${result.world.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not import that backup");
    } finally {
      setImporting(null);
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
            <p {...sx(styles.muted)}>Pick a table to join, or start a new world.</p>
          </div>
          <div {...sx(styles.spacer)} />
          <Show when={importing()}>
            {(current) => (
              <span {...sx(styles.muted)} role="status">
                {current().total
                  ? `Uploading ${current().done} of ${current().total} files…`
                  : "Importing…"}
              </span>
            )}
          </Show>
          <label {...sx(styles.button)}>
            New world from backup
            <input
              type="file"
              accept=".zip,application/zip"
              hidden
              disabled={importing() !== null}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void restore(file);
              }}
            />
          </label>
          <Button variant="primary" onClick={() => setCreating(true)}>
            New world
          </Button>
        </div>
        <Show when={!creating()}>
          <ErrorBanner message={error()} />
        </Show>

        <div {...sx(styles.divider)} />

        <Show
          when={session.worlds().length > 0}
          fallback={
            <EmptyState>
              No worlds yet. Start one, then invite your players from its settings.
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

      <Modal when={imported() !== null} title="World imported" onClose={() => setImported(null)}>
        <div {...sx(styles.col)}>
          <Show when={imported()?.skippedLibraries.length}>
            <p {...sx(styles.body)}>
              These libraries aren't published here, so they weren't turned on:{" "}
              {imported()!.skippedLibraries.join(", ")}.
              {imported()!.skippedEntries
                ? ` ${imported()!.skippedEntries} of your changes to their entries were left out.`
                : ""}
            </p>
          </Show>
          <Show when={imported()?.missing.length}>
            <p {...sx(styles.body)}>
              {imported()!.missing.length}{" "}
              {imported()!.missing.length === 1 ? "image wasn't" : "images weren't"} in the backup.
              The world's Backup settings can finish the import from another copy.
            </p>
          </Show>
          <Button variant="primary" onClick={() => navigate(`/worlds/${imported()!.worldId}`)}>
            Open the world
          </Button>
        </div>
      </Modal>

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
