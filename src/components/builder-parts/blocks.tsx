import { For } from "solid-js";
import { allBlocks } from "../../domain/layout-edit";
import { sx } from "../../theme/sx";
import { e, summarize } from "../editor-kit";
import type { PartEditorProps, PartViewProps } from "./types";

/** Some of the sheet's own blocks, edited as on the sheet. */
export function BlocksView(props: PartViewProps<"blocks">) {
  return <>{props.renderBlocks(props.part.blocks)}</>;
}

export function BlocksEditor(props: PartEditorProps<"blocks">) {
  return (
    <div {...sx(e.checkList)} role="group" aria-label={`${props.label} blocks`}>
      <For each={allBlocks(props.layout).filter((block) => block.type !== "group")}>
        {(block) => (
          <label {...sx(e.check)}>
            <input
              type="checkbox"
              checked={props.part.blocks.includes(block.id)}
              onChange={(event) => {
                const ids = new Set(props.part.blocks);
                if (event.currentTarget.checked) ids.add(block.id);
                else ids.delete(block.id);
                // Shown in the sheet's own order.
                props.onChange({
                  ...props.part,
                  blocks: allBlocks(props.layout)
                    .map((item) => item.id)
                    .filter((id) => ids.has(id)),
                });
              }}
            />
            {summarize(block)}
          </label>
        )}
      </For>
    </div>
  );
}
