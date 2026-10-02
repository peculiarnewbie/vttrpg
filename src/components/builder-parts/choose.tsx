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
import { formulaRefs, type RefSuggestion } from "../../domain/formula-help";
import type { ListRow } from "../../domain/sheet-layout";
import { sx } from "../../theme/sx";
import { EntryCard } from "../compendium";
import { e, ListInput } from "../editor-kit";
import { FormulaInput } from "../formula-input";
import { styles } from "../styles.stylex";
import { Button, EmptyState } from "../ui";
import { addedCount, offeredOptions, withoutEntry } from "./choose-filter";
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
  // Tags and the filter narrow the index rows; full entries are never loaded to filter.
  const offered = () => offeredOptions(options(), props.part, props.context.scope());
  const [query, setQuery] = createSignal("");
  const [focused, setFocused] = createSignal<string | null>(null);
  const [offers, setOffers] = createSignal<{ name: string; offers: FillOffer[] } | null>(null);
  const results = () => searchEntries(offered(), query()).slice(0, 100);
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
  // A hint, never a gate: an entry pick counts 1 when chosen, a list its rows.
  const picked = () => {
    const current = target();
    if (!current) return 0;
    if (current.type === "entry") {
      const id = values()[current.key];
      return typeof id === "string" && id ? 1 : 0;
    }
    return rows().length;
  };
  // Lists can hold the same entry several times; entries show the same ✓ as before.
  const mark = (id: string): string | undefined => {
    if (target()?.type === "entry") return chosen(id) ? "✓" : undefined;
    const n = addedCount(rows(), id);
    return n > 1 ? `✓ added ×${n}` : n ? "✓ added" : undefined;
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
  // Explicit removal only: every row copied from this entry, by `_entry`.
  const remove = (id: string) => {
    const current = target();
    if (current?.type !== "list") return;
    props.actions.setValue(current.key, withoutEntry(rows(), id));
  };

  return (
    <Show when={target() && type()}>
      {(current) => (
        <div {...sx(parts.choose)} role="group" aria-label={current().plural ?? current().name}>
          <div {...sx(styles.row)}>
            <strong {...sx(parts.label)}>{current().plural ?? current().name}</strong>
            <Show when={props.part.pick}>
              <span {...sx(styles.muted)}>
                Picked {picked()} of {props.part.pick}
              </span>
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
                        <Show when={mark(row.id)}>
                          {(text) => <span {...sx(parts.mark)}>{text()}</span>}
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
                          <div {...sx(styles.row)}>
                            <Button small variant="primary" onClick={() => choose(entry())}>
                              Add {entry().name}
                            </Button>
                            <Show when={addedCount(rows(), entry().id) > 0}>
                              <Button small onClick={() => remove(entry().id)}>
                                Remove {entry().name}
                              </Button>
                            </Show>
                          </div>
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
  /** The option's fields as `@key` first, then everything the sheet offers. */
  const filterSuggestions = (): readonly RefSuggestion[] => {
    const target = chooseTarget(props.layout, props.part.key);
    const type = target
      ? props.entryTypes.find((item) => item.id === chooseEntryType(target))
      : undefined;
    const seen = new Set<string>();
    const refs: RefSuggestion[] = [];
    for (const field of type?.fields ?? []) {
      const text = /^[A-Za-z_][A-Za-z0-9_]*$/.test(field.key) ? `@${field.key}` : `@{${field.key}}`;
      if (!seen.has(text)) {
        seen.add(text);
        refs.push({ text, label: field.label, detail: "option field" });
      }
    }
    for (const ref of formulaRefs(props.layout)) {
      if (!seen.has(ref.text)) {
        seen.add(ref.text);
        refs.push(ref);
      }
    }
    return refs;
  };

  const setTags = (key: "all" | "any" | "none", list: readonly string[]) => {
    const tags = { ...props.part.tags };
    if (list.length) tags[key] = list;
    else delete tags[key];
    props.onChange({ ...props.part, tags: (tags.all ?? tags.any ?? tags.none) ? tags : undefined });
  };

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
      <label {...sx(e.field)}>
        Only offer while
        <FormulaInput
          label={`${props.label} only offer while`}
          value={props.part.filter ?? ""}
          placeholder="@level <= 2"
          suggestions={filterSuggestions()}
          onInput={(value) =>
            props.onChange({ ...props.part, filter: value.trim() ? value : undefined })
          }
        />
      </label>
      <span {...sx(e.hint)}>
        Refs read the option (its name, tag count, and field values) and anything else the sheet.
        Tags below match the option's entry tags.
      </span>
      <div {...sx(e.bar)}>
        <ListInput
          label="Tags all"
          placeholder="comma separated"
          value={props.part.tags?.all ?? []}
          onChange={(list) => setTags("all", list)}
        />
        <ListInput
          label="Tags any"
          placeholder="comma separated"
          value={props.part.tags?.any ?? []}
          onChange={(list) => setTags("any", list)}
        />
        <ListInput
          label="Tags none"
          placeholder="comma separated"
          value={props.part.tags?.none ?? []}
          onChange={(list) => setTags("none", list)}
        />
      </div>
    </>
  );
}
