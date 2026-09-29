import { For, Show, createSignal } from "solid-js";
import {
  MAX_BOARD_LAYERS,
  deleteBoardLayer,
  normalizeBoard,
  type BoardDocument,
  type BoardLayer,
} from "../domain/board";
import { sx } from "../theme/sx";
import { boardStyles as b } from "./board.stylex";
import { Button } from "./ui";
import { BoardPopover, InlineName } from "./board-scenes";

export function BoardLayers(props: {
  document: BoardDocument;
  selectedId: string;
  busy: boolean;
  onSelect: (id: string) => void;
  onChange: (document: BoardDocument) => void;
}) {
  const [actions, setActions] = createSignal<string | null>(null);
  const [entry, setEntry] = createSignal<{ value: string; save: (name: string) => void } | null>(
    null,
  );
  const document = () => normalizeBoard(props.document);
  const update = (next: BoardLayer) =>
    props.onChange({
      ...document(),
      layers: document().layers.map((layer) => (layer.id === next.id ? next : layer)),
    });
  const move = (id: string, direction: number) => {
    const layers = [...document().layers];
    const index = layers.findIndex((layer) => layer.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= layers.length) return;
    [layers[index], layers[target]] = [layers[target], layers[index]];
    props.onChange({ ...document(), layers });
  };
  return (
    <BoardPopover label="Layers">
      <div {...sx(b.panelContent)}>
        <p {...sx(b.status)}>
          Hidden layers are private. Locked layers let you pan over their elements.
        </p>
        <Show when={entry()}>
          {(current) => (
            <InlineName label="Layer name" {...current()} onClose={() => setEntry(null)} />
          )}
        </Show>
        <For each={document().layers}>
          {(layer, index) => (
            <div {...sx(b.panelItem)}>
              <div {...sx(b.panelActions)}>
                <button
                  type="button"
                  {...sx(b.control, b.itemName, props.selectedId === layer.id && b.activeControl)}
                  disabled={props.busy}
                  aria-pressed={props.selectedId === layer.id ? "true" : "false"}
                  onClick={() => props.onSelect(layer.id)}
                >
                  {layer.name}
                  {props.selectedId === layer.id ? " · Target" : ""}
                </button>
                <button
                  type="button"
                  {...sx(b.control)}
                  disabled={props.busy}
                  aria-label={`Lock ${layer.name}`}
                  aria-pressed={layer.locked ? "true" : "false"}
                  onClick={() => update({ ...layer, locked: !layer.locked })}
                >
                  {layer.locked ? "🔒" : "🔓"}
                </button>
                <button
                  type="button"
                  {...sx(b.control)}
                  disabled={props.busy}
                  aria-label={`Hide ${layer.name}`}
                  aria-pressed={layer.hidden ? "true" : "false"}
                  onClick={() => update({ ...layer, hidden: !layer.hidden })}
                >
                  {layer.hidden ? "◌" : "◉"}
                </button>
                <button
                  type="button"
                  {...sx(b.control)}
                  aria-label={`More actions for ${layer.name}`}
                  aria-expanded={actions() === layer.id ? "true" : "false"}
                  onClick={() => setActions(actions() === layer.id ? null : layer.id)}
                >
                  ⋯
                </button>
              </div>
              <Show when={actions() === layer.id}>
                <div {...sx(b.panelActions)}>
                  <Button
                    small
                    disabled={props.busy}
                    onClick={() => {
                      setEntry({ value: layer.name, save: (name) => update({ ...layer, name }) });
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    small
                    disabled={props.busy || index() === 0}
                    onClick={() => move(layer.id, -1)}
                  >
                    Lower
                  </Button>
                  <Button
                    small
                    disabled={props.busy || index() === document().layers.length - 1}
                    onClick={() => move(layer.id, 1)}
                  >
                    Raise
                  </Button>
                  <Button
                    small
                    variant="danger"
                    disabled={props.busy || document().layers.length === 1}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete layer “${layer.name}”? Elements move to the layer below (or the next layer for the bottom layer).`,
                        )
                      )
                        props.onChange(deleteBoardLayer(document(), layer.id));
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </Show>
            </div>
          )}
        </For>
        <Button
          small
          disabled={props.busy || document().layers.length >= MAX_BOARD_LAYERS}
          onClick={() => {
            setEntry({
              value: "New layer",
              save: (name) => {
                const id = crypto.randomUUID();
                props.onChange({
                  ...document(),
                  layers: [
                    ...document().layers,
                    { id, name: name.trim().slice(0, 100), locked: false, hidden: false },
                  ],
                });
                props.onSelect(id);
              },
            });
          }}
        >
          Add layer
        </Button>
      </div>
    </BoardPopover>
  );
}
