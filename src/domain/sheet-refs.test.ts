import { describe, expect, it } from "vitest";
import type { SheetLayout, SheetValues } from "./sheet-layout";
import {
  layoutProblems,
  refValues,
  sheetDerived,
  sheetRefLookup,
  sheetScope,
  valueScope,
} from "./sheet-refs";

const layout: SheetLayout = {
  system: "Test",
  name: "Test",
  derived: [{ key: "str_mod", label: "STR mod", expr: "floor((@str - 10) / 2)" }],
  pages: [
    {
      id: "page",
      title: "Sheet",
      blocks: [
        {
          id: "group",
          type: "group",
          blocks: [
            {
              id: "stats",
              type: "stats",
              items: [
                { key: "str", label: "Strength" },
                { key: "str_mod", label: "Old label" },
              ],
            },
            { id: "fields", type: "fields", columns: 2, items: [{ key: "bonus", label: "Bonus" }] },
            {
              id: "trackers",
              type: "trackers",
              items: [{ key: "hp", label: "HP", min: 0, max: 10 }],
            },
            {
              id: "gear",
              type: "list",
              key: "inventory",
              title: "Gear",
              columns: [
                { key: "qty", label: "Quantity", kind: "number" },
                { key: "weight", label: "Weight", kind: "number" },
              ],
            },
          ],
        },
        {
          id: "plain-list",
          type: "list",
          key: "pack",
          columns: [{ key: "size", label: "Size", kind: "number" }],
        },
        { id: "checks", type: "checks", key: "conditions", options: ["A", "B"] },
        { id: "text", type: "text", key: "notes" },
        { id: "entry", type: "entry", key: "class", entryType: "class" },
      ],
    },
  ],
};
const withBlocks = (blocks: SheetLayout["pages"][number]["blocks"]): SheetLayout => ({
  ...layout,
  pages: [{ id: "page", title: "Sheet", blocks }],
});

describe("valueScope", () => {
  it("reads numbers, numeric strings, booleans, checks and list row counts", () => {
    const values: SheetValues = {
      number: -2,
      numeric: " 3.5 ",
      yes: true,
      no: false,
      checks: ["a", "b"],
      list: [{ name: "One" }, { name: "Two" }],
      emptyChecks: [],
      empty: "",
      whitespace: " ",
      text: "abc",
      inf: Infinity,
      nan: NaN,
      infString: "Infinity",
    };
    const scope = valueScope(values);
    for (const [key, expected] of Object.entries({
      number: -2,
      numeric: 3.5,
      yes: 1,
      no: 0,
      checks: 2,
      list: 2,
      emptyChecks: 0,
      // Text reads as text (arithmetic reads it as 0).
      text: "abc",
      infString: "Infinity",
    }))
      expect(scope.value({ key })).toBe(expected);
    for (const key of ["empty", "whitespace", "missing", "inf", "nan", "toString"])
      expect(scope.value({ key })).toBeUndefined();
  });

  it("sums list columns, ignoring empty, missing and non-numeric cells", () => {
    const scope = valueScope({
      inventory: [
        { weight: 2 },
        { weight: "3.5" },
        { weight: "heavy" },
        { weight: "" },
        { name: "No weight" },
        { weight: Infinity },
        { weight: true },
        { weight: ["heavy"] },
      ],
      empty: [],
      checks: ["a"],
      text: "3",
    });
    expect(scope.value({ key: "inventory", column: "weight" })).toBe(5.5);
    expect(scope.value({ key: "inventory", column: "unknown" })).toBe(0);
    expect(scope.value({ key: "empty", column: "weight" })).toBe(0);
    expect(scope.value({ key: "checks", column: "weight" })).toBeUndefined();
    expect(scope.value({ key: "text", column: "weight" })).toBeUndefined();
    expect(scope.value({ key: "missing", column: "weight" })).toBeUndefined();
  });

  it("reads the current row without mutating values or rows", () => {
    const row = Object.freeze({ qty: "2", checked: true, tags: ["a", "b"], name: "Sword" });
    const values = Object.freeze({ qty: 100 });
    const scope = valueScope(values, { row });
    expect(scope.value({ key: "row", column: "qty" })).toBe(2);
    expect(scope.value({ key: "row", column: "checked" })).toBe(1);
    expect(scope.value({ key: "row", column: "tags" })).toBe(2);
    expect(scope.value({ key: "row", column: "name" })).toBe("Sword");
    expect(scope.value({ key: "row", column: "missing" })).toBeUndefined();
    expect(valueScope(values).value({ key: "row", column: "qty" })).toBeUndefined();
    expect(values.qty).toBe(100);
  });
});

