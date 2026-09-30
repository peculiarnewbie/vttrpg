import { expect, it } from "vitest";
import type { CompendiumEntry } from "./compendium";
import { rowFromEntry } from "./compendium-rows";
import { applyRowUpdate, rowUpdate } from "./entry-diff";
import type { ListColumn, ListRow } from "./sheet-layout";

const columns: ListColumn[] = [
  { key: "name", label: "Name", kind: "text" },
  { key: "shots", label: "Shots", kind: "number" },
  { key: "tags", label: "Tags", kind: "tags" },
  { key: "ready", label: "Ready", kind: "check" },
  { key: "damage", label: "Damage", kind: "dice" },
  { key: "total", label: "Total", kind: "derived", expr: "@row.shots + 1" },
];
const entry: CompendiumEntry = {
  id: "world/weapon/sword",
  typeId: "weapon",
  name: "Sword",
  tags: [],
  fields: {
    name: "Wrong name",
    shots: "12",
    tags: ["Heavy"],
    ready: false,
    damage: "d6",
    total: 99,
  },
  body: "",
  visibility: "public",
  updatedAt: "now",
  rev: 2,
};

it("offers no update without a matching source and an older recorded revision", () => {
  const row = rowFromEntry(entry, columns);
  expect(rowUpdate({ _entry: entry.id }, entry, columns)).toBeUndefined();
  expect(rowUpdate({ ...row, _entry: "other", _rev: 1 }, entry, columns)).toBeUndefined();
  expect(rowUpdate({ ...row, _entry: "", _rev: 1 }, entry, columns)).toBeUndefined();
  expect(rowUpdate(row, entry, columns)).toBeUndefined();
  expect(rowUpdate({ ...row, _rev: 3 }, entry, columns)).toBeUndefined();
  expect(rowUpdate({ ...row, _rev: 1 }, { ...entry, rev: undefined }, columns)).toBeUndefined();
});

it("compares current copied cells with the newer entry, using the entry name and column coercion", () => {
  const row: ListRow = { ...rowFromEntry(entry, columns), _rev: 1 };
  const newer = {
    ...entry,
    name: "Longsword",
    fields: { ...entry.fields, shots: "0", ready: true },
  };
  expect(rowUpdate(row, newer, columns)).toEqual({
    rev: 2,
    changes: [
      { key: "name", label: "Name", from: "Sword", to: "Longsword" },
      { key: "shots", label: "Shots", from: 12, to: 0 },
      { key: "ready", label: "Ready", from: false, to: true },
    ],
  });
  expect(applyRowUpdate(row, newer, columns)).toEqual({
    ...row,
    name: "Longsword",
    shots: 0,
    ready: true,
    _rev: 2,
  });
  expect(row.name).toBe("Sword");
});

it("offers a revision-only update for equal values, comparing tag arrays structurally", () => {
  const row: ListRow = { ...rowFromEntry(entry, columns), _rev: 1 };
  expect(row.tags).not.toBe(entry.fields.tags);
  expect(rowUpdate(row, entry, columns)).toEqual({ rev: 2, changes: [] });
  expect(applyRowUpdate(row, entry, columns)).toEqual({ ...row, _rev: 2 });
});

it("includes player edits and changed tags, including newly filled cells", () => {
  const row = {
    _entry: entry.id,
    _rev: 1,
    name: "My sword",
    shots: 3,
    tags: ["Light"],
    ready: false,
  };
  expect(rowUpdate(row, entry, columns)).toEqual({
    rev: 2,
    changes: [
      { key: "name", label: "Name", from: "My sword", to: "Sword" },
      { key: "shots", label: "Shots", from: 3, to: 12 },
      { key: "tags", label: "Tags", from: ["Light"], to: ["Heavy"] },
      { key: "damage", label: "Damage", from: undefined, to: "d6" },
    ],
  });
});

it("keeps extra keys and cells the entry cannot fill, ignoring derived columns", () => {
  const row = { ...rowFromEntry(entry, columns), _rev: 1, total: 123, custom: "Keep", shots: 8 };
  const partial = { ...entry, fields: { ...entry.fields, shots: "bad", damage: 6 } };
  expect(rowUpdate(row, partial, columns)).toEqual({ rev: 2, changes: [] });
  const updated = applyRowUpdate(row, partial, columns);
  expect(updated).toEqual({ ...row, _rev: 2 });
  expect(updated).not.toBe(row);
  expect(updated.tags).not.toBe(entry.fields.tags);
  expect(row._rev).toBe(1);
  expect(applyRowUpdate(row, { ...partial, rev: undefined }, columns)._rev).toBe(1);
});
