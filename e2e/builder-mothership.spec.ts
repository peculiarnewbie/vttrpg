import type { CompendiumEntry, SaveEntryInput } from "../src/domain/compendium";
import { expect, test, type Table } from "./fixtures";

/*
 * The Mothership character builder: a preset (closed book) system ships shapes
 * only, so the DM writes a made-up class and skills, and the player picks and
 * types them in. Builder rolls go to chat and never land on the sheet.
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
  const page = table.dm.page;
  await page.goto(`/worlds/${table.worldId}/settings?section=system`);
  await page
    .getByRole("article", { name: "Mothership" })
    .getByRole("button", { name: "Use this system" })
    .click();
  await expect(page.getByRole("status")).toContainText("entries are yours to write from your book");
  await saveEntry(table, entry("class", "Test Voyager"));
  await saveEntry(table, entry("skill", "Test Welding", { bonus: 10 }));
  await saveEntry(table, entry("skill", "Test Patching", { bonus: 15 }));
};

const valuesOf = async (table: Table, name: string) => {
  const response = await table.dm.api.get(`/api/worlds/${table.worldId}/characters`);
  const characters = (await response.json()) as {
    name: string;
    values: Record<string, unknown>;
  }[];
  return characters.find((character) => character.name === name)?.values;
};

test("a player builds a Mothership crew member; only picks and edits reach the sheet", async ({
  table,
}) => {
  await setUp(table);
  const page = table.player.page;
  await table.open(table.player);
  await page.getByRole("tab", { name: "Characters" }).click();
  const tools = page.locator("#world-tools");
  await tools.getByRole("button", { name: "New character" }).click();
  const dialog = page.getByRole("dialog", { name: "New character" });
  await dialog.getByPlaceholder("Character name").fill("Test Crew");
  await dialog.getByRole("combobox").first().selectOption({ label: "Mothership — Classic" });
  await dialog.getByRole("button", { name: "Create and open builder" }).click();

  const builder = tools.getByRole("region", { name: "Character builder" });
  await expect(builder).toBeVisible();
  const classes = builder.getByRole("group", { name: "Classes" });
  await classes.getByRole("button", { name: "Test Voyager" }).click();
  await classes.getByRole("button", { name: "Choose Test Voyager" }).click();
  await expect(classes.getByText("Chosen: Test Voyager")).toBeVisible();

  await builder
    .getByRole("navigation", { name: "Builder steps" })
    .getByRole("button", { name: /Stats and saves/ })
    .click();
  await builder.getByRole("button", { name: /^2d10/ }).click();
  const chat = page.locator("#world-chat");
  await expect(chat.getByText("2d10").first()).toBeVisible({ timeout: 15_000 });
  const strength = builder.getByLabel("Strength");
  await strength.fill("42");
  await strength.press("Enter");

  await builder
    .getByRole("navigation", { name: "Builder steps" })
    .getByRole("button", { name: /Skills/ })
    .click();
  const skills = builder.getByRole("group", { name: "Skills" });
  await skills.getByRole("button", { name: "Test Welding" }).click();
  await skills.getByRole("button", { name: "Add Test Welding" }).click();
  await skills.getByRole("button", { name: "Test Patching" }).click();
  await skills.getByRole("button", { name: "Add Test Patching" }).click();

  await builder
    .getByRole("navigation", { name: "Builder steps" })
    .getByRole("button", { name: /Loadout/ })
    .click();
  await builder.getByRole("button", { name: /^Trinket/ }).click();
  await expect(chat.getByText("1d100").first()).toBeVisible({ timeout: 15_000 });
  const trinket = builder.getByLabel("Trinket");
  await trinket.fill("Lucky bolt");
  await trinket.press("Enter");

  await tools.getByRole("button", { name: "Done" }).click();
  await expect(builder).toHaveCount(0);
  await expect
    .poll(() => valuesOf(table, "Test Crew"))
    .toEqual({
      class: expect.stringMatching(/^world\/class\//),
      str: 42,
      skills: [
        expect.objectContaining({ name: "Test Welding" }),
        expect.objectContaining({ name: "Test Patching" }),
      ],
      trinket: "Lucky bolt",
    });
});
