import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { firstPartySystem } from "../../../src/domain/systems";
import { upstream } from "../sources";
import { validateBundle } from "../validate";
import { importStarforged, importStarforgedFrom } from "./index";
import type { Datasworn } from "./source";

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };
type Fixture = Mutable<typeof Datasworn.Type>;

const fixtureDir = fileURLToPath(new URL("./fixtures", import.meta.url));
const fixture = () => importStarforgedFrom(fixtureDir, "fixture-revision");
const find = (name: string, typeId?: string) => {
  const entry = fixture().entries.find(
    (entry) => entry.name === name && (!typeId || entry.typeId === typeId),
  );
  expect(entry).toBeDefined();
  return entry!;
};
const changeFixture = (change: (data: Fixture) => void) => {
  const dir = mkdtempSync(join(tmpdir(), "starforged-import-"));
  const file = join(dir, "datasworn/starforged/starforged.json");
  const data = JSON.parse(
    readFileSync(join(fixtureDir, "datasworn/starforged/starforged.json"), "utf8"),
  ) as Fixture;
  change(data);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
  try {
    return importStarforgedFrom(dir, "changed-fixture");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("Starforged text importer", () => {
  it("uses the first-party contract and produces a valid fixture bundle", () => {
    const bundle = fixture();
    expect({ system: bundle.system, source: bundle.source }).toEqual(
      firstPartySystem("starforged"),
    );
    expect(bundle.provenance).toMatchObject({
      upstream: "https://github.com/rsek/datasworn",
      revision: "fixture-revision",
      importer: "tools/importers/starforged",
    });
    expect(validateBundle(bundle).problems).toEqual([]);
  });

  it.each([
    ["Face Danger", "move"],
    ["Starship", "asset"],
    ["Background Assets", "oracle"],
    ["Chiton", "npc"],
    ["Cataclysm", "truth"],
  ])("converts %s exactly", (name, typeId) => {
    expect(find(name, typeId)).toMatchSnapshot();
  });

  it("preserves roll descriptions, enabled abilities and embedded tables", () => {
    expect(find("Face Danger").fields.roll).toBe(
      "Action roll +edge, +heart, +iron, +shadow or +wits (choose)",
    );
    expect(find("Endure Harm").fields.roll).toBe(
      "Action roll +iron or +health (whichever is higher)",
    );
    expect(find("Heal").fields.roll).toBe(
      "Action roll +iron, +iron or +wits (whichever is lower), +heart or +wits (choose)",
    );
    expect(find("Fulfill Your Vow").fields.roll).toBe("Progress roll");
    expect(find("Overcome Destruction").fields.roll).toBe("Progress roll (bonds legacy)");
    expect(find("Continue a Legacy").fields.roll).toBe(
      "Progress roll (quests legacy, bonds legacy, discoveries legacy; one roll per track)",
    );
    expect(find("Develop Your Relationship").fields.roll).toBe(
      "Action roll +1 (troublesome), +2 (dangerous), +3 (formidable), +4 (extreme) or +5 (epic) (choose)",
    );
    expect(find("Devotant").body).toContain("Linked stat: edge, heart, iron, shadow, wits");
    expect(find("Begin a Session", "move").fields).toMatchObject({
      category: "Session",
      roll: "No roll",
      table: find("Begin a Session", "oracle").fields.table,
    });
    expect(find("Starship").fields.track).toBe("Integrity 5 (0–5) (starts at 5); Battered; Cursed");
    expect(find("Starship").fields.abilities).toMatchObject([
      { enabled: true },
      { enabled: false },
      { enabled: false },
    ]);
    expect(find("Bonded").fields.track).toContain("One time only");
  });

  it("keeps collection paths, two-column results, non-percentile dice and null-range notes", () => {
    expect(find("Atmosphere").fields.group).toBe("Planet Oracles › Desert World › Atmosphere");
    expect(find("Sample Names").body).toContain("[[r:1d20|1d20]]");
    const table = find("Sample Names").fields.table;
    expect(table).toHaveLength(20);
    expect(Array.isArray(table) ? table[0] : undefined).toEqual({ min: 1, max: 1, text: "Abalos" });
    expect(find("Starship", "oracle").body).toContain("## Unrollable results\n\n- Access");
    expect(find("Character Role").fields.table).toContainEqual({
      min: 96,
      max: 100,
      text: "Roll twice",
    });
  });

  it("filters incompatible licences at parent, entry and nested text boundaries", () => {
    const bundle = changeFixture((data) => {
      data.moves.adventure._source!.license = "https://creativecommons.org/licenses/by-nc/4.0";
      data.assets.command_vehicle.contents!.starship._source!.license =
        "https://creativecommons.org/licenses/by-nc/4.0";
      data.assets.path.contents!.augmented.abilities[0]._source = {
        license: "https://creativecommons.org/licenses/by-nc/4.0",
      };
      data.npcs.sample_npcs.contents!.chiton.variants!.chiton_queen._source = {
        license: "https://creativecommons.org/licenses/by-nc/4.0",
      };
      data.truths.cataclysm.options[0]._source = {
        license: "https://creativecommons.org/licenses/by-nc/4.0",
      };
    });
    expect(bundle.entries.some((entry) => entry.name === "Face Danger")).toBe(false);
    expect(
      bundle.entries.some((entry) => entry.name === "Starship" && entry.typeId === "asset"),
    ).toBe(false);
    expect(
      bundle.entries.find((entry) => entry.name === "Augmented")?.fields.abilities,
    ).toHaveLength(2);
    expect(bundle.entries.find((entry) => entry.name === "Chiton")?.body).not.toContain(
      "Chiton queen",
    );
    expect(bundle.entries.find((entry) => entry.name === "Cataclysm")?.fields.options).toHaveLength(
      2,
    );
    expect(bundle.provenance.notes).toContain("Excluded incompatible or missing licence markers:");
    expect(validateBundle(bundle).problems).toEqual([]);
  });

  it("keeps ids stable across renames and ordering, and disambiguates slug collisions", () => {
    const bundle = changeFixture((data) => {
      const moves = data.moves.adventure.contents!;
      moves.other = {
        ...moves.face_danger,
        _id: "starforged/moves/adventure/face-danger",
        name: "Another move",
      };
      moves.face_danger.name = "Renamed move";
      data.moves = Object.fromEntries(Object.entries(data.moves).reverse());
    });
    const ids = bundle.entries.filter((entry) => entry.typeId === "move").map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(bundle.entries.find((entry) => entry.name === "Renamed move")?.id).toBe(
      find("Face Danger").id,
    );
    expect(validateBundle(bundle).problems).toEqual([]);
    const renamed = changeFixture((data) => {
      data.moves.adventure.contents!.face_danger.name = "New name";
    });
    expect(renamed.entries.find((entry) => entry.name === "New name")?.id).toBe(
      find("Face Danger").id,
    );
  });

  it("splits long bodies into linked parts without truncation", () => {
    const words = Array.from({ length: 1500 }, (_, index) => `paragraph-${index}.`).join("\n\n");
    const bundle = changeFixture((data) => {
      data.moves.adventure.contents!.face_danger.text = words;
    });
    const parts = bundle.entries
      .filter((entry) => entry.name.startsWith("Face Danger ("))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((entry) => entry.body.includes("[[ref:"))).toBe(true);
    for (let index = 0; index < 1500; index++)
      expect(parts.some((entry) => entry.body.includes(`paragraph-${index}.`))).toBe(true);
    expect(validateBundle(bundle).problems).toEqual([]);
  });
});

const source = upstream("datasworn");
it.skipIf(!source.available)(
  "imports and validates the entire cached Datasworn Starforged source",
  async () => {
    const bundle = await importStarforged();
    const report = validateBundle(bundle);
    const markers: string[] = [];
    const licenses = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(licenses);
        return;
      }
      if (typeof value !== "object" || value === null) return;
      for (const [key, child] of Object.entries(value)) {
        if (key === "license" && typeof child === "string") markers.push(child);
        else licenses(child);
      }
    };
    licenses(
      JSON.parse(readFileSync(join(source.dir, "datasworn/starforged/starforged.json"), "utf8")),
    );
    expect(markers.length).toBeGreaterThan(400);
    expect([...new Set(markers)]).toEqual(["https://creativecommons.org/licenses/by/4.0"]);
    expect(report.problems).toEqual([]);
    expect(report.counts).toEqual({ move: 56, asset: 87, oracle: 262, npc: 23, truth: 14 });
    expect(bundle.provenance.revision).toBe(source.revision());
    expect(bundle.provenance.notes).toContain("no incompatible licences found");
    expect(bundle.provenance.notes).toContain("Non-percentile tables (12)");
    console.info("Starforged import report", report);
  },
);
