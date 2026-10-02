import * as stylex from "@stylexjs/stylex";
import { For, Show, createMemo } from "solid-js";
import type { SheetLayout } from "../../domain/sheet-layout";
import { colors, fontSize, fonts, space } from "../../theme/tokens.stylex";
import { sx } from "../../theme/sx";
import { e, TextInput } from "../editor-kit";
import { styles } from "../styles.stylex";
import { parts } from "./parts.stylex";
import type { BuilderActions, BuilderContext, PartEditorProps, PartViewProps } from "./types";

/*
 * Scores: set numbers — a tracker's current value, or a plain stat. With
 * "Set the maximum too" a tracker also takes the number as its maximum, as a
 * draft like Edit's (saved with Done, dropped by Cancel). Counts are hints;
 * nothing here is checked or clamped beyond what setTracker already does.
 */

/** Every tracker and stat item in the layout, in sheet order. */
const scoreFields = (
  layout: SheetLayout,
): { key: string; label: string; kind: "tracker" | "stat" }[] =>
  layout.pages.flatMap((page) =>
    page.blocks.flatMap((block) => {
      const blocks = block.type === "group" ? block.blocks : [block];
      return blocks.flatMap((inner): { key: string; label: string; kind: "tracker" | "stat" }[] =>
        inner.type === "trackers"
          ? inner.items.map((item) => ({
              key: item.key,
              label: item.label,
              kind: "tracker" as const,
            }))
          : inner.type === "stats"
            ? inner.items.map((item) => ({
                key: item.key,
                label: item.label,
                kind: "stat" as const,
              }))
            : [],
      );
    }),
  );

const s = stylex.create({
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))",
    gap: space.x2,
  },
  field: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
  value: { fontFamily: fonts.numeric, fontSize: fontSize.caption, color: colors.textMuted },
});

/** A number input that reports its value when you leave it (or press Enter), not per keystroke. */
function NumberInput(props: {
  label: string;
  value: string | number;
  numeric: boolean;
  disabled: boolean;
  onCommit: (text: string) => void;
}) {
  // Memoized, so an update elsewhere on the character leaves the input alone:
  // Solid re-applies all of an element's dynamic attributes when one of them
  // re-runs, and rewriting `value` would clear what's typed here and not yet
  // committed.
  const value = createMemo(() => props.value);
  const type = createMemo(() => (props.numeric ? "number" : "text"));
  return (
    <input
      {...sx(styles.input)}
      aria-label={props.label}
      type={type()}
      value={value()}
      disabled={props.disabled}
      onChange={(event) => props.onCommit(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

function ScoreInput(props: {
  item: { key: string; label?: string };
  sheet?: { label: string };
  max: boolean;
  context: BuilderContext;
  actions: BuilderActions;
}) {
  const tracker = () => props.context.tracker(props.item.key);
  const label = () => props.item.label ?? props.sheet?.label ?? props.item.key;
  const raw = (): string | number => {
    const tick = tracker();
    if (tick) return tick.value;
    const value = props.context.values[props.item.key];
    return typeof value === "string" || typeof value === "number" ? value : "";
  };
  // Only an explicit commit writes; tracker values are whole numbers, stats
  // keep whatever number was typed.
  const commit = (text: string) => {
    if (!text.trim()) return;
    const n = Number(text);
    if (!Number.isFinite(n)) return;
    if (tracker()) {
      const value = Math.trunc(n);
      props.actions.setTracker(props.item.key, value);
      if (props.max) props.actions.setTrackerMax(props.item.key, value);
    } else props.actions.setValue(props.item.key, n);
  };
  return (
    <div {...sx(s.field)}>
      <span {...sx(parts.label)}>{label()}</span>
      <Show when={tracker()}>
        {(tick) => (
          <span {...sx(s.value)}>
            {tick().value}/{tick().max}
          </span>
        )}
      </Show>
      <NumberInput
        label={label()}
        value={raw()}
        numeric={tracker() !== undefined || typeof raw() !== "string"}
        disabled={props.context.readOnly}
        onCommit={commit}
      />
    </div>
  );
}

export function ScoresView(props: PartViewProps<"scores">) {
  const fields = () => {
    const byKey = new Map(scoreFields(props.context.layout).map((field) => [field.key, field]));
    return props.part.items.map((item) => ({ item, sheet: byKey.get(item.key) }));
  };
  return (
    <Show
      when={fields().length}
      fallback={<p {...sx(styles.muted)}>No scores in this step yet.</p>}
    >
      <div {...sx(s.grid)} role="group" aria-label="Scores">
        <For each={fields()}>
          {({ item, sheet }) => (
            <ScoreInput
              item={item}
              sheet={sheet}
              max={props.part.max ?? false}
              context={props.context}
              actions={props.actions}
            />
          )}
        </For>
      </div>
      <Show when={props.part.max}>
        <p {...sx(styles.muted)}>Sets the maximum too (saved with Done)</p>
      </Show>
    </Show>
  );
}

export function ScoresEditor(props: PartEditorProps<"scores">) {
  const fields = () => scoreFields(props.layout);
  const labels = () => new Map(props.part.items.map((item) => [item.key, item.label]));
  const setSelected = (key: string, on: boolean) => {
    const keep = new Set(props.part.items.map((item) => item.key));
    if (on) keep.add(key);
    else keep.delete(key);
    const overrides = labels();
    props.onChange({
      ...props.part,
      // Back in the sheet's own order.
      items: fields().flatMap((field) => {
        if (!keep.has(field.key)) return [];
        const label = overrides.get(field.key);
        return [{ key: field.key, ...(label ? { label } : {}) }];
      }),
    });
  };
  const setLabel = (key: string, text: string) =>
    props.onChange({
      ...props.part,
      items: props.part.items.map((item) =>
        item.key === key ? (text.trim() ? { ...item, label: text } : { key: item.key }) : item,
      ),
    });
  return (
    <div {...sx(e.column)}>
      <div {...sx(e.checkList)} role="group" aria-label={`${props.label} scores`}>
        <Show
          when={fields().length}
          fallback={<span {...sx(e.hint)}>No trackers or stats on the sheet yet.</span>}
        >
          <For each={fields()}>
            {(field) => (
              <label {...sx(e.check)}>
                <input
                  type="checkbox"
                  checked={props.part.items.some((item) => item.key === field.key)}
                  onChange={(event) => setSelected(field.key, event.currentTarget.checked)}
                />
                {field.label} <span {...sx(styles.muted)}>({field.kind})</span>
              </label>
            )}
          </For>
        </Show>
      </div>
      <For each={props.part.items}>
        {(item) => (
          <TextInput
            label={`${fields().find((field) => field.key === item.key)?.label ?? item.key} label`}
            value={item.label ?? ""}
            onInput={(text) => setLabel(item.key, text)}
          />
        )}
      </For>
      <label {...sx(e.check)}>
        <input
          type="checkbox"
          checked={props.part.max ?? false}
          onChange={(event) =>
            props.onChange({ ...props.part, max: event.currentTarget.checked || undefined })
          }
        />
        Set the maximum too
      </label>
    </div>
  );
}
