import { describe, expect, it } from "vitest";
import type { EntryType } from "./compendium";
import type { IndexRow } from "./compendium-index";
import { entryFacets } from "./entry-facets";
import { facetSummaries, matchesFacets, sortRows } from "./facets";
import type { FacetSelection, RowSort } from "./facets";

const spell: EntryType = {
  id: "spell",
  name: "Spell",
  fields: [
    { key: "level", label: "Spell level", kind: "number" },
    { key: "school", label: "School", kind: "select" },
    { key: "ritual", label: "Ritual", kind: "text" },
  ],
  filters: [
    { key: "level", kind: "range" },
    { key: "school", kind: "set" },
    { key: "ritual", kind: "flag" },
  ],
};

const row = (id: string, facets?: IndexRow["facets"], rest: Partial<IndexRow> = {}): IndexRow => ({
  id,
  name: id,
  typeId: spell.id,
  visibility: "public",
  tags: [],
  rev: 1,
  updatedAt: "2026-10-01T00:00:00.000Z",
  facets,
  ...rest,
});
const rows = [
  row("fireball", { level: 3, school: "Evocation", ritual: false }),
  row("light", { level: 0, school: "Evocation", ritual: false }),
  row("shield", { level: 1, school: "Abjuration", ritual: false }),
  row("alarm", { level: 1, school: "Abjuration", ritual: true }),
  row("detect", { level: 1, school: "Divination", ritual: true }),
  row("unclassified", { ritual: false }),
  row("missing"),
];
const ids = (entries: readonly IndexRow[]) => entries.map((entry) => entry.id);

describe("matchesFacets", () => {
  it.each<FacetSelection>([
    {},
    { level: {} },
    { level: { min: undefined, max: undefined } },
    { school: { any: [] } },
    { level: undefined, school: undefined, ritual: undefined },
  ])("treats empty selections as inactive: %j", (selection) => {
    expect(rows.every((entry) => matchesFacets(entry, selection))).toBe(true);
    expect(rows.every((entry) => matchesFacets(entry, selection, spell))).toBe(true);
  });

  it.each<[FacetSelection, string[]]>([
    [{ level: { min: 1, max: 1 } }, ["shield", "alarm", "detect"]],
    [{ level: { min: 1 } }, ["fireball", "shield", "alarm", "detect"]],
    [{ level: { max: 0 } }, ["light"]],
    [{ level: { min: 0, max: 3 } }, ["fireball", "light", "shield", "alarm", "detect"]],
    [{ level: { min: 3, max: 1 } }, []],
    [{ school: { any: ["Evocation"] } }, ["fireball", "light"]],
    [{ school: { any: ["Abjuration", "Divination"] } }, ["shield", "alarm", "detect"]],
    [{ school: { any: ["evocation"] } }, []],
    [{ school: { any: ["absent"] } }, []],
    [{ ritual: { value: true } }, ["alarm", "detect"]],
    [{ ritual: { value: false } }, ["fireball", "light", "shield", "unclassified"]],
    [
      { level: { min: 1, max: 3 }, school: { any: ["Abjuration"] }, ritual: { value: false } },
      ["shield"],
    ],
  ])("matches active selections: %j", (selection, expected) => {
    expect(ids(rows.filter((entry) => matchesFacets(entry, selection)))).toEqual(expected);
    expect(ids(rows.filter((entry) => matchesFacets(entry, selection, spell)))).toEqual(expected);
  });

  it("matches any overlap in a multi-valued set", () => {
    const selection = { school: { any: ["Divination", "Evocation"] } };
    expect(matchesFacets(row("both", { school: ["Abjuration", "Evocation"] }), selection)).toBe(
      true,
    );
    expect(matchesFacets(row("other", { school: ["Abjuration"] }), selection)).toBe(false);
    expect(matchesFacets(row("empty", { school: [] }), selection)).toBe(false);
    expect(matchesFacets(row("missing"), selection)).toBe(false);
  });

  it("ignores undeclared keys when given the entry type, including keys present on a row", () => {
    const entry = row("one", { level: 1, unknown: "present" });
    const selection = { level: { min: 1 }, unknown: { any: ["absent"] } };
    expect(matchesFacets(entry, selection, spell)).toBe(true);
    expect(matchesFacets(entry, { unknown: { min: 1 } }, spell)).toBe(true);
    expect(matchesFacets(entry, { unknown: { value: true } }, spell)).toBe(true);
    expect(matchesFacets(entry, selection, { ...spell, filters: undefined })).toBe(true);
    expect(matchesFacets(entry, selection, { ...spell, filters: [] })).toBe(true);
    expect(matchesFacets(row("missing"), { level: { min: 1 } }, spell)).toBe(false);
  });

  it("uses the already derived range, select, set and flag values", () => {
    const type: EntryType = {
      ...spell,
      fields: [...spell.fields, { key: "classes", label: "Classes", kind: "set" }],
      filters: [...(spell.filters ?? []), { key: "classes", kind: "set" }],
    };
    const facets = entryFacets(
      {
        fields: { level: " 0 ", school: " Evocation ", classes: ["Wizard", " Bard "], ritual: " " },
        tags: [],
      },
      type,
    );
    expect(
      matchesFacets(
        row("spell", facets),
        {
          level: { min: 0, max: 0 },
          school: { any: ["Evocation"] },
          classes: { any: ["Bard"] },
          ritual: { value: false },
        },
        type,
      ),
    ).toBe(true);
  });
});

