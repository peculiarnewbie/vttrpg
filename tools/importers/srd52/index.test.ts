import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBundle } from "../validate";
import { upstream } from "../sources";
import { importSrd52From } from "./index";
import { arithmetic, activityRoll } from "./rolls";
import { conversionNotes, markdown } from "./markdown";

const revision = "9e8bb7f383402a4b1df11270bf44c5a46101b7ae";
const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));
const cached = upstream("dnd5e");

describe("SRD 5.2", () => {
  it("converts a licensed fixture of every available type, and excludes unlicensed rules/tables/features", () => {
    const bundle = importSrd52From(fixtures, revision);
    const report = validateBundle(bundle);
    expect(report.problems).toEqual([]);
    expect(report.counts).toEqual({
      spell: 2,
      monster: 2,
      weapon: 2,
      armor: 1,
      "magic-item": 1,
      gear: 1,
      class: 2,
      subclass: 1,
      feature: 2,
      species: 1,
      background: 1,
      feat: 2,
    });
    expect(bundle.entries.filter((e) => e.typeId === "rule")).toEqual([]);
    expect(
      bundle.entries.filter((e) =>
        [
          "Fireball",
          "Cure Wounds",
          "Wolf",
          "Swarm of Bats",
          "Longsword",
          "Shortbow",
          "Leather Armor",
          "Bag of Holding",
          "Rope",
          "Wizard",
          "Monk",
          "Martial Arts",
          "Evoker",
          "Sculpt Spells",
          "Human",
          "Sage",
          "Alert",
          "Skilled",
        ].includes(e.name),
      ),
    ).toMatchSnapshot();
    expect(bundle.entries.find((e) => e.name === "Monk")?.fields.levels).toContainEqual({
      level: 1,
      proficiency: "+2",
      features: "Martial Arts",
      extra: "Martial Arts Die: 1d6; Focus Points: 1",
    });
    expect(bundle.system.id).toBe("dnd5e-2024");
    expect(bundle.source.id).toBe("srd52");
    expect(bundle.provenance.notes).toContain("tables24: missing/wrong licence or rules (1)");
    expect(bundle.provenance.notes).toContain(
      "monsterfeatures24: missing/wrong licence or rules (1)",
    );
  });

  it("keeps attack and each damage type separate, including flat attacks", () => {
    const actor = {
      system: { abilities: { str: { value: 18 }, dex: { value: 12 } }, details: { cr: 5 } },
    };
    const doc = {
      type: "weapon",
      system: { damage: { base: { number: 2, denomination: 10, types: ["slashing"] } } },
    };
    const activity = {
      type: "attack",
      attack: { flat: true, bonus: "6" },
      damage: { includeBase: true, parts: [{ number: 1, denomination: 6, types: ["fire"] }] },
    };
    expect(activityRoll({ actor, doc }, activity)).toBe("1d20+6 | 2d10+4 | 1d6");
    expect(arithmetic("8 + 3 * 2")).toBe(14);
    expect(arithmetic("8 + @unknown")).toBeUndefined();
  });

  it("renders HTML, UUIDs, inline saves, explicit rolls and outcome suffixes without artwork", () => {
    const notes = conversionNotes();
    const body = markdown(
      '<h2>Rolls</h2><p>@UUID[Compendium.dnd5e.spells24.Item.known]{A spell}; @UUID[elsewhere]{Unknown}. [[/damage 2d6 fire]] [[/save ability=dex dc=15]] [[/r 1d100cs&gt;25#Days]]</p><img src="private-art.webp"><section class="secret">Foundry Note</section><table><tr><th>Range</th><th>Result</th></tr><tr><td>1–6</td><td>None</td></tr></table>',
      {
        doc: { _id: "test", name: "Test", system: {} },
        references: new Map([
          ["Compendium.dnd5e.spells24.Item.known", { id: "srd52/spell/known", name: "Known" }],
        ]),
        notes,
      },
    );
    expect(body).toBe(
      "## Rolls\n\n[[ref:srd52/spell/known|A spell]]; Unknown. [[r:2d6|2d6 Fire]] DC 15 Dexterity saving throw [[r:1d100|Days]]\n\n| Range | Result |\n| --- | --- |\n| 1–6 | None |",
    );
    expect(notes.foundryNotes).toBe(1);
  });

  it("splits oversized bodies and action rows without truncating text or links", () => {
    const dir = mkdtempSync(join(tmpdir(), "srd52-split-"));
    try {
      const pack = join(dir, "packs", "_source", "actors24");
      mkdirSync(pack, { recursive: true });
      const paragraphs = Array.from({ length: 6 }, (_, i) =>
        `Paragraph ${i}: ${"long description ".repeat(200)}`.trim(),
      );
      const traitTexts = Array.from({ length: 4 }, (_, i) =>
        `Trait ${i}: ${"trait prose ".repeat(400)}`.trim(),
      );
      const actor = {
        _id: "OversizedActor",
        name: "Oversized Actor",
        type: "npc",
        system: {
          source: { license: "CC-BY-4.0", rules: "2024" },
          details: {
            cr: 1,
            type: { value: "beast" },
            biography: { value: paragraphs.map((p) => `<p>${p}</p>`).join("") },
          },
          traits: { size: "med" },
        },
        items: traitTexts.map((value, i) => ({
          _id: `Trait${i}`,
          name: `Trait ${i}`,
          type: "feat",
          system: {
            source: { license: "CC-BY-4.0", rules: "2024" },
            description: { value },
            properties: ["trait"],
          },
        })),
      };
      writeFileSync(join(pack, "oversized.yml"), JSON.stringify(actor));
      const bundle = importSrd52From(dir, "fixture");
      expect(validateBundle(bundle).problems).toEqual([]);
      expect(bundle.entries.length).toBeGreaterThan(2);
      expect(bundle.entries[0].name).toMatch(/^Oversized Actor \(1\/\d+\)$/);
      const bodies = bundle.entries.map((e) => e.body).join("\n");
      for (const paragraph of paragraphs) expect(bodies).toContain(paragraph);
      const rows = bundle.entries.flatMap((e) =>
        Array.isArray(e.fields.traits) ? e.fields.traits : [],
      );
      expect(rows.map((row) => (typeof row === "object" ? row.text : ""))).toEqual(traitTexts);
      expect(bundle.entries.every((e) => e.body.includes("[[ref:"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses stable case-sensitive upstream identity and excludes inventory copies and other rules editions", () => {
    const dir = mkdtempSync(join(tmpdir(), "srd52-identity-"));
    try {
      const pack = join(dir, "packs", "_source", "equipment24");
      mkdirSync(pack, { recursive: true });
      const item = (id: string, name: string, rules: string, container?: string) => ({
        _id: id,
        name,
        type: "loot",
        system: { source: { license: "CC-BY-4.0", rules }, container },
      });
      writeFileSync(join(pack, "a.yml"), JSON.stringify(item("SameId", "Original", "2024")));
      writeFileSync(join(pack, "b.yml"), JSON.stringify(item("sameid", "Collision", "2024")));
      writeFileSync(join(pack, "old.yml"), JSON.stringify(item("old", "Old Rules", "2014")));
      writeFileSync(
        join(pack, "copy.yml"),
        JSON.stringify(item("copy", "Inventory Copy", "2024", "pack")),
      );
      const before = importSrd52From(dir, "one");
      expect(before.entries.map((e) => e.name)).toEqual(["Original", "Collision"]);
      expect(new Set(before.entries.map((e) => e.id)).size).toBe(2);
      writeFileSync(join(pack, "a.yml"), JSON.stringify(item("SameId", "Renamed", "2024")));
      const after = importSrd52From(dir, "two");
      expect(after.entries.map((e) => e.id)).toEqual(before.entries.map((e) => e.id));
      expect(validateBundle(after).problems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!cached.available)(
    "validates the complete cached 2024 source",
    () => {
      const bundle = importSrd52From(cached.dir, cached.revision());
      const report = validateBundle(bundle);
      console.info(JSON.stringify({ counts: report.counts, largest: report.largest }));
      expect(report.problems).toEqual([]);
      expect(report.counts.spell).toBeGreaterThan(300);
      expect(report.counts.monster).toBeGreaterThan(300);
      expect(report.counts.class).toBe(12);
      expect(report.counts.subclass).toBe(12);
      expect(bundle.entries.length).toBeGreaterThan(1400);
      expect(report.largest?.bytes).toBeLessThanOrEqual(16384);
    },
    300_000,
  );
});
