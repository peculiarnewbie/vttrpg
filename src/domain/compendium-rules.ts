import {
  compendiumLimits,
  type CompendiumPack,
  type EntryType,
  type EntryField,
  type SaveEntryInput,
} from "./compendium";
import type { ListColumn, ListColumnKind } from "./sheet-layout";
import { isEntryId, parseEntryId, WORLD_SOURCE } from "./entry-id";
import { notationRefs, parseNotation } from "./dice-notation";
import { oracleRows } from "./oracle";
import { fieldKeyPattern } from "./constraints";

/** Type ids, field and column keys. */
const slug = fieldKeyPattern;
const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

const validOptions = (options: readonly string[] | undefined): boolean =>
  options !== undefined &&
  options.length >= 1 &&
  options.length <= 50 &&
  options.every((option) => option.trim().length > 0 && option.length <= 60) &&
  new Set(options).size === options.length;

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
    if ((field.kind === "select" || field.kind === "set") && !validOptions(field.options))
      return `${field.label} needs 1–50 unique options of 1–60 characters`;
    if (
      field.kind === "reference" &&
      (!field.ref ||
        field.ref.typeIds.length < 1 ||
        field.ref.typeIds.length > 10 ||
        field.ref.typeIds.some((id) => !slug.test(id)))
    )
      return `${field.label} needs 1–10 reference type ids`;
    if (field.kind === "oracle") {
      const parsed = field.dice === undefined ? undefined : parseNotation(field.dice);
      if (!parsed?.ok || notationRefs(parsed.value).length)
        return `${field.label} needs dice notation without references`;
    }
    if (field.kind !== "list" && field.kind !== "progression") {
      if (field.columns !== undefined) return `${field.label} cannot have columns`;
      continue;
    }
    if (field.kind === "list" && !field.columns?.length)
      return `List ${field.label} needs at least one column`;
    const columnKeys = new Set<string>();
    for (const column of field.columns ?? []) {
      if (!slug.test(column.key)) return `Invalid column key in ${field.label}`;
      if (field.kind === "progression" && column.key === "level")
        return `${field.label} reserves the level column`;
      if (columnKeys.has(column.key)) return `Duplicate column key in ${field.label}`;
      columnKeys.add(column.key);
      if (!column.label.trim()) return `Empty column label in ${field.label}`;
      if (column.kind === "select" && !validOptions(column.options))
        return `${field.label} column ${column.label} needs 1–50 unique options of 1–60 characters`;
    }
  }
  if ((type.filters?.length ?? 0) > 10) return "A type can have at most 10 filters";
  const filterKeys = new Set<string>();
  for (const filter of type.filters ?? []) {
    const field = type.fields.find((candidate) => candidate.key === filter.key);
    if (!field) return `Unknown filter field: ${filter.key}`;
    if (filterKeys.has(filter.key)) return `Duplicate filter: ${filter.key}`;
    filterKeys.add(filter.key);
    if (
      (filter.kind === "range" && field.kind !== "number") ||
      (filter.kind === "set" && !["select", "set", "tags"].includes(field.kind))
    )
      return `Invalid filter kind for ${field.label}`;
  }
  return undefined;
};

const matchesKind = (
  value: unknown,
  kind: ListColumnKind | "longtext",
  options?: readonly string[],
): boolean => {
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
    case "derived":
      // Computed from the row, never stored.
      return false;
    case "select":
      return typeof value === "string" && (value === "" || options?.includes(value) === true);
    case "progress":
      return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 40;
  }
};

const fieldError = (value: unknown, field: EntryField): string | undefined => {
  const invalid = `Invalid value for ${field.label} (${field.kind})`;
  switch (field.kind) {
    case "select":
      return matchesKind(value, "select", field.options) ? undefined : invalid;
    case "set":
      return Array.isArray(value) &&
        value.length <= 50 &&
        value.every((item) => typeof item === "string" && field.options?.includes(item)) &&
        new Set(value).size === value.length
        ? undefined
        : invalid;
    case "reference": {
      const validId = (id: unknown) => typeof id === "string" && isEntryId(id);
      return (
        field.ref?.multiple
          ? Array.isArray(value) && value.length <= 50 && value.every(validId)
          : validId(value)
      )
        ? undefined
        : invalid;
    }
    case "oracle":
      return oracleRows(value).ok ? undefined : invalid;
    case "actions":
      if (!Array.isArray(value) || value.length > 50) return invalid;
      for (const row of value) {
        if (
          typeof row !== "object" ||
          row === null ||
          Array.isArray(row) ||
          typeof row.name !== "string" ||
          !row.name.trim() ||
          (row.roll !== undefined &&
            (typeof row.roll !== "string" || !parseNotation(row.roll).ok)) ||
          (row.text !== undefined && typeof row.text !== "string") ||
          Object.keys(row).some((key) => !["name", "roll", "text"].includes(key))
        )
          return invalid;
      }
      return undefined;
    case "list":
    case "progression": {
      const maximum = field.kind === "list" ? 100 : 30;
      if (!Array.isArray(value) || value.length > maximum)
        return `${field.label} must have at most ${maximum} rows`;
      for (const row of value) {
        if (typeof row !== "object" || row === null || Array.isArray(row))
          return `Invalid row in ${field.label}`;
        if (
          field.kind === "progression" &&
          (!Number.isInteger(row.level) || row.level < 1 || row.level > 30)
        )
          return `${field.label} needs integer levels from 1–30`;
        for (const [columnKey, cell] of Object.entries(row)) {
          if (field.kind === "progression" && columnKey === "level") continue;
          if (columnKey === "_entry") {
            if (typeof cell !== "string") return `${field.label} row _entry must be a string`;
            continue;
          }
          if (columnKey === "_rev") {
            if (typeof cell !== "number" || !Number.isSafeInteger(cell) || cell < 0)
              return `${field.label} row _rev must be a non-negative integer`;
            continue;
          }
          const column: ListColumn | undefined = field.columns?.find(
            (candidate) => candidate.key === columnKey,
          );
          if (!column) return `Unknown column in ${field.label}: ${columnKey}`;
          if (!matchesKind(cell, column.kind, column.options))
            return `Invalid ${field.label} column ${column.label}`;
        }
      }
      return undefined;
    }
    default:
      return matchesKind(value, field.kind) ? undefined : invalid;
  }
};

export const entryError = (entry: SaveEntryInput, type: EntryType): string | undefined => {
  if (entry.typeId !== type.id) return "Entry type does not match";
  if (entry.id !== undefined) {
    const parts = parseEntryId(entry.id);
    if (!parts || parts.source !== WORLD_SOURCE || parts.typeId !== entry.typeId)
      return "Entry id must be world/<type>/<slug> with the entry's own type";
  }
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
    const error = fieldError(value, field);
    if (error) return error;
  }
  return undefined;
};

export const packError = (
  pack: CompendiumPack,
  existingTypes: readonly EntryType[] = [],
): string | undefined => {
  if (jsonBytes(pack) > compendiumLimits.packBytes) return "Pack JSON must be at most 4 MB";
  if (pack.types.length > compendiumLimits.types) return "A pack can have at most 50 entry types";
  if (pack.entries.length > compendiumLimits.entries)
    return `A pack can have at most ${compendiumLimits.entries} entries`;
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
    if (jsonBytes(entry) > compendiumLimits.entryBytes) return "Entry JSON must be at most 16 KB";
    // Legacy ids are import aliases, rather than ids a world writes today.
    const { id: _id, ...input } = entry;
    const error = entryError(pack.version === 1 ? input : entry, type);
    if (error) return error;
  }
  return undefined;
};
