import * as stylex from "@stylexjs/stylex";
import { For, Show, createSignal } from "solid-js";
import { api, ApiError } from "../client/api";
import {
  EntryFieldKind,
  type EntryField,
  type EntryType,
  type ImportPackResult,
} from "../domain/compendium";
import { packFileName, parsePack } from "../domain/compendium-io";
import { entryTypesForLayout, presetEntryTypes } from "../domain/compendium-presets";
import { typeError } from "../domain/compendium-rules";
import { effectiveLayout } from "../domain/layout-from-template";
import { slugKey } from "../domain/layout-edit";
import type { SheetTemplate } from "../domain/schemas";
import { ListColumnKind, type ListColumn } from "../domain/sheet-layout";
import { colors, fonts, skin } from "../theme/tokens.stylex";
import { sx } from "../theme/sx";
import type { CompendiumStore } from "./compendium";
import { styles } from "./styles.stylex";
import { Button, ErrorBanner, Field, Input } from "./ui";

/*
 * World settings → Compendium: the entry types a world's content uses (the
 * shape of a Knight, a spell), premade types for known systems, and packs to
 * move content between worlds. Entries themselves are written in the tools
 * panel, where they're read.
 */

const PRESET_SYSTEMS = ["Mythic Bastionland", "Mothership", "Blades in the Dark"];

const kindLabels: Record<EntryField["kind"], string> = {
  text: "Short text",
  longtext: "Long text",
  number: "Number",
  dice: "Dice",
  tags: "Tags",
  list: "List",
};

const emptyType = (): EntryType => ({ id: "", name: "", fields: [] });

