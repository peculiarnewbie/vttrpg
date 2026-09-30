import * as stylex from "@stylexjs/stylex";
import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js";
import { api, ApiError } from "../client/api";
import { renderNoteMarkdown } from "../client/note-markdown";
import type {
  CompendiumEntry,
  EntryField,
  EntryType,
  EntryVisibility,
  SaveEntryInput,
} from "../domain/compendium";
import { entryError } from "../domain/compendium-rules";
import { indexEntries, searchIndex } from "../domain/compendium-search";
import type { CompendiumStore } from "../client/compendium-store";
import { createSearch, type SearchRequest } from "../client/search";
import type { CharacterValue } from "../domain/schemas";
import type { LayoutBlock, ListRow, SheetLayout, SheetValues } from "../domain/sheet-layout";
import { colors, fonts, radii, skin } from "../theme/tokens.stylex";
import { sx } from "../theme/sx";
import { ListEditor, SheetBlocks } from "./sheet-blocks";
import { styles } from "./styles.stylex";
import { Badge, Button, EmptyState, ErrorBanner, Field, Input, Textarea } from "./ui";

/*
 * The compendium in the tools panel: search and filter a world's entries, read
 * them as cards, and (DMs) write, reveal, and delete them. Entry cards reuse the
 * sheet renderer, so an entry's fields look like the sheet they end up on.
 */

export type { CompendiumStore };

/** The entry a link points at, if this member can see it: by id for `[[ref:…]]`, else by name. */
export const linkedRow = (
  store: Pick<CompendiumStore, "row" | "rowByName"> | undefined,
  link: { name: string; id?: string },
) => (store ? (link.id ? store.row(link.id) : store.rowByName(link.name)) : undefined);

const filled = (value: CharacterValue | undefined) =>
  value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0);

/** A read-only layout for one entry: short fields together, prose and lists below; empty fields skipped. */
const entryLayout = (type: EntryType, entry: CompendiumEntry): SheetLayout => {
  const fields = type.fields.filter((field) => filled(entry.fields[field.key]));
  const short = fields.filter((field) => ["text", "number", "dice", "tags"].includes(field.kind));
  const blocks: LayoutBlock[] = [];
  if (short.length)
    blocks.push({
      id: "short",
      type: "fields",
      columns: short.length === 1 ? 1 : 2,
      items: short.map((field) => ({ key: field.key, label: field.label })),
    });
  for (const field of fields) {
    if (field.kind === "longtext")
      blocks.push({ id: field.key, type: "text", key: field.key, label: field.label });
    if (field.kind === "list")
      blocks.push({
        id: field.key,
        type: "list",
        key: field.key,
        title: field.label,
        columns: field.columns ?? [],
      });
  }
  return { system: type.name, name: type.name, pages: [{ id: "entry", title: "", blocks }] };
};

/** Field values as the sheet renderer reads them (tags shown as text). */
const entryValues = (entry: CompendiumEntry, type: EntryType): SheetValues =>
  Object.fromEntries(
    type.fields.map((field) => {
      const value = entry.fields[field.key];
      return [
        field.key,
        field.kind === "tags" && Array.isArray(value)
          ? value.join(", ")
          : (value as SheetValues[string]),
      ];
    }),
  );

export function EntryCard(props: {
  entry: CompendiumEntry;
  type: EntryType;
  onRoll?: (label: string, dice: string) => void;
  /** For `[[Entry]]` links in the description. */
  compendium?: Pick<CompendiumStore, "row" | "rowByName">;
  onOpenEntry?: (entryId: string) => void;
}) {
  const link = (link: { name: string; id?: string }) => linkedRow(props.compendium, link)?.id;
  const open = (event: MouseEvent) => {
    const target = (event.target as Element).closest<HTMLElement>("[data-entry-id]");
    if (target?.dataset.entryId) props.onOpenEntry?.(target.dataset.entryId);
  };
  return (
    <article {...sx(c.card)} aria-label={props.entry.name}>
      <SheetBlocks
        layout={entryLayout(props.type, props.entry)}
        name={props.entry.name}
        subtitle={[props.type.name, ...props.entry.tags].join(" · ")}
        values={entryValues(props.entry, props.type)}
        onChange={() => {}}
        onRoll={props.onRoll ?? (() => {})}
        readOnly
      />
      <Show when={props.entry.body.trim()}>
        <div
          class={`ttrpg-note-markdown ${sx(c.body).class}`}
          innerHTML={renderNoteMarkdown(props.entry.body, link)}
          onClick={open}
        />
      </Show>
    </article>
  );
}

