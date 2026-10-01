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
import { oracleDice, oracleRows } from "../domain/oracle";
import { librarySource } from "../domain/entry-id";
import { indexEntries, searchIndex } from "../domain/compendium-search";
import type { CompendiumStore } from "../client/compendium-store";
import { createSearch, type SearchRequest } from "../client/search";
import type { CharacterValue } from "../domain/schemas";
import type {
  LayoutBlock,
  ListColumn,
  ListRow,
  SheetLayout,
  SheetValues,
} from "../domain/sheet-layout";
import { colors, fontSize, fonts, radii, skin, space } from "../theme/tokens.stylex";
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

const libraryEntry = (entry: CompendiumEntry) => librarySource(entry.id) !== undefined;

/** Only changed values become patches; untouched source values keep following the library. */
const saveTableOverride = async (
  worldId: string,
  entry: CompendiumEntry,
  input: SaveEntryInput,
) => {
  const previous = await api.entryOverride(worldId, entry.id);
  const prior = previous?.patch ?? {};
  const fields = { ...prior.fields };
  const removed = new Set(prior.removeFields ?? []);
  for (const key of new Set([...Object.keys(entry.fields), ...Object.keys(input.fields)])) {
    if (JSON.stringify(entry.fields[key]) === JSON.stringify(input.fields[key])) continue;
    if (input.fields[key] === undefined) {
      delete fields[key];
      removed.add(key);
    } else {
      fields[key] = input.fields[key];
      removed.delete(key);
    }
  }
  await api.saveEntryOverride(worldId, entry.id, {
    baseRev: entry.sourceRev ?? entry.rev ?? 0,
    patch: {
      ...prior,
      ...(input.name !== entry.name ? { name: input.name } : {}),
      ...(input.body !== entry.body ? { body: input.body } : {}),
      ...(input.visibility !== entry.visibility ? { visibility: input.visibility } : {}),
      ...(JSON.stringify(input.tags) !== JSON.stringify(entry.tags) ? { tags: input.tags } : {}),
      fields,
      removeFields: [...removed],
    },
  });
  const body = (await api.getEntryBodies(worldId, [entry.id])).entries[0];
  if (!body) throw new ApiError("The library entry is no longer available");
  return body;
};

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
  const short = fields.filter((field) =>
    ["text", "number", "dice", "tags", "select", "set"].includes(field.kind),
  );
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
    // Actions read as a stat block (ActionList), not a table.
    if (field.kind === "list" || field.kind === "progression")
      blocks.push({
        id: field.key,
        type: "list",
        key: field.key,
        title: field.label,
        columns: fieldColumns(field),
      });
  }
  return { system: type.name, name: type.name, pages: [{ id: "entry", title: "", blocks }] };
};

/** Field values as the sheet renderer reads them (tags and sets shown as text). */
const entryValues = (entry: CompendiumEntry, type: EntryType): SheetValues =>
  Object.fromEntries(
    type.fields.map((field) => {
      const value = entry.fields[field.key];
      return [
        field.key,
        (field.kind === "tags" || field.kind === "set") && Array.isArray(value)
          ? value.join(", ")
          : (value as SheetValues[string]),
      ];
    }),
  );

/** The row shape of the kinds that are stored as rows. */
const fieldColumns = (field: EntryField): ListColumn[] =>
  field.kind === "actions"
    ? [
        { key: "name", label: "Action", kind: "text" },
        { key: "roll", label: "Roll", kind: "dice" },
        { key: "text", label: "Effect", kind: "text" },
      ]
    : field.kind === "progression"
      ? [{ key: "level", label: "Level", kind: "number" }, ...(field.columns ?? [])]
      : field.kind === "oracle"
        ? [
            { key: "min", label: "From", kind: "number" },
            { key: "max", label: "To", kind: "number" },
            { key: "text", label: "Result", kind: "text" },
          ]
        : [...(field.columns ?? [])];

const rowsOf = (value: CharacterValue | undefined) =>
  (Array.isArray(value) ? value : []).filter(
    (row): row is ListRow => typeof row === "object" && row !== null && !Array.isArray(row),
  );

