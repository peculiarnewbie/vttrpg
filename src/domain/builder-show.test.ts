import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { builderParts } from "./builder-parts";
import { explain, parseExpr } from "./derived";
import { isKnownPart, SheetLayout } from "./sheet-layout";
import { layoutProblems, sheetScope } from "./sheet-refs";

const layout: SheetLayout = {
  system: "Test",
  name: "Show",
  pages: [
    {
      id: "main",
      title: "Main",
      blocks: [{ id: "attrs", type: "stats", items: [{ key: "str", label: "STR" }] }],
    },
  ],
  derived: [{ key: "str_mod", label: "STR mod", expr: "floor((@str - 10) / 2)" }],
  builder: {
    steps: [
      {
        id: "readouts",
        title: "Readouts",
        parts: [
          {
            type: "show",
            items: [
              { label: "STR mod", expr: "@str_mod" },
              { label: "Double", expr: "@str * 2" },
            ],
          },
        ],
      },
    ],
  },
};

describe("show part schema", () => {
  it("decodes a show part and keeps it through encode", () => {
    const decoded = Schema.decodeUnknownSync(SheetLayout)(layout);
    expect(decoded.builder?.steps[0].parts).toEqual(layout.builder?.steps[0].parts);
    expect(isKnownPart({ type: "show", items: [] })).toBe(true);
  });

  it("rejects what can't be saved: too many items, a long label, a long formula", () => {
    const part = (items: unknown) => ({
      ...layout,
      builder: { steps: [{ id: "a", title: "A", parts: [{ type: "show", items }] }] },
    });
    const invalid = (items: unknown) => Schema.decodeUnknownResult(SheetLayout)(part(items))._tag;
    expect(invalid([])).toBe("Success");
    expect(invalid(Array.from({ length: 13 }, () => ({ label: "V", expr: "1" })))).toBe("Failure");
    expect(invalid([{ label: "x".repeat(61), expr: "1" }])).toBe("Failure");
    expect(invalid([{ label: "V", expr: "1".repeat(401) }])).toBe("Failure");
  });

  it("has a label and a blank part of its own kind", () => {
    const kind = builderParts.show;
    expect(kind.label).not.toBe("");
    expect(kind.blank(layout)).toEqual({ type: "show", items: [{ label: "Value", expr: "1" }] });
  });
});

describe("show part problems", () => {
  it("names a formula that doesn't parse and a ref that isn't on the sheet", () => {
    expect(
      layoutProblems({
        ...layout,
        builder: {
          steps: [
            {
              id: "a",
              title: "Readouts",
              parts: [
                {
                  type: "show",
                  items: [
                    { label: "Bad", expr: "@str +" },
                    { label: "Missing", expr: "@nope + 1" },
                  ],
                },
              ],
            },
          ],
        },
      }),
    ).toEqual([
      expect.stringMatching(/^Builder "Bad": Expected an expression/),
      'Builder "Missing" uses @nope, which isn\'t on the sheet',
    ]);
  });

  it("reports nothing for formulas the sheet knows", () => {
    expect(layoutProblems(layout)).toEqual([]);
  });
});

describe("show part values", () => {
  it("reads the character through the sheet's scope, with what each formula read", () => {
    // The view evaluates with `context.scope()` (sheetScope) via `explain`.
    const scope = sheetScope(layout, { str: 14 });
    const mod = parseExpr("@str_mod");
    const load = parseExpr("@str + 4");
    expect(mod.ok && explain(mod.value, scope).value).toBe(2);
    expect(load.ok && explain(load.value, scope)).toMatchObject({
      value: 18,
      terms: [{ ref: { key: "str" }, value: 14 }],
    });
  });
});
