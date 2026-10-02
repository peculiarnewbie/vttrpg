import * as stylex from "@stylexjs/stylex";
import type { JSX } from "@solidjs/web";
import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js";
import type { CompendiumStore } from "../client/compendium-store";
import { chooseEntryType, chooseTarget, listBlockOf, referencedIds } from "../domain/builder";
import type { CompendiumEntry, IndexRow } from "../domain/compendium";
import { rowFromEntry } from "../domain/compendium-rows";
import { searchEntries } from "../domain/compendium-search";
import { acceptedFills, fillOffers, type FillOffer } from "../domain/entry-fill";
import type { BuilderPart, ListRow, SheetLayout, SheetValues } from "../domain/sheet-layout";
import { colors, fontSize, fonts, space } from "../theme/tokens.stylex";
import { sx } from "../theme/sx";
import { EntryCard } from "./compendium";
import type { CompendiumLookup } from "./sheet-blocks";
import { styles } from "./styles.stylex";
import { Button, EmptyState } from "./ui";

/*
 * A step-by-step way to fill in the same character the sheet edits — another
 * frontend over the same values, not a second system. It writes only on an
 * explicit edit (typing, choosing, accepting an offer); its rolls and table
 * rolls go to chat like any roll and never land on the sheet, so opening it on
 * a finished character can't change anything by accident. Steps can be taken
 * in any order and skipped; counts are hints, nothing is checked.
 */

export type BuilderCompendium = CompendiumLookup & Pick<CompendiumStore, "rowByName">;

type Props = {
  layout: SheetLayout;
  values: SheetValues;
  readOnly?: boolean;
  compendium?: BuilderCompendium;
  /** The step's sheet blocks, rendered as on the sheet (in edit mode). */
  renderBlocks: (ids: readonly string[]) => JSX.Element;
  onChange: (key: string, value: SheetValues[string]) => void;
  onRoll: (label: string, dice: string) => void;
  onRollTable?: (entryId: string, field: string) => void;
  onOpenEntry?: (entryId: string) => void;
};

export function CharacterBuilder(props: Props) {
  const steps = () => props.layout.builder?.steps ?? [];
  const [index, setIndex] = createSignal(0);
  const step = () => steps()[Math.min(index(), steps().length - 1)];
  return (
    <section {...sx(b.builder)} aria-label="Character builder">
      <nav {...sx(b.steps)} aria-label="Builder steps">
        <For each={steps()}>
          {(item, position) => (
            <button
              type="button"
              {...sx(b.stepButton, position() === index() && b.stepCurrent)}
              aria-current={position() === index() ? "step" : undefined}
              onClick={() => setIndex(position())}
            >
              <span {...sx(b.stepNumber)}>{position() + 1}</span>
              {item.title || `Step ${position() + 1}`}
            </button>
          )}
        </For>
      </nav>
      <Show when={step()}>
        {(current) => (
          <div {...sx(b.body)}>
            <h3 {...sx(b.title)}>{current().title || `Step ${index() + 1}`}</h3>
            <Show when={current().hint}>
              <p {...sx(styles.muted, b.hint)}>{current().hint}</p>
            </Show>
            <For each={current().parts}>{(part) => <Part part={part} {...props} />}</For>
            <div {...sx(styles.row)}>
              <Show when={index() > 0}>
                <Button small onClick={() => setIndex(index() - 1)}>
                  ← Back
                </Button>
              </Show>
              <div {...sx(styles.spacer)} />
              <Show when={index() < steps().length - 1}>
                <Button small onClick={() => setIndex(index() + 1)}>
                  Next →
                </Button>
              </Show>
            </div>
          </div>
        )}
      </Show>
    </section>
  );
}

