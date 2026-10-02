import type { CompendiumEntry, SaveEntryInput } from "../src/domain/compendium";
import { expect, test, type Table } from "./fixtures";

/*
 * The Stonetop character builder: playbook, who you are, stats, moves from
 * the playbook, gear, people. Rolls go to chat; only what the player types,
 * picks or accepts lands on the character.
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

/** A made-up playbook with two made-up moves on it, plus one move not on it. */
const setUp = async (table: Table) => {
  const page = table.dm.page;
  await page.goto(`/worlds/${table.worldId}/settings?section=system`);
  await page
    .getByRole("article", { name: "Stonetop" })
    .getByRole("button", { name: "Use this system" })
    .click();
  await expect(page.getByRole("status")).toContainText("entries are yours to write from your book");
  const mend = await saveEntry(table, entry("move", "Test Mend"));
  const tinker = await saveEntry(table, entry("move", "Test Tinker"));
  await saveEntry(table, entry("move", "Test Wander"));
  await saveEntry(table, entry("playbook", "Test Playbook", { moves: [mend.id, tinker.id] }));
};

const valuesOf = async (table: Table, name: string) => {
  const response = await table.dm.api.get(`/api/worlds/${table.worldId}/characters`);
  const characters = (await response.json()) as {
    name: string;
    values: Record<string, unknown>;
  }[];
  return characters.find((character) => character.name === name)?.values;
};

test("a player builds a Stonetop character; the Moves step only offers the playbook's moves", async ({
  table,
}) => {
  await setUp(table);
  const page = table.player.page;
  await table.open(table.player);
  await page.getByRole("tab", { name: "Characters" }).click();
  const tools = page.locator("#world-tools");
  await tools.getByRole("button", { name: "New character" }).click();
  const dialog = page.getByRole("dialog", { name: "New character" });
  await dialog.getByPlaceholder("Character name").fill("Wren Test");
  await dialog.getByRole("combobox").first().selectOption({ label: "Stonetop — Character" });
  await dialog.getByRole("button", { name: "Create and open builder" }).click();

  const builder = tools.getByRole("region", { name: "Character builder" });
  await expect(builder).toBeVisible();
  const playbooks = builder.getByRole("group", { name: "Playbooks" });
  await playbooks.getByRole("button", { name: "Test Playbook" }).click();
  await playbooks.getByRole("button", { name: "Choose Test Playbook" }).click();

  await builder.getByRole("button", { name: "Next →" }).click();
  const origin = builder.getByLabel("Origin");
  await origin.fill("Test origin");
  await origin.press("Enter");

  await builder.getByRole("button", { name: "Next →" }).click();
  await builder.getByRole("button", { name: /^Roll/ }).first().click();
  const chat = page.locator("#world-chat");
  await expect(chat.getByText("2d6").first()).toBeVisible({ timeout: 15_000 });
  const str = builder.getByLabel("STR");
  await str.fill("1");
  await str.press("Enter");

  await builder.getByRole("button", { name: "Next →" }).click();
  const moves = builder.getByRole("group", { name: "Moves" });
  const options = moves.getByRole("list", { name: "Options" });
  // Only the playbook's two moves; the third move is not offered.
  await expect(options.getByRole("button")).toHaveText(["Test Mend", "Test Tinker"]);
  await options.getByRole("button", { name: "Test Mend" }).click();
  await moves.getByRole("button", { name: "Add Test Mend" }).click();

  await builder.getByRole("button", { name: "Next →" }).click();
  await builder.getByRole("button", { name: "Next →" }).click();

  await tools.getByRole("button", { name: "Done" }).click();
  await expect(builder).toHaveCount(0);
  await expect
    .poll(() => valuesOf(table, "Wren Test"))
    .toEqual({
      playbook: expect.stringMatching(/^world\/playbook\//),
      origin: "Test origin",
      str: 1,
      moves: [expect.objectContaining({ name: "Test Mend" })],
    });
});
