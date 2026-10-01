import * as Schema from "effect/Schema";
import { expect, it } from "vitest";
import type { CompendiumEntry } from "./compendium";
import {
  applyOverride,
  overrideError,
  EntryOverride,
  EntryPatch,
  SaveOverrideInput,
} from "./overrides";

const entry: CompendiumEntry = {
  id: "lantern/item/moss-bell",
  typeId: "item",
  name: "Moss Bell",
  tags: ["invented"],
  body: "A brass bell filled with gentle green light.",
  fields: {
    cost: 3,
    lore: "Kept by the night gardeners.",
    actions: [{ name: "Ring", roll: "1d6" }],
  },
  visibility: "public",
  updatedAt: "2026-09-30T00:00:00Z",
  rev: 100,
  sourceRev: 7,
  sourceVersion: 2,
  licence: { id: "example", name: "Example", attribution: "Lantern authors.", shareAlike: true },
};
const override: EntryOverride = {
  entryId: entry.id,
  baseRev: 7,
  patch: { name: "Moon Bell", tags: [], body: "", fields: { cost: 0 }, removeFields: ["lore"] },
  licence: { id: "other", name: "Other", attribution: "Our group.", shareAlike: false },
  updatedAt: "2026-09-30T01:00:00Z",
};

it("applies replacements and field merge/removal without mutating or sharing nested values", () => {
  const original = structuredClone(entry);
  const originalOverride = structuredClone(override);
  const resolved = applyOverride(entry, override);
  expect(resolved).toEqual({
    ...entry,
    name: "Moon Bell",
    tags: [],
    body: "",
    fields: { cost: 0, actions: entry.fields.actions },
    licence: { ...entry.licence, attribution: "Lantern authors.\n\nOur group." },
  });
  expect(entry).toEqual(original);
  expect(override).toEqual(originalOverride);
  expect(resolved.fields.actions).not.toBe(entry.fields.actions);
  expect(resolved.tags).not.toBe(override.patch.tags);
  expect(resolved.licence).not.toBe(entry.licence);
  expect(resolved.rev).toBe(100);
  expect(resolved.sourceRev).toBe(7);
});

it("keeps intentional patches when the source revision advances", () => {
  expect(applyOverride({ ...entry, sourceRev: 8 }, override).name).toBe("Moon Bell");
  expect(applyOverride({ ...entry, sourceRev: 8 }, override).sourceRev).toBe(8);
});

it("never widens source DM visibility, but permits restricting a public entry", () => {
  expect(
    applyOverride({ ...entry, visibility: "dm" }, { ...override, patch: { visibility: "public" } })
      .visibility,
  ).toBe("dm");
  expect(applyOverride(entry, { ...override, patch: { visibility: "dm" } }).visibility).toBe("dm");
});

it("uses override attribution when older entries have no licence", () => {
  const { licence: _licence, ...legacy } = entry;
  expect(applyOverride(legacy, override).licence).toEqual(override.licence);
});

it("rejects identity changes and invalid base revisions", () => {
  expect(() => applyOverride(entry, { ...override, entryId: "lantern/item/other" })).toThrow();
  for (const baseRev of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => Schema.decodeUnknownSync(EntryOverride)({ ...override, baseRev })).toThrow();
    expect(() => Schema.decodeUnknownSync(SaveOverrideInput)({ baseRev, patch: {} })).toThrow();
  }
});

it("bounds patches and forbids schema bypasses, ambiguous removals and rights changes", () => {
  expect(overrideError({})).toBeUndefined();
  expect(overrideError(override.patch)).toBeUndefined();
  for (const invalid of [
    { name: " " },
    { name: "x".repeat(121) },
    { body: "x".repeat(12_001) },
    { tags: ["a", "a"] },
    { tags: [""] },
    { tags: ["x".repeat(41)] },
    { tags: Array.from({ length: 21 }, (_, index) => `tag${index}`) },
    { fields: { bad: null } },
    { fields: { cost: Infinity } },
    { fields: { actions: [{ name: "Ring", cost: NaN }] } },
    { fields: { "../cost": 1 } },
    { fields: Object.fromEntries(Array.from({ length: 41 }, (_, index) => [`key${index}`, 0])) },
    { fields: { cost: 1 }, removeFields: ["cost"] },
    { removeFields: ["cost", "cost"] },
    { removeFields: Array.from({ length: 41 }, (_, index) => `key${index}`) },
    { body: "é".repeat(10_000) },
    { id: "lantern/item/other" },
    { typeId: "other" },
    { licence: entry.licence },
    { rev: 99 },
    { visibility: "private" },
  ]) {
    expect(overrideError(invalid as EntryPatch), JSON.stringify(invalid)).toBeTypeOf("string");
    expect(() => Schema.decodeUnknownSync(EntryPatch)(invalid)).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(EntryOverride)({ ...override, patch: invalid }),
    ).toThrow();
  }
});

it("checks limits created by merging independently valid values", () => {
  const fields = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`key${index}`, 0]));
  const boundedEntry = { ...entry, fields };
  const additions = Schema.decodeUnknownSync(EntryOverride)({
    ...override,
    patch: { fields: { extra: 1 } },
  });
  expect(() => applyOverride(boundedEntry, additions)).toThrow("40 fields");
  const largeEntry = { ...entry, fields: { lore: "é".repeat(7_000) } };
  const largePatch = Schema.decodeUnknownSync(EntryOverride)({
    ...override,
    patch: { body: "x".repeat(4_000) },
  });
  expect(() => applyOverride(largeEntry, largePatch)).toThrow("16 KB");
});