describe("sheet scopes and labels", () => {
  it("computes layout values and lets derived values shadow stored values", () => {
    const values = Object.freeze({ str: 15, str_mod: 100 });
    expect(sheetDerived(layout, values)).toEqual({ values: { str_mod: 2 }, errors: {} });
    expect(sheetScope(layout, values).value({ key: "str_mod" })).toBe(2);
    expect(sheetScope(layout, values).value({ key: "str" })).toBe(15);
    expect(sheetScope(undefined, values).value({ key: "str_mod" })).toBe(100);
    expect(sheetDerived(undefined, values)).toEqual({ values: {}, errors: {} });
    expect(values.str_mod).toBe(100);
    const rowScope = sheetScope(layout, values, { row: { qty: 3 } });
    expect(rowScope.value({ key: "row", column: "qty" })).toBe(3);
  });

  it("uses derived, stat, field, tracker and column labels through groups", () => {
    const lookup = sheetRefLookup(
      layout,
      { str: 15, inventory: [{ weight: 3 }] },
      { row: { qty: 2 } },
    );
    expect(lookup({ key: "str_mod" })).toEqual({ value: 2, label: "STR mod" });
    expect(lookup({ key: "str" })).toEqual({ value: 15, label: "Strength" });
    expect(lookup({ key: "bonus" })).toEqual({ value: 0, label: "Bonus" });
    expect(lookup({ key: "hp" })).toEqual({ value: 0, label: "HP" });
    expect(lookup({ key: "row", column: "qty" })).toEqual({ value: 2, label: "Quantity" });
    expect(lookup({ key: "inventory", column: "weight" })).toEqual({
      value: 3,
      label: "Gear Weight",
    });
    expect(lookup({ key: "pack", column: "size" })).toEqual({ value: 0, label: "pack Size" });
  });

  it("resolves known empty keys to zero and fails unknown keys", () => {
    const lookup = sheetRefLookup(layout, { existing: "text", present: undefined });
    for (const key of ["notes", "conditions", "class", "inventory", "existing", "present"])
      expect(lookup({ key })).toEqual({ value: 0, label: key });
    expect(lookup({ key: "wis" })).toBeUndefined();
    expect(lookup({ key: "toString" })).toBeUndefined();
    expect(lookup({ key: "row", column: "qty" })).toBeUndefined();
    expect(sheetRefLookup(undefined, { bonus: "3" })({ key: "bonus" })).toEqual({
      value: 3,
      label: "bonus",
    });
    expect(sheetRefLookup(undefined, {}, { row: {} })({ key: "row", column: "qty" })).toEqual({
      value: 0,
      label: "row",
    });
  });

  it("returns failed derived values as zero with their label", () => {
    const broken = { ...layout, derived: [{ key: "cycle", label: "Cycle", expr: "@cycle" }] };
    expect(sheetRefLookup(broken, { cycle: 99 })({ key: "cycle" })).toEqual({
      value: 0,
      label: "Cycle",
    });
  });
});

