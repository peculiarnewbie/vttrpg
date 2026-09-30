import { describe, expect, it } from "vitest";
import { entryError, packError, typeError } from "./compendium-rules";
import type { ListRow } from "./sheet-layout";
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
    for (const id of ["", "ent_sword", "srd52/item/sword", "world/spell/sword", "world/item/Bad"]) {
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

const richerType: EntryType = {
  id: "content",
  name: "Content",
  fields: [
    { key: "choice", label: "Choice", kind: "select", options: ["A", "B"] },
    { key: "choices", label: "Choices", kind: "set", options: ["A", "B"] },
    { key: "ref", label: "Reference", kind: "reference", ref: { typeIds: ["future"] } },
    {
      key: "refs",
      label: "References",
      kind: "reference",
      ref: { typeIds: ["future"], multiple: true },
    },
    { key: "actions", label: "Actions", kind: "actions" },
    {
      key: "levels",
      label: "Levels",
      kind: "progression",
      columns: [
        { key: "choice", label: "Choice", kind: "select", options: ["A", "B"] },
        { key: "progress", label: "Progress", kind: "progress" },
        { key: "total", label: "Total", kind: "derived", expr: "@row.progress" },
      ],
    },
    { key: "oracle", label: "Oracle", kind: "oracle", dice: "d%" },
  ],
};
const richerEntry: SaveEntryInput = { ...entry, typeId: richerType.id };

it("accepts new definitions and values, including empty choices, missing columns and forward references", () => {
  expect(typeError(richerType)).toBeUndefined();
  expect(
    typeError({ ...richerType, fields: [{ key: "levels", label: "Levels", kind: "progression" }] }),
  ).toBeUndefined();
  expect(
    entryError(
      {
        ...richerEntry,
        fields: {
          choice: "",
          choices: [],
          ref: "library/future/example",
          refs: [],
          actions: [],
          levels: [],
          oracle: [],
        },
      },
      richerType,
    ),
  ).toBeUndefined();
  expect(
    entryError(
      {
        ...richerEntry,
        fields: {
          choice: "A",
          choices: ["A", "B"],
          ref: "world/future/example",
          refs: ["library/future/example"],
          actions: [
            { name: "Action", roll: "1d20 + @bonus | d6", text: "What the players decide" },
            { name: "Move" },
          ],
          levels: [
            { level: 30, choice: "B", progress: 40, _entry: "legacy", _rev: 0 },
            { level: 1 },
          ],
          oracle: [
            { min: 3, max: 3, text: "Three" },
            { min: 1, max: 1, text: "One" },
          ],
        },
      },
      richerType,
    ),
  ).toBeUndefined();
});

it.each(["select", "set"] as const)("requires bounded unique options for %s fields", (kind) => {
  const testType = (options?: readonly string[]) => ({
    ...type,
    fields: [{ key: "choice", label: "Choice", kind, options }],
  });
  for (const options of [
    undefined,
    [],
    [""],
    [" "],
    ["A", "A"],
    ["x".repeat(61)],
    Array.from({ length: 51 }, (_, index) => String(index)),
  ])
    expect(typeError(testType(options))).toContain("Choice");
  expect(
    typeError(testType(Array.from({ length: 50 }, (_, index) => `${index}`.padEnd(60, "x")))),
  ).toBeUndefined();
});

it("validates reference ids, oracle notation and allowed column definitions", () => {
  const invalidFields: EntryType["fields"] = [
    { key: "field", label: "Field", kind: "reference" },
    { key: "field", label: "Field", kind: "reference", ref: { typeIds: [] } },
    { key: "field", label: "Field", kind: "reference", ref: { typeIds: [""] } },
    { key: "field", label: "Field", kind: "reference", ref: { typeIds: ["Bad"] } },
    { key: "field", label: "Field", kind: "reference", ref: { typeIds: Array(11).fill("future") } },
    { key: "field", label: "Field", kind: "oracle" },
    ...["", "bad", "d0", "d6+@bonus", "(@pool)d6", "d6 | @{bonus}"].map((dice) => ({
      key: "field",
      label: "Field",
      kind: "oracle" as const,
      dice,
    })),
    { key: "field", label: "Field", kind: "actions", columns: [] },
    {
      key: "field",
      label: "Field",
      kind: "progression",
      columns: [{ key: "level", label: "Level", kind: "number" }],
    },
    {
      key: "field",
      label: "Field",
      kind: "list",
      columns: [{ key: "choice", label: "Choice", kind: "select" }],
    },
    {
      key: "field",
      label: "Field",
      kind: "progression",
      columns: [{ key: "choice", label: "Choice", kind: "select", options: ["A", "A"] }],
    },
  ];
  for (const field of invalidFields) expect(typeError(fieldType([field]))).toContain("Field");
  expect(
    typeError(
      fieldType([
        {
          key: "field",
          label: "Field",
          kind: "reference",
          ref: { typeIds: Array.from({ length: 10 }, (_, index) => `future_${index}`) },
        },
      ]),
    ),
  ).toBeUndefined();
  for (const kind of ["list", "progression"] as const) {
    expect(
      typeError(
        fieldType([
          {
            key: "field",
            label: "Field",
            kind,
            columns: [
              { key: "progress", label: "Progress", kind: "progress" },
              { key: "choice", label: "Choice", kind: "select", options: ["A"] },
            ],
          },
        ]),
      ),
    ).toBeUndefined();
  }
});

const fieldKinds = [
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
] as const;

it.each(fieldKinds)("validates filter compatibility with %s fields", (kind) => {
  const field = {
    ...richerType.fields.find((candidate) => candidate.kind === kind),
    ...type.fields.find((candidate) => candidate.kind === kind),
    key: "field",
    label: "Field",
    kind,
  };
  for (const filterKind of ["range", "set", "flag"] as const) {
    const error = typeError({
      ...type,
      fields: [field],
      filters: [{ key: "field", kind: filterKind }],
    });
    const compatible =
      filterKind === "flag" ||
      (filterKind === "range" ? kind === "number" : ["select", "set", "tags"].includes(kind));
    expect(error === undefined).toBe(compatible);
  }
});

it("rejects unknown, repeated and excessive filters", () => {
  expect(typeError({ ...type, filters: [{ key: "missing", kind: "flag" }] })).toContain("missing");
  expect(
    typeError({
      ...type,
      filters: [
        { key: "text", kind: "flag" },
        { key: "text", kind: "flag" },
      ],
    }),
  ).toContain("text");
  const fields = Array.from({ length: 11 }, (_, index) => ({
    key: `field_${index}`,
    label: "Field",
    kind: "number" as const,
  }));
  const filters = fields.map(({ key }) => ({ key, kind: "range" as const }));
  expect(typeError({ ...type, fields, filters })).toContain("10");
  expect(typeError({ ...type, fields, filters: filters.slice(0, 10) })).toBeUndefined();
});

it.each<[string, SaveEntryInput["fields"][string]]>([
  ["choice", "C"],
  ["choice", 1],
  ["choices", "A"],
  ["choices", ["A", "A"]],
  ["choices", ["C"]],
  ["choices", [""]],
  ["ref", "ent_old"],
  ["ref", ""],
  ["ref", ["world/future/a"]],
  ["ref", 1],
  ["refs", "world/future/a"],
  ["refs", ["bad"]],
  ["refs", Array(51).fill("world/future/a")],
  ["actions", "action"],
  ["actions", ["action"]],
  ["actions", [{ name: " " }]],
  ["actions", [{ name: 1 }]],
  ["actions", [{ name: "A", roll: "" }]],
  ["actions", [{ name: "A", roll: "bad" }]],
  ["actions", [{ name: "A", roll: 1 }]],
  ["actions", [{ name: "A", text: 1 }]],
  ["actions", [{ name: "A", extra: true }]],
  ["actions", [{ name: "A", _entry: "world/future/a" }]],
  ["actions", Array(51).fill({ name: "A" })],
  ["levels", "row"],
  ["levels", ["row"]],
  ["levels", [{}]],
  ["levels", [{ level: "1" }]],
  ["levels", [{ level: 0 }]],
  ["levels", [{ level: -1 }]],
  ["levels", [{ level: 31 }]],
  ["levels", [{ level: 1.5 }]],
  ["levels", [{ level: NaN }]],
  ["levels", [{ level: Infinity }]],
  ["levels", [{ level: 1, unknown: "A" }]],
  ["levels", [{ level: 1, choice: "C" }]],
  ["levels", [{ level: 1, progress: -1 }]],
  ["levels", [{ level: 1, progress: 41 }]],
  ["levels", [{ level: 1, progress: 1.5 }]],
  ["levels", [{ level: 1, progress: "4" }]],
  ["levels", [{ level: 1, total: 1 }]],
  ["levels", [{ level: 1, _rev: -1 }]],
  ["levels", [{ level: 1, _entry: 1 }]],
  ["levels", Array(31).fill({ level: 1 })],
  [
    "oracle",
    [
      { min: 1, max: 2, text: "One" },
      { min: 2, max: 3, text: "Two" },
    ],
  ],
  ["oracle", [{ min: 1, max: 1, text: "" }]],
  ["oracle", [{ min: 1.5, max: 2, text: "One" }]],
  ["oracle", "table"],
])("rejects invalid %s values and names the field", (key, value) => {
  expect(entryError({ ...richerEntry, fields: { [key]: value } }, richerType)).toContain(
    richerType.fields.find((field) => field.key === key)?.label,
  );
});

it("accepts row-count boundaries, duplicates at a level and select/progress list cells", () => {
  expect(
    entryError(
      {
        ...richerEntry,
        fields: {
          refs: Array(50).fill("world/future/a"),
          actions: Array(50).fill({ name: "A" }),
          levels: Array(30).fill({ level: 1 }),
          oracle: Array.from({ length: 200 }, (_, min) => ({ min, max: min, text: "x" })),
        },
      },
      richerType,
    ),
  ).toBeUndefined();
  const listType = fieldType([
    { key: "list", label: "List", kind: "list", columns: richerType.fields[5].columns },
  ]);
  expect(
    entryError(
      {
        ...entry,
        fields: {
          list: [
            { choice: "", progress: 0 },
            { choice: "A", progress: 40 },
          ],
        },
      },
      listType,
    ),
  ).toBeUndefined();
  const invalidRows: ListRow[] = [
    { choice: "C" },
    { choice: 1 },
    { progress: Infinity },
    { progress: NaN },
    { progress: true },
  ];
  for (const row of invalidRows)
    expect(entryError({ ...entry, fields: { list: [row] } }, listType)).toContain("List");
});

it("applies new type and entry validation to packs", () => {
  const richerPack: CompendiumPack = {
    ...pack,
    version: 2,
    types: [richerType],
    entries: [{ ...richerEntry, id: "world/content/a", fields: { choice: "A" } }],
  };
  expect(packError(richerPack)).toBeUndefined();
  expect(
    packError({ ...richerPack, entries: [{ ...richerPack.entries[0], fields: { choice: "C" } }] }),
  ).toContain("Choice");
  expect(
    packError({
      ...richerPack,
      types: [{ ...richerType, filters: [{ key: "choice", kind: "range" }] }],
    }),
  ).toContain("Choice");
});
