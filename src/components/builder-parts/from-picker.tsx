import { For, Show } from "solid-js";
import { chooseKeys, chooseTarget } from "../../domain/builder";
import type { EntryType } from "../../domain/compendium";
import { allBlocks } from "../../domain/layout-edit";
import type { SheetLayout } from "../../domain/sheet-layout";
import { sx } from "../../theme/sx";
import { e } from "../editor-kit";
import { styles } from "../styles.stylex";
import type { BuilderContext } from "./types";

/** "Choose a Knight first" — the entry block a part reads from, by its label. */
export const fromLabel = (context: BuilderContext, key: string) => {
  const target = chooseTarget(context.layout, key);
  if (target?.type !== "entry") return key;
  return target.label ?? context.compendium?.typeById(target.entryType)?.name ?? key;
};

const isEntryBlock = (layout: SheetLayout, key: string) =>
  allBlocks(layout).some((block) => block.type === "entry" && block.key === key);

/** "Options from" / "Tables from": an entry block and a reference field of its entry type. */
export function FromPicker(props: {
  label: string;
  value?: { entry: string; field: string };
  layout: SheetLayout;
  entryTypes: readonly EntryType[];
  none: string;
  onChange: (value: { entry: string; field: string } | undefined) => void;
}) {
  const entries = () =>
    chooseKeys(props.layout).filter((item) => isEntryBlock(props.layout, item.key));
  const fields = (key: string) => {
    const typeId = entries().find((item) => item.key === key)?.entryType;
    return (props.entryTypes.find((type) => type.id === typeId)?.fields ?? []).filter(
      (field) => field.kind === "reference",
    );
  };
  return (
    <div {...sx(e.bar)}>
      <label {...sx(e.field)}>
        {props.label}
        <select
          {...sx(styles.select, e.small)}
          value={props.value?.entry ?? ""}
          onChange={(event) => {
            const key = event.currentTarget.value;
            props.onChange(key ? { entry: key, field: fields(key)[0]?.key ?? "" } : undefined);
          }}
        >
          <option value="">{props.none}</option>
          <For each={entries()}>
            {(item) => (
              <option value={item.key} selected={item.key === props.value?.entry}>
                {item.label}
              </option>
            )}
          </For>
        </select>
      </label>
      <Show when={props.value}>
        {(value) => (
          <label {...sx(e.field)}>
            Field
            <select
              {...sx(styles.select, e.small)}
              value={value().field}
              onChange={(event) =>
                props.onChange({ entry: value().entry, field: event.currentTarget.value })
              }
            >
              <For each={fields(value().entry)}>
                {(field) => (
                  <option value={field.key} selected={field.key === value().field}>
                    {field.label}
                  </option>
                )}
              </For>
            </select>
          </label>
        )}
      </Show>
    </div>
  );
}