const splitTags = (text: string) =>
  text
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

function FieldInput(props: {
  field: EntryField;
  value: CharacterValue | undefined;
  onChange: (value: CharacterValue | undefined) => void;
}) {
  const text = () =>
    typeof props.value === "string" || typeof props.value === "number" ? String(props.value) : "";
  return (
    <Switch
      fallback={
        <Field label={props.field.label}>
          <Input value={text()} onInput={(value) => props.onChange(value || undefined)} />
        </Field>
      }
    >
      <Match when={props.field.kind === "longtext"}>
        <Field label={props.field.label}>
          <Textarea value={text()} onInput={(value) => props.onChange(value || undefined)} />
        </Field>
      </Match>
      <Match when={props.field.kind === "number"}>
        <Field label={props.field.label}>
          <Input
            type="number"
            value={text()}
            onInput={(value) =>
              props.onChange(
                value.trim() === "" || !Number.isFinite(Number(value)) ? undefined : Number(value),
              )
            }
          />
        </Field>
      </Match>
      <Match when={props.field.kind === "tags"}>
        <Field label={`${props.field.label} (comma separated)`}>
          <Input
            value={Array.isArray(props.value) ? (props.value as string[]).join(", ") : ""}
            onInput={(value) =>
              props.onChange(splitTags(value).length ? splitTags(value) : undefined)
            }
          />
        </Field>
      </Match>
      <Match when={props.field.kind === "list"}>
        <div {...sx(styles.field)}>
          <span {...sx(styles.label)}>{props.field.label}</span>
          <ListEditor
            block={{
              key: props.field.key,
              title: props.field.label,
              columns: props.field.columns ?? [],
            }}
            rows={(Array.isArray(props.value) ? props.value : []) as readonly ListRow[]}
            onSave={(rows) => props.onChange(rows.length ? (rows as CharacterValue) : undefined)}
          />
        </div>
      </Match>
    </Switch>
  );
}

function EntryEditor(props: {
  worldId: string;
  type: EntryType;
  entry?: CompendiumEntry;
  onSaved: (entry: CompendiumEntry) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = createSignal<SaveEntryInput>(
    props.entry
      ? {
          id: props.entry.id,
          typeId: props.entry.typeId,
          name: props.entry.name,
          tags: props.entry.tags,
          body: props.entry.body,
          fields: props.entry.fields,
          visibility: props.entry.visibility,
        }
      : { typeId: props.type.id, name: "", tags: [], body: "", fields: {}, visibility: "public" },
  );
  const [tagText, setTagText] = createSignal((props.entry?.tags ?? []).join(", "));
  const [preview, setPreview] = createSignal(false);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const patch = (partial: Partial<SaveEntryInput>) => setDraft({ ...draft(), ...partial });
  const setField = (key: string, value: CharacterValue | undefined) => {
    const fields = { ...draft().fields };
    if (value === undefined) delete fields[key];
    else fields[key] = value;
    patch({ fields });
  };
  const save = async () => {
    const input = { ...draft(), name: draft().name.trim(), tags: splitTags(tagText()) };
    const problem = entryError(input, props.type);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      props.onSaved(await api.saveEntry(props.worldId, input));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the entry");
    } finally {
      setBusy(false);
    }
  };
  return (
    <fieldset
      {...sx(c.editor)}
      disabled={busy()}
      aria-label={`${props.entry ? "Edit" : "New"} ${props.type.name}`}
    >
      <div {...sx(styles.row)}>
        <h3 {...sx(styles.h3)}>
          {props.entry
            ? `Edit ${props.type.name.toLowerCase()}`
            : `New ${props.type.name.toLowerCase()}`}
        </h3>
        <div {...sx(styles.spacer)} />
        <Button small onClick={props.onCancel}>
          Cancel
        </Button>
        <Button small variant="primary" onClick={() => void save()}>
          Save
        </Button>
      </div>
      <ErrorBanner message={error()} />
      <Field label="Name">
        <Input value={draft().name} onInput={(name) => patch({ name })} />
      </Field>
      <div {...sx(c.pair)}>
        <Field label="Who can see it">
          <select
            {...sx(styles.select)}
            value={draft().visibility}
            onChange={(event) =>
              patch({ visibility: event.currentTarget.value as EntryVisibility })
            }
          >
            <option value="public">Everyone</option>
            <option value="dm">DM only</option>
          </select>
        </Field>
        <Field label="Tags (comma separated)">
          <Input value={tagText()} onInput={setTagText} />
        </Field>
      </div>
      <For each={props.type.fields}>
        {(field) => (
          <FieldInput
            field={field}
            value={draft().fields[field.key]}
            onChange={(value) => setField(field.key, value)}
          />
        )}
      </For>
      <div {...sx(styles.field)}>
        <div {...sx(styles.row)}>
          <span {...sx(styles.label)}>Description (markdown)</span>
          <div {...sx(styles.spacer)} />
          <Button small variant="ghost" onClick={() => setPreview(!preview())}>
            {preview() ? "Write" : "Preview"}
          </Button>
        </div>
        <Show
          when={!preview()}
          fallback={
            <div
              class={`ttrpg-note-markdown ${sx(c.body).class}`}
              innerHTML={renderNoteMarkdown(draft().body || "Nothing yet.")}
            />
          }
        >
          <Textarea value={draft().body} onInput={(body) => patch({ body })} />
        </Show>
      </div>
    </fieldset>
  );
}

