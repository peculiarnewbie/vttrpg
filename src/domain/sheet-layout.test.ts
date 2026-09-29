import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { SheetLayout, resolveTrackerDisplay } from "./sheet-layout";
import { presets } from "./sheet-presets";

describe("sheet layouts", () => {
  it.each(presets.map((preset) => [preset.system, preset] as const))(
    "%s decodes as a SheetLayout",
    (_, preset) => {
      expect(Schema.decodeUnknownResult(SheetLayout)(preset)._tag).toBe("Success");
    },
  );

  it("keeps block ids unique within each preset", () => {
    for (const preset of presets) {
      const ids = preset.pages.flatMap((page) => page.blocks.map((block) => block.id));
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
});
