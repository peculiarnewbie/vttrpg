import type { CompendiumEntry, SaveEntryInput } from "../src/domain/compendium";
import { bladesEntryTypes } from "../src/domain/systems/blades";
import { expect, test, type Table } from "./fixtures";

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
  const page = table.dm.page;
  await page.goto(`/worlds/${table.worldId}/settings?section=system`);
  await page
    .getByRole("article", { name: "Blades in the Dark" })
    .getByRole("button", { name: "Use this system" })
    .click();
  await expect(page.getByRole("status")).toContainText("Blades in the Dark — Scoundrel", {
    timeout: 30_000,
  });
  // The setup already adds these; putting them again keeps the spec hermetic.
  for (const id of ["ability", "playbook"]) {
    const type = bladesEntryTypes.find((item) => item.id === id)!;
    const response = await table.dm.api.put(`/api/worlds/${table.worldId}/compendium/types/${id}`, {
      data: type,
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
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
  const heritage = builder.getByLabel("Heritage");
  await heritage.fill("Test Heritage");
  await heritage.press("Enter");

  await builder
    .getByRole("navigation", { name: "Builder steps" })
    .getByRole("button", { name: /Special ability/ })
    .click();
  const abilities = builder.getByRole("group", { name: "Special Abilities" });
  await expect(abilities.getByText("Pick 1")).toBeVisible();
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
      heritage: "Test Heritage",
      abilities: [expect.objectContaining({ name: "Test Ability A" })],
    });
});