export function CompendiumPanel(props: {
  worldId: string;
  isDm: boolean;
  compendium: CompendiumStore;
  /** An entry to show, e.g. opened from a sheet. */
  focus?: string | null;
  onFocus?: (entryId: string | null) => void;
  onRoll?: (label: string, dice: string) => void;
  onSetup?: () => void;
  /** Post a link to the entry in chat. */
  onShare?: (entry: CompendiumEntry) => void;
  /** Server search, which also finds words in entries' text (the index only has names and tags). */
  search?: SearchRequest;
}) {
  const [query, setQuery] = createSignal("");
  const [typeFilter, setTypeFilter] = createSignal<string | null>(null);
  const [localFocus, setLocalFocus] = createSignal<string | null>(null);
  const [editing, setEditing] = createSignal<{ typeId: string; entryId?: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const [error, setError] = createSignal("");
  const focus = () => (props.focus !== undefined ? props.focus : localFocus());
  const setFocus = (id: string | null) => {
    setConfirmDelete(false);
    if (props.onFocus) props.onFocus(id);
    else setLocalFocus(id);
  };
  const index = createMemo(() => indexEntries(props.compendium.rows()));
  const remote = props.search ? createSearch({ request: props.search }) : undefined;
  // Names and tags match instantly from the index; the server adds matches in text.
  const results = () => {
    const local = searchIndex(index(), query(), { typeId: typeFilter() ?? undefined });
    const seen = new Set(local.map((row) => row.id));
    const more = (remote?.results() ?? []).filter(
      (row) => !seen.has(row.id) && (!typeFilter() || row.typeId === typeFilter()),
    );
    return [...local, ...more];
  };
  const selected = () => (focus() ? props.compendium.entry(focus()!) : undefined);
  const typeName = (typeId: string) => props.compendium.typeById(typeId)?.name ?? typeId;

  const setVisibility = async (entry: CompendiumEntry, visibility: EntryVisibility) => {
    try {
      const { updatedAt: _, rev: __, ...input } = entry;
      await api.saveEntry(props.worldId, { ...input, visibility });
      props.compendium.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the entry");
    }
  };
  const remove = async (entry: CompendiumEntry) => {
    try {
      await api.deleteEntry(props.worldId, entry.id);
      setFocus(null);
      props.compendium.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete the entry");
    }
  };

  return (
    <div {...sx(styles.col)}>
      <div {...sx(styles.row)}>
        <h3 {...sx(styles.h3)}>Compendium</h3>
        <div {...sx(styles.spacer)} />
        <Show when={props.isDm && props.compendium.types().length && !editing()}>
          <select
            {...sx(styles.select)}
            aria-label="New entry"
            value=""
            onChange={(event) => {
              const typeId = event.currentTarget.value;
              event.currentTarget.value = "";
              if (typeId) setEditing({ typeId });
            }}
          >
            <option value="">New…</option>
            <For each={props.compendium.types()}>
              {(type) => <option value={type.id}>{type.name}</option>}
            </For>
          </select>
        </Show>
      </div>
      <ErrorBanner message={error()} />
      <Switch>
        <Match when={editing()}>
          {(edit) => (
            <Show when={props.compendium.typeById(edit().typeId)}>
              {(type) => (
                <EntryEditor
                  worldId={props.worldId}
                  type={type()}
                  entry={edit().entryId ? props.compendium.entry(edit().entryId!) : undefined}
                  onCancel={() => setEditing(null)}
                  onSaved={(entry) => {
                    setEditing(null);
                    props.compendium.refresh();
                    setFocus(entry.id);
                  }}
                />
              )}
            </Show>
          )}
        </Match>
        <Match when={focus()}>
          <div {...sx(styles.col)}>
            <div {...sx(styles.row)}>
              <button {...sx(c.back)} onClick={() => setFocus(null)}>
                ← All
              </button>
              <div {...sx(styles.spacer)} />
              <Show when={props.onShare && selected()?.visibility === "public" && selected()}>
                {(entry) => (
                  <Button small variant="ghost" onClick={() => props.onShare?.(entry())}>
                    Share in chat
                  </Button>
                )}
              </Show>
              <Show when={props.isDm && selected()}>
                {(entry) => (
                  <>
                    <Button
                      small
                      variant="ghost"
                      onClick={() =>
                        void setVisibility(entry(), entry().visibility === "dm" ? "public" : "dm")
                      }
                    >
                      {entry().visibility === "dm" ? "Reveal to players" : "Hide from players"}
                    </Button>
                    <Button
                      small
                      onClick={() => setEditing({ typeId: entry().typeId, entryId: entry().id })}
                    >
                      Edit
                    </Button>
                    <Button small variant="danger" onClick={() => setConfirmDelete(true)}>
                      Delete
                    </Button>
                  </>
                )}
              </Show>
            </div>
            <Show when={confirmDelete() && selected()}>
              {(entry) => (
                <div {...sx(c.confirm)} role="alertdialog" aria-label="Delete entry">
                  <span {...sx(styles.spacer)}>
                    Delete “{entry().name}”? Sheets that link it will show it as missing.
                  </span>
                  <Button small variant="danger" onClick={() => void remove(entry())}>
                    Delete
                  </Button>
                  <Button small onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </Button>
                </div>
              )}
            </Show>
            <Show
              when={selected() && props.compendium.typeById(selected()!.typeId) && selected()}
              fallback={
                <EmptyState>
                  {props.compendium.missing(focus()!)
                    ? "That entry isn't in the compendium any more."
                    : "Loading…"}
                </EmptyState>
              }
            >
              {(entry) => (
                <>
                  <Show when={entry().visibility === "dm"}>
                    <div>
                      <Badge tone="dm">DM only</Badge>
                    </div>
                  </Show>
                  <EntryCard
                    entry={entry()}
                    type={props.compendium.typeById(entry().typeId)!}
                    onRoll={props.onRoll}
                    compendium={props.compendium}
                    onOpenEntry={setFocus}
                  />
                </>
              )}
            </Show>
          </div>
        </Match>
        <Match when={!props.compendium.types().length}>
          <EmptyState>
            <Show when={props.isDm} fallback="Nothing in the compendium yet.">
              <div {...sx(styles.col)}>
                <span>
                  The compendium holds your game's content — Knights, spells, items — typed up by
                  you, and linked from character sheets.
                </span>
                <Show when={props.onSetup}>
                  <div>
                    <Button small variant="primary" onClick={() => props.onSetup?.()}>
                      Set up entry types
                    </Button>
                  </div>
                </Show>
              </div>
            </Show>
          </EmptyState>
        </Match>
        <Match when={true}>
          <input
            {...sx(styles.input)}
            type="search"
            aria-label="Search the compendium"
            placeholder="Search names, tags, text…"
            value={query()}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              remote?.setQuery(event.currentTarget.value);
            }}
          />
          <Show when={props.compendium.types().length > 1}>
            <div {...sx(c.chips)} role="group" aria-label="Filter by type">
              <button
                {...sx(c.chip, typeFilter() === null && c.chipOn)}
                aria-pressed={typeFilter() === null ? "true" : "false"}
                onClick={() => setTypeFilter(null)}
              >
                All
              </button>
              <For each={props.compendium.types()}>
                {(type) => (
                  <button
                    {...sx(c.chip, typeFilter() === type.id && c.chipOn)}
                    aria-pressed={typeFilter() === type.id ? "true" : "false"}
                    onClick={() => setTypeFilter(typeFilter() === type.id ? null : type.id)}
                  >
                    {type.plural ?? type.name}
                  </button>
                )}
              </For>
            </div>
          </Show>
          <div {...sx(c.list)} role="list" aria-label="Entries">
            <For each={results()}>
              {(entry) => (
                <button {...sx(c.item)} role="listitem" onClick={() => setFocus(entry.id)}>
                  <span {...sx(c.itemName)}>{entry.name}</span>
                  <Show when={entry.visibility === "dm"}>
                    <Badge tone="dm">DM</Badge>
                  </Show>
                  <span {...sx(c.itemMeta)}>
                    {[typeFilter() ? "" : typeName(entry.typeId), ...entry.tags]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              )}
            </For>
            <Show when={!results().length}>
              <EmptyState>
                {props.compendium.rows().length
                  ? "No entries match."
                  : props.isDm
                    ? "No entries yet. Use New… to write one, or import a pack in World settings."
                    : "Nothing in the compendium yet."}
              </EmptyState>
            </Show>
          </div>
        </Match>
      </Switch>
    </div>
  );
}

