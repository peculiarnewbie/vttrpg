import { describe, expect, it } from "vitest";
import type { CompendiumEntry, IndexRow } from "./compendium";
import {
  findEntryByName,
  formatRefLink,
  insertLink,
  linkQueryAt,
  normalizeName,
  splitEntryLinks,
} from "./entry-links";

const entry = (id: string, name: string): CompendiumEntry => ({
  id,
  typeId: "knight",
  name,
  tags: [],
  body: "",
  fields: {},
  visibility: "public",
  updatedAt: "",
});

describe("entry links", () => {
  it("splits text around [[links]]", () => {
    expect(splitEntryLinks("Ask [[The Example Knight]] about [[ Seers ]].")).toEqual([
      { kind: "text", text: "Ask " },
      { kind: "link", name: "The Example Knight" },
      { kind: "text", text: " about " },
      { kind: "link", name: "Seers" },
      { kind: "text", text: "." },
    ]);
    expect(splitEntryLinks("no links [here] or [[\n]]")).toEqual([
      { kind: "text", text: "no links [here] or [[\n]]" },
    ]);
    expect(splitEntryLinks("[[Solo]]")).toEqual([{ kind: "link", name: "Solo" }]);
  });

  it("finds entries by name regardless of case, accents, and spacing", () => {
    const entries = [entry("a", "The Éxample  Knight"), entry("b", "Other")];
    expect(findEntryByName(entries, "the example knight")?.id).toBe("a");
    expect(findEntryByName(entries, "Missing")).toBeUndefined();
    expect(findEntryByName(entries, "  ")).toBeUndefined();
    const rows: IndexRow[] = entries.map(({ body: _body, fields: _fields, ...row }) => ({
      ...row,
      rev: 1,
    }));
    const found: IndexRow | undefined = findEntryByName(rows, "the example knight");
    expect(found).toBe(rows[0]);
    expect(normalizeName("  ÉXAMPLE  Knight ")).toBe("example knight");
  });

  it("splits id references and treats malformed references as names after ref:", () => {
    expect(
      splitEntryLinks("[[ref:world/spell/shield| Shield ]] [[ref:ent_abc|Old]] [[ref:bad]]"),
    ).toEqual([
      { kind: "ref", id: "world/spell/shield", label: "Shield" },
      { kind: "text", text: " " },
      { kind: "link", name: "ent_abc|Old" },
      { kind: "text", text: " " },
      { kind: "link", name: "bad" },
    ]);
    expect(splitEntryLinks("[[ref:world//shield|Shield]]")).toEqual([
      { kind: "link", name: "world//shield|Shield" },
    ]);
  });

  it("formats safe reference labels and supports ids longer than name links", () => {
    expect(formatRefLink("world/spell/shield", "[Shield]| spell")).toBe(
      "[[ref:world/spell/shield|Shield spell]]",
    );
    const id = Array(3).fill("x".repeat(60)).join("/");
    const link = formatRefLink(id, "Shield");
    expect(splitEntryLinks(link)).toEqual([{ kind: "ref", id, label: "Shield" }]);
    expect(splitEntryLinks("[[" + "x".repeat(121) + "]]")).toEqual([
      { kind: "text", text: "[[" + "x".repeat(121) + "]]" },
    ]);
    expect(splitEntryLinks(formatRefLink("world/item/empty", ""))).toEqual([
      { kind: "ref", id: "world/item/empty", label: "" },
    ]);
  });

  it("detects a link being typed and completes it", () => {
    expect(linkQueryAt("Meet [[Exa", 10)).toEqual({ start: 5, query: "Exa" });
    expect(linkQueryAt("Meet [[Exa]] now", 16)).toBeUndefined();
    expect(linkQueryAt("no link", 7)).toBeUndefined();
    expect(linkQueryAt("[[a\nb", 5)).toBeUndefined();
    expect(insertLink("Meet [[Exa and", 10, 5, "The Example Knight")).toEqual({
      text: "Meet [[The Example Knight]] and",
      caret: 27,
    });
    // Closing brackets already typed after the caret are not doubled.
    expect(insertLink("[[Ex]]", 4, 0, "Example").text).toBe("[[Example]]");
    const ref = formatRefLink("world/knight/example", "Example");
    expect(insertLink("Meet [[Ex]] now", 9, 5, "Example", "world/knight/example")).toEqual({
      text: "Meet " + ref + " now",
      caret: 5 + ref.length,
    });
  });
});
