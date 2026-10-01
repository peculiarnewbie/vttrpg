import * as stylex from "@stylexjs/stylex";
import { useSearchParams } from "@solidjs/router";
import type { JSX } from "@solidjs/web";
import { For, Show, createMemo, createSignal } from "solid-js";
import type { CompendiumEntry, EntryType, IndexRow } from "../domain/compendium";
import type { Character, CharacterValue, SheetTemplate, WorldMember } from "../domain/schemas";
import type { ListRow } from "../domain/sheet-layout";
import { librarySource } from "../domain/entry-id";
import { indexEntries, searchIndex } from "../domain/compendium-search";
import { rowFromEntry } from "../domain/compendium-rows";
import { allBlocks } from "../domain/layout-edit";
import {
  facetSummaries,
  matchesFacets,
  sortRows,
  type FacetSelection,
  type FacetSummary,
  type RowSort,
} from "../domain/facets";
import { api } from "../client/api";
import type { CompendiumStore } from "../client/compendium-store";
import { createSearch, type SearchRequest } from "../client/search";
import { createVirtualizer } from "../client/virtual";
import { colors, fontSize, fonts, radii, space } from "../theme/tokens.stylex";
import { sx } from "../theme/sx";
import { EntryCard, EntryEditor } from "./compendium";
import { styles } from "./styles.stylex";
import { Badge, Button, EmptyState, ErrorBanner, Menu, MenuItem } from "./ui";

/*
 * The compendium as a page: every entry this member may see, filtered by an
 * entry type's facets (a spell's level and school), sorted, previewed, and
 * compared side by side. Everything reads the synced index; bodies load only
 * for the entries on screen. The DM curates here too: table overrides and
 * hiding library entries.
 */

const ROW_HEIGHT = 28;

type Target = { character: Character; key: string; label: string; kind: "list" | "entry" };

