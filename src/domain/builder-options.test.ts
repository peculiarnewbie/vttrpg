import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { builderParts, optionsTarget, optionsTargets } from "./builder-parts";
import { isKnownPart, SheetLayout, type BuilderPart } from "./sheet-layout";
import { layoutProblems } from "./sheet-refs";

const layout: SheetLayout = {
  system: "Test",
  name: "Origins",
  pages: [
    {
      id: "main",
      title: "Main",
      blocks: [
        {
          id: "identity",
          type: "fields",
          columns: 1,
          items: [{ key: "background", label: "Background" }],
        },
        { id: "vigor", type: "stats", items: [{ key: "str", label: "STR" }] },
        { id: "looks", type: "text", key: "looks", label: "Looks" },
        {
          id: "skills",
          type: "checks",
          key: "skills",
          label: "Skills",
          options: ["Sneak", "Climb"],
        },
      ],
    },
  ],
  builder: {
    steps: [
      {
        id: "pick",
        title: "Pick",
        parts: [
          {
            type: "options",
            key: "skills",
            options: [{ label: "Sneak" }, { label: "Climb", note: "Up anything" }],
            pick: 2,
            grants: ["Sneak"],
          },
        ],
      },
    ],
  },
};

const part = layout.builder!.steps[0].parts[0] as Extract<BuilderPart, { type: "options" }>;

const problemsWith = (parts: readonly BuilderPart[]) =>
  layoutProblems({
    ...layout,
    builder: { steps: [{ id: "pick", title: "Pick", parts }] },
  });

describe("options part schema", () => {
  it("decodes a full part and keeps it through encode", () => {
    const decoded = Schema.decodeUnknownSync(SheetLayout)(layout);
    expect(decoded.builder?.steps[0].parts).toEqual([part]);
    expect(Schema.encodeSync(SheetLayout)(decoded).builder?.steps[0].parts).toEqual([part]);
    expect(isKnownPart(part)).toBe(true);
  });

  it("leaves options, pick and grants out until the author sets them", () => {
    const decoded = Schema.decodeUnknownSync(SheetLayout)({
      ...layout,
      builder: { steps: [{ id: "a", title: "A", parts: [{ type: "options", key: "looks" }] }] },
    });
    expect(decoded.builder?.steps[0].parts).toEqual([{ type: "options", key: "looks" }]);
  });

  it("rejects what can't be saved: a pick out of range, too many options or grants", () => {
    const invalid = (optionsPart: unknown) =>
      Schema.decodeUnknownResult(SheetLayout)({
        ...layout,
        builder: { steps: [{ id: "a", title: "A", parts: [optionsPart] }] },
      })._tag;
    const base = { type: "options", key: "skills" };
    expect(invalid({ ...base, pick: 0 })).toBe("Failure");
    expect(invalid({ ...base, pick: 51 })).toBe("Failure");
    expect(invalid({ ...base, pick: 1 })).toBe("Success");
    expect(invalid({ ...base, pick: 50 })).toBe("Success");
    const option = { label: "Sneak" };
    expect(invalid({ ...base, options: Array.from({ length: 51 }, () => option) })).toBe("Failure");
    expect(invalid({ ...base, options: Array.from({ length: 50 }, () => option) })).toBe("Success");
    expect(invalid({ ...base, grants: Array.from({ length: 21 }, () => "Sneak") })).toBe("Failure");
    expect(invalid({ ...base, grants: Array.from({ length: 20 }, () => "Sneak") })).toBe("Success");
    expect(invalid({ ...base, options: [{ label: "x".repeat(61) }] })).toBe("Failure");
    expect(invalid({ ...base, options: [{ label: "Sneak", note: "x".repeat(201) }] })).toBe(
      "Failure",
    );
  });
});

describe("options targets", () => {
  it("fills fields and stats items, text blocks and checks blocks in sheet order", () => {
    expect(optionsTargets(layout)).toEqual([
      { kind: "text", key: "background", label: "Background" },
      { kind: "text", key: "str", label: "STR" },
      { kind: "text", key: "looks", label: "Looks" },
      { kind: "checks", key: "skills", label: "Skills", options: ["Sneak", "Climb"] },
    ]);
  });

  it("finds a target by key, and nothing for a key that left the sheet", () => {
    expect(optionsTarget(layout, "skills")).toMatchObject({ kind: "checks", key: "skills" });
    expect(optionsTarget(layout, "background")).toMatchObject({ kind: "text" });
    expect(optionsTarget(layout, "gone")).toBeUndefined();
  });

  it("blanks to the first fillable value, or an empty key with no fillable values", () => {
    expect(builderParts.options.blank(layout)).toEqual({ type: "options", key: "background" });
    const empty = Schema.decodeUnknownSync(SheetLayout)({
      system: "Test",
      name: "Empty",
      pages: [{ id: "main", title: "Main", blocks: [] }],
    });
    expect(optionsTargets(empty)).toEqual([]);
    expect(builderParts.options.blank(empty)).toEqual({ type: "options", key: "" });
  });
});

describe("options problems", () => {
  it("names no problems for a part whose target, options and grants line up", () => {
    expect(problemsWith([part])).toEqual([]);
    // A checks target with no options of its own falls back to the block's.
    expect(problemsWith([{ type: "options", key: "skills", grants: ["Sneak"] }])).toEqual([]);
    expect(problemsWith([{ type: "options", key: "looks" }])).toEqual([]);
  });

  it("warns about a target that isn't on the sheet, without blocking the save", () => {
    expect(problemsWith([{ type: "options", key: "gone" }])).toEqual([
      'Builder step "Pick" offers options for "gone", which isn\'t a field, stat, text, or checks value on the sheet',
    ]);
  });

  it("warns about grants on a target that isn't a checks block", () => {
    expect(problemsWith([{ type: "options", key: "background", grants: ["Sneak"] }])).toEqual([
      'Builder step "Pick" gives options for "background", which isn\'t a checks block',
    ]);
  });

  it("warns about a grant that isn't one of the offered options", () => {
    expect(
      problemsWith([
        { type: "options", key: "skills", options: [{ label: "Sneak" }], grants: ["Climb"] },
      ]),
    ).toEqual(['Builder step "Pick" gives "Climb", which isn\'t one of its options']);
    // With no options of its own the block's options are what's offered.
    expect(problemsWith([{ type: "options", key: "skills", grants: ["Fly"] }])).toEqual([
      'Builder step "Pick" gives "Fly", which isn\'t one of its options',
    ]);
  });
});
