import { expect, it } from "vitest";
import type { CompendiumEntry, EntryFieldKind, EntryType } from "./compendium";
import { entryFacets } from "./entry-facets";

const entry = (fields: CompendiumEntry["fields"]) => ({ fields, tags: ["entry tag"] });
const type: EntryType = {
  id: "test",
  name: "Test",
  fields: [
    { key: "level", label: "Level", kind: "number" },
    { key: "school", label: "School", kind: "select", options: ["Arcane"] },
    { key: "senses", label: "Senses", kind: "set", options: ["Sight"] },
    { key: "tags", label: "Tags", kind: "tags" },
    { key: "actions", label: "Actions", kind: "actions" },
  ],
  filters: [
    { key: "level", kind: "range" },
    { key: "school", kind: "set" },
    { key: "senses", kind: "set" },
    { key: "tags", kind: "set" },
    { key: "actions", kind: "flag" },
    { key: "missing", kind: "flag" },
  ],
};

it("copies only declared facets, trims sets, and uses field tags rather than entry tags", () => {
  const fields = {
    level: " 2 ",
    school: " Arcane ",
    senses: [" Sight ", ""],
    tags: ["", " ", "tag"],
    actions: [{ name: "Move" }],
  };
  expect(entryFacets(entry(fields), type)).toEqual({
    level: 2,
    school: "Arcane",
    senses: ["Sight"],
    tags: ["tag"],
    actions: true,
  });
  expect(fields.senses).toEqual([" Sight ", ""]);
  expect(entryFacets(entry({}), type)).toEqual({ actions: false });
  expect(entryFacets(entry({ actions: [] }), type)).toEqual({ actions: false });
  expect(entryFacets(entry({ school: " ", senses: [], tags: [" "] }), type)).toEqual({
    actions: false,
  });
  expect(entryFacets(entry({}), { ...type, filters: undefined })).toBeUndefined();
  expect(entryFacets(entry({}), { ...type, filters: [] })).toBeUndefined();
});

it.each(["", " ", "bad", "Infinity", NaN, Infinity, -Infinity, true, ["2"]])(
  "skips non-finite range values: %j",
  (level) => {
    expect(entryFacets(entry({ level }), type)).toEqual({ actions: false });
  },
);

const kinds: EntryFieldKind[] = [
  "text",
  "longtext",
  "number",
  "dice",
  "tags",
  "list",
  "select",
  "set",
  "reference",
  "actions",
  "progression",
  "oracle",
];

it.each(kinds)("extracts compatible range and set facets only for %s", (kind) => {
  const field = { key: "value", label: "Value", kind };
  const filterType = (filterKind: "range" | "set" | "flag"): EntryType => ({
    ...type,
    fields: [field],
    filters: [{ key: "value", kind: filterKind }],
  });
  expect(entryFacets(entry({ value: "2" }), filterType("range"))).toEqual(
    kind === "number" ? { value: 2 } : {},
  );
  expect(entryFacets(entry({ value: " choice " }), filterType("set"))).toEqual(
    kind === "select" ? { value: "choice" } : {},
  );
  expect(entryFacets(entry({ value: [" choice ", " "] }), filterType("set"))).toEqual(
    kind === "set" || kind === "tags" ? { value: ["choice"] } : {},
  );
  expect(entryFacets(entry({ value: "filled" }), filterType("flag"))).toEqual({ value: true });
  expect(entryFacets(entry({}), filterType("flag"))).toEqual({ value: false });
});

it("flags empty strings and arrays as unfilled and zero as filled", () => {
  const flagType: EntryType = {
    ...type,
    fields: [{ key: "value", label: "Value", kind: "text" }],
    filters: [{ key: "value", kind: "flag" }],
  };
  for (const value of [false, "", " \n ", [], ["", " "]])
    expect(entryFacets(entry({ value }), flagType)).toEqual({ value: false });
  for (const value of [0, "0", [{ name: "Move" }]])
    expect(entryFacets(entry({ value }), flagType)).toEqual({ value: true });
});
