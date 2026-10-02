import * as stylex from "@stylexjs/stylex";
import { For, Show, createSignal } from "solid-js";
import { allBlocks } from "../../domain/layout-edit";
import type { SheetLayout, SheetValues } from "../../domain/sheet-layout";
import { colors, fontSize, space } from "../../theme/tokens.stylex";
import { sx } from "../../theme/sx";
import { e, ListInput, TextInput } from "../editor-kit";
import { parts } from "./parts.stylex";
import type { PartEditorProps, PartViewProps } from "./types";

/** A stat, field or tracker key the part can place onto, in sheet order. */
export type AssignTarget = { key: string; label: string; tracker: boolean };

export const assignTargets = (layout: SheetLayout): AssignTarget[] =>
  allBlocks(layout).flatMap((block): AssignTarget[] => {
    if (block.type === "stats" || block.type === "fields")
      return block.items.map((item) => ({ key: item.key, label: item.label, tracker: false }));
    if (block.type === "trackers")
      return block.items.map((item) => ({ key: item.key, label: item.label, tracker: true }));
    return [];
  });

/**
 * Which chips are already used: each target's current value uses up one equal
 * chip (compared as text, so 15 and "15" match). Derived on every render from
 * the character's values — never stored.
 */
export const usedChips = (
  values: readonly (number | string)[],
  placed: readonly unknown[],
): boolean[] => {
  const used = values.map(() => false);
  for (const current of placed) {
    if (current === undefined || current === null || Array.isArray(current)) continue;
    if (typeof current === "string" && !current.trim()) continue;
    const at = values.findIndex((chip, index) => !used[index] && String(chip) === String(current));
    if (at >= 0) used[at] = true;
  }
  return used;
};

const displayOf = (value: SheetValues[string] | number | undefined): string =>
  value === undefined ||
  (typeof value === "string" && !value.trim()) ||
  (Array.isArray(value) && !value.length)
    ? "—"
    : String(value);

/**
 * Fixed values placed onto stats, fields and trackers: click (or drag) a chip
 * then a slot. Chips already used are dimmed; anything may still go anywhere —
 * counts are hints, nothing is checked.
 */
export function AssignView(props: PartViewProps<"assign">) {
  const [selected, setSelected] = createSignal<number | null>(null);
  const name = () => (props.part.label?.trim() ? props.part.label : "Place values");
  const targets = () => {
    const wanted = new Set(props.part.targets);
    return assignTargets(props.context.layout).filter((target) => wanted.has(target.key));
  };
  const current = (key: string, tracker: boolean): SheetValues[string] | number | undefined =>
    tracker ? props.context.tracker(key)?.value : props.context.values[key];
  const used = () =>
    usedChips(
      props.part.values,
      targets().map((target) => current(target.key, target.tracker)),
    );

  const place = (key: string, tracker: boolean) => {
    const index = selected();
    if (index === null || props.context.readOnly) return;
    const chip = props.part.values[index];
    if (chip === undefined) return;
    if (tracker) {
      // Trackers count numbers; a non-numeric chip has nothing to write there.
      const value = typeof chip === "number" ? chip : Number(chip);
      if (!Number.isFinite(value)) return;
      props.actions.setTracker(key, value);
      if (props.part.max) props.actions.setTrackerMax(key, value);
    } else {
      props.actions.setValue(key, chip);
    }
    setSelected(null);
  };

  return (
    <div {...sx(a.assign)} role="group" aria-label={name()}>
      <Show when={props.part.label?.trim()}>
        <strong {...sx(parts.label)}>{props.part.label}</strong>
      </Show>
      <div {...sx(parts.rolls)} role="group" aria-label="Values">
        <For each={props.part.values}>
          {(chip, index) => (
            <button
              type="button"
              draggable={props.context.readOnly ? "false" : "true"}
              {...sx(parts.roll, used()[index()] && a.used, selected() === index() && a.picked)}
              aria-pressed={selected() === index() ? "true" : "false"}
              aria-label={`Place ${chip}`}
              disabled={props.context.readOnly}
              onClick={() => setSelected(selected() === index() ? null : index())}
              onDragStart={(event) => {
                setSelected(index());
                event.dataTransfer?.setData("text/plain", String(index()));
              }}
            >
              {String(chip)}
            </button>
          )}
        </For>
      </div>
      <ul {...sx(a.slots)} aria-label="Targets">
        <For each={targets()}>
          {(target) => (
            <li {...sx(a.slotRow)}>
              <button
                type="button"
                {...sx(parts.roll, a.slot)}
                aria-label={`${target.label}: ${displayOf(current(target.key, target.tracker))}`}
                disabled={props.context.readOnly}
                onClick={() => place(target.key, target.tracker)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const index = Number(event.dataTransfer?.getData("text/plain") ?? "");
                  if (Number.isInteger(index) && props.part.values[index] !== undefined)
                    setSelected(index);
                  place(target.key, target.tracker);
                }}
              >
                <span>{target.label}</span>
                <span {...sx(parts.dice)}>{displayOf(current(target.key, target.tracker))}</span>
              </button>
              {/* Trackers count numbers, so they have nothing to clear to. */}
              <Show when={!target.tracker && !props.context.readOnly}>
                <button
                  type="button"
                  {...sx(a.clear)}
                  aria-label={`Clear ${target.label}`}
                  onClick={() => props.actions.setValue(target.key, "")}
                >
                  ×
                </button>
              </Show>
            </li>
          )}
        </For>
      </ul>
      <Show when={selected() !== null && props.part.values[selected()!] !== undefined}>
        <span {...sx(a.hint)}>
          Placing {String(props.part.values[selected()!])} — choose a target.
        </span>
      </Show>
    </div>
  );
}

