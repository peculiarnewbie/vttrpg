import type { CompendiumEntry, SaveEntryInput } from "../src/domain/compendium";
import { expect, test, type Table } from "./fixtures";

/*
 * The Mythic Bastionland character builder: a step-by-step frontend over the
 * same character values. Rolls go to chat only; the sheet keeps only what the
 * player picks, types, or explicitly accepts. Shapes only — the Knight below
 * is made up for the test, never book content.
 */

const saveEntry = async (table: Table, input: SaveEntryInput) => {
  const response = await table.dm.api.post(`/api/worlds/${table.worldId}/compendium/entries`, {
    data: input,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as CompendiumEntry;
};

const setUp = async (table: Table) => {
  const page = table.dm.page;
  await page.goto(`/worlds/${table.worldId}/settings?section=system`);
  await page
    .getByRole("article", { name: "Mythic Bastionland" })
    .getByRole("button", { name: "Use this system" })
    .click();
  await expect(page.getByRole("status")).toContainText("entries are yours to write from your book");
  await saveEntry(table, {
    typeId: "knight",
    name: "Test Knight",
    tags: [],
    body: "",
    fields: {
      ability: "A made-up ability for tests.",
      property: [{ item: "Test spear", dmg: "d8" }],
    },
    visibility: "public",
  });
};

const valuesOf = async (table: Table, name: string) => {
  const response = await table.dm.api.get(`/api/worlds/${table.worldId}/characters`);
  const characters = (await response.json()) as {
    name: string;
    values: Record<string, unknown>;
  }[];
  return characters.find((character) => character.name === name)?.values;
};

test("a player builds a Knight step by step; only picks, edits and accepted offers reach the sheet", async ({
  table,
}) => {
  await setUp(table);
  const page = table.player.page;
  await table.open(table.player);
  await page.getByRole("tab", { name: "Characters" }).click();
  const tools = page.locator("#world-tools");
  await tools.getByRole("button", { name: "New character" }).click();
  const dialog = page.getByRole("dialog", { name: "New character" });
  await dialog.getByPlaceholder("Character name").fill("Ser E2E");
  await dialog
    .getByRole("combobox")
    .first()
    .selectOption({ label: "Mythic Bastionland — Classic" });
  await dialog.getByRole("button", { name: "Create and open builder" }).click();

  const builder = tools.getByRole("region", { name: "Character builder" });
  await expect(builder).toBeVisible();
  const knights = builder.getByRole("group", { name: "Knights" });
  await knights.getByRole("button", { name: "Test Knight" }).click();
  await knights.getByRole("button", { name: "Choose Test Knight" }).click();
  await expect(knights.getByRole("status")).toContainText("Add Test Knight's Property (1)");
  await knights.getByRole("button", { name: "Add", exact: true }).click();

  const steps = builder.getByRole("navigation", { name: "Builder steps" });
  await steps.getByRole("button", { name: /Virtues/ }).click();
  await builder.getByRole("button", { name: /^d6/ }).click();
  const chat = page.locator("#world-chat");
  await expect(chat.getByText("1d6").first()).toBeVisible({ timeout: 15_000 });

  await steps.getByRole("button", { name: /Bonds/ }).click();
  const seer = builder.getByLabel("Seer");
  await seer.fill("A test seer");
  await seer.press("Enter");

  await steps.getByRole("button", { name: /Review/ }).click();
  await expect(builder.getByLabel("Property row 1 Item")).toHaveValue("Test spear");

  await tools.getByRole("button", { name: "Done" }).click();
  await expect(builder).toHaveCount(0);
  await expect
    .poll(() => valuesOf(table, "Ser E2E"))
    .toEqual({
      knight: expect.stringMatching(/^world\/knight\//),
      property: [expect.objectContaining({ item: "Test spear", dmg: "d8" })],
      seer: "A test seer",
    });
});