function Part(props: Props & { part: BuilderPart }) {
  return (
    <Switch>
      <Match when={props.part.type === "blocks" && props.part}>
        {(part) => props.renderBlocks(part().blocks)}
      </Match>
      <Match when={props.part.type === "choose" && props.part}>
        {(part) => <ChoosePart {...props} part={part()} />}
      </Match>
      <Match when={props.part.type === "rolls" && props.part}>
        {(part) => (
          <div {...sx(b.rolls)} role="group" aria-label="Rolls">
            <For each={part().items}>
              {(item) => (
                <button
                  type="button"
                  {...sx(b.roll)}
                  onClick={() => props.onRoll(item.label, item.dice)}
                >
                  {item.label} <span {...sx(b.dice)}>{item.dice}</span>
                </button>
              )}
            </For>
          </div>
        )}
      </Match>
      <Match when={props.part.type === "tables" && props.part}>
        {(part) => <TablesPart {...props} part={part()} />}
      </Match>
    </Switch>
  );
}

/** "Choose a Knight first" — the entry block a part reads from, by its label. */
const fromLabel = (props: Props, key: string) => {
  const target = chooseTarget(props.layout, key);
  if (target?.type !== "entry") return key;
  return target.label ?? props.compendium?.typeById(target.entryType)?.name ?? key;
};

