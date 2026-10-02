import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import type { CompendiumEntry } from "./compendium";
import { chooseEntryType, chooseTarget, listBlockOf, referencedIds } from "./builder";
import { builderParts } from "./builder-parts";
import { acceptedFills, fillOffers, type EntryBlock } from "./entry-fill";
import { SheetLayout, isKnownPart } from "./sheet-layout";
import { layoutProblems } from "./sheet-refs";
import { layoutLimitsError } from "./template-io";

const layout: SheetLayout = {
  system: "Test",
  name: "Knight",
  pages: [
    {
      id: "main",
      title: "Main",
      blocks: [
        {
          id: "knight-entry",
          type: "entry",
          key: "knight",
          entryType: "knight",
          fill: [{ from: "property", to: "property" }],
        },
        { id: "virtues", type: "stats", items: [{ key: "vig", label: "VIG" }] },
        {
          id: "property",
          type: "list",
          key: "property",
          columns: [
            { key: "name", label: "Item", kind: "text" },
            { key: "dmg", label: "Dmg", kind: "dice" },
          ],
        },
        {
          id: "moves",
          type: "list",
          key: "moves",
          source: { entryType: "move" },
          columns: [{ key: "name", label: "Move", kind: "text" }],
        },
      ],
    },
  ],
  builder: {
    steps: [
      { id: "knight", title: "Knight", parts: [{ type: "choose", key: "knight" }] },
      {
        id: "virtues",
        title: "Virtues",
        hint: "Roll, then write each Virtue in.",
        parts: [
          { type: "rolls", items: [{ label: "Virtue", dice: "3d6" }] },
          { type: "blocks", blocks: ["virtues"] },
        ],
      },
      {
        id: "moves",
        title: "Moves",
        parts: [
          { type: "choose", key: "moves", from: { entry: "knight", field: "moves" }, pick: 2 },
          { type: "tables", from: { entry: "knight", field: "tables" } },
        ],
      },
    ],
  },
};

const knight: CompendiumEntry = {
  id: "world/knight/test",
  typeId: "knight",
  name: "The Test Knight",
  tags: [],
  body: "",
  fields: {
    property: [{ name: "Spear", dmg: "d8" }],
    moves: ["world/move/a", "world/move/b"],
    tables: "world/table/omens",
  },
  visibility: "public",
  updatedAt: "now",
};

describe("builder schema and rules", () => {
  it("decodes, keeps the builder, and fits the limits with no problems", () => {
    const decoded = Schema.decodeUnknownSync(SheetLayout)(layout);
    expect(decoded.builder?.steps).toHaveLength(3);
    expect(layoutLimitsError(layout)).toBeUndefined();
    expect(layoutProblems(layout)).toEqual([]);
  });

  it("rejects what can't be saved: too many steps, duplicate step ids, a pick out of range", () => {
    const invalid = (builder: unknown) =>
      Schema.decodeUnknownResult(SheetLayout)({ ...layout, builder })._tag;
    const step = layout.builder!.steps[0];
    expect(
      invalid({ steps: Array.from({ length: 21 }, (_, i) => ({ ...step, id: `s${i}` })) }),
    ).toBe("Failure");
    expect(invalid({ steps: [{ id: "a", title: "x".repeat(61), parts: [] }] })).toBe("Failure");
    expect(
      invalid({ steps: [{ id: "a", title: "A", parts: [{ type: "choose", key: "x", pick: 0 }] }] }),
    ).toBe("Failure");
    // Half-made steps stay saveable while an author works on them.
    expect(
      invalid({ steps: [{ id: "a", title: "", parts: [{ type: "blocks", blocks: [] }] }] }),
    ).toBe("Success");
    expect(layoutLimitsError({ ...layout, builder: { steps: [step, step] } })).toBe(
      "Builder step ids must be unique",
    );
  });

  it("warns about dangling references without blocking the save", () => {
    const problems = layoutProblems({
      ...layout,
      builder: {
        steps: [
          {
            id: "broken",
            title: "Broken",
            parts: [
              { type: "blocks", blocks: ["gone"] },
              { type: "choose", key: "property", from: { entry: "vig", field: "x" } },
              { type: "rolls", items: [{ label: "Bad", dice: "2q6" }] },
              { type: "tables" },
            ],
          },
        ],
      },
    });
    expect(problems).toEqual([
      'Builder step "Broken" shows block "gone", which isn\'t on the sheet',
      'Builder step "Broken" chooses into "property", which isn\'t an entry block or a list from the compendium',
      'Builder step "Broken" takes options from "vig", which isn\'t an entry block',
      expect.stringMatching(/^Roll "Bad": /),
      'Builder step "Broken" has a tables part with no tables',
    ]);
  });
});