const ids = (value: CharacterValue | undefined) =>
  typeof value === "string" && value ? [value] : Array.isArray(value) ? (value as string[]) : [];

/** An oracle table: its roll, and each row's range. What a row means is up to the table. */
function OracleTable(props: { field: EntryField; rows: readonly ListRow[]; onRoll?: () => void }) {
  const dice = () => {
    const parsed = oracleRows(props.rows);
    return parsed.ok ? oracleDice(props.field.dice, parsed.value) : props.field.dice;
  };
  const range = (row: ListRow) =>
    row.min === row.max ? String(row.min) : `${String(row.min)}–${String(row.max)}`;
  return (
    <section {...sx(c.oracle)} aria-label={props.field.label}>
      <div {...sx(c.oracleHead)}>
        <span {...sx(c.oracleTitle)}>{props.field.label}</span>
        <Show when={props.onRoll}>
          <button type="button" {...sx(c.oracleRoll)} onClick={() => props.onRoll?.()}>
            Roll {dice()}
          </button>
        </Show>
      </div>
      <div {...sx(c.oracleRows)} role="table" aria-label={`${props.field.label} rows`}>
        <For each={props.rows}>
          {(row) => (
            <div {...sx(c.oracleRow)} role="row">
              <span {...sx(c.oracleRange)} role="cell">
                {range(row)}
              </span>
              <span role="cell">{String(row.text ?? "")}</span>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}

export function EntryCard(props: {
  entry: CompendiumEntry;
  type: EntryType;
  onRoll?: (label: string, dice: string) => void;
  /** Roll one of the entry's oracle tables (the server rolls and finds the row). */
  onRollTable?: (entryId: string, field: string) => void;
  /** For links in the description and reference fields. */
  compendium?: Pick<CompendiumStore, "row" | "rowByName">;
  onOpenEntry?: (entryId: string) => void;
}) {
  const link = (link: { name: string; id?: string }) => linkedRow(props.compendium, link)?.id;
  // Entry links and inline rolls in the description are plain HTML; one handler serves both.
  const open = (event: MouseEvent) => {
    const target = (event.target as Element).closest<HTMLElement>("[data-entry-id], [data-roll]");
    if (target?.dataset.entryId) props.onOpenEntry?.(target.dataset.entryId);
    else if (target?.dataset.roll)
      props.onRoll?.(target.dataset.label || props.entry.name, target.dataset.roll);
  };
  const references = () =>
    props.type.fields.filter(
      (field) => field.kind === "reference" && ids(props.entry.fields[field.key]).length,
    );
  const actionFields = () =>
    props.type.fields.filter(
      (field) => field.kind === "actions" && rowsOf(props.entry.fields[field.key]).length,
    );
  const oracles = () =>
    props.type.fields.filter(
      (field) => field.kind === "oracle" && rowsOf(props.entry.fields[field.key]).length,
    );
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
      <For each={references()}>
        {(field) => (
          <div {...sx(c.refs)}>
            <span {...sx(styles.label)}>{field.label}</span>
            <For each={ids(props.entry.fields[field.key])}>
              {(id) => (
                <Show
                  when={props.compendium?.row(id)}
                  fallback={<span {...sx(c.refMissing)}>{id.split("/").pop()}</span>}
                >
                  {(row) => (
                    <button
                      type="button"
                      class="ttrpg-entry-link"
                      onClick={() => props.onOpenEntry?.(row().id)}
                    >
                      {row().name}
                    </button>
                  )}
                </Show>
              )}
            </For>
          </div>
        )}
      </For>
      <For each={actionFields()}>
        {(field) => (
          <section {...sx(c.actions)} aria-label={field.label} onClick={open}>
            <span {...sx(c.actionsTitle)}>{field.label}</span>
            <For each={rowsOf(props.entry.fields[field.key])}>
              {(row) => (
                <div {...sx(c.action)}>
                  <strong>{String(row.name ?? "")}.</strong>{" "}
                  <Show
                    when={typeof row.roll === "string" && row.roll ? String(row.roll) : undefined}
                  >
                    {(roll) => (
                      <button
                        type="button"
                        class="ttrpg-inline-roll"
                        title={`Roll ${row.name ?? ""}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          props.onRoll?.(String(row.name ?? props.entry.name), roll());
                        }}
                      >
                        {roll()}
                      </button>
                    )}
                  </Show>{" "}
                  <Show when={typeof row.text === "string" && row.text.trim()}>
                    <div
                      class="ttrpg-note-markdown ttrpg-action-text"
                      innerHTML={renderNoteMarkdown(String(row.text), link)}
                    />
                  </Show>
                </div>
              )}
            </For>
          </section>
        )}
      </For>
      <For each={oracles()}>
        {(field) => (
          <OracleTable
            field={field}
            rows={rowsOf(props.entry.fields[field.key])}
            onRoll={
              props.onRollTable ? () => props.onRollTable?.(props.entry.id, field.key) : undefined
            }
          />
        )}
      </For>
      <Show when={props.entry.body.trim()}>
        <div
          class={`ttrpg-note-markdown ${sx(c.body).class}`}
          innerHTML={renderNoteMarkdown(props.entry.body, link)}
          onClick={open}
        />
      </Show>
      <Show when={props.entry.licence}>
        {(licence) => (
          <small {...sx(styles.muted)}>
            {licence().name} · {licence().attribution}
          </small>
        )}
      </Show>
    </article>
  );
}

const splitTags = (text: string) =>
  text
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

/** Pick other entries by name; stored as ids so renames don't break the reference. */
function ReferenceInput(props: {
  field: EntryField;
  value: CharacterValue | undefined;
  onChange: (value: CharacterValue | undefined) => void;
  compendium?: Pick<CompendiumStore, "row" | "rowsOfType">;
}) {
  const chosen = () => ids(props.value);
  const choices = () =>
    (props.field.ref?.typeIds ?? [])
      .flatMap((typeId) => props.compendium?.rowsOfType(typeId) ?? [])
      .filter((row) => !chosen().includes(row.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  const set = (next: string[]) =>
    props.onChange(
      next.length === 0 ? undefined : props.field.ref?.multiple ? next : next[next.length - 1],
    );
  return (
    <div {...sx(styles.field)}>
      <span {...sx(styles.label)}>{props.field.label}</span>
      <div {...sx(c.refs)}>
        <For each={chosen()}>
          {(id) => (
            <span {...sx(c.chosen)}>
              {props.compendium?.row(id)?.name ?? id.split("/").pop()}
              <button
                type="button"
                {...sx(c.unchoose)}
                aria-label={`Remove ${props.compendium?.row(id)?.name ?? id}`}
                onClick={() => set(chosen().filter((item) => item !== id))}
              >
                ×
              </button>
            </span>
          )}
        </For>
        <Show when={props.field.ref?.multiple || !chosen().length}>
          <select
            {...sx(styles.select, c.refSelect)}
            aria-label={`Add to ${props.field.label}`}
            value=""
            onChange={(event) => {
              const id = event.currentTarget.value;
              event.currentTarget.value = "";
              if (id) set([...chosen(), id]);
            }}
          >
            <option value="">{choices().length ? "Choose…" : "Nothing to choose yet"}</option>
            <For each={choices()}>{(row) => <option value={row.id}>{row.name}</option>}</For>
          </select>
        </Show>
      </div>
    </div>
  );
}

function FieldInput(props: {
  field: EntryField;
  value: CharacterValue | undefined;
  onChange: (value: CharacterValue | undefined) => void;
  /** For reference fields: entries to choose from. */
  compendium?: Pick<CompendiumStore, "row" | "rowsOfType">;
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
      <Match
        when={
          props.field.kind === "list" ||
          props.field.kind === "actions" ||
          props.field.kind === "progression" ||
          props.field.kind === "oracle"
        }
      >
        <div {...sx(styles.field)}>
          <span {...sx(styles.label)}>
            {props.field.label}
            {props.field.kind === "oracle" && props.field.dice
              ? ` (rolls ${props.field.dice})`
              : ""}
          </span>
          <ListEditor
            block={{
              key: props.field.key,
              title: props.field.label,
              columns: fieldColumns(props.field),
            }}
            rows={rowsOf(props.value)}
            onSave={(rows) => props.onChange(rows.length ? (rows as CharacterValue) : undefined)}
          />
        </div>
      </Match>
      <Match when={props.field.kind === "select"}>
        <Field label={props.field.label}>
          <select
            {...sx(styles.select)}
            value={text()}
            onChange={(event) => props.onChange(event.currentTarget.value || undefined)}
          >
            <option value="">—</option>
            <For each={props.field.options ?? []}>
              {(option) => <option value={option}>{option}</option>}
            </For>
          </select>
        </Field>
      </Match>
      <Match when={props.field.kind === "set"}>
        <fieldset {...sx(c.set)}>
          <legend {...sx(styles.label)}>{props.field.label}</legend>
          <For each={props.field.options ?? []}>
            {(option) => {
              const on = () => Array.isArray(props.value) && props.value.includes(option);
              return (
                <label {...sx(c.setOption)}>
                  <input
                    type="checkbox"
                    checked={on()}
                    onChange={() => {
                      const current = (Array.isArray(props.value) ? props.value : []) as string[];
                      const next = on()
                        ? current.filter((item) => item !== option)
                        : (props.field.options ?? []).filter(
                            (item) => item === option || current.includes(item),
                          );
                      props.onChange(next.length ? next : undefined);
                    }}
                  />
                  {option}
                </label>
              );
            }}
          </For>
        </fieldset>
      </Match>
      <Match when={props.field.kind === "reference"}>
        <ReferenceInput
          field={props.field}
          value={props.value}
          onChange={props.onChange}
          compendium={props.compendium}
        />
      </Match>
    </Switch>
  );
}

export function EntryEditor(props: {
  worldId: string;
  compendium?: Pick<CompendiumStore, "row" | "rowsOfType">;
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
  const override = () => !!props.entry && libraryEntry(props.entry);
  const patch = (partial: Partial<SaveEntryInput>) => setDraft({ ...draft(), ...partial });
  const setField = (key: string, value: CharacterValue | undefined) => {
    const fields = { ...draft().fields };
    if (value === undefined) delete fields[key];
    else fields[key] = value;
    patch({ fields });
  };
  const save = async () => {
    const input = { ...draft(), name: draft().name.trim(), tags: splitTags(tagText()) };
    const problem = entryError(override() ? { ...input, id: undefined } : input, props.type);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      props.onSaved(
        override() && props.entry
          ? await saveTableOverride(props.worldId, props.entry, input)
          : await api.saveEntry(props.worldId, input),
      );
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
      aria-label={`${override() ? "Table override" : props.entry ? "Edit" : "New"} ${props.type.name}`}
    >
      <div {...sx(styles.row)}>
        <h3 {...sx(styles.h3)}>
          {override()
            ? `Table override · ${props.type.name.toLowerCase()}`
            : props.entry
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
      <Show when={override()}>
        <p {...sx(styles.muted)}>
          Changes apply in this world. The library's attribution and licence stay with the entry.
        </p>
      </Show>
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
            <option value="public" disabled={override() && props.entry?.visibility === "dm"}>
              Everyone
            </option>
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
            compendium={props.compendium}
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
  onRollTable?: (entryId: string, field: string) => void;
  onSetup?: () => void;
  /** Post a link to the entry in chat. */
  onShare?: (entry: CompendiumEntry) => void;
  /** Server search, which also finds words in entries' text (the index only has names and tags). */
  search?: SearchRequest;
  /** Open the compendium as a page (filters, compare). */
  onBrowse?: () => void;
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
      if (libraryEntry(entry))
        await saveTableOverride(props.worldId, entry, { ...input, visibility });
      else await api.saveEntry(props.worldId, { ...input, visibility });
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
  const sourceAction = async (entry: CompendiumEntry, block: boolean) => {
    try {
      if (block) {
        await api.blockEntry(props.worldId, entry.id, true);
        setFocus(null);
      } else await api.deleteEntryOverride(props.worldId, entry.id);
      await props.compendium.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the library entry");
    }
  };

  return (
    <div {...sx(styles.col)}>
      <div {...sx(styles.row)}>
        <h3 {...sx(styles.h3)}>Compendium</h3>
        <div {...sx(styles.spacer)} />
        <Show when={props.onBrowse}>
          <Button small onClick={() => props.onBrowse?.()}>
            Full page
          </Button>
        </Show>
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
                  compendium={props.compendium}
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
                    <Show when={!libraryEntry(entry()) || entry().visibility === "public"}>
                      <Button
                        small
                        variant="ghost"
                        onClick={() =>
                          void setVisibility(entry(), entry().visibility === "dm" ? "public" : "dm")
                        }
                      >
                        {entry().visibility === "dm" ? "Reveal to players" : "Hide from players"}
                      </Button>
                    </Show>
                    <Button
                      small
                      onClick={() => setEditing({ typeId: entry().typeId, entryId: entry().id })}
                    >
                      {libraryEntry(entry()) ? "Table override" : "Edit"}
                    </Button>
                    <Show
                      when={libraryEntry(entry())}
                      fallback={
                        <Button small variant="danger" onClick={() => setConfirmDelete(true)}>
                          Delete
                        </Button>
                      }
                    >
                      <Button
                        small
                        variant="ghost"
                        onClick={() => void sourceAction(entry(), false)}
                      >
                        Reset table changes
                      </Button>
                      <Button
                        small
                        variant="danger"
                        onClick={() => void sourceAction(entry(), true)}
                      >
                        Block in this world
                      </Button>
                    </Show>
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
                    onRollTable={props.onRollTable}
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
  actions: { display: "flex", flexDirection: "column", gap: space.x1 },
  actionsTitle: {
    fontFamily: fonts.display,
    color: colors.accent,
    fontSize: fontSize.caption,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  action: { fontSize: fontSize.body, lineHeight: 1.4 },

  refs: { display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px" },
  refMissing: { color: colors.textFaint, fontStyle: "italic" },
  chosen: {
    display: "inline-flex",
    alignItems: "center",
    gap: "2px",
    paddingLeft: "6px",
    ...hair,
    borderRadius: skin.controlRadius,
    fontSize: "13px",
  },
  unchoose: {
    padding: "0 4px",
    borderWidth: 0,
    backgroundColor: "transparent",
    color: colors.textMuted,
    cursor: "pointer",
  },
  refSelect: { width: "auto", minWidth: "10em" },
  set: {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px 10px",
    margin: 0,
    padding: 0,
    borderWidth: 0,
  },
  setOption: { display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "13px" },
  oracle: { display: "flex", flexDirection: "column", gap: "4px" },
  oracleHead: { display: "flex", alignItems: "center", gap: "8px" },
  oracleTitle: {
    fontFamily: fonts.display,
    fontSize: "12px",
    textTransform: skin.headTransform,
    letterSpacing: skin.headTracking,
    color: colors.textMuted,
  },
  oracleRoll: {
    paddingInline: "7px",
    paddingBlock: "2px",
    ...hair,
    borderRadius: skin.controlRadius,
    backgroundColor: { default: colors.surface, ":hover": colors.surfaceHover },
    color: colors.accent,
    fontFamily: fonts.numeric,
    fontSize: "12px",
    cursor: "pointer",
  },
  oracleRows: { display: "flex", flexDirection: "column", fontSize: "13px" },
  oracleRow: {
    display: "grid",
    gridTemplateColumns: "4.5em minmax(0, 1fr)",
    gap: "6px",
    paddingBlock: "1px",
    borderBottomWidth: "1px",
    borderBottomStyle: "dotted",
    borderBottomColor: colors.border,
  },
  oracleRange: { fontFamily: fonts.numeric, color: colors.textMuted, textAlign: "right" },
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
