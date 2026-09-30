import { For, Show, createSignal, onSettled } from "solid-js";
import { api } from "../client/api";
import type { WorldLibraries } from "../domain/corpus-rpc";
import { sx } from "../theme/sx";
import { styles } from "./styles.stylex";
import { Badge, Button, EmptyState, ErrorBanner, Spinner } from "./ui";

export function Libraries(props: { worldId: string; onChanged: () => Promise<void> }) {
  const [libraries, setLibraries] = createSignal<WorldLibraries | null>(null);
  const [blocked, setBlocked] = createSignal<readonly string[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [followChoices, setFollowChoices] = createSignal<Record<string, boolean>>({});
  const refresh = async () => {
    const [result, hidden] = await Promise.all([
      api.libraries(props.worldId),
      api.blockedEntries(props.worldId),
    ]);
    setLibraries(result);
    setBlocked(hidden.ids);
  };
  const act = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      await refresh();
      await props.onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update libraries");
    } finally {
      setBusy(false);
    }
  };
  onSettled(() => {
    void refresh().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : "Could not load libraries"),
    );
  });
  return (
    <section {...sx(styles.col)} aria-label="Libraries">
      <div {...sx(styles.row)}>
        <h2 {...sx(styles.h3)}>Libraries</h2>
        <div {...sx(styles.spacer)} />
        <Button
          small
          disabled={busy()}
          onClick={() => void act(() => api.checkLibraries(props.worldId))}
        >
          Check for updates
        </Button>
      </div>
      <p {...sx(styles.muted)}>
        Enable a library to use its entries in this world. Versions stay pinned until you choose an
        update.
      </p>
      <ErrorBanner message={error()} />
      <Show when={libraries()} fallback={<Spinner label="Loading libraries…" />}>
        {(data) => (
          <>
            <For each={data().enabled}>
              {(source) => (
                <section {...sx(styles.card, styles.col)} aria-label={source.name}>
                  <div {...sx(styles.row)}>
                    <strong>{source.name}</strong>
                    <Badge>Version {source.version}</Badge>
                    <div {...sx(styles.spacer)} />
                    <Button
                      small
                      disabled={busy()}
                      onClick={() =>
                        void act(() => api.disableLibrary(props.worldId, source.sourceId))
                      }
                    >
                      Disable
                    </Button>
                  </div>
                  <label {...sx(styles.row)}>
                    <input
                      type="checkbox"
                      checked={followChoices()[source.sourceId] ?? source.mode === "follow"}
                      disabled={busy()}
                      onChange={(event) => {
                        const follow = event.currentTarget.checked;
                        setFollowChoices((previous) => ({
                          ...previous,
                          [source.sourceId]: follow,
                        }));
                        void act(() =>
                          api.enableLibrary(props.worldId, source.sourceId, {
                            mode: follow ? "follow" : "pinned",
                            ...(follow ? {} : { version: source.version }),
                          }),
                        ).finally(() => {
                          setFollowChoices((previous) => {
                            const next = { ...previous };
                            delete next[source.sourceId];
                            return next;
                          });
                        });
                      }}
                    />
                    Follow latest
                  </label>
                  <Show when={source.mode === "follow"}>
                    <span {...sx(styles.muted)}>
                      New published versions are adopted when the table reconnects or checks for
                      updates.
                    </span>
                  </Show>
                  <Show when={source.update}>
                    {(update) => (
                      <div {...sx(styles.col)}>
                        <div {...sx(styles.row)}>
                          <Badge tone="accent">
                            Update available · version {update().toVersion}
                          </Badge>
                          <Button
                            small
                            variant="primary"
                            disabled={busy()}
                            onClick={() =>
                              void act(() =>
                                api.enableLibrary(props.worldId, source.sourceId, {
                                  version: update().toVersion,
                                  mode: source.mode,
                                }),
                              )
                            }
                          >
                            Apply update
                          </Button>
                        </div>
                        <details>
                          <summary>
                            {update().added.length} added · {update().changed.length} changed ·{" "}
                            {update().removed.length} removed
                          </summary>
                          <For
                            each={[
                              { label: "Added", ids: update().added },
                              { label: "Changed", ids: update().changed },
                              { label: "Removed", ids: update().removed },
                            ]}
                          >
                            {(group) => (
                              <Show when={group.ids.length}>
                                <p>
                                  <strong>{group.label}</strong>:{" "}
                                  {group.ids
                                    .map((id) => id.split("/").slice(1).join(" / "))
                                    .join(", ")}
                                </p>
                              </Show>
                            )}
                          </For>
                        </details>
                        <span {...sx(styles.muted)}>
                          Table overrides stay in place. Copied sheet rows offer their own updates.
                        </span>
                      </div>
                    )}
                  </Show>
                  <small {...sx(styles.muted)}>
                    {source.licence.name} · {source.licence.attribution}
                  </small>
                </section>
              )}
            </For>
            <h3 {...sx(styles.h3)}>Available libraries</h3>
            <For
              each={data().available.filter(
                (source) => !data().enabled.some((enabled) => enabled.sourceId === source.id),
              )}
              fallback={<EmptyState>No more published libraries are available.</EmptyState>}
            >
              {(source) => (
                <section {...sx(styles.card)} aria-label={source.name}>
                  <div {...sx(styles.row)}>
                    <div {...sx(styles.spacer)}>
                      <strong>{source.name}</strong>
                      <div {...sx(styles.muted)}>
                        Version {source.latestVersion} · {source.licence.name}
                      </div>
                      <small>{source.licence.attribution}</small>
                    </div>
                    <Button
                      small
                      disabled={busy()}
                      onClick={() =>
                        void act(() => api.enableLibrary(props.worldId, source.id, {}))
                      }
                    >
                      Enable
                    </Button>
                  </div>
                </section>
              )}
            </For>
            <Show when={blocked().length}>
              <h3 {...sx(styles.h3)}>Blocked entries</h3>
              <For each={blocked()}>
                {(id) => (
                  <div {...sx(styles.row)}>
                    <span {...sx(styles.spacer)}>{id}</span>
                    <Button
                      small
                      disabled={busy()}
                      onClick={() => void act(() => api.blockEntry(props.worldId, id, false))}
                    >
                      Restore
                    </Button>
                  </div>
                )}
              </For>
            </Show>
          </>
        )}
      </Show>
    </section>
  );
}
