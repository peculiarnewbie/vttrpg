import type { CompendiumEntry, EntryField, EntryType } from "./compendium";
import type { CharacterValue } from "./schemas";
import type { ListColumn, ListRow } from "./sheet-layout";

const columnValue = (
  value: CharacterValue | undefined,
  kind: ListColumn["kind"],
): ListRow[string] | undefined => {
  switch (kind) {
    case "number": {
      const number = typeof value === "string" && value.trim() ? Number(value) : value;
      return typeof number === "number" && Number.isFinite(number) ? number : undefined;
    }
    case "text":
    case "dice":
      return typeof value === "string" ? value : undefined;
    case "check":
      return typeof value === "boolean" ? value : undefined;
    case "tags":
      return Array.isArray(value) && value.every((tag) => typeof tag === "string")
        ? [...value]
        : undefined;
  }
};

const copyColumns = (
  values: Readonly<Record<string, CharacterValue>>,
  columns: readonly ListColumn[],
): ListRow => {
  const row: ListRow = {};
  for (const column of columns) {
    const value = columnValue(values[column.key], column.kind);
    if (value !== undefined) row[column.key] = value;
  }
  return row;
};

export const rowFromEntry = (entry: CompendiumEntry, columns: readonly ListColumn[]): ListRow => ({
  ...copyColumns({ ...entry.fields, name: entry.name }, columns),
  _entry: entry.id,
});

export const rowsFromEntryList = (
  entry: CompendiumEntry,
  fromFieldKey: string,
  columns: readonly ListColumn[],
): ListRow[] => {
  const value = entry.fields[fromFieldKey];
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) =>
    typeof row === "object" && row !== null && !Array.isArray(row)
      ? [{ ...copyColumns(row, columns), _entry: entry.id }]
      : [],
  );
};

const empty = (value: CharacterValue | undefined) =>
  value === undefined ||
  (typeof value === "string" && !value.trim()) ||
  (Array.isArray(value) && value.every((item) => typeof item === "string" && !item.trim()));

export const entryFieldsForDisplay = (
  entry: CompendiumEntry,
  type: EntryType,
  show?: readonly string[],
): { field: EntryField; value: CharacterValue }[] =>
  type.fields.flatMap((field) => {
    const value = entry.fields[field.key];
    return (show === undefined || show.includes(field.key)) && value !== undefined && !empty(value)
      ? [{ field, value }]
      : [];
  });

export const sourceOf = (row: ListRow): string | undefined =>
  typeof row._entry === "string" && row._entry ? row._entry : undefined;
