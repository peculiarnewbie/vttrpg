import {
  compendiumLimits,
  type CompendiumPack,
  type EntryType,
  type SaveEntryInput,
} from "./compendium";
import type { ListColumnKind } from "./sheet-layout";

const slug = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

export const typeError = (
  type: EntryType,
  others: readonly EntryType[] = [],
): string | undefined => {
  if (!slug.test(type.id)) return "Type id must be a lowercase slug of 1–40 characters";
  if (!type.name.trim() || type.name.length > compendiumLimits.name)
    return "Type name must be 1–120 characters";
  if (new Set([...others.map((other) => other.id), type.id]).size > compendiumLimits.types)
    return "A world can have at most 50 entry types";
  if (type.fields.length > compendiumLimits.fieldsPerType)
    return "A type can have at most 40 fields";
  const keys = new Set<string>();
  for (const field of type.fields) {
    if (!slug.test(field.key)) return "Field keys must be lowercase slugs of 1–40 characters";
    if (keys.has(field.key)) return "Field keys must be unique";
    keys.add(field.key);
    if (!field.label.trim()) return "Field labels must not be empty";
    if (field.kind !== "list") {
      if (field.columns !== undefined) return "Only list fields may have columns";
      continue;
    }
    if (!field.columns?.length) return "List fields must have at least one column";
    const columnKeys = new Set<string>();
    for (const column of field.columns) {
      if (!slug.test(column.key)) return "Column keys must be lowercase slugs of 1–40 characters";
      if (columnKeys.has(column.key)) return "List column keys must be unique";
      columnKeys.add(column.key);
      if (!column.label.trim()) return "Column labels must not be empty";
    }
  }
  return undefined;
};

const matchesKind = (value: unknown, kind: ListColumnKind | "longtext"): boolean => {
  switch (kind) {
    case "text":
    case "longtext":
      return typeof value === "string";
    case "dice":
      return typeof value === "string" && value.length <= 40;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "tags":
      return (
        Array.isArray(value) && value.length <= 50 && value.every((tag) => typeof tag === "string")
      );
    case "check":
      return typeof value === "boolean";
  }
};

export const entryError = (entry: SaveEntryInput, type: EntryType): string | undefined => {
  if (entry.typeId !== type.id) return "Entry type does not match";
  if (!entry.name.trim() || entry.name.trim().length > compendiumLimits.name)
    return "Entry name must be 1–120 characters";
  if (entry.tags.length > compendiumLimits.tags || entry.tags.some((tag) => tag.length > 40))
    return "Entries may have at most 20 tags, each at most 40 characters";
  if (entry.body.length > compendiumLimits.body)
    return "Entry body must be at most 12000 characters";
  if (jsonBytes(entry) > compendiumLimits.entryBytes) return "Entry JSON must be at most 16 KB";
  for (const [key, value] of Object.entries(entry.fields)) {
    const field = type.fields.find((candidate) => candidate.key === key);
    if (!field) return `Unknown entry field: ${key}`;
    if (field.kind !== "list") {
      if (!matchesKind(value, field.kind))
        return `Invalid value for ${field.label} (${field.kind})`;
      continue;
    }
    if (!Array.isArray(value) || value.length > 100)
      return `List ${field.label} must have at most 100 rows`;
    for (const row of value) {
      if (typeof row !== "object" || row === null || Array.isArray(row))
        return `Invalid row in ${field.label}`;
      for (const [columnKey, cell] of Object.entries(row)) {
        if (columnKey === "_entry") {
          if (typeof cell !== "string") return "Row _entry must be a string";
          continue;
        }
        const column = field.columns?.find((candidate) => candidate.key === columnKey);
        if (!column) return `Unknown column in ${field.label}: ${columnKey}`;
        if (!matchesKind(cell, column.kind)) return `Invalid value for column ${column.label}`;
      }
    }
  }
  return undefined;
};

export const packError = (
  pack: CompendiumPack,
  existingTypes: readonly EntryType[] = [],
): string | undefined => {
  if (jsonBytes(pack) > compendiumLimits.packBytes) return "Pack JSON must be at most 4 MB";
  if (pack.types.length > compendiumLimits.types) return "A pack can have at most 50 entry types";
  if (pack.entries.length > compendiumLimits.entries) return "A pack can have at most 2000 entries";
  const types = new Map(existingTypes.map((type) => [type.id, type]));
  const typeIds = new Set<string>();
  for (const type of pack.types) {
    if (typeIds.has(type.id)) return "Pack type ids must be unique";
    typeIds.add(type.id);
    const error = typeError(type, [...types.values()]);
    if (error) return error;
    types.set(type.id, type);
  }
  const entryIds = new Set<string>();
  for (const entry of pack.entries) {
    if (!entry.id.trim()) return "Entry ids must not be empty";
    if (entryIds.has(entry.id)) return "Pack entry ids must be unique";
    entryIds.add(entry.id);
    const type = types.get(entry.typeId);
    if (!type) return `Unknown entry type: ${entry.typeId}`;
    const error = entryError(entry, type);
    if (error) return error;
  }
  return undefined;
};
