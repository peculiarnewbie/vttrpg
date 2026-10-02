import { describe, expect, it } from "vitest";
import { errorAt, formulaRefs, matchRefs, refAtCursor } from "./formula-help";
import type { SheetLayout } from "./sheet-layout";

const layout: SheetLayout = {
  system: "Test",
  name: "Test",
  derived: [{ key: "str_mod", label: "STR mod", expr: "floor((@str - 10) / 2)" }],
  pages: [
    {
      id: "main",
      title: "Main",
      blocks: [
        { id: "stats", type: "stats", items: [{ key: "str", label: "Strength" }] },
        { id: "hp", type: "trackers", items: [{ key: "hp", label: "HP", min: 0, max: 10 }] },
        { id: "skills", type: "checks", key: "skills", label: "Skills", options: ["Stealth"] },
        {
          id: "gear",
          type: "list",
          key: "gear",
          title: "Gear",
          columns: [
            { key: "name", label: "Item", kind: "text" },
            { key: "weight", label: "Weight", kind: "number" },
          ],
        },
      ],
    },
  ],
};

describe("formula suggestions", () => {
  it("lists every value a formula can read, with labels, and the row's columns first in a list", () => {
    expect(formulaRefs(layout).map((item) => [item.text, item.label, item.detail])).toEqual([
      ["@str_mod", "STR mod", "formula"],
      ["@str", "Strength", "stat"],
      ["@hp", "HP", "tracker"],
      ["@skills", "Skills", "checks (count)"],
      ["@gear", "Gear", "list (rows)"],
      ["@gear.name", "Gear Item", "column total"],
      ["@gear.weight", "Gear Weight", "column total"],
    ]);
    expect(
      formulaRefs(layout, "gear")
        .slice(0, 2)
        .map((item) => item.text),
    ).toEqual(["@row.name", "@row.weight"]);
  });

  it("matches by ref prefix first, then by a word of the label", () => {
    const refs = formulaRefs(layout);
    expect(matchRefs(refs, "st").map((item) => item.text)).toEqual(["@str_mod", "@str"]);
    expect(matchRefs(refs, "weig").map((item) => item.text)).toEqual(["@gear.weight"]);
    expect(matchRefs(refs, "strength").map((item) => item.text)).toEqual(["@str"]);
  });

  it("finds the @ref being typed before the cursor", () => {
    expect(refAtCursor("floor(@st", 9)).toEqual({ start: 6, typed: "st" });
    expect(refAtCursor("@gear.we + 1", 8)).toEqual({ start: 0, typed: "gear.we" });
    expect(refAtCursor("@str + 1", 8)).toBeUndefined();
    expect(refAtCursor("1 + @", 5)).toEqual({ start: 4, typed: "" });
  });

  it("splits a parse error into its message and position", () => {
    expect(errorAt("Expected “)” at 6")).toEqual({ message: "Expected “)”", position: 6 });
    expect(errorAt("Invalid expression")).toEqual({ message: "Invalid expression" });
  });
});
