import * as stylex from "@stylexjs/stylex";
import { For, Show, createSignal, onSettled } from "solid-js";
import { colors, fontSize, space } from "../theme/tokens.stylex";
import { api } from "../client/api";
import type { BlockedEntries, LibraryEntryDiff, WorldLibraries } from "../domain/corpus-rpc";
import type { CompendiumStore } from "../client/compendium-store";
import { entryChanges } from "../domain/entry-diff";
import { sx } from "../theme/sx";
import { styles } from "./styles.stylex";
import { Badge, Button, EmptyState, ErrorBanner, Modal, Spinner } from "./ui";

export function Libraries(props: {
  worldId: string;
  onChanged: () => Promise<void>;
  /** For field labels in update diffs. */
  compendium?: Pick<CompendiumStore, "typeById">;
}) {
  const [libraries, setLibraries] = createSignal<WorldLibraries | null>(null);
  const [blocked, setBlocked] = createSignal<BlockedEntries["entries"]>([]);
  const [diff, setDiff] = createSignal<LibraryEntryDiff | null>(null);
  const review = async (sourceId: string, entryId: string) => {
    setError("");
    try {
      setDiff(await api.libraryEntryDiff(props.worldId, sourceId, entryId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the change");
    }
  };
  const diffChanges = (value: LibraryEntryDiff) => {
    const typeId = (value.to ?? value.from)?.typeId ?? "";
    const labels = new Map(
      (props.compendium?.typeById(typeId)?.fields ?? []).map((field) => [field.key, field.label]),
    );
    return entryChanges(value.from, value.to, labels);
  };
  const shortId = (id: string) => id.split("/").slice(1).join(" / ");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [followChoices, setFollowChoices] = createSignal<Record<string, boolean>>({});
  const refresh = async () => {
    const [result, hidden] = await Promise.all([
      api.libraries(props.worldId),
      api.blockedEntries(props.worldId),
    ]);
    setLibraries(result);
    setBlocked(hidden.entries);
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
                                <p {...sx(l.changes)}>
                                  <strong>{group.label}</strong>:{" "}
                                  <For each={group.ids}>
                                    {(id) => (
                                      <button
                                        type="button"
                                        {...sx(l.change)}
                                        onClick={() => void review(source.sourceId, id)}
                                      >
                                        {update().names?.[id] ?? shortId(id)}
                                      </button>
                                    )}
                                  </For>
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
                {(entry) => (
                  <div {...sx(styles.row)}>
                    <span {...sx(styles.spacer)}>{entry.name ?? shortId(entry.id)}</span>
                    <Button
                      small
                      disabled={busy()}
                      onClick={() => void act(() => api.blockEntry(props.worldId, entry.id, false))}
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
      <Modal
        when={!!diff()}
        title={`Changes to ${diff()?.to?.name ?? diff()?.from?.name ?? "entry"}`}
        onClose={() => setDiff(null)}
      >
        <Show when={diff()}>
          {(value) => (
            <div {...sx(styles.col)}>
              <p {...sx(styles.muted)}>
                {value().from
                  ? value().to
                    ? `Version ${value().fromVersion} → ${value().toVersion}.`
                    : `Removed in version ${value().toVersion}.`
                  : `Added in version ${value().toVersion}.`}
                <Show when={value().overridden}>
                  {" "}
                  This world has a table override for it, which keeps applying after the update.
                </Show>
              </p>
              <For
                each={diffChanges(value())}
                fallback={<EmptyState>Only bookkeeping changed (no text or fields).</EmptyState>}
              >
                {(change) => (
                  <div {...sx(l.diffRow)}>
                    <strong {...sx(l.diffLabel)}>{change.label}</strong>
                    <del {...sx(l.from)}>{change.from || "—"}</del>
                    <ins {...sx(l.to)}>{change.to || "—"}</ins>
                  </div>
                )}
              </For>
            </div>
          )}
        </Show>
      </Modal>
    </section>
  );
}

const l = stylex.create({
  changes: { display: "flex", flexWrap: "wrap", gap: space.x1, alignItems: "baseline", margin: 0 },
  change: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: colors.accent,
    textDecorationLine: "underline",
    font: "inherit",
    cursor: "pointer",
  },
  diffRow: {
    display: "grid",
    gridTemplateColumns: "8em 1fr 1fr",
    gap: space.x2,
    alignItems: "start",
    fontSize: fontSize.caption,
  },
  diffLabel: { fontWeight: 600 },
  from: { color: colors.textMuted, whiteSpace: "pre-wrap" },
  to: { textDecorationLine: "none", whiteSpace: "pre-wrap" },
});
