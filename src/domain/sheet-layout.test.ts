import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  SheetLayout,
  gridMode,
  resolveSpan,
  resolveTrackerDisplay,
  resolveVariant,
} from "./sheet-layout";
import { presets } from "./sheet-presets";

describe("sheet layouts", () => {
  it.each(presets.map((preset) => [`${preset.system} ${preset.name}`, preset] as const))(
    "%s decodes as a SheetLayout",
    (_name, preset) => {
      expect(Schema.decodeUnknownResult(SheetLayout)(preset)._tag).toBe("Success");
    },
  );

  it("keeps block ids unique within each preset, groups included", () => {
    for (const preset of presets) {
      const ids = preset.pages.flatMap((page) =>
        page.blocks.flatMap((block) =>
          block.type === "group"
            ? [block.id, ...block.blocks.map((child) => child.id)]
            : [block.id],
        ),
      );
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("rejects unknown block types", () => {
    const bad = {
      system: "X",
      pages: [{ id: "p", title: "P", blocks: [{ id: "b", type: "hexmap" }] }],
    };
    expect(Schema.decodeUnknownResult(SheetLayout)(bad)._tag).toBe("Failure");
  });

  it("resolves auto tracker displays by range", () => {
    expect(resolveTrackerDisplay({ min: 0, max: 6 })).toBe("pips");
    expect(resolveTrackerDisplay({ min: 2, max: 20 })).toBe("bar");
    expect(resolveTrackerDisplay({ min: 0, max: 4, display: "clock" })).toBe("clock");
  });

  it("prefers a valid viewer override, then the layout's variant, then the default", () => {
    const block = { id: "abilities", type: "stats", variant: "boxes" } as const;
    expect(resolveVariant(block)).toBe("boxes");
    expect(resolveVariant(block, { abilities: "bars" })).toBe("bars");
    expect(resolveVariant(block, { abilities: "clock" })).toBe("boxes");
    expect(resolveVariant({ id: "x", type: "list" })).toBe("table");
  });

  it("stacks narrow sheets and uses wide spans on wide ones", () => {
    const block = { span: 3, wide: 2 };
    expect(resolveSpan(block, gridMode(280))).toBe(6);
    expect(resolveSpan(block, gridMode(340))).toBe(3);
    expect(resolveSpan(block, gridMode(720))).toBe(2);
    expect(resolveSpan({}, "wide")).toBe(6);
  });

  it("rejects spans outside the 6-column grid", () => {
    const bad = {
      system: "X",
      name: "Y",
      pages: [{ id: "p", title: "P", blocks: [{ id: "b", type: "heading", text: "H", span: 7 }] }],
    };
    expect(Schema.decodeUnknownResult(SheetLayout)(bad)._tag).toBe("Failure");
  });
});
