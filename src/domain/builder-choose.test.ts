import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  addedCount,
  matchesChooseTags,
  offeredOptions,
  offersOption,
  withoutEntry,
} from "../components/builder-parts/choose-filter";
import { builderParts } from "./builder-parts";
import type { IndexRow } from "./compendium-index";
import type { Scope } from "./derived";
import { SheetLayout, type ListRow } from "./sheet-layout";
import { layoutProblems } from "./sheet-refs";

/*
 * The choose part's filters, "added" marks and removal: filtering reads only
 * the compendium index row (never a full entry), counts are hints, and removal
 * drops every row copied from an entry.
 */

const row = (id: string, rest: Partial<IndexRow> = {}): IndexRow => ({
  id,
  name: id,
  typeId: "gear",
  visibility: "public",
  tags: [],
  rev: 1,
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...rest,
});

// The character's own scope: `max_level` is the sheet's, anything else empty.
const character: Scope = {
  value: (ref) => (ref.column !== undefined ? undefined : ref.key === "max_level" ? 2 : undefined),
};

const rows = [
  row("dagger", { name: "Dagger", tags: ["Light"], facets: { level: 1, kind: "Blade" } }),
  row("plate", { name: "Plate", tags: ["Heavy"], facets: { level: 5, kind: "Plate" } }),
  row("torch", { name: "Torch", facets: { level: 1 } }),
];

describe("matchesChooseTags", () => {
  it("offers everything without a spec, and matches all/any/none case-insensitively", () => {
    expect(matchesChooseTags(["Heavy"], undefined)).toBe(true);
    expect(matchesChooseTags(["Heavy"], {})).toBe(true);
    expect(matchesChooseTags(["Heavy", "Metal"], { all: ["heavy"] })).toBe(true);
    expect(matchesChooseTags(["Heavy"], { all: ["heavy", "metal"] })).toBe(false);
    expect(matchesChooseTags(["Heavy"], { any: ["light", "HEAVY"] })).toBe(true);
    expect(matchesChooseTags(["Heavy"], { any: ["light"] })).toBe(false);
    expect(matchesChooseTags(["Heavy"], { none: ["light"] })).toBe(true);
    expect(matchesChooseTags(["Heavy"], { none: ["heavy"] })).toBe(false);
  });

  it("ignores surrounding whitespace and empty any lists", () => {
    expect(matchesChooseTags(["  Heavy "], { all: ["heavy"] })).toBe(true);
    expect(matchesChooseTags([], { any: [] })).toBe(true);
  });
});

describe("offersOption", () => {
  it("offers everything without a filter or tags", () => {
    for (const entry of rows) expect(offersOption(entry, {}, character)).toBe(true);
  });

  it("reads the option's facets first: a number range and a text equality", () => {
    const filter = { filter: "@level <= 1" };
    expect(offeredOptions(rows, filter, character).map((entry) => entry.id)).toEqual([
      "dagger",
      "torch",
    ]);
    const kind = { filter: '@kind == "blade"' };
    expect(offeredOptions(rows, kind, character).map((entry) => entry.id)).toEqual(["dagger"]);
  });

  it("falls back to the character for refs the option doesn't carry", () => {
    const filter = { filter: "@level <= @max_level" };
    expect(offeredOptions(rows, filter, character).map((entry) => entry.id)).toEqual([
      "dagger",
      "torch",
    ]);
    // The row wins when both have the key: @level is the option's, never the sheet's.
    const characterLevel: Scope = {
      value: (ref) => (ref.column === undefined && ref.key === "level" ? 99 : undefined),
    };
    expect(offeredOptions(rows, { filter: "@level <= 1" }, characterLevel)).toHaveLength(2);
  });

  it("reads the option's name and tag count, and flags as 1 or 0", () => {
    expect(
      offeredOptions(rows, { filter: '@name == "torch"' }, character).map((entry) => entry.id),
    ).toEqual(["torch"]);
    expect(
      offeredOptions(rows, { filter: "@tags > 0" }, character).map((entry) => entry.id),
    ).toEqual(["dagger", "plate"]);
    const flagged = [
      row("yes", { facets: { laden: true } }),
      row("no", { facets: { laden: false } }),
    ];
    expect(
      offeredOptions(flagged, { filter: "@laden" }, character).map((entry) => entry.id),
    ).toEqual(["yes"]);
  });

  it("reads a set facet as how many values it has, like the sheet does", () => {
    const set = [
      row("one", { facets: { use: ["a"] } }),
      row("two", { facets: { use: ["a", "b"] } }),
    ];
    expect(
      offeredOptions(set, { filter: "@use >= 2" }, character).map((entry) => entry.id),
    ).toEqual(["two"]);
  });

  it("offers everything when the filter is blank or broken, and narrows by tags first", () => {
    expect(offeredOptions(rows, { filter: "   " }, character)).toHaveLength(3);
    expect(offeredOptions(rows, { filter: "@level >=" }, character)).toHaveLength(3);
    expect(
      offeredOptions(rows, { filter: "@level <= 5", tags: { none: ["heavy"] } }, character).map(
        (entry) => entry.id,
      ),
    ).toEqual(["dagger", "torch"]);
  });

  it("keeps the options' order", () => {
    expect(offeredOptions([...rows].reverse(), {}, character).map((entry) => entry.id)).toEqual([
      "torch",
      "plate",
      "dagger",
    ]);
  });
});

