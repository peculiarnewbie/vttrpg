import { For, Show } from "solid-js";
import { repeatLabel, repeatNotation } from "../../domain/builder-parts";
import { sx } from "../../theme/sx";
import { ItemRows } from "../editor-kit";
import { styles } from "../styles.stylex";
import { parts } from "./parts.stylex";
import type { PartEditorProps, PartViewProps } from "./types";

/**
 * Roll buttons: each posts one chat roll; a repeated roll keeps its groups
 * apart (`4d6kh3` × 3 rolls `4d6kh3 | 4d6kh3 | 4d6kh3`). Nothing a roll lands
 * on is written to the character.
 */
export function RollsView(props: PartViewProps<"rolls">) {
  return (
    <div {...sx(parts.rolls)} role="group" aria-label="Rolls">
      <For each={props.part.items}>
        {(item) => (
          <span {...sx(styles.row)}>
            <button
              type="button"
              {...sx(parts.roll)}
              onClick={() => props.actions.roll(repeatLabel(item), repeatNotation(item))}
            >
              {repeatLabel(item)} <span {...sx(parts.dice)}>{item.dice}</span>
            </button>
            <Show when={item.note}>
              <span {...sx(styles.muted)}>{item.note}</span>
            </Show>
          </span>
        )}
      </For>
    </div>
  );
}

export function RollsEditor(props: PartEditorProps<"rolls">) {
  return (
    <ItemRows
      title={`${props.label} rolls`}
      items={props.part.items}
      columns={[
        { key: "label", label: "Label" },
        { key: "dice", label: "Dice", placeholder: "3d6", required: true },
        { key: "times", label: "×", kind: "number", width: "52px", placeholder: "1" },
        { key: "note", label: "Note", placeholder: "optional" },
      ]}
      onChange={(items) => props.onChange({ ...props.part, items })}
      make={() => ({ label: "Roll", dice: "1d6" })}
    />
  );
}
