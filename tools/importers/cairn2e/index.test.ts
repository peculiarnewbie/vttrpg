import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseNotation } from "../../../src/domain/dice-notation";
import { validateBundle } from "../validate";
import { upstream } from "../sources";
import { importCairn2e, importCairn2eFrom } from "./index";

const fixture = fileURLToPath(new URL("./fixtures", import.meta.url));
const bundle = importCairn2eFrom(fixture, "fixture-revision");
const entry = (type: string, name: string) =>
  bundle.entries.find((entry) => entry.typeId === type && entry.name === name)!;

describe("Cairn Second Edition", () => {
  it("validates the licensed fixture and preserves the contract", () => {
    expect(validateBundle(bundle).problems).toEqual([]);
    expect(bundle.source.id).toBe("cairn2e");
    expect(bundle.source.licence.id).toBe("CC-BY-SA-4.0");
    expect(bundle.provenance.revision).toBe("fixture-revision");
  });

  it("imports background prose, gear and separate table references", () => {
    expect(entry("background", "Aurifex")).toEqual({
      id: "cairn2e/background/aurifex",
      typeId: "background",
      name: "Aurifex",
      tags: [],
      visibility: "public",
      body: "> You are an artisan of the arcane, a smith of subtle forces. In the crucible of your workshop, the laws that govern this world are warped to suit your needs.",
      fields: {
        names: "Hestia, Basil, Rune, Prism, Ember, Quintess, Aludel, Mordant, Salaman, Jazia",
        gear: "- [[r:3d6|3d6]] Gold Pieces\n- Rations (3 uses)\n- Lantern\n- Oil Can (6 uses)\n- Needle-knife (d6)\n- Protective Gloves (_petty_)",
        tables: [
          "cairn2e/table/aurifex-what-went-horribly-wrong-afb8450f26",
          "cairn2e/table/aurifex-what-alchemical-marvel-is-the-product-of-93ccaea15b",
        ],
      },
    });
    const table = entry("table", "What went horribly wrong?");
    expect(table.fields.group).toBe("Aurifex");
    expect(table.fields.table).toHaveLength(6);
    expect((table.fields.table as readonly object[])[5]).toEqual({
      min: 6,
      max: 6,
      text: "Ridiculed for discovering how to turn gold into _lead_, you were a laughing stock. Take a bottle of **Universal Solvent** (2 uses) that dissolves anything it touches into its constituent parts.",
    });
  });

  it("separates alternative attacks and keeps the first monster category", () => {
    expect(entry("monster", "Goblin").fields).toEqual({
      group: "Goblinoid",
      hp: 4,
      armor: 0,
      str: 8,
      dex: 12,
      wil: 8,
      attacks: [
        { name: "dagger", roll: "d6" },
        { name: "sling", roll: "d6" },
      ],
    });
    expect(entry("monster", "Griffon").fields.attacks).toEqual([
      { name: "claws", roll: "d6 | d6" },
    ]);
    expect(entry("monster", "Hydra").fields.group).toBe("Lizard");
    expect(entry("monster", "Hydra").body).toContain("_detachment_");
    expect(bundle.provenance.notes).toContain("Hydra: Lizard before Mythical");
  });

  it("imports spellbook text and relic charges without automation", () => {
    expect(entry("spellbook", "Cure Wounds")).toEqual({
      id: "cairn2e/spellbook/cure-wounds",
      typeId: "spellbook",
      name: "Cure Wounds",
      tags: [],
      visibility: "public",
      fields: {},
      body: "Restore [[r:1d4|1d4]] STR per day to a creature you can touch. _Smells of vinegar and thyme. Turns red after use._",
    });
    expect(entry("relic", "Betterwand")).toEqual({
      id: "cairn2e/relic/betterwand",
      typeId: "relic",
      name: "Betterwand",
      tags: [],
      visibility: "public",
      fields: { charges: "2 charges" },
      body: "## Betterwand, 2 charges\n\n- Vibrates with increased intensity when pointed at the best of a series of objects.\n  - **Recharge**: Willingly accept a poor deal or trade while in possession of the wand.",
    });
  });

  it("keeps marketplace groups as priced items and extracts carrying properties", () => {
    expect(entry("item", "Chainmail")).toEqual({
      id: "cairn2e/item/armor-chainmail",
      typeId: "item",
      name: "Chainmail",
      tags: [],
      visibility: "public",
      body: "Chainmail (2 Armor, _bulky_)",
      fields: { category: "Armor", cost: "40 gp", armor: 2, slots: 2, properties: ["bulky"] },
    });
    expect(entry("item", "Oil Can").fields).toEqual({
      category: "Gear",
      cost: "10 gp",
      slots: 1,
      properties: ["uses"],
      uses: "6 uses",
    });
    expect(entry("item", "Dagger, Cudgel, Sickle, Staff, etc.").fields.damage).toBe("d6");
  });

  it("merges packed d100 columns, expands ranges and preserves independent columns", () => {
    const adjective = entry("table", "Adjectives");
    expect(adjective.fields.table).toHaveLength(100);
    expect((adjective.fields.table as readonly object[])[50]).toEqual({
      min: 51,
      max: 51,
      text: "Furious",
    });
    expect(adjective.body).toContain("[[r:1d100|1d100]]");
    expect(entry("table", "Forest Names: Nouns").fields.table).toHaveLength(100);
    expect(entry("table", "Names Formula").fields.table).toHaveLength(6);
    expect(entry("rule", "Scars").fields).toEqual({ chapter: "Core Rules" });
    expect(entry("rule", "Generating Names").body).toContain(
      "[[ref:cairn2e/table/naming-procedures-adjectives-0253e01ff4|Adjectives]]",
    );
    const names = bundle.entries.filter(
      (entry) =>
        entry.typeId === "table" &&
        entry.fields.group === "NPC Tables" &&
        entry.name === "NPC Tables",
    );
    expect(new Set(names.map((entry) => entry.id)).size).toBe(3);
    expect(names.every((entry) => /-[0-9a-f]{10}$/.test(entry.id))).toBe(true);
  });

  it("transposes reaction ranges and retains them as rule text", () => {
    expect(entry("table", "Reactions").fields).toEqual({
      group: "Core Rules",
      table: [
        { min: 2, max: 2, text: "Hostile" },
        { min: 3, max: 5, text: "Wary" },
        { min: 6, max: 8, text: "Curious" },
        { min: 9, max: 11, text: "Kind" },
        { min: 12, max: 12, text: "Helpful" },
      ],
    });
    expect(entry("table", "Reactions").body.startsWith("Roll [[r:2d6|2d6]].")).toBe(true);
    expect(entry("rule", "Reactions")).toEqual({
      id: "cairn2e/rule/players-guide-core-rules-reactions",
      typeId: "rule",
      name: "Reactions",
      tags: [],
      visibility: "public",
      fields: { chapter: "Core Rules" },
      body: "When the PCs encounter an NPC whose reaction to the party is not obvious, the Warden may roll [[r:2d6|2d6]] and consult the following table:\n\n|  |  |  |  |  |\n| --- | --- | --- | --- | --- |\n| 2 | 3-5 | 6-8 | 9-11 | 12 |\n| Hostile | Wary | Curious | Kind | Helpful |\n",
    });
    expect(
      bundle.entries.some((entry) => entry.typeId === "table" && entry.name === "Scars Table"),
    ).toBe(false);
  });

  it("imports compact die-drop ranges exactly and keeps duplicate-labelled columns distinct", () => {
    expect(entry("table", "Dungeon Die Drop Table")).toEqual({
      id: "cairn2e/table/dungeon-seeds-dungeon-die-drop-table-a0cc7f8638",
      typeId: "table",
      name: "Dungeon Die Drop Table",
      tags: [],
      visibility: "public",
      body: "Roll [[r:1d6|1d6]].\n\n| **d6** | **Room** |\n| --- | --- |\n| **1** | Monster |\n| **2-3** | Lore |\n| **4** | Special |\n| **5-6** | Trap |\n",
      fields: {
        group: "Dungeon Seeds",
        table: [
          { min: 1, max: 1, text: "Monster" },
          { min: 2, max: 3, text: "Lore" },
          { min: 4, max: 4, text: "Special" },
          { min: 5, max: 6, text: "Trap" },
        ],
      },
    });
    const columns = bundle.entries.filter(
      (entry) => entry.typeId === "table" && entry.name === "Forest Description: Description",
    );
    expect(columns).toHaveLength(2);
    expect(columns[0].id).not.toBe(columns[1].id);
    expect(
      bundle.entries.some((entry) => entry.typeId === "table" && entry.name === "Encounters"),
    ).toBe(false);
  });

  it("keeps anonymous table identities when sibling tables are removed or reordered", () => {
    const dir = mkdtempSync(join(tmpdir(), "cairn2e-fixture-"));
    try {
      cpSync(fixture, dir, { recursive: true });
      const path = join(dir, "wardens-guide/npc-tables.md");
      const raw = readFileSync(path, "utf8");
      const heading = raw.slice(0, raw.indexOf("|"));
      const parts = raw.slice(raw.indexOf("|")).split("## Quirks")[0].trim().split(/\n\n+/);
      const original = bundle.entries.filter(
        (entry) => entry.typeId === "table" && entry.name === "NPC Tables",
      );
      writeFileSync(path, [heading.trim(), parts[2], parts[0]].join("\n\n"));
      const changed = importCairn2eFrom(dir, "another-revision");
      const names = changed.entries.filter(
        (entry) => entry.typeId === "table" && entry.name === "NPC Tables",
      );
      expect(names).toHaveLength(2);
      for (const value of names)
        expect(original.find((entry) => entry.id === value.id)).toEqual(value);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!upstream("cairn").available)("validates the complete pinned upstream", async () => {
    const full = await importCairn2e();
    const report = validateBundle(full);
    expect(report.problems).toEqual([]);
    expect(report.counts.background).toBe(20);
    expect(report.counts.monster).toBeGreaterThan(70);
    expect(report.counts.spellbook).toBe(100);
    expect(report.counts.relic).toBeGreaterThan(30);
    expect(report.counts.item).toBeGreaterThan(70);
    expect(report.counts.table).toBeGreaterThan(100);
    // Bestiary and reliquary sections are monsters and relics, not repeated as rules.
    expect(report.counts.rule).toBeGreaterThan(120);
    expect(report.largest!.bytes).toBeLessThanOrEqual(16384);
    for (const value of full.entries) {
      expect(value.name, value.id).not.toMatch(/[*_`]/);
      expect(value.body).not.toContain("[[r:[[");
      if (value.typeId === "table") {
        const notation = value.body.match(/\[\[r:(\d+)d(\d+)\|/)!;
        expect(parseNotation(`${notation[1]}d${notation[2]}`).ok).toBe(true);
        let next = Number(notation[1]);
        for (const row of value.fields.table as readonly { min: number; max: number }[]) {
          expect(row.min, value.id).toBe(next);
          next = row.max + 1;
        }
        expect(next - 1, value.id).toBe(Number(notation[1]) * Number(notation[2]));
      }
      if (value.typeId === "rule" && value.name.startsWith("Spellbooks: Introduction")) {
        const lines = value.body.split("\n");
        const firstRow = lines.findIndex((line) => line.startsWith("|"));
        expect(lines[firstRow + 1]).toMatch(/^\| ---/);
      }
    }
  });
});
