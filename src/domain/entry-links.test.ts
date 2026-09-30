import { describe, expect, it } from "vitest";
import type { CompendiumEntry } from "./compendium";
import { findEntryByName, insertLink, linkQueryAt, splitEntryLinks } from "./entry-links";

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
  });
});
