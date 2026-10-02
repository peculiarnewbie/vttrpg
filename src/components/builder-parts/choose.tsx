import { For, Show, createMemo, createSignal } from "solid-js";
import {
  chooseEntryType,
  chooseKeys,
  chooseTarget,
  listBlockOf,
  referencedIds,
} from "../../domain/builder";
import type { CompendiumEntry, IndexRow } from "../../domain/compendium";
import { rowFromEntry } from "../../domain/compendium-rows";
import { searchEntries } from "../../domain/compendium-search";
import { acceptedFills, fillOffers, type FillOffer } from "../../domain/entry-fill";
import type { ListRow } from "../../domain/sheet-layout";
import { sx } from "../../theme/sx";
import { EntryCard } from "../compendium";
import { e } from "../editor-kit";
import { styles } from "../styles.stylex";
import { Button, EmptyState } from "../ui";
import { FromPicker, fromLabel } from "./from-picker";
import { parts } from "./parts.stylex";
import type { PartEditorProps, PartViewProps } from "./types";

/**
 * Choose from the compendium into an entry block (one pick) or a
 * compendium-fed list (rows added): a searchable list with a readable
 * preview, then the same "Add its Property?" offer the sheet makes.
 */
export function ChooseView(props: PartViewProps<"choose">) {
  const layout = () => props.context.layout;
  const values = () => props.context.values;
  const compendium = () => props.context.compendium;
  const target = () => chooseTarget(layout(), props.part.key);
  const type = () => {
    const current = target();
    return current ? compendium()?.typeById(chooseEntryType(current)) : undefined;
  };
  const fromIds = () =>
    props.part.from && compendium()
      ? referencedIds(props.part.from, values(), compendium()!.entry)
      : undefined;
  const options = createMemo((): readonly IndexRow[] => {
    const lookup = compendium();
    const current = target();
    if (!lookup || !current) return [];
    if (props.part.from) return (fromIds() ?? []).flatMap((id) => lookup.row(id) ?? []);
    return lookup.rowsOfType(chooseEntryType(current));
  });
  const [query, setQuery] = createSignal("");
  const [focused, setFocused] = createSignal<string | null>(null);
  const [offers, setOffers] = createSignal<{ name: string; offers: FillOffer[] } | null>(null);
  const results = () => searchEntries(options(), query()).slice(0, 100);
  const focusedEntry = () => (focused() ? compendium()?.entry(focused()!) : undefined);
  const focusedType = () => {
    const entry = focusedEntry();
    return entry ? compendium()?.typeById(entry.typeId) : undefined;
  };
  const rows = () => {
    const value = values()[props.part.key];
    return Array.isArray(value) ? (value as readonly ListRow[]) : [];
  };
  const chosen = (id: string) => {
    const current = target();
    if (current?.type === "entry") return values()[current.key] === id;
    return rows().some((row) => row._entry === id);
  };
  const chosenName = () => {
    const current = target();
    if (current?.type !== "entry") return undefined;
    const id = values()[current.key];
    return typeof id === "string" && id ? (compendium()?.row(id)?.name ?? id) : undefined;
  };

  const choose = (entry: CompendiumEntry) => {
    const current = target();
    if (!current) return;
    if (current.type === "entry") {
      props.actions.setValue(current.key, entry.id);
      // The same offer the sheet makes: copy the entry's lists, only if asked.
      const offered = fillOffers(entry, current, (key) => listBlockOf(layout(), key), values());
      setOffers(offered.length ? { name: entry.name, offers: offered } : null);
    } else props.actions.setValue(current.key, [...rows(), rowFromEntry(entry, current.columns)]);
  };
  const accept = () => {
    for (const [key, value] of acceptedFills(offers()?.offers ?? [], values()))
      props.actions.setValue(key, value);
    setOffers(null);
  };

  return (
    <Show when={target() && type()}>
      {(current) => (
        <div {...sx(parts.choose)} role="group" aria-label={current().plural ?? current().name}>
          <div {...sx(styles.row)}>
            <strong {...sx(parts.label)}>{current().plural ?? current().name}</strong>
            <Show when={props.part.pick}>
              <span {...sx(styles.muted)}>Pick {props.part.pick}</span>
            </Show>
            <div {...sx(styles.spacer)} />
            <Show when={chosenName()}>
              <span {...sx(styles.muted)}>Chosen: {chosenName()}</span>
            </Show>
          </div>
          <Show when={offers()}>
            {(offer) => (
              <div {...sx(parts.offer)} role="status">
                <span>
                  Add {offer().name}'s{" "}
                  {offer()
                    .offers.map((item) => `${item.title} (${item.rows.length})`)
                    .join(", ")}{" "}
                  to the sheet?
                </span>
                <div {...sx(styles.row)}>
                  <Button small variant="primary" onClick={accept}>
                    Add
                  </Button>
                  <Button small onClick={() => setOffers(null)}>
                    No thanks
                  </Button>
                </div>
              </div>
            )}
          </Show>
          <Show
            when={!props.part.from || fromIds() !== undefined}
            fallback={
              <EmptyState>
                Choose a {fromLabel(props.context, props.part.from!.entry)} first.
              </EmptyState>
            }
          >
            <input
              type="search"
              {...sx(styles.input, parts.search)}
              aria-label={`Search ${(current().plural ?? current().name).toLowerCase()}`}
              placeholder="Search…"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
            <Show
              when={results().length}
              fallback={
                <EmptyState>
                  No {(current().plural ?? current().name).toLowerCase()} to choose from.
                </EmptyState>
              }
            >
              <ul {...sx(parts.options)} aria-label="Options">
                <For each={results()}>
                  {(row) => (
                    <li>
                      <button
                        type="button"
                        {...sx(parts.option, focused() === row.id && parts.optionFocused)}
                        aria-pressed={focused() === row.id ? "true" : "false"}
                        onClick={() => setFocused(row.id)}
                      >
                        <span>{row.name}</span>
                        <Show when={chosen(row.id)}>
                          <span {...sx(parts.mark)}>✓</span>
                        </Show>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <Show when={focusedEntry() && focusedType() ? focusedEntry() : undefined}>
              {(entry) => (
                <div {...sx(parts.preview)}>
                  <Show when={!props.context.readOnly}>
                    <div {...sx(styles.row)}>
                      <Show
                        when={target()?.type === "entry"}
                        fallback={
                          <Button small variant="primary" onClick={() => choose(entry())}>
                            Add {entry().name}
                          </Button>
                        }
                      >
                        <Button
                          small
                          variant="primary"
                          disabled={chosen(entry().id)}
                          onClick={() => choose(entry())}
                        >
                          {chosen(entry().id) ? "Chosen" : `Choose ${entry().name}`}
                        </Button>
                      </Show>
                    </div>
                  </Show>
                  <EntryCard
                    entry={entry()}
                    type={focusedType()!}
                    compendium={compendium()}
                    onRoll={props.actions.roll}
                    onRollTable={props.actions.rollTable}
                    onOpenEntry={props.actions.openEntry}
                  />
                </div>
              )}
            </Show>
          </Show>
        </div>
      )}
    </Show>
  );
}

export function ChooseEditor(props: PartEditorProps<"choose">) {
  return (
    <>
      <div {...sx(e.bar)}>
        <label {...sx(e.field)}>
          Into
          <select
            {...sx(styles.select, e.small)}
            value={props.part.key}
            onChange={(event) => props.onChange({ ...props.part, key: event.currentTarget.value })}
          >
            <For each={chooseKeys(props.layout)}>
              {(item) => (
                <option value={item.key} selected={item.key === props.part.key}>
                  {item.label}
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
      <FromPicker
        label="Options from"
        none="Every entry of its type"
        value={props.part.from}
        layout={props.layout}
        entryTypes={props.entryTypes}
        onChange={(from) => props.onChange({ ...props.part, from })}
      />
    </>
  );
}
