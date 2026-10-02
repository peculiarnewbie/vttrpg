import type { CompendiumEntry, SaveEntryInput } from "../src/domain/compendium";
import type { Character } from "../src/domain/schemas";
import { expect, test, type Table } from "./fixtures";

/*
 * The Cairn character builder: pick a background, roll its tables into chat,
 * roll attributes and HP into chat and write them in, then take gear from the
 * compendium. Rolls never reach the sheet — only picks and typed values do.
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

/** Cairn the way a DM sets it up, plus the few compendium entries the builder needs. */
const setUp = async (table: Table) => {
  const page = table.dm.page;
  await page.goto(`/worlds/${table.worldId}/settings?section=system`);
  await page
    .getByRole("article", { name: "Cairn (2nd edition)" })
    .getByRole("button", { name: "Use this system" })
    .click();
  await expect(page.getByRole("status")).toContainText("entries are yours to write", {
    timeout: 30_000,
  });
  const templates = (await (
    await table.dm.api.get(`/api/worlds/${table.worldId}/templates`)
  ).json()) as { id: string; name: string; layout?: { builder?: unknown } }[];
  const template = templates.find((item) => item.layout?.builder);
  expect(template).toBeDefined();

  const omens = await saveEntry(
    table,
    entry("table", "Test Omens", {
      group: "Test",
      table: [{ min: 1, max: 6, text: "A crow over still water" }],
    }),
  );
  await saveEntry(table, entry("item", "Test Rations", { uses: "3", slots: 1 }));
  await saveEntry(table, entry("item", "Test Rope", { slots: 1 }));
  const forager = await saveEntry(
    table,
    entry("background", "Test Forager", {
      names: "Test names",
      gear: "Test gear",
      tables: [omens.id],
    }),
  );
  return { template: template!, forager };
};

const characterOf = async (table: Table, name: string) => {
  const response = await table.dm.api.get(`/api/worlds/${table.worldId}/characters`);
  const characters = (await response.json()) as Character[];
  return characters.find((character) => character.name === name);
};

test("a player builds a Cairn character; only picks and typed values reach the sheet", async ({
  table,
}) => {
  const { template, forager } = await setUp(table);
  const page = table.player.page;
  await table.open(table.player);
  await page.getByRole("tab", { name: "Characters" }).click();
  const tools = page.locator("#world-tools");
  await tools.getByRole("button", { name: "New character" }).click();
  const dialog = page.getByRole("dialog", { name: "New character" });
  await dialog.getByPlaceholder("Character name").fill("Test Wren");
  await dialog.getByRole("combobox").first().selectOption({ label: template.name });
  await dialog.getByRole("button", { name: "Create and open builder" }).click();

  const builder = tools.getByRole("region", { name: "Character builder" });
  await expect(builder).toBeVisible();
  const steps = builder.getByRole("navigation", { name: "Builder steps" });
  const chat = page.locator("#world-chat");

  const backgrounds = builder.getByRole("group", { name: "Backgrounds" });
  await backgrounds.getByRole("button", { name: "Test Forager" }).click();
  await backgrounds.getByRole("button", { name: "Choose Test Forager" }).click();
  await expect(backgrounds.getByText("Chosen: Test Forager")).toBeVisible();

  await steps.getByRole("button", { name: /Name/ }).click();
  await builder
    .getByRole("group", { name: "Tables" })
    .getByRole("button", { name: "Test Omens" })
    .click();
  await expect(chat.getByText("Test Omens · Table").first()).toBeVisible({ timeout: 15_000 });
  const bonds = builder.getByLabel("Bonds & omens");
  await bonds.fill("Owes the Test Forager a debt");
  await bonds.press("Tab");
  await expect
    .poll(async () => (await characterOf(table, "Test Wren"))?.values.bonds)
    .toBe("Owes the Test Forager a debt");

  await steps.getByRole("button", { name: /Attributes/ }).click();
  await builder.getByRole("button", { name: "STR 3d6" }).click();
  await expect(chat.getByText("3d6").first()).toBeVisible({ timeout: 15_000 });
  await builder.getByRole("button", { name: "Decrease STR" }).click();
  await builder.getByRole("button", { name: "Set HP to 4" }).click();
  await expect
    .poll(async () => (await characterOf(table, "Test Wren"))?.tickers)
    .toMatchObject({ str: 17, hp: 4 });
  const gold = builder.getByLabel("Gold");
  await gold.fill("12");
  await gold.press("Enter");
  await expect.poll(async () => (await characterOf(table, "Test Wren"))?.values.gold).toBe(12);

  await steps.getByRole("button", { name: /Gear/ }).click();
  const items = builder.getByRole("group", { name: "Items" });
  await items.getByRole("button", { name: "Test Rations" }).click();
  await items.getByRole("button", { name: "Add Test Rations" }).click();

  await tools.getByRole("button", { name: "Done" }).click();
  await expect(builder).toHaveCount(0);
  await expect
    .poll(async () => {
      const character = await characterOf(table, "Test Wren");
      return { values: character?.values, tickers: character?.tickers };
    })
    .toEqual({
      values: {
        background: forager.id,
        bonds: "Owes the Test Forager a debt",
        gold: 12,
        inventory: [expect.objectContaining({ name: "Test Rations", uses: "3" })],
      },
      tickers: { str: 17, dex: 18, wil: 18, hp: 4 },
    });
});
