import { describe, expect, it } from "vitest";
import type { CompendiumEntry, IndexRow } from "./compendium";
import {
  findEntryByName,
  formatRefLink,
  formatRollLink,
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

it("splits valid inline rolls, leaving invalid notation completely as text", () => {
  expect(splitEntryLinks("Roll [[r: 2d6+1 | Damage ]] then [[r:d%]].")).toEqual([
    { kind: "text", text: "Roll " },
    { kind: "roll", notation: "2d6+1", label: "Damage" },
    { kind: "text", text: " then " },
    { kind: "roll", notation: "d%" },
    { kind: "text", text: "." },
  ]);
  for (const payload of ["", "d0", "no dice", "d6+", "d6 | label | bad"]) {
    const text = `[[r:${payload}]]`;
    expect(splitEntryLinks(text)).toEqual([{ kind: "text", text }]);
  }
  expect(splitEntryLinks(`[[r:d6${" ".repeat(200)}]]`)).toEqual([{ kind: "roll", notation: "d6" }]);
  expect(splitEntryLinks("[[r:1d20+@str_mod]]")).toEqual([
    { kind: "roll", notation: "1d20+@str_mod" },
  ]);
  expect(splitEntryLinks("[[r:1d20 | 2d6]]")).toEqual([{ kind: "roll", notation: "1d20 | 2d6" }]);
  expect(splitEntryLinks("[[r:1d20 | 2d6 | Attack]]")).toEqual([
    { kind: "roll", notation: "1d20 | 2d6", label: "Attack" },
  ]);
  expect(splitEntryLinks("[[r:d6|]]")).toEqual([{ kind: "roll", notation: "d6", label: "" }]);
});

it("formats roll links with safe labels and supports long valid notation", () => {
  expect(formatRollLink("2d6+1")).toBe("[[r:2d6+1]]");
  expect(formatRollLink("2d6+1", "[Damage]|\nroll")).toBe("[[r:2d6+1|Damageroll]]");
  // A notation label would read back as a second dice group.
  expect(formatRollLink("1d100", "d100")).toBe("[[r:1d100]]");
  expect(splitEntryLinks(formatRollLink("1d6", "1d6"))).toEqual([
    { kind: "roll", notation: "1d6" },
  ]);
  expect(formatRollLink("8d6", "8d6 fire")).toBe("[[r:8d6|8d6 fire]]");
  expect(splitEntryLinks(formatRollLink("d6", "Damage"))).toEqual([
    { kind: "roll", notation: "d6", label: "Damage" },
  ]);
  const notation = "d6" + " + 1".repeat(19) + " | d6" + " + 1".repeat(19);
  expect(notation.length).toBeGreaterThan(120);
  expect(splitEntryLinks(formatRollLink(notation))).toEqual([{ kind: "roll", notation }]);
  expect(splitEntryLinks(formatRollLink("d6+" + "1".repeat(201)))).toEqual([
    { kind: "text", text: formatRollLink("d6+" + "1".repeat(201)) },
  ]);
});