describe("layoutProblems (expressions)", () => {
  it("names cycle members, parse errors and unknown refs", () => {
    const problems = layoutProblems({
      ...layout,
      derived: [
        { key: "str_mod", label: "STR mod", expr: "@str_mod" },
        { key: "dependent", label: "Dependent", expr: "@str_mod + 1" },
        { key: "bad", label: "Bad", expr: "sqrt(4)" },
        { key: "unknown", label: "Unknown", expr: "@wis + @wis + @{hp-max} + @row.qty" },
      ],
    });
    expect(problems).toEqual([
      'Derived "STR mod" refers to itself',
      'Derived "Bad": Unknown function “sqrt” at 0',
      'Derived "Unknown" uses @wis, which isn\'t on the sheet',
      'Derived "Unknown" uses @{hp-max}, which isn\'t on the sheet',
      'Derived "Unknown" uses @row.qty, which isn\'t on the sheet',
    ]);
  });

  it("accepts known keys and row refs inside derived list columns", () => {
    const sheet = withBlocks([
      {
        id: "gear",
        type: "list",
        key: "inventory",
        columns: [
          { key: "qty", label: "Qty", kind: "number" },
          {
            key: "total",
            label: "Total",
            kind: "derived",
            expr: "@row.qty * @str_mod + @inventory.qty",
          },
          { key: "bad", label: "Bad column", kind: "derived", expr: "@missing" },
          { key: "syntax", label: "Syntax", kind: "derived", expr: "1 +" },
        ],
      },
    ]);
    expect(
      layoutProblems({ ...sheet, derived: [{ key: "str_mod", label: "Mod", expr: "2" }] }),
    ).toEqual([
      'Derived "Bad column" uses @missing, which isn\'t on the sheet',
      'Derived "Syntax": Expected an expression at 3',
    ]);
  });

  it("reports a missing derived-column expression and keeps first duplicate derived keys", () => {
    expect(
      layoutProblems({
        ...withBlocks([
          {
            id: "list",
            type: "list",
            key: "list",
            columns: [{ key: "total", label: "Total", kind: "derived" }],
          },
        ]),
        derived: [
          { key: "value", label: "First", expr: "1" },
          { key: "value", label: "Second", expr: "@unknown" },
        ],
      }),
    ).toEqual(['Derived "Total": Expected an expression at 0']);
  });
});

// These exercise the dice contract directly; its implementation is owned by another worker.
describe("layoutProblems (needs dice-notation)", () => {
  it("names invalid notation and missing refs in grouped roll blocks", () => {
    const sheet = withBlocks([
      {
        id: "group",
        type: "group",
        blocks: [
          {
            id: "rolls",
            type: "rolls",
            items: [
              { label: "Attack", dice: "1d20+x" },
              { label: "Save", dice: "1d20+@wis" },
            ],
          },
        ],
      },
    ]);
    expect(layoutProblems({ ...sheet, derived: [] })).toEqual([
      'Roll "Attack": Unexpected “x” at 5',
      'Roll "Save" uses @wis, which isn\'t on the sheet',
    ]);
  });

  it("checks stat, tracker and list rolls, accepting derived and row refs", () => {
    const sheet = withBlocks([
      {
        id: "stats",
        type: "stats",
        items: [
          { key: "str", label: "Strength", roll: "1d20 + @str_mod" },
          { key: "dex", label: "Dexterity", roll: "1d20+@missing" },
        ],
      },
      {
        id: "trackers",
        type: "trackers",
        items: [{ key: "hunt", label: "Hunt", min: 0, max: 4, roll: "(@hunt)d6khz+@typo" }],
      },
      {
        id: "list",
        type: "list",
        key: "inventory",
        title: "Gear",
        roll: "1d20 + @row.qty + @str_mod + @unknown",
        columns: [{ key: "qty", label: "Qty", kind: "number" }],
      },
    ]);
    expect(layoutProblems(sheet)).toEqual([
      'Roll "Dexterity" uses @missing, which isn\'t on the sheet',
      'Roll "Hunt" uses @typo, which isn\'t on the sheet',
      'Roll "Gear" uses @unknown, which isn\'t on the sheet',
    ]);
  });

  it("allows row refs only in list contexts and checks dice-count refs", () => {
    const sheet = withBlocks([
      { id: "rolls", type: "rolls", items: [{ label: "Pool", dice: "(@missing)d6 + @row.bonus" }] },
    ]);
    expect(layoutProblems(sheet)).toEqual([
      'Derived "STR mod" uses @str, which isn\'t on the sheet',
      'Roll "Pool" uses @missing, which isn\'t on the sheet',
      'Roll "Pool" uses @row.bonus, which isn\'t on the sheet',
    ]);
  });
});

describe("refValues", () => {
  const layout: SheetLayout = {
    system: "Test",
    name: "Test",
    pages: [
      {
        id: "p",
        title: "P",
        blocks: [
          {
            id: "t",
            type: "trackers",
            items: [
              { key: "hunt", label: "Hunt", min: 0, max: 4, start: 0 },
              { key: "hp", label: "HP", min: 0, max: 10 },
            ],
          },
        ],
      },
    ],
  };

  it("reads trackers from their own values, falling back like the sheet does", () => {
    expect(refValues(layout, { hunt: 3, str: 12 }, { hunt: 2 })).toEqual({
      hunt: 2,
      hp: 10,
      str: 12,
    });
    expect(refValues(layout, {}, {})).toEqual({ hunt: 0, hp: 10 });
  });

  it("keeps trackers of older templates that have no layout", () => {
    expect(refValues(undefined, { str: 12 }, { hp: 4 })).toEqual({ str: 12, hp: 4 });
  });
});