export function AssignEditor(props: PartEditorProps<"assign">) {
  const targets = () => assignTargets(props.layout);
  return (
    <div {...sx(e.column)}>
      <TextInput
        label="Label (optional)"
        value={props.part.label ?? ""}
        onInput={(label) =>
          props.onChange({ ...props.part, label: label.trim() ? label : undefined })
        }
      />
      <ListInput
        label="Values (comma separated)"
        value={props.part.values}
        placeholder="3, 2, 2, 1, 1"
        onChange={(items) =>
          props.onChange({
            ...props.part,
            values: items.map((item) => (Number.isFinite(Number(item)) ? Number(item) : item)),
          })
        }
      />
      <div {...sx(e.checkList)} role="group" aria-label={`${props.label} targets`}>
        <For each={targets()}>
          {(target) => (
            <label {...sx(e.check)}>
              <input
                type="checkbox"
                checked={props.part.targets.includes(target.key)}
                onChange={(event) => {
                  const picked = new Set(props.part.targets);
                  if (event.currentTarget.checked) picked.add(target.key);
                  else picked.delete(target.key);
                  // Kept in the sheet's own order.
                  props.onChange({
                    ...props.part,
                    targets: targets()
                      .map((item) => item.key)
                      .filter((key) => picked.has(key)),
                  });
                }}
              />
              {target.label}
            </label>
          )}
        </For>
      </div>
      <label {...sx(e.check)}>
        <input
          type="checkbox"
          checked={props.part.max ?? false}
          onChange={(event) =>
            props.onChange({ ...props.part, max: event.currentTarget.checked ? true : undefined })
          }
        />
        Set tracker maximums too
      </label>
    </div>
  );
}

const a = stylex.create({
  assign: { display: "flex", flexDirection: "column", gap: space.x2 },
  used: { opacity: 0.4 },
  picked: { borderColor: colors.accent },
  slots: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: space.x1,
  },
  slotRow: { display: "flex", alignItems: "center", gap: space.x1 },
  slot: { flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center" },
  clear: {
    flexShrink: 0,
    width: "22px",
    height: "22px",
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: colors.textMuted,
    fontSize: fontSize.caption,
    cursor: "pointer",
  },
  hint: { fontSize: fontSize.caption, color: colors.textMuted },
});
