import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseNotation } from "../../../src/domain/dice-notation";
import { splitEntryLinks } from "../../../src/domain/entry-links";
import { renderNoteMarkdown } from "../../../src/client/note-markdown";
import { firstPartySystems } from "../../../src/domain/systems";
import { upstream } from "../sources";
import { validateBundle } from "../validate";
import { importBlades, importBladesFrom } from "./index";

const fixtureDir = fileURLToPath(new URL("./fixtures", import.meta.url));
const fixture = () => importBladesFrom(fixtureDir, "fixture-revision");
const entry = (id: string) => fixture().entries.find((item) => item.id === `blades/${id}`);

function withDocument(document: string, test: (dir: string) => void, notice?: string) {
  const dir = mkdtempSync(join(tmpdir(), "blades-import-"));
  try {
    writeFileSync(
      join(dir, "README.md"),
      notice ?? readFileSync(join(fixtureDir, "README.md"), "utf8"),
    );
    writeFileSync(join(dir, "Blades-in-the-Dark-SRD.md"), document);
    test(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Blades SRD fixtures", () => {
  it("uses the first-party contract and records the upstream revision", () => {
    const bundle = fixture();
    const definition = firstPartySystems.find((item) => item.system.id === "blades")!;
    expect(bundle.system).toEqual(definition.system);
    expect(bundle.source).toEqual(definition.source);
    expect(bundle.provenance).toMatchObject({
      upstream: "https://github.com/amazingrando/blades-in-the-dark-srd-content",
      revision: "fixture-revision",
      importer: "tools/importers/blades",
    });
    expect(validateBundle(bundle).problems).toEqual([]);
  });

  it("imports a rule with its chapter and stable heading path", () => {
    expect(entry("rule/the-basics-the-game")).toEqual({
      id: "blades/rule/the-basics-the-game",
      typeId: "rule",
      name: "The Game",
      tags: [],
      visibility: "public",
      body: "*Blades in the Dark* is a game about a group of daring characters building an enterprising crew. We play to find out if the fledgling crew can thrive amidst the teeming threats that surround it.",
      fields: { chapter: "The Basics" },
    });
  });

  it("imports abilities with their example asides", () => {
    expect(entry("ability/mule")).toEqual({
      id: "blades/ability/mule",
      typeId: "ability",
      name: "Mule",
      tags: [],
      visibility: "public",
      fields: {},
      body: "Your load limits are higher. Light: 5. Normal: 7. Heavy: 8.\n\n> This ability is great if you want to wear heavy armor and pack a heavy weapon without attracting lots of attention. Since your exact gear is determined on-the-fly during an operation, having more load also gives you more options to get creative with when dealing with problems during a score.",
    });
    expect(entry("ability/fortitude")).toMatchObject({
      name: "Fortitude",
      typeId: "ability",
      body: 'You may expend your **special armor** to resist a consequence of fatigue, weakness, or chemical effects, or to **push yourself** when working with technical skill or handling alchemicals.\n\n> When you use this ability, tick the special armor box on your playbook sheet. If you "resist a consequence" of the appropriate type, you avoid it completely. If you use this ability to push yourself, you get one of the benefits (+1d, +1 effect, act despite severe harm) but you don\'t take 2 stress. Your special armor is restored at the beginning of downtime.',
    });
  });

  it("imports crew abilities without creating template crews", () => {
    expect(entry("crew-ability/deadly")).toEqual({
      id: "blades/crew-ability/deadly",
      typeId: "crew-ability",
      name: "Deadly",
      tags: [],
      visibility: "public",
      fields: {},
      body: "Each PC may add +1 action rating to **Hunt**, **Prowl**, or **Skirmish** (up to a max rating of 3).\n\n> Each player may choose the action they prefer (you don't all have to choose the same one). If you take this ability during initial character and crew creation, it supersedes the normal starting limit for action ratings.",
    });
    const text = fixture()
      .entries.map((item) => `${item.name}\n${item.body}`)
      .join("\n");
    expect(text).not.toMatch(
      /Short Descriptor|Medium length description|PRIMARY ACTION|SECONDARY ACTION|First upgrade|Add xp trigger|Add a list of five/,
    );
    expect(
      fixture().entries.some((item) => item.typeId === "playbook" || item.typeId === "crew"),
    ).toBe(false);
  });

  it("extracts multi-box costs and malformed upstream upgrade emphasis", () => {
    expect(entry("upgrade/hardened")).toEqual({
      id: "blades/upgrade/hardened",
      typeId: "upgrade",
      name: "Hardened",
      tags: [],
      visibility: "public",
      fields: { cost: 3 },
      body: "Each PC gets **+1** **trauma** **box**. This costs three upgrades to unlock, not just one. *This may bring a PC with 4 **trauma** back into play if you wish.*",
    });
    expect(entry("upgrade/mastery")?.fields).toEqual({ cost: 4 });
    expect(entry("upgrade/boat-house")).toMatchObject({
      name: "Boat house",
      fields: {},
      body: "You have a boat, a dock on a waterway, and a small shack to store boating supplies. A second upgrade improves the boat with armor and more cargo capacity.",
    });
    expect(entry("rule/crew-playbook-crew-upgrades")?.body).toContain(
      "[[ref:blades/upgrade/hardened|Hardened]]",
    );
    expect(entry("rule/crew-playbook-make-a-claim-map-for-the-crew")?.body).toContain(
      "**City Records**",
    );
  });

  it("normalizes tables and entities while retaining worked example grids", () => {
    const ratings = entry("rule/actions-attributes-resistance-roll")!.body;
    expect(ratings).toContain("| ● |  | ○ | ○ | ○ | **Hunt** |\n| ○ |  | ○ | ○ | ○ | **Study** |");
    const magnitude = entry("rule/magnitude")!.body;
    expect(magnitude).toContain(
      "| 0 | 1 | 2 | 3 | 4 | 5 | 6 |\n| --- | --- | --- | --- | --- | --- | --- |\n| A closet | A small room | A large room& Several rooms | A small building | A large building | A city block |  |",
    );
    expect(magnitude).not.toMatch(/&#|&nbsp;|\[\]\(\)/);
    expect(magnitude).toContain("[[r:6d6kh1|6d]]");
    expect(entry("rule/entanglements")?.body).toContain(
      "| 1-3 | Gang Trouble or The Usual Suspects | Gang Trouble or Questioning | Flipped or Interrogation |",
    );
  });

  it("links fixed pools that parse, keeping bonuses and result ranges as prose", () => {
    const text = fixture()
      .entries.map((item) => item.body)
      .join("\n");
    const rolls = splitEntryLinks(text).filter((part) => part.kind === "roll");
    expect(rolls.length).toBeGreaterThan(5);
    for (const roll of rolls) expect(parseNotation(roll.notation).ok).toBe(true);
    expect(text).toContain("[[r:0d6khz|0d]]");
    expect(text).toContain("(+1d, +1 effect");
    expect(text).not.toContain("[[r:+1");
    expect(renderNoteMarkdown("[[r:2d6kh1|2d]]")).toContain('data-roll="2d6kh1"');
  });

  it("requires the upstream's CC BY 3.0 notice at the input boundary", () => {
    withDocument(
      "# Rules\n\nText.",
      (dir) => {
        expect(() => importBladesFrom(dir, "unlicensed")).toThrow("CC BY 3.0");
      },
      "All rights reserved.",
    );
  });

  it("imports text links while excluding images and image paths", () => {
    withDocument(
      '# Links\n\n![Art](art.png) [Diagram](https://example.com/map.svg) <img src="portrait.webp">\n\n[Website](https://example.com/) [Unresolved](#missing)',
      (dir) => {
        const bundle = importBladesFrom(dir, "text-only");
        expect(validateBundle(bundle).problems).toEqual([]);
        expect(bundle.entries[0].body).toBe(
          "Diagram \n\n[Website](https://example.com/) Unresolved",
        );
      },
    );
  });

  it("keeps ids deterministic when sections move or slugs collide", () => {
    const sections = ["## A & B\n\nFirst rule.", "## A B\n\nSecond rule."];
    let ids: string[] = [];
    withDocument(`# Chapter\n\n${sections.join("\n\n")}`, (dir) => {
      const bundle = importBladesFrom(dir, "one");
      expect(validateBundle(bundle).problems).toEqual([]);
      ids = bundle.entries.map((item) => item.id).sort();
    });
    withDocument(`# Chapter\n\n${sections.toReversed().join("\n\n")}`, (dir) => {
      expect(
        importBladesFrom(dir, "two")
          .entries.map((item) => item.id)
          .sort(),
      ).toEqual(ids);
    });
  });

  it("splits long Unicode prose without truncating it and links every part", () => {
    const paragraphs = Array.from({ length: 30 }, (_, index) =>
      `Paragraph ${index}: ${'雪\\" '.repeat(300)}`.trim(),
    );
    withDocument(`# Long rules\n\n${paragraphs.join("\n\n")}`, (dir) => {
      const bundle = importBladesFrom(dir, "long");
      expect(bundle.entries.length).toBeGreaterThan(2);
      expect(validateBundle(bundle).problems).toEqual([]);
      expect(bundle.entries[0].id).toBe("blades/rule/long-rules");
      expect(bundle.entries[0].name).toBe(`Long rules (1/${bundle.entries.length})`);
      const text = bundle.entries
        .map((item) => item.body.replace(/\n\n\[\[ref:[\s\S]*$/, ""))
        .join("\n\n");
      expect(text).toBe(paragraphs.join("\n\n"));
    });
  });

  it("splits a long paragraph without breaking entry links or losing words", () => {
    const paragraph = Array.from({ length: 1800 }, (_, index) =>
      index % 20 === 0 ? "**Target rule**" : `Word${index}`,
    ).join(" ");
    withDocument(`# Long prose\n\n${paragraph}\n\n## Target rule\n\nDefinition.`, (dir) => {
      const bundle = importBladesFrom(dir, "long-paragraph");
      expect(validateBundle(bundle).problems).toEqual([]);
      const parts = bundle.entries.filter((item) => item.name.startsWith("Long prose ("));
      expect(parts.length).toBeGreaterThan(1);
      expect(parts[1].body).toContain("|Previous part]]");
      const text = parts.map((item) => item.body.replace(/\n\n\[\[ref:[\s\S]*$/, "")).join(" ");
      expect(
        text.replaceAll(
          "[[ref:blades/rule/long-prose-target-rule|Target rule]]",
          "**Target rule**",
        ),
      ).toBe(paragraph);
    });
  });

  it("splits an oversized word on Unicode character boundaries", () => {
    const text = "𐐀".repeat(10_000);
    withDocument(`# Long word\n\n${text}`, (dir) => {
      const bundle = importBladesFrom(dir, "long-word");
      expect(validateBundle(bundle).problems).toEqual([]);
      expect(
        bundle.entries.map((item) => item.body.replace(/\n\n\[\[ref:[\s\S]*$/, "")).join(""),
      ).toBe(text);
    });
  });
});

const fullSource = upstream("blades");
it.skipIf(!fullSource.available)(
  "imports the complete fetched SRD within publishing limits",
  async () => {
    const bundle = await importBlades();
    const report = validateBundle(bundle);
    expect(report.problems).toEqual([]);
    expect(report.counts.ability).toBeGreaterThanOrEqual(40);
    expect(report.counts["crew-ability"]).toBe(16);
    expect(report.counts.upgrade).toBe(18);
    expect(report.counts.rule).toBeGreaterThan(90);
    expect(report.counts.playbook).toBeUndefined();
    expect(report.counts.crew).toBeUndefined();
    expect(bundle.provenance.revision).toBe(fullSource.revision());
    process.stdout.write(`${JSON.stringify({ counts: report.counts, largest: report.largest })}\n`);
  },
);
