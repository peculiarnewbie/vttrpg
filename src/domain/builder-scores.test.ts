import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { builderParts } from "./builder-parts";
import { SheetLayout } from "./sheet-layout";
import { layoutProblems } from "./sheet-refs";

const layout: SheetLayout = {
  system: "Test",
  name: "Scores",
  pages: [
    {
      id: "main",
      title: "Main",
      blocks: [
        { id: "health", type: "trackers", items: [{ key: "hp", label: "HP", min: 0, max: 20 }] },
        { id: "attrs", type: "stats", items: [{ key: "str", label: "STR" }] },
      ],
    },
  ],
  builder: {
    steps: [
      {
        id: "scores",
        title: "Scores",
        parts: [
          {
            type: "scores",
            items: [{ key: "hp" }, { key: "str", label: "Might" }],
            max: true,
          },
        ],
      },
    ],
  },
};

describe("scores part", () => {
  it("decodes, and tracker and stat keys raise no problems", () => {
    expect(Schema.decodeUnknownSync(SheetLayout)(layout).builder?.steps).toHaveLength(1);
    expect(layoutProblems(layout)).toEqual([]);
  });

  it("warns when an item key isn't a tracker or stat, without blocking the save", () => {
    expect(
      layoutProblems({
        ...layout,
        builder: {
          steps: [
            {
              id: "scores",
              title: "Scores",
              parts: [{ type: "scores", items: [{ key: "hp" }, { key: "gone" }] }],
            },
          ],
        },
      }),
    ).toEqual(['Builder step "Scores" sets "gone", which isn\'t a tracker or stat on the sheet']);
  });

  it("rejects what can't be saved: too many items, a long label, a non-boolean max", () => {
    const part = (items: unknown, max?: unknown) =>
      Schema.decodeUnknownResult(SheetLayout)({
        ...layout,
        builder: {
          steps: [{ id: "scores", title: "Scores", parts: [{ type: "scores", items, max }] }],
        },
      })._tag;
    expect(part(Array.from({ length: 13 }, (_, i) => ({ key: `k${i}` })))).toBe("Failure");
    expect(part([{ key: "hp" }])).toBe("Success");
    expect(part([{ key: "hp", label: "x".repeat(61) }])).toBe("Failure");
    expect(part([{ key: "hp" }], "yes")).toBe("Failure");
    expect(part([{ key: "hp" }], true)).toBe("Success");
  });

  it("has a label and an empty blank part of its own kind", () => {
    expect(builderParts.scores.label).not.toBe("");
    expect(builderParts.scores.blank(layout)).toEqual({ type: "scores", items: [] });
  });
});