const hair = { borderWidth: "1px", borderStyle: "solid", borderColor: colors.border } as const;

const c = stylex.create({
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "10px",
    ...hair,
    borderWidth: skin.panelBorderWidth,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    backgroundImage: skin.paper,
    backgroundSize: skin.paperSize,
    boxShadow: skin.panelShadow,
  },
  body: {
    "--note-display": fonts.display,
    "--note-head-weight": skin.headWeight,
    "--note-head-tracking": skin.headTracking,
    "--note-head-transform": skin.headTransform,
    "--note-ornament": skin.ornament,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: "13px",
    lineHeight: 1.5,
    overflowWrap: "break-word",
  },
  editor: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    minWidth: 0,
    margin: 0,
    padding: 0,
    borderWidth: 0,
  },
  pair: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" },
  back: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: "13px",
    cursor: "pointer",
    ":hover": { color: colors.text },
  },
  confirm: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "6px",
    padding: "6px 8px",
    fontSize: "12px",
    backgroundColor: colors.dangerMuted,
    borderRadius: skin.controlRadius,
  },
  chips: { display: "flex", flexWrap: "wrap", gap: "4px" },
  chip: {
    paddingInline: "7px",
    paddingBlock: "1px",
    ...hair,
    borderRadius: skin.controlRadius,
    backgroundColor: { default: "transparent", ":hover": colors.surfaceHover },
    color: colors.textMuted,
    fontFamily: fonts.display,
    fontSize: "11px",
    textTransform: skin.headTransform,
    letterSpacing: skin.headTracking,
    cursor: "pointer",
  },
  chipOn: { borderColor: colors.accent, color: colors.accent, backgroundColor: colors.accentMuted },
  list: { display: "flex", flexDirection: "column" },
  item: {
    display: "flex",
    alignItems: "baseline",
    flexWrap: "wrap",
    columnGap: "6px",
    paddingInline: "4px",
    paddingBlock: "5px",
    borderWidth: 0,
    borderBottomWidth: "1px",
    borderBottomStyle: "dotted",
    borderBottomColor: colors.border,
    backgroundColor: { default: "transparent", ":hover": colors.surfaceHover },
    color: colors.text,
    fontFamily: fonts.body,
    textAlign: "left",
    cursor: "pointer",
  },
  itemName: { fontSize: "14px", fontWeight: 600 },
  itemMeta: { marginLeft: "auto", fontSize: "11px", color: colors.textFaint },
});
