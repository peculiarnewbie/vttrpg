import { describe, expect, it } from "vitest";
import { entryId, isEntryId, parseEntryId, SLUG_MAX, slugify, uniqueSlug } from "./entry-id";

describe("entry ids", () => {
  it.each([
    ["Éowyn's Épée", "eowyn-s-epee"],
    ["  --Rust...Knight!?  ", "rust-knight"],
    ["A___B / C", "a-b-c"],
    ["E\u0301pe\u0301e", "epee"],
    ["", "entry"],
    ["???", "entry"],
    ["竜", "entry"],
  ])("slugifies %j", (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });

  it("cuts long slugs without leaving a trailing hyphen", () => {
    expect(slugify("x".repeat(100))).toBe("x".repeat(SLUG_MAX));
    expect(slugify("x".repeat(SLUG_MAX - 1) + " more")).toBe("x".repeat(SLUG_MAX - 1));
  });

  it("takes the first available slug, starting suffixes at 2", () => {
    expect(uniqueSlug("rust", () => false)).toBe("rust");
    const taken = new Set(["rust", "rust-2", "rust-4"]);
    expect(uniqueSlug("rust", (slug) => taken.has(slug))).toBe("rust-3");
  });

  it("shortens the base for suffixes and trims separators at the cut", () => {
    const base = "x".repeat(SLUG_MAX);
    expect(uniqueSlug(base, (slug) => slug === base)).toBe("x".repeat(SLUG_MAX - 2) + "-2");
    expect(uniqueSlug(base, (slug) => slug !== "x".repeat(SLUG_MAX - 3) + "-10")).toBe(
      "x".repeat(SLUG_MAX - 3) + "-10",
    );
    const separated = "x".repeat(SLUG_MAX - 3) + "-yy";
    const unique = uniqueSlug(separated, (slug) => slug === separated);
    expect(unique).toBe("x".repeat(SLUG_MAX - 3) + "-2");
    expect(isEntryId(entryId("world", "item", unique))).toBe(true);
  });

  it.each(["world/knight/the-rust-knight", "srd52/spell/fireball", "world/my_type/a_2-b"])(
    "parses valid ids: %s",
    (id) => {
      const [source, typeId, slug] = id.split("/");
      expect(parseEntryId(id)).toEqual({ source, typeId, slug });
      expect(isEntryId(id)).toBe(true);
      expect(entryId(source, typeId, slug)).toBe(id);
    },
  );

  it.each([
    "ent_abc",
    "",
    "world/item",
    "world/item/a/b",
    "/item/a",
    "world//a",
    "world/item/",
    "World/item/a",
    "world/item/a.b",
    "world/item/é",
    "world/item/has space",
    "world/item/-a",
    `world/item/${"a".repeat(SLUG_MAX + 1)}`,
  ])("rejects invalid ids: %j", (id) => {
    expect(parseEntryId(id)).toBeUndefined();
    expect(isEntryId(id)).toBe(false);
  });

  it("accepts parts shaped like existing type ids", () => {
    expect(parseEntryId("world/knight_/rope--2")).toEqual({
      source: "world",
      typeId: "knight_",
      slug: "rope--2",
    });
  });

  it("validates every part, including maximum lengths", () => {
    const max = "x".repeat(SLUG_MAX);
    expect(parseEntryId(entryId(max, max, max))).toEqual({ source: max, typeId: max, slug: max });
    for (const bad of ["", "Upper", "a/b", "-a", "_a", "a b", "x".repeat(SLUG_MAX + 1)]) {
      expect(() => entryId(bad, "item", "rope")).toThrow();
      expect(() => entryId("world", bad, "rope")).toThrow();
      expect(() => entryId("world", "item", bad)).toThrow();
    }
  });
});
