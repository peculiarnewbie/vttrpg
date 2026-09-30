import { describe, expect, it } from "vitest";
import { entryError, packError, typeError } from "./compendium-rules";
import {
  compendiumLimits,
  type CompendiumPack,
  type EntryType,
  type SaveEntryInput,
} from "./compendium";

const type: EntryType = {
  id: "item",
  name: "Item",
  fields: [
    { key: "text", label: "Text", kind: "text" },
    { key: "description", label: "Description", kind: "longtext" },
    { key: "cost", label: "Cost", kind: "number" },
    { key: "dice", label: "Dice", kind: "dice" },
    { key: "tags", label: "Tags", kind: "tags" },
    {
      key: "list",
      label: "List",
      kind: "list",
      columns: [
        { key: "name", label: "Name", kind: "text" },
        { key: "cost", label: "Cost", kind: "number" },
        { key: "dice", label: "Dice", kind: "dice" },
        { key: "tags", label: "Tags", kind: "tags" },
        { key: "ready", label: "Ready", kind: "check" },
      ],
    },
  ],
};
const entry: SaveEntryInput = {
  typeId: "item",
  name: "Sword",
  tags: [],
  body: "",
  fields: {},
  visibility: "public",
};
const pack: CompendiumPack = {
  format: "ttrpg-pack",
  version: 1,
  name: "Gear",
  types: [type],
  entries: [{ ...entry, id: "ent_sword" }],
};

const fieldType = (fields: EntryType["fields"]): EntryType => ({ ...type, fields });

describe("compendium type rules", () => {
  it("accepts valid slugs, optional plural and empty field sets", () => {
    expect(typeError(type)).toBeUndefined();
    expect(typeError({ id: "0-a_b", name: "A", plural: "Things", fields: [] })).toBeUndefined();
    expect(typeError({ ...type, id: "x".repeat(40), name: "x".repeat(120) })).toBeUndefined();
    expect(
      typeError(
        fieldType(
          Array.from({ length: 40 }, (_, i) => ({
            key: `field_${i}`,
            label: "Field",
            kind: "text",
          })),
        ),
      ),
    ).toBeUndefined();
  });

  it.each(["", " ", "Upper", "_leading", "has space", "bad.dot", "x".repeat(41)])(
    "rejects type id %j",
    (id) => {
      expect(typeError({ ...type, id })).toContain("Type id");
    },
  );

  it.each<EntryType>([
    { ...type, name: " " },
    { ...type, name: "x".repeat(121) },
    fieldType(
      Array.from({ length: 41 }, (_, i) => ({ key: `field_${i}`, label: "Field", kind: "text" })),
    ),
    fieldType([{ key: "Bad", label: "Field", kind: "text" }]),
    fieldType([{ key: "text", label: " ", kind: "text" }]),
    fieldType([type.fields[0], type.fields[0]]),
    fieldType([{ key: "list", label: "List", kind: "list" }]),
    fieldType([{ key: "list", label: "List", kind: "list", columns: [] }]),
    fieldType([{ ...type.fields[0], columns: [] }]),
    fieldType([
      {
        key: "list",
        label: "List",
        kind: "list",
        columns: [{ key: "Bad", label: "Name", kind: "text" }],
      },
    ]),
    fieldType([
      {
        key: "list",
        label: "List",
        kind: "list",
        columns: [{ key: "name", label: " ", kind: "text" }],
      },
    ]),
    fieldType([
      {
        key: "list",
        label: "List",
        kind: "list",
        columns: [
          { key: "name", label: "Name", kind: "text" },
          { key: "name", label: "Name", kind: "text" },
        ],
      },
    ]),
  ])("rejects invalid type definitions: %j", (invalid) => {
    expect(typeError(invalid)).toBeTypeOf("string");
  });

  it("counts type upserts once against the world limit", () => {
    const others = Array.from({ length: 50 }, (_, i) => ({ ...type, id: `type_${i}` }));
    expect(typeError({ ...type, id: "type_0" }, others)).toBeUndefined();
    expect(typeError(type, others)).toContain("50");
  });
});

