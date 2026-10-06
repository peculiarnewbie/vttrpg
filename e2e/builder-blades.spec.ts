import type { CompendiumEntry, SaveEntryInput } from "../src/domain/compendium";
import { expect, test, type Table } from "./fixtures";
import { setUpSystemSheets } from "./system-world";

/*
 * The Blades in the Dark character builder: a DM sets the system up, writes a
 * made-up playbook with made-up abilities, and a player builds a scoundrel
 * step by step. Only what the player picks or types reaches the sheet — the
 * ability step offers just the playbook's own abilities.
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
  await setUpSystemSheets(table, "Blades in the Dark");
  const first = await saveEntry(table, entry("ability", "Test Ability A"));
  const second = await saveEntry(table, entry("ability", "Test Ability B"));
  await saveEntry(table, entry("ability", "Test Ability Z"));
  await saveEntry(table, entry("playbook", "Test Playbook", { abilities: [first.id, second.id] }));
};

const valuesOf = async (table: Table, name: string) => {
  const response = await table.dm.api.get(`/api/worlds/${table.worldId}/characters`);
  const characters = (await response.json()) as {
    name: string;
    values: Record<string, unknown>;
  }[];
  return characters.find((character) => character.name === name)?.values;
};

test("a player builds a scoundrel; the ability step offers only the playbook's abilities", async ({
  table,
}) => {
  await setUp(table);
  const page = table.player.page;
  await table.open(table.player);
  await page.getByRole("tab", { name: "Characters" }).click();
  const tools = page.locator("#world-tools");
  await tools.getByRole("button", { name: "New character" }).click();
  const dialog = page.getByRole("dialog", { name: "New character" });
  await dialog.getByPlaceholder("Character name").fill("Test Scoundrel");
  await dialog
    .getByRole("combobox")
    .first()
    .selectOption({ label: "Blades in the Dark — Scoundrel" });
  await dialog.getByRole("button", { name: "Create and open builder" }).click();

  const builder = tools.getByRole("region", { name: "Character builder" });
  await expect(builder).toBeVisible();
  const playbooks = builder.getByRole("group", { name: "Playbooks" });
  await playbooks.getByRole("button", { name: "Test Playbook" }).click();
  await playbooks.getByRole("button", { name: "Choose Test Playbook" }).click();
  await expect(playbooks.getByText("Chosen: Test Playbook")).toBeVisible();

  await builder
    .getByRole("navigation", { name: "Builder steps" })
    .getByRole("button", { name: /Details/ })
    .click();
  // Heritage and vice are offered as choices; a click writes the one picked.
  await builder
    .getByRole("group", { name: "Heritage" })
    .getByRole("button", { name: "Iruvia" })
    .click();
  await builder.getByRole("group", { name: "Vice" }).getByRole("button", { name: "Weird" }).click();
  await expect(builder.getByRole("textbox", { name: "Heritage" })).toHaveValue("Iruvia");
  const look = builder.getByRole("textbox", { name: "Look" });
  await look.fill("Test look");
  await look.press("Enter");

  // Action dots are tallied against seven, with a hint past two; nothing is checked.
  await builder
    .getByRole("navigation", { name: "Builder steps" })
    .getByRole("button", { name: /Actions/ })
    .click();
  await expect(builder.getByRole("group", { name: "Action dots" })).toContainText("Spent 0 of 7");

  await builder
    .getByRole("navigation", { name: "Builder steps" })
    .getByRole("button", { name: /Special ability/ })
    .click();
  const abilities = builder.getByRole("group", { name: "Special Abilities" });
  await expect(abilities.getByText("Picked 0 of 1")).toBeVisible();
  const options = abilities.getByRole("list", { name: "Options" });
  await expect(options.getByRole("button")).toHaveText(["Test Ability A", "Test Ability B"]);
  await options.getByRole("button", { name: "Test Ability A" }).click();
  await abilities.getByRole("button", { name: "Add Test Ability A" }).click();

  await tools.getByRole("button", { name: "Done" }).click();
  await expect(builder).toHaveCount(0);
  await expect
    .poll(() => valuesOf(table, "Test Scoundrel"))
    .toEqual({
      playbook_entry: expect.any(String),
      heritage: "Iruvia",
      vice: "Weird",
      look: "Test look",
      abilities: [expect.objectContaining({ name: "Test Ability A" })],
    });
});
