import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { builderParts } from "./builder-parts";
import { SheetLayout, isKnownPart } from "./sheet-layout";
import { layoutProblems } from "./sheet-refs";

const layout: SheetLayout = {
  system: "Test",
  name: "Oath",
  pages: [
    {
      id: "main",
      title: "Main",
      blocks: [{ id: "virtues", type: "stats", items: [{ key: "vig", label: "VIG" }] }],
    },
  ],
  builder: {
    steps: [
      {
        id: "oath",
        title: "Oath",
        parts: [
          {
            type: "text",
            markdown: "Say what your knight believes.\n\nRoll [[r:3d6|Virtue]] and write it in.",
          },
        ],
      },
    ],
  },
};

describe("text builder part", () => {
  it("decodes and round-trips, and rejects guidance over 4000 characters", () => {
    const decoded = Schema.decodeUnknownSync(SheetLayout)(layout);
    expect(decoded.builder?.steps[0].parts).toEqual(layout.builder?.steps[0].parts);
    expect(isKnownPart({ type: "text", markdown: "hi" })).toBe(true);
    const tooLong = {
      ...layout,
      builder: {
        steps: [
          { id: "oath", title: "Oath", parts: [{ type: "text", markdown: "x".repeat(4001) }] },
        ],
      },
    };
    expect(Schema.decodeUnknownResult(SheetLayout)(tooLong)._tag).toBe("Failure");
  });

  it("has a label and a blank part of its own kind", () => {
    expect(builderParts.text.label).not.toBe("");
    expect(builderParts.text.blank(layout)).toEqual({ type: "text", markdown: "" });
  });

  it("warns about empty guidance without blocking the save", () => {
    expect(layoutProblems(layout)).toEqual([]);
    const empty = {
      ...layout,
      builder: {
        steps: [{ id: "oath", title: "Oath", parts: [{ type: "text", markdown: "  " }] }],
      },
    };
    expect(layoutProblems(empty)).toEqual(['Builder step "Oath" has a text part with no guidance']);
  });
});