function ColumnsEditor(props: {
  label: string;
  columns: readonly ListColumn[];
  onChange: (columns: ListColumn[]) => void;
}) {
  const set = (index: number, patch: Partial<ListColumn>) =>
    props.onChange(
      props.columns.map((column, i) => (i === index ? { ...column, ...patch } : column)),
    );
  return (
    <div {...sx(t.columns)}>
      <span {...sx(t.small)}>Columns</span>
      <For each={props.columns.map((_, i) => i)}>
        {(index) => (
          <div {...sx(t.columnRow)}>
            <input
              {...sx(styles.input, t.compact)}
              aria-label={`${props.label} column ${index + 1} label`}
              placeholder="Label"
              value={props.columns[index]?.label ?? ""}
              onInput={(event) => {
                const label = event.currentTarget.value;
                const column = props.columns[index];
                set(index, {
                  label,
                  key:
                    !column.key || column.key === slugKey(column.label)
                      ? slugKey(label)
                      : column.key,
                });
              }}
            />
            <input
              {...sx(styles.input, t.compact)}
              aria-label={`${props.label} column ${index + 1} key`}
              placeholder="key"
              value={props.columns[index]?.key ?? ""}
              onInput={(event) => set(index, { key: event.currentTarget.value })}
            />
            <select
              {...sx(styles.select, t.compact)}
              aria-label={`${props.label} column ${index + 1} kind`}
              value={props.columns[index]?.kind ?? "text"}
              onChange={(event) =>
                set(index, { kind: event.currentTarget.value as ListColumn["kind"] })
              }
            >
              <For each={ListColumnKind.literals}>
                {(kind) => <option value={kind}>{kind}</option>}
              </For>
            </select>
            <button
              {...sx(t.remove)}
              aria-label={`Remove ${props.label} column ${index + 1}`}
              onClick={() => props.onChange(props.columns.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </div>
        )}
      </For>
      <button
        {...sx(t.add)}
        onClick={() => props.onChange([...props.columns, { key: "", label: "", kind: "text" }])}
      >
        + Column
      </button>
    </div>
  );
}

function TypeEditor(props: {
  type: EntryType;
  isNew: boolean;
  others: readonly EntryType[];
  onSave: (type: EntryType) => Promise<void>;
  onDelete: () => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = createSignal<EntryType>(props.type);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const patch = (partial: Partial<EntryType>) => setDraft({ ...draft(), ...partial });
  const setField = (index: number, partial: Partial<EntryField>) =>
    patch({
      fields: draft().fields.map((field, i) => (i === index ? { ...field, ...partial } : field)),
    });
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't work — try again.");
    } finally {
      setBusy(false);
    }
  };
  const save = () => {
    const problem = typeError(draft(), props.others);
    if (problem) return setError(problem);
    void run(() => props.onSave(draft()));
  };
  return (
    <fieldset
      {...sx(t.editor)}
      disabled={busy()}
      aria-label={`Edit ${draft().name || "entry type"}`}
    >
      <ErrorBanner message={error()} />
      <div {...sx(t.triple)}>
        <Field label="Name">
          <Input
            value={draft().name}
            placeholder="Knight"
            onInput={(name) =>
              patch({
                name,
                id:
                  props.isNew && (!draft().id || draft().id === slugKey(draft().name))
                    ? slugKey(name)
                    : draft().id,
              })
            }
          />
        </Field>
        <Field label="Plural">
          <Input
            value={draft().plural ?? ""}
            placeholder="Knights"
            onInput={(plural) => patch({ plural: plural || undefined })}
          />
        </Field>
        <Field label="Id (layouts refer to it)">
          <Show when={props.isNew} fallback={<span {...sx(t.id)}>{draft().id}</span>}>
            <Input value={draft().id} onInput={(id) => patch({ id })} />
          </Show>
        </Field>
      </div>
      <div {...sx(t.fields)}>
        <div {...sx(t.fieldHead)}>
          <span>Field</span>
          <span>Key</span>
          <span>Kind</span>
          <span />
        </div>
        <For each={draft().fields.map((_, i) => i)}>
          {(index) => {
            const field = () => draft().fields[index];
            return (
              <div {...sx(t.fieldBlock)}>
                <div {...sx(t.fieldRow)}>
                  <input
                    {...sx(styles.input, t.compact)}
                    aria-label={`Field ${index + 1} label`}
                    value={field()?.label ?? ""}
                    onInput={(event) => {
                      const label = event.currentTarget.value;
                      setField(index, {
                        label,
                        key:
                          !field().key || field().key === slugKey(field().label)
                            ? slugKey(label)
                            : field().key,
                      });
                    }}
                  />
                  <input
                    {...sx(styles.input, t.compact)}
                    aria-label={`Field ${index + 1} key`}
                    value={field()?.key ?? ""}
                    onInput={(event) => setField(index, { key: event.currentTarget.value })}
                  />
                  <select
                    {...sx(styles.select, t.compact)}
                    aria-label={`Field ${index + 1} kind`}
                    value={field()?.kind ?? "text"}
                    onChange={(event) => {
                      const kind = event.currentTarget.value as EntryField["kind"];
                      setField(index, {
                        kind,
                        columns:
                          kind === "list"
                            ? (field().columns ?? [{ key: "name", label: "Name", kind: "text" }])
                            : undefined,
                      });
                    }}
                  >
                    <For each={EntryFieldKind.literals}>
                      {(kind) => <option value={kind}>{kindLabels[kind]}</option>}
                    </For>
                  </select>
                  <button
                    {...sx(t.remove)}
                    aria-label={`Remove field ${index + 1}`}
                    onClick={() => patch({ fields: draft().fields.filter((_, i) => i !== index) })}
                  >
                    ×
                  </button>
                </div>
                <Show when={field()?.kind === "list"}>
                  <ColumnsEditor
                    label={field().label || `Field ${index + 1}`}
                    columns={field().columns ?? []}
                    onChange={(columns) => setField(index, { columns })}
                  />
                </Show>
              </div>
            );
          }}
        </For>
        <button
          {...sx(t.add)}
          onClick={() =>
            patch({ fields: [...draft().fields, { key: "", label: "", kind: "text" }] })
          }
        >
          + Field
        </button>
      </div>
      <span {...sx(t.hint)}>
        Every entry also has a name, tags, and a markdown description. Renaming a key hides what
        entries stored under the old one.
      </span>
      <div {...sx(styles.row)}>
        <Button small variant="primary" onClick={save}>
          {props.isNew ? "Create type" : "Save type"}
        </Button>
        <Button small onClick={props.onCancel}>
          Cancel
        </Button>
        <div {...sx(styles.spacer)} />
        <Show when={!props.isNew}>
          <Button small variant="danger" onClick={() => void run(props.onDelete)}>
            Delete type
          </Button>
        </Show>
      </div>
    </fieldset>
  );
}

export function CompendiumSettings(props: {
  worldId: string;
  worldName: string;
  templates: readonly SheetTemplate[];
  compendium: CompendiumStore;
}) {
  const [editing, setEditing] = createSignal<{ type: EntryType; isNew: boolean } | null>(null);
  const [error, setError] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const types = () => props.compendium.types();
  const exists = (id: string) => types().some((type) => type.id === id);
  const counts = (typeId: string) => props.compendium.entriesOfType(typeId).length;

  // Entry types the world's sheet templates refer to that the compendium lacks.
  const missing = () => {
    const wanted = new Map<string, EntryType>();
    for (const template of props.templates)
      for (const type of entryTypesForLayout(effectiveLayout(template)))
        if (!exists(type.id)) wanted.set(type.id, type);
    return [...wanted.values()];
  };

  const act = async (action: () => Promise<unknown>, done?: string) => {
    setError("");
    setNotice("");
    try {
      await action();
      await props.compendium.refresh();
      if (done) setNotice(done);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't work — try again.");
    }
  };
  const addTypes = (list: readonly EntryType[]) => {
    const fresh = list.filter((type) => !exists(type.id));
    return act(
      async () => {
        for (const type of fresh) await api.saveEntryType(props.worldId, type);
      },
      fresh.length
        ? `Added ${fresh.map((type) => type.name).join(", ")}.`
        : "Those types are already here.",
    );
  };

  const exportAll = () =>
    act(async () => {
      const pack = await api.exportCompendium(props.worldId);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = packFileName(props.worldName);
      link.click();
      URL.revokeObjectURL(url);
    });
  const importFile = async (file: File) => {
    const parsed = parsePack(await file.text());
    if (!parsed.ok) return setError(parsed.error);
    let result: ImportPackResult | undefined;
    await act(async () => {
      result = await api.importCompendium(props.worldId, parsed.pack);
    });
    if (result)
      setNotice(
        `Imported “${parsed.pack.name}”: ${result.types} types, ${result.created} new entries, ${result.updated} updated.`,
      );
  };

  return (
    <div {...sx(styles.col)}>
      <p {...sx(t.intro)}>
        The compendium holds your game's content — Knights and their abilities, spells, items —
        typed up by you and linked from character sheets. Entry types decide what each kind of entry
        records. Write the entries themselves in the table's tools panel.
      </p>
      <ErrorBanner message={error()} />
      <Show when={notice()}>
        <div {...sx(t.notice)} role="status">
          {notice()}
        </div>
      </Show>

      <Show when={missing().length}>
        <div {...sx(t.notice)}>
          <span {...sx(styles.spacer)}>
            Your sheet templates use{" "}
            {missing()
              .map((type) => type.name)
              .join(", ")}
            , which this compendium doesn't have yet.
          </span>
          <Button small variant="primary" onClick={() => void addTypes(missing())}>
            Create {missing().length === 1 ? "it" : "them"}
          </Button>
        </div>
      </Show>

      <div {...sx(styles.row)}>
        <h3 {...sx(styles.h3)}>Entry types</h3>
        <div {...sx(styles.spacer)} />
        <select
          {...sx(styles.select)}
          aria-label="Add types for a premade system"
          value=""
          onChange={(event) => {
            const system = event.currentTarget.value;
            event.currentTarget.value = "";
            if (system) void addTypes(presetEntryTypes(system));
          }}
        >
          <option value="">Add types for a system…</option>
          <For each={PRESET_SYSTEMS}>{(system) => <option value={system}>{system}</option>}</For>
        </select>
        <Button small onClick={() => setEditing({ type: emptyType(), isNew: true })}>
          New type
        </Button>
      </div>

      <div {...sx(t.types)} role="list" aria-label="Entry types">
        <For each={types()}>
          {(type) => (
            <div role="listitem" {...sx(t.type)}>
              <div {...sx(t.typeRow)}>
                <span {...sx(t.typeName)}>{type.name}</span>
                <span {...sx(t.typeMeta)}>
                  {type.fields.map((field) => field.label).join(", ") || "no fields"} ·{" "}
                  {counts(type.id)} {counts(type.id) === 1 ? "entry" : "entries"}
                </span>
                <div {...sx(styles.spacer)} />
                <Button
                  small
                  variant="ghost"
                  onClick={() =>
                    setEditing(editing()?.type.id === type.id ? null : { type, isNew: false })
                  }
                >
                  {editing()?.type.id === type.id && !editing()?.isNew ? "Close" : "Edit"}
                </Button>
              </div>
              <Show when={editing()?.type.id === type.id && !editing()?.isNew}>
                <TypeEditor
                  type={type}
                  isNew={false}
                  others={types().filter((other) => other.id !== type.id)}
                  onCancel={() => setEditing(null)}
                  onSave={async (next) => {
                    await api.saveEntryType(props.worldId, next);
                    await props.compendium.refresh();
                    setEditing(null);
                  }}
                  onDelete={async () => {
                    await api.deleteEntryType(props.worldId, type.id);
                    await props.compendium.refresh();
                    setEditing(null);
                  }}
                />
              </Show>
            </div>
          )}
        </For>
        <Show when={!types().length && !editing()}>
          <span {...sx(t.hint)}>
            No entry types yet. Add a premade system's types, or make your own.
          </span>
        </Show>
        <Show when={editing()?.isNew && editing()}>
          {(edit) => (
            <div {...sx(t.type)}>
              <TypeEditor
                type={edit().type}
                isNew
                others={types()}
                onCancel={() => setEditing(null)}
                onSave={async (next) => {
                  await api.saveEntryType(props.worldId, next);
                  await props.compendium.refresh();
                  setEditing(null);
                }}
                onDelete={async () => {}}
              />
            </div>
          )}
        </Show>
      </div>

      <h3 {...sx(styles.h3)}>Packs</h3>
      <p {...sx(t.hint)}>
        A pack is a file of entry types and entries. Export this world's compendium to reuse it in
        another campaign or share it with your group; importing a pack again updates the entries it
        added.
      </p>
      <div {...sx(styles.row)}>
        <Button small onClick={() => void exportAll()}>
          Export pack
        </Button>
        <label {...sx(styles.button, styles.buttonSmall)}>
          Import pack
          <input
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void importFile(file);
            }}
          />
        </label>
      </div>
    </div>
  );
}