describe("compendium entry rules", () => {
  it("accepts missing fields, trims names for validation, and leaves dice uninterpreted", () => {
    expect(entryError(entry, type)).toBeUndefined();
    expect(
      entryError(
        {
          ...entry,
          name: ` ${"x".repeat(120)} `,
          fields: {
            text: "",
            description: "Long text",
            cost: 1.5,
            dice: "table decides",
            tags: ["old"],
            list: [
              {
                name: "Shield",
                cost: 0,
                dice: "?",
                tags: [],
                ready: true,
                _entry: "ent_shield",
                _rev: 1,
              },
              {},
            ],
          },
        },
        type,
      ),
    ).toBeUndefined();
  });

  it.each<Partial<SaveEntryInput>>([
    { typeId: "missing" },
    { name: " " },
    { name: "x".repeat(121) },
    { tags: Array(21).fill("tag") },
    { tags: ["x".repeat(41)] },
    { body: "x".repeat(12001) },
    { fields: { unknown: "value" } },
    { fields: { text: 1 } },
    { fields: { description: false } },
    { fields: { cost: "1" } },
    { fields: { cost: Infinity } },
    { fields: { cost: NaN } },
    { fields: { dice: 1 } },
    { fields: { dice: "x".repeat(41) } },
    { fields: { tags: "tag" } },
    { fields: { tags: Array(51).fill("tag") } },
    { fields: { tags: [{ name: "tag" }] } },
    { fields: { list: "row" } },
    { fields: { list: Array(101).fill({}) } },
    { fields: { list: ["row"] } },
    { fields: { list: [{ unknown: "value" }] } },
    { fields: { list: [{ _entry: 1 }] } },
    { fields: { list: [{ _rev: "1" }] } },
    { fields: { list: [{ _rev: -1 }] } },
    { fields: { list: [{ _rev: 1.5 }] } },
    { fields: { list: [{ name: 1 }] } },
    { fields: { list: [{ cost: "1" }] } },
    { fields: { list: [{ cost: -Infinity }] } },
    { fields: { list: [{ dice: "x".repeat(41) }] } },
    { fields: { list: [{ ready: "yes" }] } },
    { fields: { list: [{ tags: "tag" }] } },
    { fields: { list: [{ tags: Array(51).fill("tag") }] } },
  ])("rejects invalid entry values: %j", (invalid) => {
    expect(entryError({ ...entry, ...invalid }, type)).toBeTypeOf("string");
  });

  it("validates supplied world ids against their entry type", () => {
    expect(entryError({ ...entry, id: "world/item/sword" }, type)).toBeUndefined();
    for (const id of [
      "",
      "ent_sword",
      "srd52/item/sword",
      "world/spell/sword",
      "world/item/Bad",
    ]) {
      expect(entryError({ ...entry, id }, type)).toContain("Entry id");
    }
  });

  it("accepts boundary sizes and measures JSON as UTF-8 bytes", () => {
    expect(
      entryError({ ...entry, body: "x".repeat(12000), tags: Array(20).fill("x".repeat(40)) }, type),
    ).toBeUndefined();
    expect(
      entryError(
        {
          ...entry,
          fields: { dice: "x".repeat(40), tags: Array(50).fill("tag"), list: Array(100).fill({}) },
        },
        type,
      ),
    ).toBeUndefined();
    expect(entryError({ ...entry, body: "界".repeat(6000) }, type)).toContain("16 KB");
    expect(
      entryError({ ...entry, fields: { text: "x".repeat(compendiumLimits.entryBytes) } }, type),
    ).toContain("16 KB");
  });
});

describe("compendium pack rules", () => {
  it("accepts packs and references to existing types, with packed definitions taking precedence", () => {
    expect(packError(pack)).toBeUndefined();
    expect(packError({ ...pack, types: [] }, [type])).toBeUndefined();
    expect(packError(pack, [{ ...type, fields: [] }])).toBeUndefined();
    expect(
      packError(
        {
          ...pack,
          entries: [{ ...pack.entries[0], fields: { text: "old" } }],
          types: [{ ...type, fields: [] }],
        },
        [type],
      ),
    ).toContain("Unknown entry field");
  });

  it.each<Partial<CompendiumPack>>([
    { types: [type, type] },
    { entries: [pack.entries[0], pack.entries[0]] },
    { types: [] },
    { types: [{ ...type, name: "" }] },
    { entries: [{ ...pack.entries[0], id: " " }] },
    { entries: [{ ...pack.entries[0], body: "x".repeat(12001) }] },
    { types: Array.from({ length: 51 }, (_, i) => ({ ...type, id: `type_${i}` })) },
    {
      entries: Array.from({ length: compendiumLimits.entries + 1 }, (_, i) => ({
        ...pack.entries[0],
        id: `ent_${i}`,
      })),
    },
    { name: "x".repeat(compendiumLimits.packBytes) },
  ])("rejects invalid packs: %j", (invalid) => {
    expect(packError({ ...pack, ...invalid })).toBeTypeOf("string");
  });

  it("accepts exactly 50 types and the entry limit", () => {
    expect(
      packError({
        ...pack,
        types: [type, ...Array.from({ length: 49 }, (_, i) => ({ ...type, id: `type_${i}` }))],
        entries: Array.from({ length: compendiumLimits.entries }, (_, i) => ({
          ...pack.entries[0],
          id: `ent_${i}`,
        })),
      }),
    ).toBeUndefined();
  });

  it("accepts arbitrary non-empty legacy ids, but requires world ids of the entry's own type in version 2", () => {
    for (const id of [
      "ent_sword",
      "old-id",
      "Old / legacy",
      "srd52/item/sword",
      "world/spell/sword",
    ]) {
      expect(packError({ ...pack, entries: [{ ...pack.entries[0], id }] })).toBeUndefined();
      expect(packError({ ...pack, version: 2, entries: [{ ...pack.entries[0], id }] })).toContain(
        "Entry id",
      );
    }
    expect(
      packError({ ...pack, version: 2, entries: [{ ...pack.entries[0], id: "world/item/sword" }] }),
    ).toBeUndefined();
    expect(
      packError({ ...pack, version: 2, entries: [{ ...pack.entries[0], id: " " }] }),
    ).toContain("must not be empty");
  });

  it("reports the configured entry limit", () => {
    expect(
      packError({
        ...pack,
        entries: Array.from({ length: compendiumLimits.entries + 1 }, (_, i) => ({
          ...pack.entries[0],
          id: `ent_${i}`,
        })),
      }),
    ).toBe(`A pack can have at most ${compendiumLimits.entries} entries`);
  });

  it("counts legacy ids toward the entry byte limit", () => {
    expect(
      packError({
        ...pack,
        entries: [{ ...pack.entries[0], id: "x".repeat(compendiumLimits.entryBytes) }],
      }),
    ).toBe("Entry JSON must be at most 16 KB");
  });
});