describe("builder helpers", () => {
  it("finds what a choose part fills: an entry block or a sourced list, nothing else", () => {
    expect(chooseTarget(layout, "knight")).toMatchObject({ type: "entry", entryType: "knight" });
    expect(chooseEntryType(chooseTarget(layout, "moves")!)).toBe("move");
    expect(chooseTarget(layout, "property")).toBeUndefined();
    expect(chooseTarget(layout, "missing")).toBeUndefined();
    expect(listBlockOf(layout, "property")?.id).toBe("property");
  });

  it("reads options from the chosen entry's reference field, once it's chosen and loaded", () => {
    const entryOf = (id: string) => (id === knight.id ? knight : undefined);
    const moves = { entry: "knight", field: "moves" };
    expect(referencedIds(moves, {}, entryOf)).toBeUndefined();
    expect(referencedIds(moves, { knight: "world/knight/unloaded" }, entryOf)).toBeUndefined();
    expect(referencedIds(moves, { knight: knight.id }, entryOf)).toEqual([
      "world/move/a",
      "world/move/b",
    ]);
    expect(
      referencedIds({ entry: "knight", field: "tables" }, { knight: knight.id }, entryOf),
    ).toEqual(["world/table/omens"]);
    expect(
      referencedIds({ entry: "knight", field: "none" }, { knight: knight.id }, entryOf),
    ).toEqual([]);
  });
});

describe("entry fills", () => {
  const block = layout.pages[0].blocks[0] as EntryBlock;
  const lists = (key: string) => listBlockOf(layout, key);

  it("offers the entry's list rows for each fill target, and appends them on accept", () => {
    const offers = fillOffers(knight, block, lists, {});
    expect(offers).toEqual([
      {
        to: "property",
        title: "property",
        rows: [{ name: "Spear", dmg: "d8", _entry: knight.id }],
      },
    ]);
    expect(acceptedFills(offers, { property: [{ name: "Torch", dmg: "" }] })).toEqual([
      [
        "property",
        [
          { name: "Torch", dmg: "" },
          { name: "Spear", dmg: "d8", _entry: knight.id },
        ],
      ],
    ]);
  });

  it("offers nothing when the entry has no rows or the target list is missing", () => {
    expect(fillOffers({ ...knight, fields: {} }, block, lists, {})).toEqual([]);
    expect(fillOffers(knight, block, () => undefined, {})).toEqual([]);
  });

  it("limits a progression's offer to rows up to the character's level", () => {
    const progression: EntryBlock = {
      ...block,
      fill: [{ from: "features", to: "property" }],
      progression: { field: "features", level: "level" },
    };
    const classEntry = {
      ...knight,
      fields: {
        features: [
          { level: 1, name: "First" },
          { level: 3, name: "Third" },
        ],
      },
    };
    const names = (values: Record<string, number>) =>
      fillOffers(classEntry, progression, lists, values)[0]?.rows.map((row) => row.name);
    expect(names({ level: 2 })).toEqual(["First"]);
    expect(names({ level: 3 })).toEqual(["First", "Third"]);
  });
});

describe("conditions and part kinds this version doesn't know", () => {
  const future = { type: "spinner", options: [1, 2, 3], nested: { keep: true } };

  it("keeps an unknown part whole through decode and encode, and still rejects bad known parts", () => {
    const withFuture = {
      ...layout,
      builder: { steps: [{ id: "a", title: "A", parts: [future] }] },
    };
    const decoded = Schema.decodeUnknownSync(SheetLayout)(withFuture);
    expect(decoded.builder?.steps[0].parts).toEqual([future]);
    expect(Schema.encodeSync(SheetLayout)(decoded).builder?.steps[0].parts).toEqual([future]);
    // A known kind with bad fields is an error, not an "unknown" part.
    expect(
      Schema.decodeUnknownResult(SheetLayout)({
        ...layout,
        builder: { steps: [{ id: "a", title: "A", parts: [{ type: "choose", pick: 0 }] }] },
      })._tag,
    ).toBe("Failure");
    expect(isKnownPart(future as never)).toBe(false);
    expect(isKnownPart({ type: "blocks", blocks: [] })).toBe(true);
  });

  it("names unknown parts and broken conditions as problems", () => {
    expect(
      layoutProblems({
        ...layout,
        builder: {
          steps: [
            {
              id: "a",
              title: "Spells",
              when: "@level >=",
              done: "count(@vig)",
              parts: [future as never, { type: "blocks", blocks: ["virtues"], when: "@nope > 1" }],
            },
          ],
        },
      }),
    ).toEqual([
      expect.stringMatching(/^Builder "Spells applies when": Expected an expression/),
      'Builder "Spells is done when" reads @vig as a list, but it isn\'t a list or checks',
      'Builder step "Spells" has a "spinner" part, which this version can\'t show',
      'Builder "Spells part applies when" uses @nope, which isn\'t on the sheet',
    ]);
  });

  it("gives every kind a label and a blank part of its own kind", () => {
    for (const [type, kind] of Object.entries(builderParts)) {
      const blank = kind.blank(layout);
      expect(blank.type).toBe(type);
      expect(kind.label).not.toBe("");
    }
  });
});