const hair = { borderWidth: "1px", borderStyle: "solid", borderColor: colors.border } as const;

const t = stylex.create({
  intro: { margin: 0, maxWidth: "70ch", color: colors.textMuted, fontSize: "14px" },
  notice: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px",
    padding: "8px 10px",
    ...hair,
    borderColor: colors.success,
    borderRadius: skin.controlRadius,
    backgroundColor: colors.successMuted,
    color: colors.text,
    fontSize: "13px",
  },
  types: { display: "flex", flexDirection: "column", ...hair, borderRadius: skin.controlRadius },
  type: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "8px 10px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  typeRow: { display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" },
  typeName: {
    fontFamily: fonts.display,
    fontSize: "14px",
    textTransform: skin.headTransform,
    letterSpacing: skin.headTracking,
    color: colors.accent,
  },
  typeMeta: { fontSize: "12px", color: colors.textMuted },
  editor: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    minWidth: 0,
    margin: 0,
    padding: 0,
    borderWidth: 0,
  },
  triple: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px" },
  id: { fontFamily: fonts.mono, fontSize: "12px", paddingBlock: "6px" },
  fields: { display: "flex", flexDirection: "column", gap: "4px" },
  fieldHead: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1.4fr) minmax(0, 1.2fr) 22px",
    gap: "6px",
    fontSize: "11px",
    color: colors.textMuted,
  },
  fieldBlock: { display: "flex", flexDirection: "column", gap: "4px" },
  fieldRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1.4fr) minmax(0, 1.2fr) 22px",
    gap: "6px",
    alignItems: "center",
  },
  columns: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    marginLeft: "16px",
    paddingLeft: "10px",
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    borderLeftColor: colors.borderStrong,
  },
  columnRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1.4fr) minmax(0, 1fr) 22px",
    gap: "6px",
    alignItems: "center",
  },
  compact: { height: "26px", paddingBlock: 0, fontSize: "12px", lineHeight: 1.2 },
  small: { fontSize: "11px", color: colors.textMuted },
  remove: {
    width: "22px",
    height: "22px",
    padding: 0,
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":hover": colors.surfaceHover },
    color: colors.textMuted,
    cursor: "pointer",
  },
  add: {
    alignSelf: "flex-start",
    paddingInline: "6px",
    paddingBlock: "1px",
    borderWidth: "1px",
    borderStyle: "dashed",
    borderColor: colors.border,
    borderRadius: skin.controlRadius,
    backgroundColor: "transparent",
    color: colors.textMuted,
    fontSize: "12px",
    cursor: "pointer",
  },
  hint: { fontSize: "12px", color: colors.textMuted },
});
