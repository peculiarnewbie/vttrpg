import { For, Show } from "solid-js";
import { optionsTarget, optionsTargets } from "../../domain/builder-parts";
import { sx } from "../../theme/sx";
import { ItemRows, ListInput, e } from "../editor-kit";
import { styles } from "../styles.stylex";
import { Button } from "../ui";
import { parts } from "./parts.stylex";
import type { PartEditorProps, PartViewProps } from "./types";

/*
 * Pick from DM-written choices: one value into a field, stat or text block,
 * or ticks on a checks block (which falls back to its own options when the
 * part lists none). Picks and grants are hints and offers — nothing is
 * enforced and nothing is written until the player clicks.
 */
export function OptionsView(props: PartViewProps<"options">) {
  const target = () => optionsTarget(props.context.layout, props.part.key);
  const offered = (): readonly { readonly label: string; readonly note?: string }[] => {
    const current = target();
    if (props.part.options?.length) return props.part.options;
    return current?.kind === "checks" ? current.options.map((label) => ({ label })) : [];
  };
  const value = () => props.context.values[props.part.key];
  const on = (): readonly string[] =>
    Array.isArray(value())
      ? (value() as readonly unknown[]).filter((item): item is string => typeof item === "string")
      : [];
  const isChecks = () => target()?.kind === "checks";
  const chosen = (label: string) => (isChecks() ? on().includes(label) : value() === label);
  // A hint, never a gate: picking past it stays allowed.
  const picked = () => (isChecks() ? on().length : value() === undefined || value() === "" ? 0 : 1);
  const chosenText = () =>
    !isChecks() && (typeof value() === "string" || typeof value() === "number") && value() !== ""
      ? String(value())
      : undefined;

  const pick = (label: string) => {
    if (!target() || props.context.readOnly) return;
    if (isChecks()) {
      const next = on().includes(label) ? on().filter((item) => item !== label) : [...on(), label];
      props.actions.setValue(props.part.key, next);
    } else props.actions.setValue(props.part.key, label);
  };
  // One explicit button for the grants, not an automatic tick.
  const tickGiven = () => {
    if (!isChecks() || props.context.readOnly) return;
    const missing = (props.part.grants ?? []).filter((grant) => !on().includes(grant));
    if (missing.length) props.actions.setValue(props.part.key, [...on(), ...missing]);
  };

  return (
    <Show when={target()}>
      {(current) => (
        <div {...sx(parts.choose)} role="group" aria-label={current().label}>
          <div {...sx(styles.row)}>
            <strong {...sx(parts.label)}>{current().label}</strong>
            <Show when={props.part.pick !== undefined}>
              <span {...sx(styles.muted)}>
                Picked {picked()} of {props.part.pick}
              </span>
            </Show>
            <div {...sx(styles.spacer)} />
            <Show when={chosenText()}>
              <span {...sx(styles.muted)}>Chosen: {chosenText()}</span>
            </Show>
          </div>
          <div {...sx(parts.rolls)}>
            <For each={offered()}>
              {(option) => (
                <button
                  type="button"
                  {...sx(parts.roll, chosen(option.label) && parts.optionFocused)}
                  aria-pressed={chosen(option.label) ? "true" : "false"}
                  disabled={props.context.readOnly}
                  onClick={() => pick(option.label)}
                >
                  {option.label}
                  <Show when={chosen(option.label)}>
                    <span {...sx(parts.mark)}> ✓</span>
                  </Show>
                  <Show when={option.note}>
                    <span {...sx(styles.muted)}> {option.note}</span>
                  </Show>
                </button>
              )}
            </For>
          </div>
          <Show when={isChecks() && (props.part.grants?.length ?? 0) > 0}>
            <div {...sx(styles.row)}>
              <span {...sx(styles.muted)}>Given: {(props.part.grants ?? []).join(", ")}</span>
              <Button small disabled={props.context.readOnly} onClick={tickGiven}>
                Tick given
              </Button>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}

export function OptionsEditor(props: PartEditorProps<"options">) {
  const targets = () => optionsTargets(props.layout);
  const target = () => optionsTarget(props.layout, props.part.key);
  return (
    <>
      <div {...sx(e.bar)}>
        <label {...sx(e.field)}>
          Target
          <select
            {...sx(styles.select, e.small)}
            value={props.part.key}
            onChange={(event) => props.onChange({ ...props.part, key: event.currentTarget.value })}
          >
            <For each={targets()}>
              {(item) => (
                <option value={item.key} selected={item.key === props.part.key}>
                  {item.label === item.key ? item.label : `${item.label} (${item.key})`}
                </option>
              )}
            </For>
          </select>
        </label>
        <label {...sx(e.field)}>
          Pick (hint)
          <input
            {...sx(styles.input, e.small)}
            type="number"
            min="1"
            max="50"
            value={props.part.pick ?? ""}
            onInput={(event) => {
              const pick = Math.trunc(Number(event.currentTarget.value));
              props.onChange({ ...props.part, pick: pick >= 1 && pick <= 50 ? pick : undefined });
            }}
          />
        </label>
      </div>
      <ItemRows
        title={`${props.label} options`}
        items={props.part.options ?? []}
        columns={[
          { key: "label", label: "Label" },
          { key: "note", label: "Note", placeholder: "Why pick it" },
        ]}
        onChange={(options) => props.onChange({ ...props.part, options })}
        make={(): { label: string; note?: string } => ({ label: "Option" })}
      />
      <Show when={target()?.kind === "checks"}>
        <ListInput
          label="Given (checks only, comma separated)"
          value={props.part.grants ?? []}
          onChange={(grants) =>
            props.onChange({ ...props.part, grants: grants.length ? grants : undefined })
          }
        />
      </Show>
    </>
  );
}
