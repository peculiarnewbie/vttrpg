import type { CompendiumEntry } from "./compendium";
import type { ListColumn, ListRow } from "./sheet-layout";
import { copyColumns, revOf, sourceOf } from "./compendium-rows";

/*
 * Copied list rows remember their entry (`_entry`) and its revision (`_rev`).
 * When the entry has changed since, the sheet offers the update — showing
 * what would change — and applies it only when the owner says so. Players may
 * have edited their copy on purpose; nothing changes silently.
 */

export type RowChange = {
  readonly key: string;
  readonly label: string;
  readonly from: ListRow[string] | undefined;
  readonly to: ListRow[string] | undefined;
};

export type RowUpdate = {
  /** The entry's current revision; applying the update stores it in `_rev`. */
  readonly rev: number;
  /** Columns whose copied value differs from the entry's now (name included). */
  readonly changes: readonly RowChange[];
};

/**
 * The update on offer for a copied row, or `undefined` when there is none:
 * the row isn't from this entry, has no `_rev`, or `entry.rev` isn't newer.
 * A newer entry whose copied columns all still match gives `changes: []`
 * (applying it just records the revision). Derived columns never count.
 */
export const rowUpdate = (
  row: ListRow,
  entry: CompendiumEntry,
  columns: readonly ListColumn[],
): RowUpdate | undefined => {
  const rev = revOf(row);
  if (
    sourceOf(row) !== entry.id ||
    rev === undefined ||
    entry.rev === undefined ||
    entry.rev <= rev
  )
    return undefined;
  const copied = copyColumns({ ...entry.fields, name: entry.name }, columns);
  const changes = columns.flatMap((column) => {
    const from = row[column.key];
    const to = copied[column.key];
    const same =
      Array.isArray(from) && Array.isArray(to)
        ? from.length === to.length && from.every((value, index) => value === to[index])
        : from === to;
    return to === undefined || same ? [] : [{ key: column.key, label: column.label, from, to }];
  });
  return { rev: entry.rev, changes };
};

/**
 * The row with the entry's current values in the copied columns and the new
 * `_rev`. Columns the entry doesn't fill keep the row's value; `_entry` and
 * other extra keys are kept.
 */
export const applyRowUpdate = (
  row: ListRow,
  entry: CompendiumEntry,
  columns: readonly ListColumn[],
): ListRow => {
  return {
    ...row,
    ...copyColumns({ ...entry.fields, name: entry.name }, columns),
    ...(entry.rev === undefined ? {} : { _rev: entry.rev }),
  };
};

export type EntryChange = { readonly label: string; readonly from: string; readonly to: string };

const shown = (value: unknown): string => {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string"))
    return value.join(", ");
  return JSON.stringify(value);
};

/**
 * What a library update changes in one entry, for the DM to read before
 * applying it: name, tags, text and each field (by the type's labels, then any
 * field the type doesn't name). Either side may be absent (added, removed).
 */
export const entryChanges = (
  from: CompendiumEntry | undefined,
  to: CompendiumEntry | undefined,
  fieldLabels: ReadonlyMap<string, string> = new Map(),
): EntryChange[] => {
  const changes: EntryChange[] = [];
  const compare = (label: string, a: unknown, b: unknown) => {
    const before = shown(a);
    const after = shown(b);
    if (before !== after) changes.push({ label, from: before, to: after });
  };
  compare("Name", from?.name, to?.name);
  compare("Tags", from?.tags, to?.tags);
  compare("Text", from?.body, to?.body);
  const keys = new Set([
    ...fieldLabels.keys(),
    ...Object.keys(from?.fields ?? {}),
    ...Object.keys(to?.fields ?? {}),
  ]);
  for (const key of keys) compare(fieldLabels.get(key) ?? key, from?.fields[key], to?.fields[key]);
  return changes;
};
