import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import type { SheetTemplate } from "./schemas";
import { SheetLayout, layoutTrackers } from "./sheet-layout";
import { bastionlandClassic } from "./sheet-presets";
import { effectiveLayout, layoutFromTemplate } from "./layout-from-template";

const template: SheetTemplate = {
  id: "template",
  worldId: "world",
  name: "Adventurer",
  fields: [
    { id: "name", label: "Name", kind: "text", group: "Identity" },
    { id: "story", label: "Story", kind: "longtext", group: "Story" },
    { id: "level", label: "Level", kind: "number", group: "Identity", defaultValue: 1 },
    { id: "notes", label: "Notes", kind: "longtext", group: "Story" },
    { id: "misc", label: "Miscellaneous", kind: "text" },
  ],
  stats: [{ id: "bonus", label: "Bonus", base: 2, modifiers: [] }],
  tickers: [{ id: "hp", label: "HP", min: 0, max: 40, defaultValue: 20, display: "bar" }],
  rolls: [
    {
      id: "sneak",
      label: "Sneak",
      dice: [
        { count: 1, sides: 20 },
        { count: 1, sides: 6 },
      ],
      modifiers: [{ kind: "static", value: 2 }],
      visibility: "public",
    },
  ],
  updatedAt: "2026-09-30T00:00:00Z",
};

describe("legacy template conversion", () => {
  it("produces a decodable layout with tracker values, stats and dice groups", () => {
    const layout = layoutFromTemplate(template);
    expect(Schema.decodeUnknownResult(SheetLayout)(layout)._tag).toBe("Success");
    expect(layout.system).toBe(template.name);
    expect(layout.pages).toHaveLength(1);
    expect(layoutTrackers(layout)).toEqual([
      { key: "hp", label: "HP", min: 0, max: 40, start: 20, display: "bar" },
    ]);
    expect(layout.pages[0].blocks.slice(1, 3)).toEqual([
      { id: "legacy-stats", type: "stats", items: [{ key: "bonus", label: "Bonus" }] },
      { id: "legacy-rolls", type: "rolls", items: [{ label: "Sneak", dice: "1d20+1d6" }] },
    ]);
  });

  it("keeps groups in first-seen order and fields in order within each group", () => {
    const blocks = layoutFromTemplate(template).pages[0].blocks;
    expect(blocks.filter((block) => block.type === "heading").map((block) => block.text)).toEqual([
      "Identity",
      "Story",
      "Fields",
    ]);
    expect(blocks.find((block) => block.type === "fields")).toMatchObject({
      columns: 2,
      items: [
        { key: "name", label: "Name" },
        { key: "level", label: "Level" },
      ],
    });
    // A text block named like its group drops the label; the heading already names it.
    expect(blocks.filter((block) => block.type === "text")).toMatchObject([
      { key: "story", label: undefined },
      { key: "notes", label: "Notes" },
    ]);
    expect(blocks.filter((block) => block.type === "fields")).toHaveLength(2);
  });

  it("omits empty legacy sections and leaves the input intact", () => {
    const empty = { ...template, fields: [], stats: [], tickers: [], rolls: [] };
    expect(layoutFromTemplate(empty).pages[0].blocks).toEqual([]);
    const before = structuredClone(template);
    expect(layoutFromTemplate(template)).toEqual(layoutFromTemplate(template));
    expect(template).toEqual(before);
  });

  it("uses generated ids even when field ids and group names collide", () => {
    const layout = layoutFromTemplate({
      ...template,
      fields: [
        { id: "legacy-trackers", label: "A", kind: "longtext", group: "A B" },
        { id: "legacy-trackers", label: "B", kind: "longtext", group: "A-B" },
      ],
    });
    const ids = layout.pages[0].blocks.map((block) => block.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses the saved layout when present and converts legacy templates otherwise", () => {
    expect(effectiveLayout({ ...template, layout: bastionlandClassic })).toBe(bastionlandClassic);
    expect(effectiveLayout(template)).toEqual(layoutFromTemplate(template));
  });
});
