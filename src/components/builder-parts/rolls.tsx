import { For } from "solid-js";
import { sx } from "../../theme/sx";
import { ItemRows } from "../editor-kit";
import { parts } from "./parts.stylex";
import type { PartEditorProps, PartViewProps } from "./types";

/** Roll buttons: each posts to chat; nothing a roll lands on is written to the character. */
export function RollsView(props: PartViewProps<"rolls">) {
  return (
    <div {...sx(parts.rolls)} role="group" aria-label="Rolls">
      <For each={props.part.items}>
        {(item) => (
          <button
            type="button"
            {...sx(parts.roll)}
            onClick={() => props.actions.roll(item.label, item.dice)}
          >
            {item.label} <span {...sx(parts.dice)}>{item.dice}</span>
          </button>
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
      ]}
      onChange={(items) => props.onChange({ ...props.part, items })}
      make={() => ({ label: "Roll", dice: "1d6" })}
    />
  );
}
