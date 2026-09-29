import { For } from "solid-js";
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

export function BoardLayers(props: {
  document: BoardDocument;
  selectedId: string;
  busy: boolean;
  onSelect: (id: string) => void;
  onChange: (document: BoardDocument) => void;
}) {
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
    <details open>
      <summary {...sx(b.control)}>Layers (bottom → top)</summary>
      <div {...sx(b.panelContent)}>
        <p {...sx(b.status)}>
          Hidden layers are private. Locked layers let you pan over their elements.
        </p>
        <For each={document().layers}>
          {(layer, index) => (
            <div {...sx(b.panelItem)}>
              <button
                type="button"
                {...sx(b.control, props.selectedId === layer.id && b.activeControl)}
                disabled={props.busy}
                aria-pressed={props.selectedId === layer.id ? "true" : "false"}
                onClick={() => props.onSelect(layer.id)}
              >
                {layer.name}
              </button>
              <div {...sx(b.panelActions)}>
                <label>
                  <input
                    type="checkbox"
                    disabled={props.busy}
                    checked={layer.locked}
                    onChange={(event) => update({ ...layer, locked: event.currentTarget.checked })}
                  />{" "}
                  Locked
                </label>
                <label>
                  <input
                    type="checkbox"
                    disabled={props.busy}
                    checked={layer.hidden}
                    onChange={(event) => update({ ...layer, hidden: event.currentTarget.checked })}
                  />{" "}
                  Hidden
                </label>
                <Button
                  small
                  disabled={props.busy}
                  onClick={() => {
                    const name = window.prompt("Layer name", layer.name);
                    if (name?.trim()) update({ ...layer, name: name.trim().slice(0, 100) });
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
            </div>
          )}
        </For>
        <Button
          small
          disabled={props.busy || document().layers.length >= MAX_BOARD_LAYERS}
          onClick={() => {
            const name = window.prompt("Layer name", "New layer");
            if (!name?.trim()) return;
            const id = crypto.randomUUID();
            props.onChange({
              ...document(),
              layers: [
                ...document().layers,
                { id, name: name.trim().slice(0, 100), locked: false, hidden: false },
              ],
            });
            props.onSelect(id);
          }}
        >
          Add layer
        </Button>
      </div>
    </details>
  );
}
