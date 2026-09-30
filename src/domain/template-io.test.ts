import { describe, expect, it } from "vitest";
import type { SaveTemplateInput, SheetTemplate } from "./schemas";
import type { SheetLayout } from "./sheet-layout";
import { bastionlandClassic } from "./sheet-presets";
import { exportTemplate, importTemplate, layoutLimitsError } from "./template-io";

const input: SaveTemplateInput = {
  name: "Knight",
  description: "A portable sheet",
  fields: [{ id: "name", label: "Name", kind: "text" }],
  stats: [],
  tickers: [],
  rolls: [],
  layout: bastionlandClassic,
};
const template: SheetTemplate = {
  ...input,
  id: "old-id",
  worldId: "old-world",
  updatedAt: "2026-09-30T00:00:00Z",
};
const envelope = (template: unknown) =>
  JSON.stringify({ format: "ttrpg-template", version: 1, template });
const layout: SheetLayout = {
  system: "Test",
  name: "Classic",
  pages: [{ id: "page", title: "Sheet", blocks: [] }],
};
const heading = (id: string) => ({ id, type: "heading" as const, text: "Heading" });
const trackers = (id: string, key: string) => ({
  id,
  type: "trackers" as const,
  items: [{ key, label: key, min: 0, max: 10 }],
});
const withBlocks = (blocks: SheetLayout["pages"][number]["blocks"]): SheetLayout => ({
  ...layout,
  pages: [{ ...layout.pages[0], blocks }],
});

describe("template JSON", () => {
  it("round-trips legacy arrays and layouts without world identity", () => {
    const text = exportTemplate(template);
    expect(text).toContain('\n  "format"');
    expect(JSON.parse(text)).toEqual({ format: "ttrpg-template", version: 1, template: input });
    expect(importTemplate(text)).toEqual({ ok: true, input });
    expect(importTemplate(exportTemplate({ ...template, layout: undefined }))).toEqual({
      ok: true,
      input: { ...input, layout: undefined },
    });
  });

  it("strips any imported id, including an id of the wrong type", () => {
    expect(importTemplate(envelope({ ...input, id: "other-world-id" }))).toEqual({
      ok: true,
      input,
    });
    expect(importTemplate(envelope({ ...input, id: 42 }))).toEqual({ ok: true, input });
  });

  it("reports invalid JSON, format, version and template data", () => {
    expect(importTemplate("{")).toEqual({ ok: false, error: "Invalid JSON" });
    expect(
      importTemplate(JSON.stringify({ format: "other", version: 1, template: input })),
    ).toEqual({ ok: false, error: "Expected ttrpg-template format" });
    expect(
      importTemplate(JSON.stringify({ format: "ttrpg-template", version: 2, template: input })),
    ).toEqual({ ok: false, error: "Unsupported template version" });
    expect(importTemplate(envelope({ ...input, fields: "invalid" }))).toEqual({
      ok: false,
      error: "Invalid template data",
    });
    expect(
      importTemplate(envelope({ ...input, layout: { ...layout, pages: [{ blocks: [] }] } })),
    ).toEqual({ ok: false, error: "Invalid template data" });
    expect(importTemplate("null").ok).toBe(false);
  });
});

describe("shared layout limits", () => {
  it("allows absent layouts and measures the serialized UTF-8 size at the boundary", () => {
    expect(layoutLimitsError(undefined)).toBeUndefined();
    const base = new TextEncoder().encode(JSON.stringify(layout)).byteLength;
    const exact = { ...layout, name: "x".repeat(64 * 1024 - base + layout.name.length) };
    expect(layoutLimitsError(exact)).toBeUndefined();
    const oversized = { ...exact, name: `${exact.name}é` };
    expect(layoutLimitsError(oversized)).toBe("Layout JSON must be at most 64 KB");
    expect(importTemplate(envelope({ ...input, layout: oversized }))).toEqual({
      ok: false,
      error: "Layout JSON must be at most 64 KB",
    });
  });

  it("allows ten pages and rejects an eleventh", () => {
    const pages = Array.from({ length: 10 }, (_, i) => ({ ...layout.pages[0], id: `page-${i}` }));
    expect(layoutLimitsError({ ...layout, pages })).toBeUndefined();
    expect(layoutLimitsError({ ...layout, pages: [...pages, layout.pages[0]] })).toBe(
      "Layout must have at most 10 pages",
    );
  });

  it("counts group containers and children against the 200 block limit", () => {
    const children = Array.from({ length: 199 }, (_, i) => heading(`child-${i}`));
    expect(
      layoutLimitsError(withBlocks([{ id: "group", type: "group", blocks: children }])),
    ).toBeUndefined();
    expect(
      layoutLimitsError(
        withBlocks([{ id: "group", type: "group", blocks: children }, heading("extra")]),
      ),
    ).toBe("Layout must have at most 200 blocks");
  });

  it("rejects duplicate block ids across pages and inside groups", () => {
    const duplicate = withBlocks([
      heading("duplicate"),
      { id: "group", type: "group", blocks: [heading("duplicate")] },
    ]);
    expect(importTemplate(envelope({ ...input, layout: duplicate }))).toEqual({
      ok: false,
      error: "Layout block ids must be unique",
    });
    expect(
      layoutLimitsError({
        ...layout,
        pages: [
          { ...layout.pages[0], blocks: [heading("same")] },
          { id: "two", title: "Two", blocks: [heading("same")] },
        ],
      }),
    ).toBe("Layout block ids must be unique");
    expect(
      layoutLimitsError(withBlocks([{ id: "same", type: "group", blocks: [heading("same")] }])),
    ).toBe("Layout block ids must be unique");
  });

  it("rejects duplicate tracker keys across blocks and within an item list", () => {
    expect(
      layoutLimitsError(
        withBlocks([
          trackers("one", "hp"),
          { id: "group", type: "group", blocks: [trackers("two", "hp")] },
        ]),
      ),
    ).toBe("Layout tracker keys must be unique");
    const tracker = trackers("one", "hp");
    expect(
      layoutLimitsError(withBlocks([{ ...tracker, items: [...tracker.items, ...tracker.items] }])),
    ).toBe("Layout tracker keys must be unique");
    expect(
      layoutLimitsError(withBlocks([trackers("one", "hp"), trackers("two", "mp")])),
    ).toBeUndefined();
  });
});