describe("facetSummaries", () => {
  it("returns labels and summaries in filter order, omitting missing values from counts", () => {
    expect(facetSummaries(spell, rows, {})).toEqual([
      { key: "level", label: "Spell level", kind: "range", min: 0, max: 3, count: 5 },
      {
        key: "school",
        label: "School",
        kind: "set",
        options: [
          { value: "Abjuration", count: 2 },
          { value: "Evocation", count: 2 },
          { value: "Divination", count: 1 },
        ],
      },
      { key: "ritual", label: "Ritual", kind: "flag", true: 2, false: 4 },
    ]);
  });

  it("excludes each facet's own selection and applies all the other selections", () => {
    expect(
      facetSummaries(spell, rows, {
        level: { min: 1, max: 1 },
        school: { any: ["Abjuration"] },
        ritual: { value: false },
      }),
    ).toEqual([
      { key: "level", label: "Spell level", kind: "range", min: 1, max: 1, count: 1 },
      { key: "school", label: "School", kind: "set", options: [{ value: "Abjuration", count: 1 }] },
      { key: "ritual", label: "Ritual", kind: "flag", true: 1, false: 1 },
    ]);
    const summaries = facetSummaries(spell, rows, { school: { any: ["Evocation"] } });
    expect(summaries[0]).toEqual({
      key: "level",
      label: "Spell level",
      kind: "range",
      min: 0,
      max: 3,
      count: 2,
    });
    expect(summaries[1]).toEqual(facetSummaries(spell, rows, {})[1]);
    expect(summaries[2]).toEqual({
      key: "ritual",
      label: "Ritual",
      kind: "flag",
      true: 0,
      false: 2,
    });
  });

  it("keeps alternatives for a selection that matches no rows", () => {
    const summaries = facetSummaries(spell, rows, { school: { any: ["Necromancy"] } });
    expect(summaries[0]).toEqual({
      key: "level",
      label: "Spell level",
      kind: "range",
      min: undefined,
      max: undefined,
      count: 0,
    });
    expect(summaries[1]).toEqual(facetSummaries(spell, rows, {})[1]);
    expect(summaries[2]).toEqual({
      key: "ritual",
      label: "Ritual",
      kind: "flag",
      true: 0,
      false: 0,
    });
  });

  it("applies an overlapping set selection to the other facets' counts", () => {
    const entries = [
      row("one", { level: 1, school: ["Evocation", "Abjuration"], ritual: true }),
      row("two", { level: 2, school: ["Divination"], ritual: false }),
      row("three", { level: 3, school: ["Evocation"], ritual: false }),
    ];
    expect(
      facetSummaries(spell, entries, {
        level: { max: 2 },
        school: { any: ["Evocation", "Abjuration"] },
      }),
    ).toEqual([
      { key: "level", label: "Spell level", kind: "range", min: 1, max: 3, count: 2 },
      {
        key: "school",
        label: "School",
        kind: "set",
        options: [
          { value: "Abjuration", count: 1 },
          { value: "Divination", count: 1 },
          { value: "Evocation", count: 1 },
        ],
      },
      { key: "ritual", label: "Ritual", kind: "flag", true: 1, false: 0 },
    ]);
  });

  it("ignores unknown keys and empty ranges/sets in selections", () => {
    expect(
      facetSummaries(spell, rows, {
        unknown: { any: ["absent"] },
        level: {},
        school: { any: [] },
        ritual: undefined,
      }),
    ).toEqual(facetSummaries(spell, rows, {}));
  });

  it("counts rows once per option and sorts by count then accent/case-insensitive value", () => {
    const entries = [
      row("one", { school: ["Zulu", "Zulu", "Évocation", "alpha"] }),
      row("two", { school: "Zulu" }),
      row("three", { school: ["beta", "Évocation"] }),
      row("four", { school: [] }),
      row("five"),
    ];
    expect(facetSummaries(spell, entries, {})[1]).toEqual({
      key: "school",
      label: "School",
      kind: "set",
      options: [
        { value: "Évocation", count: 2 },
        { value: "Zulu", count: 2 },
        { value: "alpha", count: 1 },
        { value: "beta", count: 1 },
      ],
    });
  });

  it("does not merge distinct options that collate equally", () => {
    const entries = [row("one", { school: "école" }), row("two", { school: "Ecole" })];
    expect(facetSummaries(spell, entries, {})[1]).toEqual({
      key: "school",
      label: "School",
      kind: "set",
      options: [
        { value: "école", count: 1 },
        { value: "Ecole", count: 1 },
      ],
    });
  });

  it.each([{ entries: [] }, { entries: [row("missing")] }])(
    "returns empty summaries when no values exist: %j",
    ({ entries }) => {
      expect(facetSummaries(spell, entries, {})).toEqual([
        {
          key: "level",
          label: "Spell level",
          kind: "range",
          min: undefined,
          max: undefined,
          count: 0,
        },
        { key: "school", label: "School", kind: "set", options: [] },
        { key: "ritual", label: "Ritual", kind: "flag", true: 0, false: 0 },
      ]);
    },
  );

  it("handles negative and fractional ranges", () => {
    expect(
      facetSummaries(spell, [row("one", { level: -2.5 }), row("two", { level: 0 })], {})[0],
    ).toEqual({ key: "level", label: "Spell level", kind: "range", min: -2.5, max: 0, count: 2 });
  });

  it("supports absent filters and uses the key if a filter has no field", () => {
    expect(facetSummaries({ ...spell, filters: undefined }, rows, {})).toEqual([]);
    expect(facetSummaries({ ...spell, filters: [] }, rows, {})).toEqual([]);
    expect(
      facetSummaries(
        { ...spell, fields: [], filters: [{ key: "missing", kind: "flag" }] },
        rows,
        {},
      ),
    ).toEqual([{ key: "missing", label: "missing", kind: "flag", true: 0, false: 0 }]);
  });
});

