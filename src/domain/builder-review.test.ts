import { describe, expect, it } from "vitest";
import { reviewRows } from "./builder-review";
import type { SheetLayout, SheetValues } from "./sheet-layout";
import { layoutProblems, sheetScope } from "./sheet-refs";

const layout: SheetLayout = {
  system: "Test",
  name: "Review",
  pages: [
    {
      id: "main",
      title: "Main",
      blocks: [
        {
          id: "name-fields",
          type: "fields",
          columns: 1,
          items: [{ key: "name", label: "Name" }],
        },
        { id: "virtues", type: "stats", items: [{ key: "vig", label: "VIG" }] },
        {
          id: "health",
          type: "trackers",
          items: [{ key: "hp", label: "HP", min: 0, max: 6 }],
        },
        { id: "notes", type: "text", key: "notes", label: "Notes" },
        { id: "kin", type: "entry", key: "kin", entryType: "kin", label: "Kin" },
        {
          id: "gear",
          type: "list",
          key: "gear",
          title: "Gear",
          columns: [{ key: "name", label: "Item", kind: "text" }],
        },
        { id: "traits", type: "checks", key: "traits", label: "Traits", options: ["Brave"] },
      ],
    },
  ],
  builder: {
    steps: [
      {
        id: "basics",
        title: "Basics",
        done: "@vig > 0",
        parts: [
          { type: "blocks", blocks: ["name-fields", "virtues", "health"] },
          { type: "choose", key: "kin" },
        ],
      },
      {
        id: "extra",
        title: "Extra",
        when: "@vig >= 10",
        parts: [
          { type: "blocks", blocks: ["notes", "gear", "traits", "gone"] },
          { type: "spinner", faces: 6 } as never,
        ],
      },
      { id: "lookback", title: "Look back", parts: [{ type: "review" }] },
    ],
  },
};

const rowsOf = (values: SheetValues, exclude = "lookback") =>
  reviewRows(layout, values, sheetScope(layout, values), exclude);

describe("review rows", () => {
  it("lists every other applying step with its done tick and blank values", () => {
    expect(rowsOf({ vig: 5 })).toEqual([
      { stepId: "basics", title: "Basics", done: true, blank: ["Name", "Kin"] },
    ]);
    // Extra applies at VIG 12: its text, list and checks are still empty.
    expect(rowsOf({ vig: 12, name: "Ser Test" })).toEqual([
      { stepId: "basics", title: "Basics", done: true, blank: ["Kin"] },
      { stepId: "extra", title: "Extra", done: false, blank: ["Notes", "Gear", "Traits"] },
    ]);
  });

  it("counts filled values as done: numbers, text, entries, rows and ticks", () => {
    expect(
      rowsOf({
        vig: 12,
        name: "Ser Test",
        kin: "world/kin/a",
        notes: "  ",
        gear: [{ name: "Torch" }],
        traits: ["Brave"],
      }),
    ).toEqual([
      { stepId: "basics", title: "Basics", done: true, blank: [] },
      { stepId: "extra", title: "Extra", done: false, blank: ["Notes"] },
    ]);
  });

  it("ignores unknown part kinds, dangling block ids and tracker values", () => {
    // No hp anywhere above, yet it never shows: trackers count as filled.
    // "gone" isn't on the sheet and the spinner part is unknown: both skipped.
    const rows = rowsOf({ vig: 12 });
    expect(rows[1].blank).toEqual(["Notes", "Gear", "Traits"]);
  });

  it("names each blank value once even when two parts read it", () => {
    const doubled: SheetLayout = {
      ...layout,
      builder: {
        steps: [
          {
            id: "basics",
            title: "Basics",
            parts: [
              { type: "blocks", blocks: ["name-fields", "name-fields"] },
              { type: "choose", key: "kin" },
              { type: "choose", key: "kin" },
            ],
          },
          { id: "lookback", title: "Look back", parts: [{ type: "review" }] },
        ],
      },
    };
    expect(reviewRows(doubled, {}, sheetScope(doubled, {}), "lookback")).toEqual([
      { stepId: "basics", title: "Basics", done: false, blank: ["Name", "Kin"] },
    ]);
  });

  it("falls back to Step N for untitled steps, and a bad condition never hides a step", () => {
    const odd: SheetLayout = {
      ...layout,
      builder: {
        steps: [
          { id: "a", title: "", when: "@vig >=", parts: [] },
          { id: "b", title: "", done: "@vig >=", parts: [{ type: "review" }] },
        ],
      },
    };
    expect(reviewRows(odd, {}, sheetScope(odd, {}), "b")).toEqual([
      { stepId: "a", title: "Step 1", done: false, blank: [] },
    ]);
  });
});

describe("review problems", () => {
  it("warns when a review has only one step to look back on, and is otherwise quiet", () => {
    // The fixture's dangling block and unknown part are still named; the review itself adds nothing.
    expect(layoutProblems(layout)).toEqual([
      'Builder step "Extra" shows block "gone", which isn\'t on the sheet',
      'Builder step "Extra" has a "spinner" part, which this version can\'t show',
    ]);
    const single: SheetLayout = {
      ...layout,
      builder: { steps: [{ id: "only", title: "Only", parts: [{ type: "review" }] }] },
    };
    expect(layoutProblems(single)).toEqual([
      'Builder step "Only" is a review with only one step to look back on',
    ]);
  });
});