describe("derived layout limits", () => {
  const value = { key: "str_mod", label: "STR mod", expr: "floor((@str - 10) / 2)" };
  const withDerived = (derived: SheetLayout["derived"]): SheetLayout => ({ ...layout, derived });

  it("accepts at most 50 derived values", () => {
    const values = Array.from({ length: 50 }, (_, i) => ({ ...value, key: `value_${i}` }));
    expect(layoutLimitsError(withDerived(values))).toBeUndefined();
    expect(layoutLimitsError(withDerived([...values, { ...value, key: "extra" }]))).toBe(
      "Layout must have at most 50 derived values",
    );
  });

  it.each(["", "2mod", "str-mod", "str.mod", "str mod", "é", "a\n"])(
    "rejects invalid derived key %j",
    (key) => {
      expect(layoutLimitsError(withDerived([{ ...value, key }]))).toContain("needs a key");
    },
  );

  it("allows valid keys, and rejects duplicates only among derived values", () => {
    expect(layoutLimitsError(withDerived([{ ...value, key: "_mod2" }]))).toBeUndefined();
    expect(layoutLimitsError(withDerived([value, value]))).toBe(
      "Layout derived keys must be unique",
    );
    const sheet = withBlocks([
      { id: "stats", type: "stats", items: [{ key: value.key, label: "Modifier" }] },
    ]);
    expect(layoutLimitsError({ ...sheet, derived: [value] })).toBeUndefined();
  });

  it("requires a non-empty label of at most 60 characters", () => {
    for (const label of ["", "  ", "x".repeat(61)])
      expect(layoutLimitsError(withDerived([{ ...value, label }]))).toBe(
        "Derived labels must be non-empty and at most 60 characters",
      );
    expect(layoutLimitsError(withDerived([{ ...value, label: "x".repeat(60) }]))).toBeUndefined();
  });

  it("checks expression length, syntax and depth", () => {
    expect(
      layoutLimitsError(withDerived([{ ...value, expr: `1${" ".repeat(199)}` }])),
    ).toBeUndefined();
    expect(layoutLimitsError(withDerived([{ ...value, expr: `1${" ".repeat(200)}` }]))).toContain(
      "At most 200 characters",
    );
    expect(layoutLimitsError(withDerived([{ ...value, expr: "floor()" }]))).toContain(
      "needs 1 argument",
    );
    expect(
      layoutLimitsError(withDerived([{ ...value, expr: `${"(".repeat(33)}1${")".repeat(33)}` }])),
    ).toContain("At most 32 nested");
  });

  it("validates derived columns inside groups, including missing expressions", () => {
    const column = (expr?: string): SheetLayout =>
      withBlocks([
        {
          id: "group",
          type: "group",
          blocks: [
            {
              id: "gear",
              type: "list",
              key: "gear",
              columns: [{ key: "total", label: "Total weight", kind: "derived", expr }],
            },
          ],
        },
      ]);
    expect(layoutLimitsError(column("@row.qty * @row.weight"))).toBeUndefined();
    expect(layoutLimitsError(column("1 +"))).toBe(
      'Derived column "Total weight": Expected an expression at 3',
    );
    expect(layoutLimitsError(column())).toBe(
      'Derived column "Total weight": Expected an expression at 0',
    );
    expect(layoutLimitsError(column(`1${" ".repeat(200)}`))).toContain("At most 200 characters");
  });

  it("keeps cycles, unknown refs and legacy notation saveable", () => {
    const sheet = withBlocks([
      {
        id: "stats",
        type: "stats",
        items: [{ key: "old-key", label: "", roll: "broken notation" }],
      },
      {
        id: "list",
        type: "list",
        key: "gear",
        roll: "broken notation",
        columns: [{ key: "old-key", label: "", kind: "text", expr: "invalid legacy expression" }],
      },
    ]);
    expect(
      layoutLimitsError({
        ...sheet,
        derived: [
          { key: "self", label: "Self", expr: "@self" },
          { key: "unknown", label: "Unknown", expr: "@missing" },
        ],
      }),
    ).toBeUndefined();
  });

  it("applies derived validation to imports and preserves them on round trip", () => {
    const derivedLayout = withDerived([value]);
    expect(importTemplate(exportTemplate({ ...template, layout: derivedLayout }))).toEqual({
      ok: true,
      input: { ...input, layout: derivedLayout },
    });
    expect(importTemplate(envelope({ ...input, layout: withDerived([value, value]) }))).toEqual({
      ok: false,
      error: "Layout derived keys must be unique",
    });
  });
});