describe("formulas over lists, checks and computed columns", () => {
  const gear: SheetLayout = {
    system: "Test",
    name: "Gear",
    derived: [
      { key: "prof", label: "Proficiency", expr: "2" },
      { key: "load", label: "Load", expr: "sum(@gear, @row.weight * @row.qty)" },
      { key: "attacks", label: "Attack total", expr: "@weapons.attack" },
      { key: "best", label: "Best attack", expr: "highest(@weapons, @row.attack)" },
      { key: "skilled", label: "Skilled", expr: 'count(@skills) + has(@skills, "Stealth")' },
      { key: "status", label: "Status", expr: 'if(@load > 10, "Encumbered", "Fine")' },
    ],
    pages: [
      {
        id: "main",
        title: "Main",
        blocks: [
          {
            id: "gear",
            type: "list",
            key: "gear",
            columns: [
              { key: "name", label: "Item", kind: "text" },
              { key: "weight", label: "Weight", kind: "number" },
              { key: "qty", label: "Qty", kind: "number" },
            ],
          },
          {
            id: "weapons",
            type: "list",
            key: "weapons",
            columns: [
              { key: "name", label: "Weapon", kind: "text" },
              { key: "bonus", label: "Bonus", kind: "number" },
              // A computed column that reads another computed column and a derived value.
              { key: "base", label: "Base", kind: "derived", expr: "@row.bonus + @prof" },
              { key: "attack", label: "Attack", kind: "derived", expr: "@row.base + 1" },
            ],
          },
          { id: "skills", type: "checks", key: "skills", options: ["Athletics", "Stealth"] },
        ],
      },
    ],
  };
  const values = {
    gear: [
      { name: "Rope", weight: 1, qty: 2 },
      { name: "Anvil", weight: 9, qty: 1 },
    ],
    weapons: [
      { name: "Sword", bonus: 1 },
      { name: "Bow", bonus: 3 },
    ],
    skills: ["Stealth"],
  };

  it("computes aggregates, computed columns and text values", () => {
    expect(sheetDerived(gear, values)).toEqual({
      values: { prof: 2, load: 11, attacks: 10, best: 6, skilled: 2, status: "Encumbered" },
      errors: {},
    });
    const cell = sheetScope(gear, values, { row: values.weapons[1], list: "weapons" });
    expect(cell.value({ key: "row", column: "attack" })).toBe(6);
    expect(layoutProblems(gear)).toEqual([]);
  });

  it("reads a loop through computed columns as empty instead of hanging", () => {
    const looped: SheetLayout = {
      ...gear,
      derived: [{ key: "total", label: "Total", expr: "@weapons.a" }],
      pages: [
        {
          id: "main",
          title: "Main",
          blocks: [
            {
              id: "weapons",
              type: "list",
              key: "weapons",
              columns: [
                { key: "a", label: "A", kind: "derived", expr: "@row.b + 1" },
                { key: "b", label: "B", kind: "derived", expr: "@row.a + @total" },
              ],
            },
          ],
        },
      ],
    };
    expect(sheetDerived(looped, { weapons: [{}] }).values).toEqual({ total: 1 });
  });

  it("warns about aggregates over things that aren't lists, and missing columns", () => {
    expect(
      layoutProblems({
        ...gear,
        derived: [
          { key: "bad", label: "Bad", expr: "sum(@gear, @row.price) + count(@prof)" },
          { key: "prof", label: "Proficiency", expr: "2" },
        ],
      }),
    ).toEqual(['Derived "Bad" reads @row.price, which isn\'t a column of @gear']);
    expect(
      layoutProblems({
        ...gear,
        derived: [{ key: "bad", label: "Bad", expr: "sum(@name_field, 1)" }],
        pages: [
          {
            id: "main",
            title: "Main",
            blocks: [
              {
                id: "f",
                type: "fields",
                columns: 1,
                items: [{ key: "name_field", label: "Name" }],
              },
            ],
          },
        ],
      }),
    ).toEqual(['Derived "Bad" reads @name_field as a list, but it isn\'t a list or checks']);
  });
});
