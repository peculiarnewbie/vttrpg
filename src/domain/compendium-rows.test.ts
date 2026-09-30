import { expect, it } from "vitest";
import type { CompendiumEntry, EntryType } from "./compendium";
import type { ListColumn } from "./sheet-layout";
import {
  entryFieldsForDisplay,
  revOf,
  rowFromEntry,
  rowsFromEntryList,
  sourceOf,
} from "./compendium-rows";

const columns: ListColumn[] = [
  { key: "name", label: "Name", kind: "text" },
  { key: "shots", label: "Shots", kind: "number" },
  { key: "dmg", label: "Damage", kind: "dice" },
  { key: "tags", label: "Tags", kind: "tags" },
  { key: "carried", label: "Carried", kind: "check" },
];
const entry: CompendiumEntry = {
  id: "ent_test",
  typeId: "weapon",
  name: "Test weapon",
  tags: [],
  body: "",
  fields: { name: "Wrong", shots: " 12 ", dmg: "d6", tags: ["Heavy"], carried: false, extra: true },
  visibility: "public",
  updatedAt: "now",
};

it("copies only matching columns, coerces numbers, uses the entry name and records its source", () => {
  const row = rowFromEntry(entry, columns);
  expect(row).toEqual({
    name: "Test weapon",
    shots: 12,
    dmg: "d6",
    tags: ["Heavy"],
    carried: false,
    _entry: "ent_test",
  });
  expect(row.tags).not.toBe(entry.fields.tags);
  expect(sourceOf(row)).toBe(entry.id);
  expect(rowFromEntry(entry, [])).toEqual({ _entry: entry.id });
  expect(sourceOf({})).toBeUndefined();
  expect(sourceOf({ _entry: 1 })).toBeUndefined();
  expect(sourceOf({ _entry: "" })).toBeUndefined();
});

it("records revisions on copies and nested list rows, ignoring derived columns", () => {
  const withRev = {
    ...entry,
    rev: 7,
    fields: { ...entry.fields, total: 99, property: [{ name: "Rope", total: 3, _rev: 1 }] },
  };
  const withDerived: ListColumn[] = [
    ...columns,
    { key: "total", label: "Total", kind: "derived", expr: "@row.shots + 1" },
  ];
  expect(rowFromEntry(withRev, withDerived)).toEqual({ ...rowFromEntry(entry, columns), _rev: 7 });
  expect(rowsFromEntryList(withRev, "property", withDerived)).toEqual([
    { name: "Rope", _entry: entry.id, _rev: 7 },
  ]);
  expect(revOf(rowFromEntry(withRev, withDerived))).toBe(7);
  expect(revOf({ _rev: 0 })).toBe(0);
  expect(revOf({})).toBeUndefined();
  for (const _rev of ["7", true, ["7"], -1, 1.5, Infinity, NaN])
    expect(revOf({ _rev })).toBeUndefined();
});

it("skips mismatches, blank numbers and non-finite numbers, keeping valid zero values", () => {
  for (const shots of ["", " ", "Infinity", "no", true, ["1"], Infinity, NaN]) {
    expect(rowFromEntry({ ...entry, fields: { shots } }, columns)).toEqual({
      name: entry.name,
      _entry: entry.id,
    });
  }
  expect(
    rowFromEntry({ ...entry, fields: { shots: "0", dmg: 6, tags: [{}], carried: "yes" } }, columns),
  ).toEqual({ name: entry.name, shots: 0, _entry: entry.id });
});

it("copies list rows without extra columns or their previous source, preserving row names", () => {
  const original = { name: "Rope", shots: "2", tags: ["Long"], extra: "ignore", _entry: "old" };
  const withList = { ...entry, fields: { property: [original, { name: "Torch", shots: "bad" }] } };
  const rows = rowsFromEntryList(withList, "property", columns);
  expect(rows).toEqual([
    { name: "Rope", shots: 2, tags: ["Long"], _entry: entry.id },
    { name: "Torch", _entry: entry.id },
  ]);
  expect(rows[0]).not.toBe(original);
  expect(rows[0].tags).not.toBe(original.tags);
  expect(original._entry).toBe("old");
  expect(rowsFromEntryList(entry, "missing", columns)).toEqual([]);
  expect(rowsFromEntryList(entry, "tags", columns)).toEqual([]);
  expect(rowsFromEntryList(entry, "dmg", columns)).toEqual([]);
});

it("shows populated fields in type order, including zero and false, respecting an optional show list", () => {
  const type: EntryType = {
    id: "test",
    name: "Test",
    fields: ["missing", "blank", "tags", "shots", "carried", "dmg", "property"].map((key) => ({
      key,
      label: key,
      kind: "text",
    })),
  };
  const populated = {
    ...entry,
    fields: { ...entry.fields, blank: " \n", tags: [], shots: 0, property: [] },
  };
  expect(
    entryFieldsForDisplay(populated, type).map(({ field, value }) => [field.key, value]),
  ).toEqual([
    ["shots", 0],
    ["carried", false],
    ["dmg", "d6"],
  ]);
  expect(
    entryFieldsForDisplay(populated, type, ["dmg", "shots", "unknown"]).map(
      ({ field }) => field.key,
    ),
  ).toEqual(["shots", "dmg"]);
  expect(entryFieldsForDisplay(populated, type, [])).toEqual([]);
});
