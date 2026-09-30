import { expect, it } from "vitest";
import type { CompendiumEntry } from "./compendium";
import { indexEntries, searchEntries, searchIndex } from "./compendium-search";

const entry = (id: string, name: string, tags: string[] = [], body = ""): CompendiumEntry => ({
  id,
  typeId: "item",
  name,
  tags,
  body,
  fields: {},
  visibility: "public",
  updatedAt: "now",
});

it("ranks exact names, prefixes, word prefixes, tags and body matches in that order", () => {
  const entries = [
    entry("body", "A book", [], "A silver sword"),
    entry("tag", "A knife", ["sword"]),
    entry("word", "Silver sword"),
    entry("prefix", "Swordfish"),
    entry("exact", "Sword"),
    entry("none", "An axe"),
  ];
  expect(searchEntries(entries, "sword").map((entry) => entry.id)).toEqual([
    "exact",
    "prefix",
    "word",
    "tag",
    "body",
  ]);
  expect(searchEntries(entries, "ord").map((entry) => entry.id)).toEqual(["tag", "body"]);
});

it("normalizes case, composed and decomposed accents and punctuation word boundaries", () => {
  const entries = [
    entry("exact", "Épée"),
    entry("word", "Old—E\u0301pe\u0301e"),
    entry("tag", "Knife", ["ÉPÉE"]),
    entry("body", "Book", [], "An ÉPÉE"),
  ];
  expect(searchIndex(indexEntries(entries), "  EPEE  ")).toEqual(entries);
});

it("combines type and exact normalized tag filters, with alphabetical ties and empty queries", () => {
  const entries = [
    entry("z", "Zebra", ["Rare"]),
    { ...entry("a", "Axe", ["Ráre"]), typeId: "weapon" },
    entry("b", "Book", ["Rare"]),
    entry("partial", "Coin", ["Rare-ish"]),
  ];
  expect(searchEntries(entries, " ").map((entry) => entry.id)).toEqual(["a", "b", "partial", "z"]);
  expect(
    searchEntries(entries, "", { typeId: "item", tag: "RARE" }).map((entry) => entry.id),
  ).toEqual(["b", "z"]);
  expect(searchEntries(entries, "rare").map((entry) => entry.id)).toEqual([
    "a",
    "b",
    "partial",
    "z",
  ]);
  expect(entries[0].id).toBe("z");
});

it("can reuse one index for a full world of 2000 entries", () => {
  const index = indexEntries(Array.from({ length: 2000 }, (_, n) => entry(String(n), `Item ${n}`)));
  expect(searchIndex(index, "Item 1999").map((entry) => entry.id)).toEqual(["1999"]);
  expect(searchIndex(index, "missing")).toEqual([]);
  expect(searchIndex(index, "")).toHaveLength(2000);
});