export function CompendiumBrowser(props: {
  worldId: string;
  isDm: boolean;
  me: WorldMember;
  compendium: CompendiumStore;
  characters: readonly Character[];
  templates: readonly SheetTemplate[];
  search?: SearchRequest;
  onRoll?: (label: string, dice: string) => void;
  onRollTable?: (entryId: string, field: string) => void;
  onShare?: (entry: CompendiumEntry) => void;
  onValue: (characterId: string, key: string, value: CharacterValue) => void;
  /** Panels open over the page's left/right edge; the page leaves room for them. */
  insetLeft?: boolean;
  insetRight?: boolean;
}) {
  const [params, setParams] = useSearchParams<{
    type?: string;
    q?: string;
    entry?: string;
    compare?: string;
  }>();
  const typeId = () => params.type || undefined;
  const query = () => params.q ?? "";
  const [selection, setSelection] = createSignal<FacetSelection>({});
  const [sort, setSort] = createSignal<RowSort>({ by: "name", direction: "asc" });
  const [editing, setEditing] = createSignal(false);
  const [notice, setNotice] = createSignal("");
  const [error, setError] = createSignal("");

  const type = () => (typeId() ? props.compendium.typeById(typeId()!) : undefined);
  const typeName = (id: string) => props.compendium.typeById(id)?.name ?? id;
  const chooseType = (id: string | undefined) => {
    setSelection({});
    setSort({ by: "name", direction: "asc" });
    setParams({ type: id, entry: undefined, compare: undefined });
  };

  // Names and tags match from the index; the server adds matches in entries' text.
  const index = createMemo(() => indexEntries(props.compendium.rows()));
  const remote = props.search ? createSearch({ request: props.search, limit: 50 }) : undefined;
  const searched = createMemo(() => {
    const scope = typeId() ? props.compendium.rowsOfType(typeId()!) : props.compendium.rows();
    if (!query().trim()) return scope;
    const local = searchIndex(index(), query(), { typeId: typeId() });
    const seen = new Set(local.map((row) => row.id));
    const more = (remote?.results() ?? []).filter(
      (row) => !seen.has(row.id) && (!typeId() || row.typeId === typeId()),
    );
    return [...local, ...more];
  });
  const filtered = createMemo(() => {
    const rows = searched();
    const current = type();
    return current ? rows.filter((row) => matchesFacets(row, selection(), current)) : rows;
  });
  const results = createMemo(() => sortRows(filtered(), sort(), props.compendium.types()));
  const summaries = createMemo(() =>
    type() ? facetSummaries(type()!, searched(), selection()) : [],
  );
  const counts = createMemo(() => {
    const byType = new Map<string, number>();
    for (const row of props.compendium.rows())
      byType.set(row.typeId, (byType.get(row.typeId) ?? 0) + 1);
    return byType;
  });
  // The first two filters as columns (a spell's level and school); every filter stays in the sidebar.
  const facetColumns = () =>
    (type()?.filters ?? []).slice(0, 2).map((filter) => ({
      key: filter.key,
      label: type()!.fields.find((field) => field.key === filter.key)?.label ?? filter.key,
    }));

  const setQuery = (value: string) => {
    setParams({ q: value || undefined });
    remote?.setQuery(value, typeId() ? [typeId()!] : undefined);
  };
  const open = (id: string) => {
    setEditing(false);
    setNotice("");
    setParams({ entry: id });
  };
  const selected = () => (params.entry ? props.compendium.entry(params.entry) : undefined);
  const pinned = () => (params.compare ? props.compendium.entry(params.compare) : undefined);

  // Sheets this member may write to that take this entry: a list fed by its type, or a pick.
  const canEdit = (character: Character) =>
    props.isDm ||
    (character.scope === "world" ? !character.locked : character.memberId === props.me.id);
  const targets = (entry: CompendiumEntry): Target[] =>
    props.characters.filter(canEdit).flatMap((character) => {
      const template = props.templates.find((item) => item.id === character.templateId);
      if (!template?.layout) return [];
      return allBlocks(template.layout).flatMap((block): Target[] => {
        if (block.type === "list" && block.source?.entryType === entry.typeId)
          return [{ character, key: block.key, label: block.title || block.key, kind: "list" }];
        if (block.type === "entry" && block.entryType === entry.typeId)
          return [{ character, key: block.key, label: block.label || block.key, kind: "entry" }];
        return [];
      });
    });
  const add = (entry: CompendiumEntry, target: Target) => {
    const template = props.templates.find((item) => item.id === target.character.templateId);
    const block = template?.layout
      ? allBlocks(template.layout).find(
          (candidate) =>
            (candidate.type === "list" || candidate.type === "entry") &&
            candidate.key === target.key,
        )
      : undefined;
    if (target.kind === "list" && block?.type === "list") {
      const current = target.character.values[target.key];
      const rows = Array.isArray(current) ? (current as ListRow[]) : [];
      props.onValue(target.character.id, target.key, [...rows, rowFromEntry(entry, block.columns)]);
    } else props.onValue(target.character.id, target.key, entry.id);
    setNotice(`Added to ${target.character.name} · ${target.label}`);
  };

  const block = async (entry: CompendiumEntry) => {
    setError("");
    try {
      await api.blockEntry(props.worldId, entry.id, true);
      setParams({ entry: undefined });
      await props.compendium.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not hide the entry");
    }
  };

  const [scroller, setScroller] = createSignal<HTMLDivElement>();
  const virtualizer = createVirtualizer({
    count: () => results().length,
    getScrollElement: scroller,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const sortBy = (by: RowSort["by"]) =>
    setSort((current) =>
      JSON.stringify(current.by) === JSON.stringify(by)
        ? { by, direction: current.direction === "asc" ? "desc" : "asc" }
        : { by, direction: "asc" },
    );
  const sortMark = (by: RowSort["by"]) =>
    JSON.stringify(sort().by) === JSON.stringify(by)
      ? sort().direction === "asc"
        ? " ▲"
        : " ▼"
      : "";
  const facetValue = (row: IndexRow, key: string) => {
    const value = row.facets?.[key];
    if (value === undefined) return "";
    if (typeof value === "boolean") return value ? "✓" : "";
    return Array.isArray(value) ? value.join(", ") : String(value);
  };

  return (
    <section
      {...sx(
        c.page,
        props.insetLeft ? c.insetLeft : c.clearLeft,
        props.insetRight ? c.insetRight : c.clearRight,
      )}
      aria-label="Compendium browser"
    >
      <header {...sx(c.header)}>
        <h1 {...sx(c.title)}>Compendium</h1>
        <input
          type="search"
          {...sx(styles.input, c.search)}
          aria-label="Search the compendium"
          placeholder="Search names, tags and text…"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
        <span {...sx(c.count)} aria-live="polite">
          {results().length === props.compendium.rows().length
            ? `${results().length} entries`
            : `${results().length} of ${props.compendium.rows().length}`}
        </span>
      </header>
      <div {...sx(c.body)}>
        <nav {...sx(c.facets)} aria-label="Filters">
          <div {...sx(c.facetGroup)} role="group" aria-label="Type">
            <button
              type="button"
              {...sx(c.typeButton, !typeId() && c.typeActive)}
              aria-pressed={!typeId() ? "true" : "false"}
              onClick={() => chooseType(undefined)}
            >
              <span>Everything</span>
              <span {...sx(c.facetCount)}>{props.compendium.rows().length}</span>
            </button>
            <For each={props.compendium.types().filter((item) => counts().get(item.id))}>
              {(item) => (
                <button
                  type="button"
                  {...sx(c.typeButton, typeId() === item.id && c.typeActive)}
                  aria-pressed={typeId() === item.id ? "true" : "false"}
                  onClick={() => chooseType(item.id)}
                >
                  <span>{item.plural ?? item.name}</span>
                  <span {...sx(c.facetCount)}>{counts().get(item.id)}</span>
                </button>
              )}
            </For>
          </div>
          <For each={summaries()}>
            {(summary) => (
              <FacetControl summary={summary} selection={selection()} onSelection={setSelection} />
            )}
          </For>
        </nav>
        <div {...sx(c.results)}>
          <div {...sx(c.headRow)} role="row">
            <button type="button" {...sx(c.headCell, c.nameCell)} onClick={() => sortBy("name")}>
              Name{sortMark("name")}
            </button>
            <Show when={!typeId()}>
              <button type="button" {...sx(c.headCell, c.typeCell)} onClick={() => sortBy("type")}>
                Type{sortMark("type")}
              </button>
            </Show>
            <For each={facetColumns()}>
              {(column) => (
                <button
                  type="button"
                  {...sx(c.headCell, c.facetCell)}
                  onClick={() => sortBy({ facet: column.key })}
                >
                  {column.label}
                  {sortMark({ facet: column.key })}
                </button>
              )}
            </For>
          </div>
          <div ref={setScroller} {...sx(c.scroll)}>
            <Show
              when={results().length}
              fallback={
                <EmptyState>
                  {props.compendium.loading() && !props.compendium.rows().length
                    ? "Loading the compendium…"
                    : "No entries match."}
                </EmptyState>
              }
            >
              <ul
                {...sx(c.list)}
                style={{ height: `${virtualizer.getTotalSize()}px` }}
                aria-label="Entries"
              >
                <For each={virtualizer.getVirtualItems()}>
                  {(item) => {
                    const row = () => results()[item.index];
                    return (
                      <Show when={row()}>
                        {(current) => (
                          <li
                            {...sx(
                              c.row,
                              params.entry === current().id && c.rowActive,
                              params.compare === current().id && c.rowPinned,
                            )}
                            style={{ transform: `translateY(${item.start}px)` }}
                          >
                            <button
                              type="button"
                              {...sx(c.rowButton)}
                              aria-current={params.entry === current().id ? "true" : undefined}
                              onClick={() => open(current().id)}
                            >
                              <span {...sx(c.nameCell, c.cellText)}>
                                {current().name}
                                <Show when={current().visibility === "dm"}>
                                  <span {...sx(c.dm)}> DM</span>
                                </Show>
                              </span>
                              <Show when={!typeId()}>
                                <span {...sx(c.typeCell, c.cellText, c.muted)}>
                                  {typeName(current().typeId)}
                                </span>
                              </Show>
                              <For each={facetColumns()}>
                                {(column) => (
                                  <span {...sx(c.facetCell, c.cellText)}>
                                    {facetValue(current(), column.key)}
                                  </span>
                                )}
                              </For>
                            </button>
                          </li>
                        )}
                      </Show>
                    );
                  }}
                </For>
              </ul>
            </Show>
          </div>
        </div>
        <aside {...sx(c.preview)} aria-label="Preview">
          <ErrorBanner message={error()} />
          <Show
            when={params.entry}
            fallback={<EmptyState>Pick an entry to read it here.</EmptyState>}
          >
            <Show
              when={selected()}
              fallback={
                <EmptyState>
                  {props.compendium.missing(params.entry!)
                    ? "That entry isn't in the compendium any more."
                    : "Loading…"}
                </EmptyState>
              }
            >
              {(entry) => (
                <div {...sx(c.cards, !!pinned() && pinned()!.id !== entry().id && c.compare)}>
                  <Show when={pinned() && pinned()!.id !== entry().id ? pinned() : undefined}>
                    {(other) => (
                      <EntryPane
                        label="Pinned"
                        entry={other()}
                        type={props.compendium.typeById(other().typeId)}
                        compendium={props.compendium}
                        onRoll={props.onRoll}
                        onRollTable={props.onRollTable}
                        onOpenEntry={open}
                        actions={
                          <Button small onClick={() => setParams({ compare: undefined })}>
                            Unpin
                          </Button>
                        }
                      />
                    )}
                  </Show>
                  <Show
                    when={editing() && props.compendium.typeById(entry().typeId)}
                    fallback={
                      <EntryPane
                        entry={entry()}
                        type={props.compendium.typeById(entry().typeId)}
                        compendium={props.compendium}
                        onRoll={props.onRoll}
                        onRollTable={props.onRollTable}
                        onOpenEntry={open}
                        actions={
                          <>
                            <Show
                              when={targets(entry()).length}
                              fallback={
                                <span title="None of your sheets has a place for this kind of entry">
                                  <Button small disabled>
                                    Add to character
                                  </Button>
                                </span>
                              }
                            >
                              <Menu label="Add to character" trigger="Add to character">
                                <For each={targets(entry())}>
                                  {(target) => (
                                    <MenuItem onClick={() => add(entry(), target)}>
                                      {target.character.name} · {target.label}
                                    </MenuItem>
                                  )}
                                </For>
                              </Menu>
                            </Show>
                            <Show when={params.compare !== entry().id}>
                              <Button small onClick={() => setParams({ compare: entry().id })}>
                                Pin to compare
                              </Button>
                            </Show>
                            <Show when={props.onShare}>
                              <Button small onClick={() => props.onShare?.(entry())}>
                                Share
                              </Button>
                            </Show>
                            <Show when={props.isDm}>
                              <Button small onClick={() => setEditing(true)}>
                                {librarySource(entry().id) ? "Table override" : "Edit"}
                              </Button>
                              <Show when={librarySource(entry().id)}>
                                <Button small variant="danger" onClick={() => void block(entry())}>
                                  Hide in this world
                                </Button>
                              </Show>
                            </Show>
                          </>
                        }
                        notice={notice()}
                      />
                    }
                  >
                    {(entryType) => (
                      <EntryEditor
                        worldId={props.worldId}
                        compendium={props.compendium}
                        type={entryType()}
                        entry={entry()}
                        onSaved={() => {
                          setEditing(false);
                          void props.compendium.refresh();
                        }}
                        onCancel={() => setEditing(false)}
                      />
                    )}
                  </Show>
                </div>
              )}
            </Show>
          </Show>
        </aside>
      </div>
    </section>
  );
}

function EntryPane(props: {
  label?: string;
  entry: CompendiumEntry;
  type: EntryType | undefined;
  compendium: CompendiumStore;
  onRoll?: (label: string, dice: string) => void;
  onRollTable?: (entryId: string, field: string) => void;
  onOpenEntry: (id: string) => void;
  actions: JSX.Element;
  notice?: string;
}) {
  return (
    <article
      {...sx(c.pane)}
      aria-label={props.label ? `${props.label}: ${props.entry.name}` : props.entry.name}
    >
      <div {...sx(c.actions)}>
        <Show when={props.label}>
          <Badge>{props.label!}</Badge>
        </Show>
        {props.actions}
      </div>
      <Show when={props.notice}>
        <p {...sx(c.notice)} role="status">
          {props.notice}
        </p>
      </Show>
      <Show when={props.type} fallback={<EmptyState>Unknown entry type.</EmptyState>}>
        {(type) => (
          <EntryCard
            entry={props.entry}
            type={type()}
            onRoll={props.onRoll}
            onRollTable={props.onRollTable}
            compendium={props.compendium}
            onOpenEntry={props.onOpenEntry}
          />
        )}
      </Show>
    </article>
  );
}

function FacetControl(props: {
  summary: FacetSummary;
  selection: FacetSelection;
  onSelection: (next: FacetSelection) => void;
}) {
  const update = (value: FacetSelection[string] | undefined) => {
    const next = { ...props.selection };
    if (value === undefined) delete next[props.summary.key];
    else next[props.summary.key] = value;
    props.onSelection(next);
  };
  const current = () => props.selection[props.summary.key];
  return (
    <fieldset {...sx(c.facetGroup)}>
      <legend {...sx(c.facetLegend)}>{props.summary.label}</legend>
      <Show when={props.summary.kind === "range" ? props.summary : undefined}>
        {(range) => {
          const value = () => current() as { min?: number; max?: number } | undefined;
          const set = (bound: "min" | "max", text: string) => {
            const number = text.trim() === "" ? undefined : Number(text);
            const next = { ...value(), [bound]: Number.isFinite(number) ? number : undefined };
            update(next.min === undefined && next.max === undefined ? undefined : next);
          };
          return (
            <div {...sx(c.range)}>
              <input
                type="number"
                {...sx(styles.input, c.rangeInput)}
                aria-label={`${range().label} from`}
                placeholder={range().min === undefined ? "" : String(range().min)}
                value={value()?.min ?? ""}
                onInput={(event) => set("min", event.currentTarget.value)}
              />
              <span {...sx(c.muted)}>–</span>
              <input
                type="number"
                {...sx(styles.input, c.rangeInput)}
                aria-label={`${range().label} to`}
                placeholder={range().max === undefined ? "" : String(range().max)}
                value={value()?.max ?? ""}
                onInput={(event) => set("max", event.currentTarget.value)}
              />
            </div>
          );
        }}
      </Show>
      <Show when={props.summary.kind === "set" ? props.summary : undefined}>
        {(set) => {
          const chosen = () => (current() as { any: string[] } | undefined)?.any ?? [];
          const toggle = (value: string, on: boolean) => {
            const any = on ? [...chosen(), value] : chosen().filter((item) => item !== value);
            update(any.length ? { any } : undefined);
          };
          return (
            <For each={set().options}>
              {(option) => (
                <label {...sx(c.option)}>
                  <input
                    type="checkbox"
                    checked={chosen().includes(option.value)}
                    onChange={(event) => toggle(option.value, event.currentTarget.checked)}
                  />
                  <span {...sx(c.optionLabel)}>{option.value}</span>
                  <span {...sx(c.facetCount)}>{option.count}</span>
                </label>
              )}
            </For>
          );
        }}
      </Show>
      <Show when={props.summary.kind === "flag" ? props.summary : undefined}>
        {(flag) => {
          const value = () => (current() as { value: boolean } | undefined)?.value;
          return (
            <For each={[true, false]}>
              {(option) => (
                <label {...sx(c.option)}>
                  <input
                    type="checkbox"
                    checked={value() === option}
                    onChange={(event) =>
                      update(event.currentTarget.checked ? { value: option } : undefined)
                    }
                  />
                  <span {...sx(c.optionLabel)}>{option ? "Yes" : "No"}</span>
                  <span {...sx(c.facetCount)}>{option ? flag().true : flag().false}</span>
                </label>
              )}
            </For>
          );
        }}
      </Show>
    </fieldset>
  );
}

const c = stylex.create({
  page: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    gap: space.x2,
    padding: space.x3,
    backgroundColor: colors.canvas,
    zIndex: 1,
  },
  // The chat and tools panels float over the stage; keep the page clear of them,
  // and of their collapsed tabs at the top corners.
  insetLeft: { paddingLeft: { default: "372px", "@media (max-width: 1100px)": space.x3 } },
  insetRight: { paddingRight: { default: "372px", "@media (max-width: 1100px)": space.x3 } },
  clearLeft: { paddingLeft: "116px" },
  clearRight: { paddingRight: "116px" },
  header: { display: "flex", alignItems: "center", gap: space.x3 },
  title: { fontFamily: fonts.display, fontSize: fontSize.headingLg, margin: 0 },
  search: { flex: 1, maxWidth: "420px" },
  count: { color: colors.textMuted, fontSize: fontSize.caption, fontFamily: fonts.numeric },
  body: {
    flex: 1,
    minHeight: 0,
    display: "grid",
    // Fits between both open panels (~670px) without overflowing into them.
    gridTemplateColumns: "minmax(140px, 180px) minmax(200px, 1fr) minmax(280px, 1.3fr)",
    gap: space.x3,
  },
  facets: {
    display: "flex",
    flexDirection: "column",
    gap: space.x3,
    overflowY: "auto",
    fontSize: fontSize.caption,
  },
  facetGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "1px",
    margin: 0,
    padding: 0,
    borderWidth: 0,
  },
  facetLegend: {
    fontFamily: fonts.display,
    color: colors.textMuted,
    padding: 0,
    marginBottom: space.x1,
  },
  facetCount: { marginLeft: "auto", color: colors.textMuted, fontFamily: fonts.numeric },
  typeButton: {
    display: "flex",
    gap: space.x2,
    alignItems: "baseline",
    textAlign: "left",
    paddingBlock: "2px",
    paddingInline: space.x1,
    borderWidth: 0,
    borderRadius: radii.sm,
    backgroundColor: { default: "transparent", ":hover": colors.surfaceHover },
    color: colors.text,
    font: "inherit",
    cursor: "pointer",
  },
  // Same as the app's other selected nav items, so every theme keeps the contrast.
  typeActive: { backgroundColor: colors.accentMuted, color: colors.text, fontWeight: 600 },
  option: { display: "flex", alignItems: "center", gap: space.x1, cursor: "pointer" },
  optionLabel: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  range: { display: "flex", alignItems: "center", gap: space.x1 },
  rangeInput: { width: "5em", paddingBlock: "2px" },
  results: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  headRow: {
    display: "flex",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  headCell: {
    textAlign: "left",
    paddingBlock: space.x1,
    paddingInline: space.x2,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: colors.textMuted,
    font: "inherit",
    fontSize: fontSize.caption,
    cursor: "pointer",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  nameCell: { flex: 2, minWidth: "8em" },
  typeCell: { flex: 1, minWidth: 0 },
  facetCell: { flex: 1, minWidth: 0 },
  cellText: {
    paddingInline: space.x2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  muted: { color: colors.textMuted },
  dm: { color: colors.accent, fontSize: fontSize.micro },
  scroll: { flex: 1, minHeight: 0, overflowY: "auto" },
  list: { position: "relative", listStyle: "none", margin: 0, padding: 0 },
  row: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: `${ROW_HEIGHT}px`,
  },
  rowActive: { backgroundColor: colors.surfaceHover },
  rowPinned: { boxShadow: `inset 3px 0 0 ${colors.accent}` },
  rowButton: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    height: "100%",
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":hover": colors.surfaceHover },
    color: colors.text,
    font: "inherit",
    fontSize: fontSize.body,
    textAlign: "left",
    cursor: "pointer",
  },
  preview: { minHeight: 0, overflowY: "auto" },
  cards: { display: "grid", gap: space.x3 },
  // Side by side when there is room, stacked when the panels leave the preview narrow.
  compare: { gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" },
  pane: { display: "flex", flexDirection: "column", gap: space.x2, minWidth: 0 },
  actions: { display: "flex", flexWrap: "wrap", gap: space.x1, alignItems: "center" },
  notice: { margin: 0, color: colors.textMuted, fontSize: fontSize.caption },
});