describe("sortRows", () => {
  it.each<[RowSort["direction"], string[]]>([
    ["asc", ["alpha", "a", "b", "z"]],
    ["desc", ["z", "a", "b", "alpha"]],
  ])(
    "sorts names %s ignoring accents and case, breaking ties by ascending id",
    (direction, expected) => {
      const entries = [
        row("z", undefined, { name: "Zulu" }),
        row("b", undefined, { name: "eclair" }),
        row("alpha", undefined, { name: "Alpha" }),
        row("a", undefined, { name: "ÉCLAIR" }),
      ];
      expect(ids(sortRows(entries, { by: "name", direction }, [spell]))).toEqual(expected);
      expect(ids(sortRows([...entries].reverse(), { by: "name", direction }, [spell]))).toEqual(
        expected,
      );
    },
  );

  it.each<[RowSort["direction"], string[]]>([
    ["asc", ["zero", "two-a", "two-b", "ten", "missing-a", "missing-b"]],
    ["desc", ["ten", "two-a", "two-b", "zero", "missing-a", "missing-b"]],
  ])("sorts numeric facets %s with missing values last", (direction, expected) => {
    const entries = [
      row("missing-b"),
      row("two-b", { level: 2 }),
      row("ten", { level: 10 }),
      row("missing-a", {}),
      row("zero", { level: 0 }),
      row("two-a", { level: 2 }),
    ];
    expect(ids(sortRows(entries, { by: { facet: "level" }, direction }, [spell]))).toEqual(
      expected,
    );
  });

  it.each<[RowSort["direction"], string[]]>([
    ["asc", ["alpha", "a", "b", "z", "empty", "missing"]],
    ["desc", ["z", "a", "b", "alpha", "empty", "missing"]],
  ])(
    "sorts set facets %s by their first value, using the same text collation",
    (direction, expected) => {
      const entries = [
        row("missing"),
        row("empty", { school: [] }),
        row("z", { school: ["Zulu", "Alpha"] }),
        row("a", { school: "ÉCLAIR" }),
        row("b", { school: ["eclair", "Zulu"] }),
        row("alpha", { school: ["Alpha"] }),
      ];
      expect(ids(sortRows(entries, { by: { facet: "school" }, direction }, [spell]))).toEqual(
        expected,
      );
    },
  );

  it.each<[RowSort["direction"], string[]]>([
    ["asc", ["false", "true", "missing"]],
    ["desc", ["true", "false", "missing"]],
  ])("sorts boolean facets %s", (direction, expected) => {
    const entries = [
      row("missing"),
      row("true", { ritual: true }),
      row("false", { ritual: false }),
    ];
    expect(ids(sortRows(entries, { by: { facet: "ritual" }, direction }, [spell]))).toEqual(
      expected,
    );
  });

  it.each<[RowSort["direction"], string[]]>([
    ["asc", ["new-type", "item", "spell-a", "spell-b"]],
    ["desc", ["spell-a", "spell-b", "item", "new-type"]],
  ])(
    "sorts types %s by display name, then entry name, falling back to the type id",
    (direction, expected) => {
      const types: EntryType[] = [spell, { id: "z-item", name: "Ítem", fields: [] }];
      const entries = [
        row("spell-b", undefined, { name: "Zulu" }),
        row("item", undefined, { typeId: "z-item" }),
        row("new-type", undefined, { typeId: "Artifact" }),
        row("spell-a", undefined, { name: "Alpha" }),
      ];
      expect(ids(sortRows(entries, { by: "type", direction }, types))).toEqual(expected);
    },
  );

  it.each<[RowSort["direction"], string[]]>([
    ["asc", ["old", "new-a", "new-b"]],
    ["desc", ["new-a", "new-b", "old"]],
  ])("sorts update timestamps %s with stable id ties", (direction, expected) => {
    const entries = [
      row("new-b"),
      row("old", undefined, { updatedAt: "2026-09-30T23:59:59.999Z" }),
      row("new-a"),
    ];
    expect(ids(sortRows(entries, { by: "updated", direction }, [spell]))).toEqual(expected);
  });

  it("uses ids as a total tie-break even when ids collate equally", () => {
    const entries = [row("a", undefined, { name: "Same" }), row("A", undefined, { name: "Same" })];
    expect(ids(sortRows(entries, { by: "name", direction: "asc" }, []))).toEqual(["A", "a"]);
    expect(ids(sortRows(entries, { by: { facet: "unknown" }, direction: "desc" }, []))).toEqual([
      "A",
      "a",
    ]);
  });

  it("orders mixed facet kinds consistently across entry types", () => {
    const entries = [
      row("string", { shared: "11" }),
      row("ten", { shared: 10 }),
      row("two", { shared: 2 }),
      row("boolean", { shared: false }),
    ];
    expect(ids(sortRows(entries, { by: { facet: "shared" }, direction: "asc" }, []))).toEqual([
      "boolean",
      "two",
      "ten",
      "string",
    ]);
    expect(ids(sortRows(entries, { by: { facet: "shared" }, direction: "desc" }, []))).toEqual([
      "string",
      "ten",
      "two",
      "boolean",
    ]);
  });

  it("handles empty/singleton lists and preserves row references and extra fields", () => {
    expect(sortRows([], { by: "name", direction: "asc" }, [])).toEqual([]);
    const entry = { ...row("one"), extra: "retained" };
    const sorted = sortRows([entry], { by: "name", direction: "asc" }, []);
    expect(sorted[0]).toBe(entry);
    expect(sorted[0].extra).toBe("retained");
  });
});

