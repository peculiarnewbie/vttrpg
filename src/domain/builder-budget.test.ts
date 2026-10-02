import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { builderParts } from "./builder-parts";
import { SheetLayout } from "./sheet-layout";
import { layoutProblems } from "./sheet-refs";

const layout: SheetLayout = {
  system: "Test",
  name: "Budget",
  pages: [
    {
      id: "main",
      title: "Main",
      blocks: [
        {
          id: "scores",
          type: "stats",
          items: [
            { key: "str", label: "STR" },
            { key: "dex", label: "DEX" },
          ],
        },
      ],
    },
  ],
  derived: [{ key: "half", label: "Half", expr: "@str / 2" }],
  builder: {
    steps: [
      {
        id: "spend",
        title: "Spend",
        parts: [
          {
            type: "budget",
            label: "Points",
            spent: "@str + @dex",
            total: "10",
            items: [{ key: "str", cap: 5 }, { key: "dex" }],
          },
        ],
      },
    ],
  },
};

const budgeted = (parts: unknown) => ({
  ...layout,
  builder: { steps: [{ id: "spend", title: "Spend", parts }] },
});

const problemsIn = (parts: unknown) => layoutProblems(budgeted(parts) as SheetLayout);

describe("budget part schema", () => {
  it("decodes, keeps the budget, and fits the limits with no problems", () => {
    const decoded = Schema.decodeUnknownSync(SheetLayout)(layout);
    expect(decoded.builder?.steps[0].parts).toEqual(layout.builder?.steps[0].parts);
    expect(layoutProblems(layout)).toEqual([]);
  });

  it("rejects what can't be saved: a long label, long formulas, too many items, a bad cap", () => {
    const part = layout.builder!.steps[0].parts[0];
    const invalid = (override: unknown) =>
      Schema.decodeUnknownResult(SheetLayout)(
        budgeted([
          { ...(part as Record<string, unknown>), ...(override as Record<string, unknown>) },
        ]),
      )._tag;
    expect(invalid({ label: "x".repeat(61) })).toBe("Failure");
    expect(invalid({ spent: "1".repeat(401) })).toBe("Failure");
    expect(invalid({ total: "1".repeat(401) })).toBe("Failure");
    expect(invalid({ items: Array.from({ length: 13 }, () => ({ key: "str" })) })).toBe("Failure");
    expect(invalid({ items: [{ key: "str", cap: 1001 }] })).toBe("Failure");
    expect(invalid({ items: [{ key: "str", cap: -1001 }] })).toBe("Failure");
    expect(invalid({ items: [{ key: "str", cap: 1.5 }] })).toBe("Failure");
    // Edge values stay saveable: a 60-char label, 400-char formulas, 12 items, caps at ±1000.
    expect(
      invalid({
        label: "x".repeat(60),
        spent: "@str + 0".padEnd(400, " "),
        total: "1".padEnd(400, " "),
        items: Array.from({ length: 12 }, () => ({ key: "str", cap: 1000 })),
      }),
    ).toBe("Success");
    expect(invalid({ items: [{ key: "str", cap: -1000 }] })).toBe("Success");
    expect(invalid({ items: undefined })).toBe("Success");
  });

  it("gives the kind a label and a blank part of its own kind", () => {
    const kind = builderParts.budget;
    expect(kind.label).not.toBe("");
    expect(kind.blank(layout)).toEqual({
      type: "budget",
      label: expect.any(String),
      spent: expect.any(String),
      total: expect.any(String),
    });
    expect(kind.blank(layout).type).toBe("budget");
  });
});

describe("budget part problems", () => {
  it("names broken formulas and unknown keys without blocking the save", () => {
    expect(
      problemsIn([
        {
          type: "budget",
          label: "Points",
          spent: "@str +",
          total: "2d6",
          items: [{ key: "str", cap: 5 }, { key: "gone" }],
        },
      ]),
    ).toEqual([
      expect.stringMatching(/^Builder "Points spent": /),
      expect.stringMatching(/^Builder "Points total": /),
      'Builder step "Spend" counts "gone", which isn\'t on the sheet',
    ]);
  });

  it("names refs to keys that aren't on the sheet", () => {
    expect(
      problemsIn([{ type: "budget", label: "Points", spent: "@nope + 1", total: "@half + @str" }]),
    ).toEqual(['Builder "Points spent" uses @nope, which isn\'t on the sheet']);
  });
});
