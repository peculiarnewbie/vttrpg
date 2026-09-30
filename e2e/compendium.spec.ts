import type { Page } from "@playwright/test";
import type { CompendiumEntry, EntryType, SaveEntryInput } from "../src/domain/compendium";
import type { SheetLayout } from "../src/domain/sheet-layout";
import { expect, test, type Table } from "./fixtures";

/*
 * Phase 2: the compendium as an index synced by revision. Links carry ids, so
 * they survive renames; copied rows remember their revision and offer updates;
 * players never see DM-only entries until they're revealed.
 */

const weapon: EntryType = {
  id: "weapon",
  name: "Weapon",
  plural: "Weapons",
  fields: [{ key: "damage", label: "Damage", kind: "dice" }],
};

const setup = async (table: Table) => {
  const put = await table.dm.api.put(`/api/worlds/${table.worldId}/compendium/types/weapon`, {
    data: weapon,
  });
  expect(put.ok()).toBe(true);
};

const saveEntry = async (table: Table, input: SaveEntryInput) => {
  const response = await table.dm.api.post(`/api/worlds/${table.worldId}/compendium/entries`, {
    data: input,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as CompendiumEntry;
};

const longsword = (id?: string): SaveEntryInput => ({
  ...(id ? { id } : {}),
  typeId: "weapon",
  name: "Longsword",
  tags: ["martial"],
  body: "A knight's blade.",
  fields: { damage: "d8" },
  visibility: "public",
});

const layout: SheetLayout = {
  system: "E2E",
  name: "Arms",
  pages: [
    {
      id: "main",
      title: "Main",
      blocks: [
        {
          id: "weapons",
          type: "list",
          key: "weapons",
          title: "Weapons",
          source: { entryType: "weapon" },
          columns: [
            { key: "name", label: "Weapon", kind: "text" },
            { key: "damage", label: "Damage", kind: "dice" },
          ],
        },
      ],
    },
  ],
};

const openSheet = async (page: Page, name: string) => {
  await page.getByRole("tab", { name: "Characters" }).click();
  const tools = page.locator("#world-tools");
  await tools
    .getByRole("heading", { name })
    .or(tools.getByRole("button", { name: new RegExp(name) }))
    .first()
    .click();
  await expect(tools.getByRole("heading", { name })).toBeVisible();
};

test("a link picked from suggestions keeps working after the entry is renamed", async ({
  table,
}) => {
  await setup(table);
  const entry = await saveEntry(table, longsword());
  expect(entry.id).toBe("world/weapon/longsword");

  const { page } = table.player;
  await table.open(table.player);
  const composer = page.getByPlaceholder(/Speak, describe/);
  await composer.fill("I draw my [[Long");
  await composer.press("End");
  await page.keyboard.type("s");
  await expect(page.getByRole("option", { name: /Longsword/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(composer).toHaveValue("I draw my [[ref:world/weapon/longsword|Longsword]]");
  await page.keyboard.press("Enter");

  const chat = page.locator("#world-chat");
  await expect(chat.getByRole("button", { name: "Longsword" })).toBeVisible();

  await saveEntry(table, { ...longsword(entry.id), name: "Oathkeeper" });
  await expect(chat.getByRole("button", { name: "Oathkeeper" })).toBeVisible();
  await chat.getByRole("button", { name: "Oathkeeper" }).click();
  await expect(page.getByRole("dialog").getByText("A knight's blade.")).toBeVisible();
});

test("a copied row offers the entry's changes and applies them only when asked", async ({
  table,
}) => {
  await setup(table);
  const entry = await saveEntry(table, longsword());
  const template = await table.saveTemplate({
    name: "Arms",
    fields: [],
    stats: [],
    tickers: [],
    rolls: [],
    layout,
  });
  await table.saveCharacter({
    name: "Gawain",
    templateId: template.id,
    memberId: table.player.memberId,
    values: {},
  });

  const { page } = table.player;
  await table.open(table.player);
  await openSheet(page, "Gawain");
  const sheet = page.locator("#world-tools");
  await sheet.getByRole("button", { name: "+ From compendium" }).click();
  await sheet.getByRole("option", { name: /Longsword/ }).click();
  await expect(sheet.getByRole("button", { name: "Longsword" })).toBeVisible();
  await expect(sheet.getByText("d8")).toBeVisible();

  await saveEntry(table, { ...longsword(entry.id), fields: { damage: "d10" } });
  const review = sheet.getByRole("button", { name: "Review changes to Longsword" });
  await expect(review).toBeVisible();
  await review.click();
  const dialog = sheet.getByRole("dialog", { name: "Changes to Longsword" });
  await expect(dialog).toContainText("Damage");
  await expect(dialog.locator("del")).toHaveText("d8");
  await expect(dialog.locator("ins")).toHaveText("d10");
  await dialog.getByRole("button", { name: "Update the row" }).click();
  await expect(sheet.getByText("d10")).toBeVisible();
  await expect(review).toHaveCount(0);
});

test("players find DM-only entries only once they're revealed", async ({ table }) => {
  await setup(table);
  const secret = await saveEntry(table, {
    ...longsword(),
    name: "Vorpal Blade",
    body: "Snicker-snack.",
    visibility: "dm",
  });

  const { page } = table.player;
  await table.open(table.player);
  await page.getByRole("tab", { name: "Compendium" }).click();
  const tools = page.locator("#world-tools");
  const search = tools.getByRole("searchbox", { name: "Search the compendium" });
  await search.fill("snicker");
  await expect(
    tools.getByText("No entries match.").or(tools.getByText(/Nothing in/)),
  ).toBeVisible();

  await saveEntry(table, {
    ...longsword(secret.id),
    name: "Vorpal Blade",
    body: "Snicker-snack.",
    visibility: "public",
  });
  // Text matches come from the server; names from the synced index.
  await search.fill("snicker-");
  await expect(tools.getByRole("listitem").filter({ hasText: "Vorpal Blade" })).toBeVisible();
  await search.fill("vorpal");
  await expect(tools.getByRole("listitem").filter({ hasText: "Vorpal Blade" })).toBeVisible();
});
