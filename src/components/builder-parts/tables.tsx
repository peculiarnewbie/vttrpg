import { For, Show } from "solid-js";
import { referencedIds } from "../../domain/builder";
import { sx } from "../../theme/sx";
import { TextInput } from "../editor-kit";
import { EmptyState } from "../ui";
import { FromPicker, fromLabel } from "./from-picker";
import { parts } from "./parts.stylex";
import type { PartEditorProps, PartViewProps } from "./types";

/** Oracle tables to roll while building — the result goes to chat; players write what they keep. */
export function TablesView(props: PartViewProps<"tables">) {
  const compendium = () => props.context.compendium;
  const ids = () =>
    props.part.from
      ? compendium()
        ? referencedIds(props.part.from, props.context.values, compendium()!.entry)
        : undefined
      : [...(props.part.entries ?? [])];
  const buttons = () =>
    (ids() ?? []).flatMap((id) => {
      const row = compendium()?.row(id);
      const oracles = row
        ? (compendium()?.typeById(row.typeId)?.fields ?? []).filter(
            (field) => field.kind === "oracle",
          )
        : [];
      return oracles.map((field) => ({
        id,
        field: field.key,
        label: oracles.length > 1 ? `${row!.name} · ${field.label}` : row!.name,
      }));
    });
  return (
    <Show when={props.actions.rollTable}>
      <Show
        when={ids() !== undefined}
        fallback={
          <EmptyState>
            Choose a {fromLabel(props.context, props.part.from!.entry)} to see its tables.
          </EmptyState>
        }
      >
        <div {...sx(parts.rolls)} role="group" aria-label="Tables">
          <For each={buttons()}>
            {(item) => (
              <button
                type="button"
                {...sx(parts.roll)}
                onClick={() => props.actions.rollTable?.(item.id, item.field)}
              >
                {item.label}
              </button>
            )}
          </For>
        </div>
      </Show>
    </Show>
  );
}

export function TablesEditor(props: PartEditorProps<"tables">) {
  return (
    <>
      <FromPicker
        label="Tables from"
        none="These entries"
        value={props.part.from}
        layout={props.layout}
        entryTypes={props.entryTypes}
        onChange={(from) =>
          props.onChange(
            from
              ? { ...props.part, from, entries: undefined }
              : { ...props.part, from: undefined, entries: [] },
          )
        }
      />
      <Show when={!props.part.from}>
        <TextInput
          label="Table entry ids (comma separated)"
          value={(props.part.entries ?? []).join(", ")}
          onInput={(text) =>
            props.onChange({
              ...props.part,
              entries: text
                .split(",")
                .map((id) => id.trim())
                .filter(Boolean),
            })
          }
        />
      </Show>
    </>
  );
}