it("does not mutate frozen rows, types or selections", () => {
  const entries = Object.freeze([
    Object.freeze(row("z", Object.freeze({ school: Object.freeze(["Zulu", "Alpha"]) }))),
    Object.freeze(row("a", Object.freeze({ school: "Alpha" }))),
  ]);
  const selection = Object.freeze({ school: Object.freeze({ any: Object.freeze(["Zulu"]) }) });
  const type = Object.freeze({
    ...spell,
    fields: Object.freeze(spell.fields),
    filters: Object.freeze(spell.filters ?? []),
  });
  expect(matchesFacets(entries[0], selection, type)).toBe(true);
  expect(facetSummaries(type, entries, selection)[1]).toEqual({
    key: "school",
    label: "School",
    kind: "set",
    options: [
      { value: "Alpha", count: 2 },
      { value: "Zulu", count: 1 },
    ],
  });
  const sorted = sortRows(
    entries,
    { by: { facet: "school" }, direction: "asc" },
    Object.freeze([type]),
  );
  expect(ids(sorted)).toEqual(["a", "z"]);
  expect(sorted).not.toBe(entries);
  expect(sorted[0]).toBe(entries[1]);
  expect(ids(entries)).toEqual(["z", "a"]);
  expect(entries[0].facets?.school).toEqual(["Zulu", "Alpha"]);
  expect(selection.school.any).toEqual(["Zulu"]);
});

