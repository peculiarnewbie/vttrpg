import * as Schema from "effect/Schema";
import { expect, it } from "vitest";
import { EntryType } from "./compendium";
import { entryTypesForLayout, presetEntryTypes } from "./compendium-presets";
import { allBlocks } from "./layout-edit";
import { bastionlandClassic, bastionlandCompact, mothership, presets } from "./sheet-presets";

it("ships valid entry types for known systems, returning independent copies and no content", () => {
  for (const layout of presets) {
    for (const type of presetEntryTypes(layout.system)) {
      expect(Schema.decodeUnknownResult(EntryType)(type)._tag).toBe("Success");
      // Shapes only: no text, entries or anything beyond a type's own definition.
      for (const key of Object.keys(type))
        expect(["fields", "filters", "id", "name", "plural"]).toContain(key);
    }
  }
  expect(presetEntryTypes("Unknown")).toEqual([]);
  expect(presetEntryTypes("constructor")).toEqual([]);
  const first = presetEntryTypes("Mythic Bastionland");
  expect(first).not.toBe(presetEntryTypes("Mythic Bastionland"));
  expect(first[0].fields).not.toBe(presetEntryTypes("Mythic Bastionland")[0].fields);
  expect(first[0].fields[1].columns).not.toBe(
    presetEntryTypes("Mythic Bastionland")[0].fields[1].columns,
  );
  expect(
    presetEntryTypes("Blades in the Dark").find((type) => type.id === "playbook"),
  ).toMatchObject({ fields: expect.any(Array) });
});

it("resolves every preset layout reference to a preset type, including grouped entry blocks", () => {
  for (const layout of presets) {
    const types = presetEntryTypes(layout.system);
    const referenced = allBlocks(layout).flatMap((block) =>
      block.type === "entry"
        ? [block.entryType]
        : block.type === "list" && block.source
          ? [block.source.entryType]
          : [],
    );
    expect(referenced.every((id) => types.some((type) => type.id === id))).toBe(true);
    expect(
      entryTypesForLayout(layout)
        .map((type) => type.id)
        .sort(),
    ).toEqual([...new Set(referenced)].sort());
  }
  expect(entryTypesForLayout(bastionlandClassic).map((type) => type.id)).toEqual(["knight"]);
  expect(entryTypesForLayout({ ...bastionlandClassic, system: "Unknown" })).toEqual([]);
});

it("gives Knights only Ability and Property, with the exact Property columns and fill wiring", () => {
  const knight = presetEntryTypes("Mythic Bastionland")[0];
  expect(knight.fields.map((field) => field.key)).toEqual(["ability", "property"]);
  for (const layout of [bastionlandClassic, bastionlandCompact]) {
    const blocks = allBlocks(layout);
    const property = blocks.find((block) => block.type === "list" && block.key === "property");
    expect(property?.type === "list" && property.columns).toEqual(knight.fields[1].columns);
    expect(blocks.find((block) => block.type === "entry")).toMatchObject({
      key: "knight",
      entryType: "knight",
      show: ["ability"],
      fill: [{ from: "property", to: "property" }],
    });
    expect(property?.type === "list" && property.source).toBeUndefined();
  }
  expect(allBlocks(bastionlandClassic).find((block) => block.id === "ability")).toMatchObject({
    type: "text",
  });
});

it("matches Mothership entry fields to its existing loadout columns", () => {
  const types = presetEntryTypes("Mothership");
  for (const key of ["weapons", "gear"]) {
    const list = allBlocks(mothership).find((block) => block.type === "list" && block.key === key);
    if (list?.type !== "list") throw new Error("Missing loadout list");
    const type = types.find((type) => type.id === list.source?.entryType);
    expect(type?.fields).toEqual(list.columns.filter((column) => column.key !== "name"));
  }
});
