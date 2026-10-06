import type { CompendiumEntry, SaveEntryInput } from "../src/domain/compendium";
import type { SheetTemplate } from "../src/domain/schemas";
import { expect, test, type Table } from "./fixtures";
import { setUpSystemSheets } from "./system-world";

/*
 * The Fifth Edition character builder: class, species, background, ability
 * scores, skills, equipment and spells over the same values the sheet edits.
 * Test entries use made-up names; the SRD library is not needed.
 */

const saveEntry = async (table: Table, input: SaveEntryInput) => {
  const response = await table.dm.api.post(`/api/worlds/${table.worldId}/compendium/entries`, {
    data: input,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as CompendiumEntry;
};

const entry = (typeId: string, name: string, fields: SaveEntryInput["fields"] = {}) => ({
  typeId,
  name,
  tags: [],
  body: "",
  fields,
  visibility: "public" as const,
});

const setUp = async (table: Table) => {
  await setUpSystemSheets(table, "Fifth Edition (SRD 5.2)");

  const slash = await saveEntry(
    table,
    entry("feature", "Test Slash", { class: "Fighter", level: 1 }),
  );
  await saveEntry(table, entry("feature", "Test Unrelated", { class: "Wizard", level: 1 }));
  await saveEntry(
    table,
    entry("class", "Test Swordmaster", {
      hit_die: "1d10",
      levels: [{ level: 1, proficiency: "+2", features: "Test Slash", extra: "" }],
      features: [slash.id],
    }),
  );
  const alertness = await saveEntry(table, entry("feat", "Test Alertness", { category: "Origin" }));
  await saveEntry(table, entry("feat", "Test Other", { category: "General" }));
  await saveEntry(
    table,
    entry("species", "Test Starfolk", { creature_type: "Humanoid", size: "Medium" }),
  );
  await saveEntry(
    table,
    entry("background", "Test Urchin", { feat: alertness.id, skills: "Sneaking", tool: "Cards" }),
  );
  await saveEntry(
    table,
    entry("weapon", "Test Longblade", { damage: "1d8", damage_type: "Slashing" }),
  );
  await saveEntry(table, entry("armor", "Test Glassplate", { ac: "12", weight: "Heavy" }));
  await saveEntry(table, entry("gear", "Test Rope", { weight: "Light" }));
  await saveEntry(
    table,
    entry("spell", "Test Spark", { level: 1, casting: "One gesture", range: "Near" }),
  );
};

const valuesOf = async (table: Table, name: string) => {
  const response = await table.dm.api.get(`/api/worlds/${table.worldId}/characters`);
  const characters = (await response.json()) as {
    name: string;
    values: Record<string, unknown>;
  }[];
  return characters.find((character) => character.name === name)?.values;
};

test("a player builds a Fifth Edition character; only picks, edits and added rows land", async ({
  table,
}) => {
  await setUp(table);
  const templates = (await (
    await table.dm.api.get(`/api/worlds/${table.worldId}/templates`)
  ).json()) as SheetTemplate[];
  expect(templates.some((item) => item.name === "Fifth Edition (SRD 5.2) — Character")).toBe(true);

  const page = table.player.page;
  await table.open(table.player);
  await page.getByRole("tab", { name: "Characters" }).click();
  const tools = page.locator("#world-tools");
  await tools.getByRole("button", { name: "New character" }).click();
  const dialog = page.getByRole("dialog", { name: "New character" });
  await dialog.getByPlaceholder("Character name").fill("Test Hero");
  await dialog
    .getByRole("combobox")
    .first()
    .selectOption({ label: "Fifth Edition (SRD 5.2) — Character" });
  await dialog.getByRole("button", { name: "Create and open builder" }).click();

  const builder = tools.getByRole("region", { name: "Character builder" });
  await expect(builder).toBeVisible();
  const steps = builder.getByRole("navigation", { name: "Builder steps" });
  await expect(steps.getByRole("button")).toHaveText([
    /Class/,
    /Species/,
    /Background/,
    /Ability Scores/,
    /Skills/,
    /Hit Points & Defenses/,
    /Equipment/,
    /Spells/,
    /Review/,
  ]);

  // Class, features from the class, and level by hand.
  const classes = builder.getByRole("group", { name: "Classes" });
  await classes.getByRole("button", { name: "Test Swordmaster" }).click();
  await classes.getByRole("button", { name: "Choose Test Swordmaster" }).click();
  const features = builder.getByRole("group", { name: "Features" });
  await expect(features.getByRole("list", { name: "Options" }).getByRole("button")).toHaveText([
    "Test Slash",
  ]);
  await features.getByRole("button", { name: "Test Slash" }).click();
  await features.getByRole("button", { name: "Add Test Slash" }).click();
  const level = builder.getByLabel("Level", { exact: true });
  await level.fill("1");
  await level.press("Enter");

  // Species and background; the background's feat is the only feat offered.
  await steps.getByRole("button", { name: /Species/ }).click();
  const species = builder.getByRole("group", { name: "Species" });
  await species.getByRole("button", { name: "Test Starfolk" }).click();
  await species.getByRole("button", { name: "Choose Test Starfolk" }).click();

  await steps.getByRole("button", { name: /Background/ }).click();
  const backgrounds = builder.getByRole("group", { name: "Backgrounds" });
  await backgrounds.getByRole("button", { name: "Test Urchin" }).click();
  await backgrounds.getByRole("button", { name: "Choose Test Urchin" }).click();
  const feats = builder.getByRole("group", { name: "Feats" });
  await expect(feats.getByText("Picked 0 of 1")).toBeVisible();
  await expect(feats.getByRole("list", { name: "Options" }).getByRole("button")).toHaveText([
    "Test Alertness",
  ]);
  await feats.getByRole("button", { name: "Test Alertness" }).click();
  await feats.getByRole("button", { name: "Add Test Alertness" }).click();

  // Ability scores: the rolls go to chat; a number from the standard array is placed by
  // hand, and the point-buy tally reads what was placed (15 costs 9).
  await steps.getByRole("button", { name: /Ability Scores/ }).click();
  await builder.getByRole("button", { name: /^Ability scores/ }).click();
  const chat = page.locator("#world-chat");
  await expect(chat.getByText("4d6kh3").first()).toBeVisible({ timeout: 15_000 });
  const array = builder.getByRole("group", { name: "Standard array" });
  await array.getByRole("button", { name: "Place 15" }).click();
  await array.getByRole("button", { name: "STR: —" }).click();
  await expect(array.getByRole("button", { name: "STR: 15" })).toBeVisible();
  await expect(builder.getByRole("group", { name: "Point buy" })).toContainText("Spent 9 of 27");

  // The class's hit die is read from the chosen entry.
  await steps.getByRole("button", { name: /Hit Points & Defenses/ }).click();
  await expect(builder.getByRole("group", { name: "Readouts" })).toContainText("1d10");
  // The Hit Dice roll reads the same die on the server and rolls it in chat.
  await builder.getByRole("button", { name: "Hit Dice", exact: true }).click();
  await expect(chat.getByText("1d10 + @con_mod").first()).toBeVisible({ timeout: 15_000 });

  // Equipment and spells straight from the compendium.
  await steps.getByRole("button", { name: /Equipment/ }).click();
  const weapons = builder.getByRole("group", { name: "Weapons" });
  await weapons.getByRole("button", { name: "Test Longblade" }).click();
  await weapons.getByRole("button", { name: "Add Test Longblade" }).click();
  const armor = builder.getByRole("group", { name: "Armor" });
  await armor.getByRole("button", { name: "Test Glassplate" }).click();
  await armor.getByRole("button", { name: "Add Test Glassplate" }).click();
  const gear = builder.getByRole("group", { name: "Gear" });
  await gear.getByRole("button", { name: "Test Rope" }).click();
  await gear.getByRole("button", { name: "Add Test Rope" }).click();

  await steps.getByRole("button", { name: /Spells/ }).click();
  const spells = builder.getByRole("group", { name: "Spells" });
  await spells.getByRole("button", { name: "Test Spark" }).click();
  await spells.getByRole("button", { name: "Add Test Spark" }).click();

  await tools.getByRole("button", { name: "Done" }).click();
  await expect(builder).toHaveCount(0);
  await expect
    .poll(() => valuesOf(table, "Test Hero"))
    .toEqual({
      class: expect.stringMatching(/^world\/class\//),
      species: expect.stringMatching(/^world\/species\//),
      background: expect.stringMatching(/^world\/background\//),
      level: 1,
      str: 15,
      features: [expect.objectContaining({ name: "Test Slash", level: 1 })],
      feats: [expect.objectContaining({ name: "Test Alertness" })],
      weapons: [expect.objectContaining({ name: "Test Longblade", damage: "1d8" })],
      armor: [expect.objectContaining({ name: "Test Glassplate" })],
      gear: [expect.objectContaining({ name: "Test Rope" })],
      spells: [expect.objectContaining({ name: "Test Spark", level: 1 })],
    });
});
