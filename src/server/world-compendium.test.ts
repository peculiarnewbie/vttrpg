import { expect, it } from "vitest";
import type { CompendiumEntry, EntryType } from "../domain/compendium";
import { applyOverride } from "../domain/overrides";
import { entrySearchText } from "./world-compendium";

const type: EntryType = {
  id: "spell",
  name: "Spell",
  fields: [
    { key: "summary", label: "Summary", kind: "text" },
    { key: "details", label: "Details", kind: "longtext" },
    { key: "level", label: "Level", kind: "number" },
    { key: "school", label: "School", kind: "select", options: ["hidden"] },
  ],
};
const entry: CompendiumEntry = {
  id: "fixtures/spell/lantern",
  typeId: "spell",
  name: "Lantern",
  tags: ["tag-only"],
  body: "  ÉTHER\n Shines.",
  fields: {
    summary: "Silver",
    details: "  MIST\t flows",
    level: 9,
    school: "hidden",
    extra: "undeclared",
  },
  visibility: "public",
  updatedAt: "2026-10-01T00:00:00.000Z",
};
it("normalizes the body and only declared text/longtext fields for both world and library entries", () => {
  expect(entrySearchText(entry, type)).toBe("ether shines. silver mist flows");
  expect(entrySearchText(entry)).toBe("ether shines.");
});
it("indexes the resolved override body and fields, including removed text fields", () => {
  const applied = applyOverride(entry, {
    entryId: entry.id,
    baseRev: 1,
    updatedAt: entry.updatedAt,
    licence: { id: "CC0-1.0", name: "CC0", attribution: "Synthetic", shareAlike: false },
    patch: { body: "  PRISMATIC", fields: { summary: "Lúminous" }, removeFields: ["details"] },
  });
  expect(entrySearchText(applied, type)).toBe("prismatic luminous");
});
