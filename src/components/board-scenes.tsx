import type { JSX } from "@solidjs/web";
import { For, Show, createSignal, createUniqueId, onSettled } from "solid-js";
import { api } from "../client/api";
import {
  MAX_BOARD_SCENES,
  type BoardSnapshot,
  type SceneList,
  type SceneMetadata,
} from "../domain/board";
import { sx } from "../theme/sx";
import { boardStyles as b } from "./board.stylex";
import { Button, ErrorBanner } from "./ui";

export function BoardScenes(props: {
  worldId: string;
  scenes: readonly SceneMetadata[];
  activeId: string;
  selectedId: string;
  busy: boolean;
  editing: boolean;
  onOpen: (load: () => Promise<BoardSnapshot>) => Promise<void>;
  onList: (list: SceneList) => void;
}) {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const disabled = () => busy() || props.busy;
  const run = async (action: () => Promise<unknown>) => {
    if (disabled()) return;
    setBusy(true);
    setError("");
    try {
      await action();
      props.onList(await api.listScenes(props.worldId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update scenes");
    } finally {
      setBusy(false);
    }
  };
  const [entry, setEntry] = createSignal<{
    label: string;
    value: string;
    save: (name: string) => void;
    allowEmpty?: boolean;
  } | null>(null);
  const [actions, setActions] = createSignal<string | null>(null);
  const create = (source?: SceneMetadata) => {
    setEntry({
      label: "Scene name",
      value: source ? `${source.name} copy` : "New scene",
      save: (name) =>
        void run(() =>
          props.onOpen(() =>
            api.createScene(props.worldId, {
              name,
              ...(source ? { duplicateFrom: source.id } : {}),
            }),
          ),
        ),
    });
  };
  const groups = () => [...new Set(props.scenes.map((scene) => scene.group))];
  return (
    <BoardPopover
      label="Scenes"
      summary={
        <>
          <span {...sx(b.sceneName)}>
            {props.scenes.find((scene) => scene.id === props.selectedId)?.name ?? "Deleted scene"}
          </span>
          <span {...sx(b.sceneBadge)}>{props.selectedId === props.activeId ? "LIVE" : "PREP"}</span>
        </>
      }
    >
      <div {...sx(b.panelContent)}>
        <Show when={props.selectedId !== props.activeId}>
          <p {...sx(b.status)} role="status">
            PRIVATE PREP — players see another scene
          </p>
        </Show>
        <Show when={props.editing}>
          <Button
            small
            disabled={disabled() || props.scenes.length >= MAX_BOARD_SCENES}
            onClick={() => create()}
          >
            New scene
          </Button>
        </Show>
        <Show when={entry()}>
          {(current) => <InlineName {...current()} onClose={() => setEntry(null)} />}
        </Show>
        <For each={groups()}>
          {(group) => (
            <section aria-label={group ?? "Ungrouped scenes"}>
              <strong>{group ?? "Ungrouped"}</strong>
              <For each={props.scenes.filter((scene) => scene.group === group)}>
                {(scene) => (
                  <div {...sx(b.panelItem)}>
                    <div {...sx(b.panelActions)}>
                      <button
                        type="button"
                        {...sx(
                          b.control,
                          b.itemName,
                          scene.id === props.selectedId && b.activeControl,
                        )}
                        aria-pressed={scene.id === props.selectedId ? "true" : "false"}
                        disabled={disabled()}
                        onClick={() =>
                          void run(() => props.onOpen(() => api.getScene(props.worldId, scene.id)))
                        }
                      >
                        {scene.id === props.selectedId ? "▸ " : ""}
                        {scene.name}
                      </button>
                      <Show when={scene.id === props.activeId}>
                        <span {...sx(b.sceneBadge)}>LIVE</span>
                      </Show>
                      <Show when={scene.id !== props.activeId}>
                        <Button
                          small
                          disabled={disabled() || scene.id === props.activeId}
                          onClick={() =>
                            void run(() =>
                              props.onOpen(() => api.activateScene(props.worldId, scene.id)),
                            )
                          }
                        >
                          Show
                        </Button>
                      </Show>
                      <Show when={props.editing}>
                        <button
                          type="button"
                          {...sx(b.control)}
                          aria-label={`More actions for ${scene.name}`}
                          aria-expanded={actions() === scene.id ? "true" : "false"}
                          onClick={() => setActions(actions() === scene.id ? null : scene.id)}
                        >
                          ⋯
                        </button>
                      </Show>
                    </div>
                    <Show when={props.editing && actions() === scene.id}>
                      <div {...sx(b.panelActions)}>
                        <Button
                          small
                          disabled={disabled() || props.scenes.length >= MAX_BOARD_SCENES}
                          onClick={() => create(scene)}
                        >
                          Duplicate
                        </Button>
                        <Button
                          small
                          disabled={disabled()}
                          onClick={() => {
                            setEntry({
                              label: "Scene name",
                              value: scene.name,
                              save: (name) =>
                                void run(() => api.updateScene(props.worldId, scene.id, { name })),
                            });
                          }}
                        >
                          Rename
                        </Button>
                        <Button
                          small
                          disabled={disabled()}
                          onClick={() => {
                            setEntry({
                              label: "Group (leave blank for ungrouped)",
                              value: scene.group ?? "",
                              allowEmpty: true,
                              save: (group) =>
                                void run(() =>
                                  api.updateScene(props.worldId, scene.id, {
                                    group: group || null,
                                  }),
                                ),
                            });
                          }}
                        >
                          Set group
                        </Button>
                        <Button
                          small
                          disabled={disabled() || scene.sort === 0}
                          onClick={() =>
                            void run(() =>
                              api.updateScene(props.worldId, scene.id, { sort: scene.sort - 1 }),
                            )
                          }
                        >
                          Move up
                        </Button>
                        <Button
                          small
                          disabled={disabled() || scene.sort >= props.scenes.length - 1}
                          onClick={() =>
                            void run(() =>
                              api.updateScene(props.worldId, scene.id, { sort: scene.sort + 1 }),
                            )
                          }
                        >
                          Move down
                        </Button>
                        <Button
                          small
                          variant="danger"
                          disabled={disabled() || props.scenes.length === 1}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete “${scene.name}”? Deleting the live scene shows a neighboring scene to players.`,
                              )
                            )
                              void run(() =>
                                props.onOpen(async () => {
                                  const list = await api.deleteScene(props.worldId, scene.id);
                                  props.onList(list);
                                  return api.getScene(
                                    props.worldId,
                                    scene.id === props.selectedId
                                      ? list.activeSceneId
                                      : props.selectedId,
                                  );
                                }),
                              );
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </section>
          )}
        </For>
        <ErrorBanner message={error()} />
      </div>
    </BoardPopover>
  );
}

// Native popovers provide light dismissal and restore focus to their trigger on Escape.
export function BoardPopover(props: {
  label: string;
  summary?: JSX.Element;
  children: JSX.Element;
}) {
  const id = createUniqueId();
  const [open, setOpen] = createSignal(false);
  let panel!: HTMLDivElement;
  return (
    <>
      <button
        type="button"
        {...sx(b.control, b.popoverTrigger)}
        aria-label={props.label}
        aria-expanded={open() ? "true" : "false"}
        aria-controls={id}
        popovertarget={id}
        onClick={(event) => {
          const toolbar = event.currentTarget.closest('[aria-label="Board tools"]');
          if (toolbar) panel.style.top = `${toolbar.getBoundingClientRect().bottom + 8}px`;
        }}
      >
        {props.summary ?? props.label}
        <span aria-hidden="true">▾</span>
      </button>
      <div
        ref={(element) => {
          panel = element;
        }}
        id={id}
        popover="auto"
        {...sx(b.scenePanels)}
        role="region"
        aria-label={props.label}
        tabindex={-1}
        onToggle={(event) => {
          const visible = event.newState === "open";
          setOpen(visible);
          if (visible) panel.focus();
        }}
      >
        {props.children}
      </div>
    </>
  );
}

export function InlineName(props: {
  label: string;
  value: string;
  save: (value: string) => void;
  onClose: () => void;
  allowEmpty?: boolean;
}) {
  const [value, setValue] = createSignal(props.value);
  let input!: HTMLInputElement;
  onSettled(() => {
    input.focus();
    input.select();
  });
  return (
    <form
      {...sx(b.panelContent)}
      onSubmit={(event) => {
        event.preventDefault();
        if (!value().trim() && !props.allowEmpty) return;
        props.save(value().trim());
        props.onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          props.onClose();
        }
      }}
    >
      <label>
        {props.label}
        <input
          ref={(element) => {
            input = element;
          }}
          {...sx(b.nameInput)}
          value={value()}
          maxlength={100}
          onInput={(event) => setValue(event.currentTarget.value)}
        />
      </label>
      <div {...sx(b.panelActions)}>
        <Button small type="submit" disabled={!props.allowEmpty && !value().trim()}>
          Save
        </Button>
        <Button small onClick={props.onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
