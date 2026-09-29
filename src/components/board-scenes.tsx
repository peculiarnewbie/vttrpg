import { For, createSignal } from "solid-js";
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
  const create = (source?: SceneMetadata) => {
    const name = window.prompt("Scene name", source ? `${source.name} copy` : "New scene");
    if (!name?.trim()) return;
    void run(() =>
      props.onOpen(() =>
        api.createScene(props.worldId, {
          name: name.trim(),
          ...(source ? { duplicateFrom: source.id } : {}),
        }),
      ),
    );
  };
  const groups = () => [...new Set(props.scenes.map((scene) => scene.group))];
  return (
    <details>
      <summary {...sx(b.control)}>Scenes ({props.scenes.length})</summary>
      <div {...sx(b.panelContent)}>
        <Button
          small
          disabled={disabled() || props.scenes.length >= MAX_BOARD_SCENES}
          onClick={() => create()}
        >
          New scene
        </Button>
        <For each={groups()}>
          {(group) => (
            <section aria-label={group ?? "Ungrouped scenes"}>
              <strong>{group ?? "Ungrouped"}</strong>
              <For each={props.scenes.filter((scene) => scene.group === group)}>
                {(scene) => (
                  <div {...sx(b.panelItem)}>
                    <Button
                      small
                      disabled={disabled()}
                      onClick={() =>
                        void run(() => props.onOpen(() => api.getScene(props.worldId, scene.id)))
                      }
                    >
                      {scene.id === props.selectedId ? "▸ " : ""}
                      {scene.name}
                      {scene.id === props.activeId ? " · LIVE" : ""}
                    </Button>
                    <span {...sx(b.status)}>{scene.elementCount} elements</span>
                    <div {...sx(b.panelActions)}>
                      <Button
                        small
                        disabled={disabled() || scene.id === props.activeId}
                        onClick={() =>
                          void run(() =>
                            props.onOpen(() => api.activateScene(props.worldId, scene.id)),
                          )
                        }
                      >
                        Show to players
                      </Button>
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
                          const name = window.prompt("Scene name", scene.name);
                          if (name?.trim())
                            void run(() =>
                              api.updateScene(props.worldId, scene.id, { name: name.trim() }),
                            );
                        }}
                      >
                        Rename
                      </Button>
                      <Button
                        small
                        disabled={disabled()}
                        onClick={() => {
                          const group = window.prompt(
                            "Group (leave blank for ungrouped)",
                            scene.group ?? "",
                          );
                          if (group !== null)
                            void run(() =>
                              api.updateScene(props.worldId, scene.id, {
                                group: group.trim() || null,
                              }),
                            );
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
                  </div>
                )}
              </For>
            </section>
          )}
        </For>
        <ErrorBanner message={error()} />
      </div>
    </details>
  );
}
