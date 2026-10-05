import { describe, expect, it } from "vitest";
import { evaluate, parseExpr } from "./derived";
import { parseNotation, rollNotation } from "./dice-notation";
import type { SheetLayout, SheetValues } from "./sheet-layout";
import {
  entriesRead,
  layoutProblems,
  refValues,
  sheetRefLookup,
  sheetScope,
  trackerMaxOf,
  type EntryFields,
} from "./sheet-refs";

const layout: SheetLayout = {
  system: "Test",
  name: "Test",
  derived: [
    { key: "con_mod", label: "CON mod", expr: "floor((@con - 10) / 2)" },
    { key: "prof", label: "Proficiency", expr: "scale(@class.levels, @level, @row.proficiency)" },
  ],
  pages: [
    {
      id: "page",
      title: "Sheet",
      blocks: [
        { id: "class", type: "entry", key: "class", entryType: "class", label: "Class" },
        {
          id: "stats",
          type: "stats",
          items: [
            { key: "con", label: "Constitution" },
            { key: "level", label: "Level" },
          ],
        },
        {
          id: "hp",
          type: "trackers",
          items: [
            { key: "hp", label: "HP", min: 0, max: 999, maxFrom: "@level * 6 + @con_mod" },
            { key: "luck", label: "Luck", min: 0, max: 6 },
          ],
        },
      ],
    },
  ],
};

const fighter = {
  hit_die: "1d10",
  primary: "Strength",
  levels: [
    { level: 1, proficiency: "+2", features: "Fighting Style" },
    { level: 5, proficiency: "+3", features: "Extra Attack" },
    { level: 9, proficiency: "+4", features: "Indomitable" },
  ],
};
const entries: EntryFields = (id) => (id === "fighter" ? fighter : undefined);
const values: SheetValues = { class: "fighter", con: 14, level: 6 };

const value = (expr: string, scope = sheetScope(layout, values, undefined, entries)) => {
  const parsed = parseExpr(expr);
  if (!parsed.ok) throw new Error(parsed.error);
  return evaluate(parsed.value, scope);
};

describe("chosen-entry fields", () => {
  it("reads a field of the entry chosen in an entry block", () => {
    expect(value("@class.hit_die")).toBe("1d10");
    expect(value('@class.primary == "strength"')).toBe(1);
    // A list field reads as its row count, like a sheet list.
    expect(value("@class.levels")).toBe(3);
  });

  it("reads empty while the entry isn't loaded or nothing is chosen", () => {
    expect(value("@class.hit_die", sheetScope(layout, values))).toBe(0);
    expect(value("@class.hit_die", sheetScope(layout, { level: 1 }, undefined, entries))).toBe(0);
  });

  it("aggregates over an entry's list field", () => {
    expect(value("count(@class.levels)")).toBe(3);
    expect(value("sum(@class.levels, @row.proficiency)")).toBe(9);
    expect(value('has(@class.levels, "nope")')).toBe(0);
  });

  it("labels entry fields from the block", () => {
    const lookup = sheetRefLookup(layout, values, undefined, entries);
    expect(lookup({ key: "class", column: "hit_die" })).toEqual({
      value: 0,
      label: "Class hit die",
      text: "1d10",
    });
  });

  it("lists which entries a roll must load, through derived values too", () => {
    const refs = (dice: string) => {
      const parsed = parseNotation(dice);
      if (!parsed.ok) throw new Error(parsed.error);
      return parsed.value.groups.flatMap((group) =>
        group.terms.flatMap((term) => (term.kind === "ref" ? [term.ref] : [])),
      );
    };
    // `prof` reads the class's levels, so any roll on this layout loads it.
    expect(entriesRead(layout, refs("1d20"))).toEqual(["class"]);
    const plain: SheetLayout = { ...layout, derived: [] };
    expect(entriesRead(plain, refs("1d20 + @con"))).toEqual([]);
    expect(entriesRead(plain, refs("@class.hit_die"))).toEqual(["class"]);
  });
});