describe("added marks and removal", () => {
  const added: ListRow[] = [
    { name: "Dagger", _entry: "dagger" },
    { name: "Dagger copy", _entry: "dagger" },
    { name: "Torch" },
  ];

  it("counts how many times the entry is already on the sheet", () => {
    expect(addedCount(added, "dagger")).toBe(2);
    expect(addedCount(added, "torch")).toBe(0);
    expect(addedCount([], "dagger")).toBe(0);
  });

  it("removes every row copied from the entry, and nothing else", () => {
    expect(withoutEntry(added, "dagger")).toEqual([{ name: "Torch" }]);
    expect(withoutEntry(added, "missing")).toEqual(added);
  });
});

const layout: SheetLayout = {
  system: "Test",
  name: "Kit",
  pages: [
    {
      id: "main",
      title: "Main",
      blocks: [
        { id: "level", type: "stats", items: [{ key: "max_level", label: "Max" }] },
        {
          id: "kit",
          type: "list",
          key: "kit",
          title: "Kit",
          source: { entryType: "gear" },
          columns: [{ key: "name", label: "Item", kind: "text" }],
        },
      ],
    },
  ],
};

describe("choose schema and problems", () => {
  it("decodes a part with a filter, tags and a pick", () => {
    const decoded = Schema.decodeUnknownSync(SheetLayout)({
      ...layout,
      builder: {
        steps: [
          {
            id: "kit",
            title: "Kit",
            parts: [
              {
                type: "choose",
                key: "kit",
                pick: 2,
                filter: "@max_level >= 1",
                tags: { any: ["light"], none: ["heavy"] },
              },
            ],
          },
        ],
      },
    });
    expect(decoded.builder?.steps[0].parts).toEqual([
      {
        type: "choose",
        key: "kit",
        pick: 2,
        filter: "@max_level >= 1",
        tags: { any: ["light"], none: ["heavy"] },
      },
    ]);
    expect(layoutProblems(decoded)).toEqual([]);
  });

  it("checks a filter's syntax but not its refs, which can be the option's own fields", () => {
    expect(
      layoutProblems({
        ...layout,
        builder: {
          steps: [
            {
              id: "kit",
              title: "Kit",
              parts: [
                { type: "choose", key: "kit", filter: "@level <= @max_level" },
                { type: "choose", key: "kit", filter: "@level <=" },
              ],
            },
          ],
        },
      }),
    ).toEqual(['Builder "choice into "kit" filter": Expected an expression at 9']);
  });

  it("rejects a filter past 400 characters, tag lists past 20, and a long tag", () => {
    const part = (override: object) => ({
      steps: [{ id: "a", title: "A", parts: [{ type: "choose", key: "kit", ...override }] }],
    });
    const invalid = (builder: unknown) =>
      Schema.decodeUnknownResult(SheetLayout)({ ...layout, builder })._tag;
    expect(invalid(part({ filter: "x".repeat(401) }))).toBe("Failure");
    expect(invalid(part({ filter: "x".repeat(400) }))).toBe("Success");
    expect(invalid(part({ tags: { all: Array.from({ length: 21 }, () => "x") } }))).toBe("Failure");
    expect(invalid(part({ tags: { any: ["x".repeat(41)] } }))).toBe("Failure");
  });

  it("checks the filter as a formula, like other formulas", () => {
    const formulas: [string, string][] = [];
    builderParts.choose.check(
      { type: "choose", key: "kit", filter: "@level >=" },
      {
        layout,
        name: 'Builder step "Kit"',
        blockIds: new Set(["kit"]),
        entryKeys: new Set(),
        choosable: new Set(["kit"]),
        problem: () => {},
        roll: () => {},
        formula: (label, expr) => formulas.push([label, expr]),
      },
    );
    expect(formulas).toEqual([['choice into "kit" filter', "@level >="]]);
    expect(
      layoutProblems({
        ...layout,
        builder: {
          steps: [
            {
              id: "kit",
              title: "Kit",
              parts: [{ type: "choose", key: "kit", filter: "@level >=" }],
            },
          ],
        },
      }),
    ).toEqual([expect.stringMatching(/^Builder "choice into "kit" filter": /)]);
  });
});