it("summarizes three facets and sorts 10,000 rows in under 50 ms", () => {
  const schools = [
    "Abjuration",
    "Conjuration",
    "Divination",
    "Enchantment",
    "Evocation",
    "Illusion",
    "Necromancy",
    "Transmutation",
  ];
  const entries = Array.from({ length: 10_000 }, (_, i) => {
    const n = (i * 7919) % 10_000;
    return row(
      `spell-${n}`,
      { level: n % 10, school: schools[n % schools.length], ritual: n % 3 === 0 },
      { name: `${n % 2 ? "Éclair" : "arcane"} ${n}` },
    );
  });
  const selection = {
    level: { min: 1, max: 7 },
    school: { any: ["Evocation", "Divination"] },
    ritual: { value: false },
  };
  const run = () => {
    const summaries = facetSummaries(spell, entries, selection);
    const sorted = sortRows(entries, { by: "name", direction: "asc" }, [spell]);
    return { summaries, sorted };
  };
  run();
  run();
  const samples = Array.from({ length: 7 }, () => {
    const start = performance.now();
    const result = run();
    const elapsed = performance.now() - start;
    expect(result.summaries).toHaveLength(3);
    expect(result.sorted).toHaveLength(10_000);
    return elapsed;
  }).sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  console.info(`facets + name sort, 10,000 rows / 3 filters: ${median.toFixed(2)} ms median`);
  expect(median).toBeLessThan(50);
});