function ChoosePart(props: Props & { part: Extract<BuilderPart, { type: "choose" }> }) {
  const target = () => chooseTarget(props.layout, props.part.key);
  const type = () => {
    const current = target();
    return current ? props.compendium?.typeById(chooseEntryType(current)) : undefined;
  };
  const fromIds = () =>
    props.part.from && props.compendium
      ? referencedIds(props.part.from, props.values, props.compendium.entry)
      : undefined;
  const options = createMemo((): readonly IndexRow[] => {
    const lookup = props.compendium;
    const current = target();
    if (!lookup || !current) return [];
    if (props.part.from) return (fromIds() ?? []).flatMap((id) => lookup.row(id) ?? []);
    return lookup.rowsOfType(chooseEntryType(current));
  });
  const [query, setQuery] = createSignal("");
  const [focused, setFocused] = createSignal<string | null>(null);
  const [offers, setOffers] = createSignal<{ name: string; offers: FillOffer[] } | null>(null);
  const results = () => searchEntries(options(), query()).slice(0, 100);
  const focusedEntry = () => (focused() ? props.compendium?.entry(focused()!) : undefined);
  const focusedType = () => {
    const entry = focusedEntry();
    return entry ? props.compendium?.typeById(entry.typeId) : undefined;
  };
  const rows = () => {
    const value = props.values[props.part.key];
    return Array.isArray(value) ? (value as readonly ListRow[]) : [];
  };
  const chosen = (id: string) => {
    const current = target();
    if (current?.type === "entry") return props.values[current.key] === id;
    return rows().some((row) => row._entry === id);
  };
  const chosenName = () => {
    const current = target();
    if (current?.type !== "entry") return undefined;
    const id = props.values[current.key];
    return typeof id === "string" && id ? (props.compendium?.row(id)?.name ?? id) : undefined;
  };

  const choose = (entry: CompendiumEntry) => {
    const current = target();
    if (!current) return;
    if (current.type === "entry") {
      props.onChange(current.key, entry.id);
      // The same offer the sheet makes: copy the entry's lists, only if asked.
      const offered = fillOffers(
        entry,
        current,
        (key) => listBlockOf(props.layout, key),
        props.values,
      );
      setOffers(offered.length ? { name: entry.name, offers: offered } : null);
    } else props.onChange(current.key, [...rows(), rowFromEntry(entry, current.columns)]);
  };
  const accept = () => {
    for (const [key, value] of acceptedFills(offers()?.offers ?? [], props.values))
      props.onChange(key, value);
    setOffers(null);
  };

  return (
    <Show when={target() && type()}>
      {(current) => (
        <div {...sx(b.choose)} role="group" aria-label={current().plural ?? current().name}>
          <div {...sx(styles.row)}>
            <strong {...sx(b.label)}>{current().plural ?? current().name}</strong>
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
              <div {...sx(b.offer)} role="status">
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
              <EmptyState>Choose a {fromLabel(props, props.part.from!.entry)} first.</EmptyState>
            }
          >
            <input
              type="search"
              {...sx(styles.input, b.search)}
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
              <ul {...sx(b.options)} aria-label="Options">
                <For each={results()}>
                  {(row) => (
                    <li>
                      <button
                        type="button"
                        {...sx(b.option, focused() === row.id && b.optionFocused)}
                        aria-pressed={focused() === row.id ? "true" : "false"}
                        onClick={() => setFocused(row.id)}
                      >
                        <span>{row.name}</span>
                        <Show when={chosen(row.id)}>
                          <span {...sx(b.mark)}>✓</span>
                        </Show>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <Show when={focusedEntry() && focusedType() ? focusedEntry() : undefined}>
              {(entry) => (
                <div {...sx(b.preview)}>
                  <Show when={!props.readOnly}>
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
                    compendium={props.compendium}
                    onRoll={props.onRoll}
                    onRollTable={props.onRollTable}
                    onOpenEntry={props.onOpenEntry}
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

/** Oracle tables to roll while building — the result goes to chat; players write what they keep. */
function TablesPart(props: Props & { part: Extract<BuilderPart, { type: "tables" }> }) {
  const ids = () =>
    props.part.from
      ? props.compendium
        ? referencedIds(props.part.from, props.values, props.compendium.entry)
        : undefined
      : [...(props.part.entries ?? [])];
  const buttons = () =>
    (ids() ?? []).flatMap((id) => {
      const row = props.compendium?.row(id);
      const oracles = row
        ? (props.compendium?.typeById(row.typeId)?.fields ?? []).filter(
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
    <Show when={props.onRollTable}>
      <Show
        when={ids() !== undefined}
        fallback={
          <EmptyState>
            Choose a {fromLabel(props, props.part.from!.entry)} to see its tables.
          </EmptyState>
        }
      >
        <div {...sx(b.rolls)} role="group" aria-label="Tables">
          <For each={buttons()}>
            {(item) => (
              <button
                type="button"
                {...sx(b.roll)}
                onClick={() => props.onRollTable?.(item.id, item.field)}
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

const b = stylex.create({
  builder: { display: "flex", flexDirection: "column", gap: space.x3 },
  steps: { display: "flex", flexWrap: "wrap", gap: space.x1 },
  stepButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.x1,
    paddingBlock: "2px",
    paddingInline: space.x2,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: "transparent",
    color: colors.textMuted,
    fontSize: fontSize.caption,
    cursor: "pointer",
  },
  stepCurrent: { borderColor: colors.accent, color: colors.text },
  stepNumber: { fontFamily: fonts.numeric, color: colors.accent },
  body: { display: "flex", flexDirection: "column", gap: space.x2 },
  title: { margin: 0, fontSize: fontSize.subheading },
  hint: { whiteSpace: "pre-wrap" },
  label: { fontSize: fontSize.caption },
  rolls: { display: "flex", flexWrap: "wrap", gap: space.x1 },
  roll: {
    paddingBlock: "2px",
    paddingInline: space.x2,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: fontSize.caption,
    cursor: "pointer",
  },
  dice: { color: colors.accent, fontFamily: fonts.numeric },
  choose: { display: "flex", flexDirection: "column", gap: space.x2 },
  search: { width: "100%" },
  options: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    maxHeight: "180px",
    overflowY: "auto",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
  },
  option: {
    display: "flex",
    width: "100%",
    justifyContent: "space-between",
    paddingBlock: "3px",
    paddingInline: space.x2,
    borderWidth: 0,
    borderBottomWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 0,
    boxShadow: "none",
    backgroundColor: "transparent",
    color: colors.text,
    textAlign: "start",
    fontSize: fontSize.caption,
    cursor: "pointer",
  },
  optionFocused: { backgroundColor: colors.surfaceHover },
  mark: { color: colors.accent },
  offer: {
    display: "flex",
    flexDirection: "column",
    gap: space.x1,
    padding: space.x2,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.accent,
    fontSize: fontSize.caption,
  },
  preview: { display: "flex", flexDirection: "column", gap: space.x2 },
});
