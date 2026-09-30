import { expect, it } from "vitest";
import { compendiumLimits, type Compendium } from "./compendium";
import { exportPack, packFileName, parsePack } from "./compendium-io";

const compendium: Compendium = {
  types: [{ id: "item", name: "Item", fields: [{ key: "cost", label: "Cost", kind: "number" }] }],
  entries: [
    {
      id: "ent_rope",
      typeId: "item",
      name: "Rope",
      tags: ["gear"],
      body: "A rope.",
      fields: { cost: 2 },
      visibility: "dm",
      updatedAt: "now",
    },
  ],
};

it("exports pretty, portable packs retaining entry identity and visibility without timestamps", () => {
  const text = exportPack(compendium, "Our world");
  expect(text).toContain('\n  "format"');
  const pack = JSON.parse(text);
  expect(pack).toEqual({
    format: "ttrpg-pack",
    version: 1,
    name: "Our world",
    types: compendium.types,
    entries: [
      {
        id: "ent_rope",
        typeId: "item",
        name: "Rope",
        tags: ["gear"],
        body: "A rope.",
        fields: { cost: 2 },
        visibility: "dm",
      },
    ],
  });
  expect(parsePack(text)).toEqual({ ok: true, pack });
  expect(compendium.entries[0].updatedAt).toBe("now");
  expect(parsePack(exportPack({ types: [], entries: [] }, "Empty")).ok).toBe(true);
});

it("reports bad JSON, wrong format, unsupported versions and invalid nested data", () => {
  expect(parsePack("{")).toEqual({ ok: false, error: "Invalid JSON" });
  for (const data of [null, {}, { format: "other", version: 1 }]) {
    expect(parsePack(JSON.stringify(data))).toEqual({
      ok: false,
      error: "Expected ttrpg-pack format",
    });
  }
  const pack = JSON.parse(exportPack(compendium, "Test"));
  for (const version of [2, "1", undefined]) {
    expect(parsePack(JSON.stringify({ ...pack, version }))).toEqual({
      ok: false,
      error: "Unsupported pack version",
    });
  }
  for (const data of [
    { ...pack, entries: "invalid" },
    {
      ...pack,
      types: [{ id: "item", name: "Item", fields: [{ key: "x", label: "X", kind: "bad" }] }],
    },
    { ...pack, entries: [{ ...pack.entries[0], visibility: "secret" }] },
  ]) {
    expect(parsePack(JSON.stringify(data))).toEqual({
      ok: false,
      error: "Invalid compendium pack data",
    });
  }
});

it("measures the raw UTF-8 pack size before parsing, accepting the exact limit", () => {
  const text = exportPack({ types: [], entries: [] }, "");
  const exact =
    text + " ".repeat(compendiumLimits.packBytes - new TextEncoder().encode(text).byteLength);
  expect(parsePack(exact).ok).toBe(true);
  expect(parsePack(exact + "é")).toEqual({ ok: false, error: "Pack JSON must be at most 4 MB" });
});

it("makes safe, accent-normalized pack filenames with a fallback for empty slugs", () => {
  expect(packFileName("  Éowyn's World / Pack  ")).toBe("eowyn-s-world-pack.ttrpg-pack.json");
  expect(packFileName("../")).toBe("compendium.ttrpg-pack.json");
  expect(packFileName("")).toBe("compendium.ttrpg-pack.json");
});
