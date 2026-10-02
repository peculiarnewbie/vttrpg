import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { assignTargets, usedChips } from "../components/builder-parts/assign";
import { builderParts, type PartChecks } from "./builder-parts";
import { SheetLayout, type SheetLayout as Layout } from "./sheet-layout";
import { layoutProblems } from "./sheet-refs";

const layout: Layout = {
  system: "Test",
  name: "Array",
  pages: [
    {
      id: "main",
      title: "Main",
      blocks: [
        { id: "edge", type: "stats", items: [{ key: "edge", label: "Edge" }] },
        {
          id: "grouped",
          type: "group",
          title: "Grouped",
          blocks: [
            { id: "name", type: "fields", columns: 1, items: [{ key: "name", label: "Name" }] },
            {
              id: "resolve",
              type: "trackers",
              items: [{ key: "resolve", label: "Resolve", min: 0, max: 6, start: 0 }],
            },
          ],
        },
        { id: "notes", type: "text", key: "notes", label: "Notes" },
      ],
    },
  ],
};

const checks = (part: { values: readonly (number | string)[]; targets: readonly string[] }) => {
  const problems: string[] = [];
  const context: PartChecks = {
    layout,
    name: 'Builder step "Scores"',
    blockIds: new Set(),
    entryKeys: new Set(),
    choosable: new Set(),
    problem: (message) => problems.push(message),
    roll: () => {},
    formula: () => {},
  };
  builderParts.assign.check(
    { type: "assign", ...part } as Parameters<typeof builderParts.assign.check>[0],
    context,
  );
  return problems;
};

describe("assign part schema", () => {
  const step = (part: unknown) => ({
    ...layout,
    builder: { steps: [{ id: "scores", title: "Scores", parts: [part] }] },
  });

  it("decodes numbers, strings, an optional label and tracker maximums", () => {
    const decoded = Schema.decodeUnknownSync(SheetLayout)(
      step({
        type: "assign",
        label: "Place",
        values: [15, "wild", 8],
        targets: ["edge"],
        max: true,
      }),
    );
    expect(decoded.builder?.steps[0].parts[0]).toEqual({
      type: "assign",
      label: "Place",
      values: [15, "wild", 8],
      targets: ["edge"],
      max: true,
    });
    expect(builderParts.assign.blank(layout)).toEqual({ type: "assign", values: [], targets: [] });
  });

  it("rejects what can't be saved: long strings and lists over twelve", () => {
    const invalid = (part: unknown) => Schema.decodeUnknownResult(SheetLayout)(step(part))._tag;
    expect(invalid({ type: "assign", values: [], targets: [] })).toBe("Success");
    expect(
      invalid({
        type: "assign",
        values: Array.from({ length: 13 }, (_, i) => i),
        targets: [],
      }),
    ).toBe("Failure");
    expect(invalid({ type: "assign", values: ["x".repeat(31)], targets: [] })).toBe("Failure");
    expect(invalid({ type: "assign", label: "x".repeat(61), values: [1], targets: [] })).toBe(
      "Failure",
    );
    expect(
      invalid({
        type: "assign",
        values: [1],
        targets: Array.from({ length: 13 }, (_, i) => `k${i}`),
      }),
    ).toBe("Failure");
  });
});

describe("assign part problems", () => {
  it("warns about no values and targets that aren't stats, fields or trackers", () => {
    expect(checks({ values: [], targets: [] })).toEqual([
      'Builder step "Scores" has a place-values part with no values to place',
    ]);
    expect(checks({ values: [15], targets: ["edge", "name", "resolve"] })).toEqual([]);
    expect(checks({ values: [15], targets: ["notes", "gone"] })).toEqual([
      'Builder step "Scores" places onto "notes", which isn\'t a stat, field or tracker on the sheet',
      'Builder step "Scores" places onto "gone", which isn\'t a stat, field or tracker on the sheet',
    ]);
  });

  it("surfaces through the layout's own problems list", () => {
    expect(
      layoutProblems({
        ...layout,
        builder: {
          steps: [
            {
              id: "scores",
              title: "Scores",
              parts: [{ type: "assign", values: [], targets: ["gone"] }],
            },
          ],
        },
      }),
    ).toEqual([
      'Builder step "Scores" has a place-values part with no values to place',
      'Builder step "Scores" places onto "gone", which isn\'t a stat, field or tracker on the sheet',
    ]);
  });
});

describe("assign targets and used chips", () => {
  it("lists stats, fields and tracker items in sheet order, groups included", () => {
    expect(assignTargets(layout)).toEqual([
      { key: "edge", label: "Edge", tracker: false },
      { key: "name", label: "Name", tracker: false },
      { key: "resolve", label: "Resolve", tracker: true },
    ]);
  });

  it('uses up one equal chip per placed value, as text so 15 matches "15"', () => {
    expect(usedChips([3, 2, 2, 1, 1], [3, 2, "Edge", "", undefined, ["x"], 1])).toEqual([
      true,
      true,
      false,
      true,
      false,
    ]);
    // A chip may still go anywhere twice: use is a hint, never a count.
    expect(usedChips([8], [8, 8])).toEqual([true]);
    expect(usedChips([15], [])).toEqual([false]);
  });
});