describe("scale", () => {
  it("takes the row at the highest level reached", () => {
    expect(value("scale(@class.levels, 1, @row.proficiency)")).toBe(2);
    expect(value("scale(@class.levels, 4, @row.proficiency)")).toBe(2);
    expect(value("scale(@class.levels, @level, @row.proficiency)")).toBe(3);
    expect(value("scale(@class.levels, 20, @row.features)")).toBe("Indomitable");
    expect(value("@prof")).toBe(3);
  });

  it("gives 0 below every row, and reads positions when rows have no level", () => {
    expect(value("scale(@class.levels, 0, @row.proficiency)")).toBe(0);
    const scope = sheetScope(
      {
        ...layout,
        pages: [
          {
            id: "p",
            title: "P",
            blocks: [
              {
                id: "dice",
                type: "list",
                key: "dice",
                columns: [{ key: "die", label: "Die", kind: "text" }],
              },
            ],
          },
        ],
      },
      { dice: [{ die: "d6" }, { die: "d8" }, { die: "d10" }] },
    );
    expect(value("scale(@dice, 2, @row.die)", scope)).toBe("d8");
    expect(value("scale(@dice, 9, @row.die)", scope)).toBe("d10");
  });

  it("needs a list, a level and a value", () => {
    expect(parseExpr("scale(@class.levels, @level)").ok).toBe(false);
    expect(parseExpr("scale(@row.levels, 1, 2)").ok).toBe(false);
  });
});

describe("dice text in rolls", () => {
  // `fraction` is what the rng gives: a die shows floor(fraction × sides) + 1.
  const roll = (dice: string, fraction: number) => {
    const parsed = parseNotation(dice);
    if (!parsed.ok) throw new Error(parsed.error);
    return rollNotation(parsed.value, {
      lookup: sheetRefLookup(layout, values, undefined, entries),
      scope: sheetScope(layout, values, undefined, entries),
      rng: () => fraction,
    });
  };

  it("rolls an entry's hit die in place of the ref", () => {
    const result = roll("@class.hit_die + @con_mod", 0.65);
    expect(result.ok && result.value.dice).toEqual([{ sides: 10, results: [7] }]);
    expect(result.ok && result.value.total).toBe(9);
  });

  it("rolls dice text a formula gives, with the term's sign", () => {
    const result = roll("10 - {scale(@class.levels, 1, @row.die) + @class.hit_die}", 0.6);
    // Text joined by + isn't dice, so it reads as a number (0).
    expect(result.ok && result.value.total).toBe(10);
    const dice = roll('10 - {if(@level > 5, "2d4", "1d4")}', 0.6);
    expect(dice.ok && dice.value.dice).toEqual([{ sides: 4, results: [3, 3], negative: true }]);
    expect(dice.ok && dice.value.total).toBe(4);
  });

  it("keeps other text as a number", () => {
    const result = roll("1d20 + @class.primary", 0.2);
    expect(result.ok && result.value.total).toBe(5);
  });
});

describe("tracker maximum formulas", () => {
  const scope = sheetScope(layout, values, undefined, entries);
  const hp = layout.pages[0].blocks[2].type === "trackers" ? layout.pages[0].blocks[2].items : [];

  it("computes, floors and bounds the maximum; the character's own wins", () => {
    expect(trackerMaxOf(hp[0], undefined, scope)).toBe(38);
    expect(trackerMaxOf(hp[0], 20, scope)).toBe(20);
    expect(trackerMaxOf({ ...hp[0], max: 30 }, undefined, scope)).toBe(30);
    expect(trackerMaxOf({ ...hp[0], maxFrom: "-5" }, undefined, scope)).toBe(0);
    expect(trackerMaxOf({ ...hp[0], maxFrom: "@nope +" }, undefined, scope)).toBe(999);
    expect(trackerMaxOf(hp[1], undefined, scope)).toBe(6);
  });

  it("reads a tracker as no more than its maximum", () => {
    // A new character starts at the ceiling and reads as full.
    expect(refValues(layout, values, {}, { entries }).hp).toBe(38);
    expect(refValues(layout, values, { hp: 12 }, { entries }).hp).toBe(12);
    expect(refValues(layout, values, {}, { entries, tickerMax: { hp: 30 } }).hp).toBe(30);
    expect(refValues(layout, values, {}).luck).toBe(6);
  });

  it("names a maximum that doesn't parse", () => {
    const broken: SheetLayout = {
      ...layout,
      pages: [
        {
          id: "p",
          title: "P",
          blocks: [
            {
              id: "t",
              type: "trackers",
              items: [{ key: "hp", label: "HP", min: 0, max: 9, maxFrom: "@missing + (" }],
            },
          ],
        },
      ],
    };
    expect(layoutProblems(broken).some((p) => p.startsWith('Tracker "HP" maximum'))).toBe(true);
  });
});

describe("entry list problems", () => {
  it("warns when an entry list is read through something that isn't an entry", () => {
    const problems = layoutProblems({
      ...layout,
      derived: [{ key: "x", label: "X", expr: "count(@level.rows)" }],
    });
    expect(problems).toContain(
      'Derived "X" reads @level.rows as a list, but @level isn\'t an entry',
    );
    expect(layoutProblems(layout)).toEqual([]);
  });
});
