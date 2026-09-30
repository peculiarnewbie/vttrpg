import type { Page } from "@playwright/test";
import type { CompendiumEntry, EntryType, SaveEntryInput } from "../src/domain/compendium";
import type { SheetLayout } from "../src/domain/sheet-layout";
import { expect, test, type Table } from "./fixtures";

/*
 * Phase 3: sheets and entries that Blades, Starforged, Cairn and 5e need —
 * shared sheets, oracle tables, progress tracks, bulky slots, progression.
 * Everything shows content and makes rolls; nothing decides outcomes.
 */

const putType = async (table: Table, type: EntryType) => {
  const response = await table.dm.api.put(
    `/api/worlds/${table.worldId}/compendium/types/${type.id}`,
    { data: type },
  );
  expect(response.ok(), await response.text()).toBe(true);
};

const saveEntry = async (table: Table, input: SaveEntryInput) => {
  const response = await table.dm.api.post(`/api/worlds/${table.worldId}/compendium/entries`, {
    data: input,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as CompendiumEntry;
};

const template = (table: Table, name: string, layout: SheetLayout) =>
  table.saveTemplate({ name, fields: [], stats: [], tickers: [], rolls: [], layout });

const openSheet = async (page: Page, name: string) => {
  await page.getByRole("tab", { name: "Characters" }).click();
  const tools = page.locator("#world-tools");
  await tools
    .getByRole("heading", { name })
    .or(tools.getByRole("button", { name: new RegExp(name) }))
    .first()
    .click();
  await expect(tools.getByRole("heading", { name })).toBeVisible();
  return tools;
};

test("a shared crew sheet is everyone's until the DM locks it", async ({ table }) => {
  const crew = await template(table, "Crew", {
    subject: "shared",
    system: "Blades",
    name: "Crew",
    pages: [
      {
        id: "crew",
        title: "Crew",
        blocks: [
          {
            id: "heat",
            type: "trackers",
            items: [{ key: "heat", label: "Heat", min: 0, max: 9, start: 0 }],
          },
        ],
      },
    ],
  });
  await table.saveCharacter({
    name: "The Lampblacks",
    templateId: crew.id,
    memberId: table.dm.memberId,
    values: {},
    scope: "world",
  });

  const { page } = table.player;
  await table.open(table.player);
  const sheet = await openSheet(page, "The Lampblacks");
  await sheet.getByRole("button", { name: "Set Heat to 2" }).click();
  await expect(sheet.getByRole("group", { name: "Heat" })).toBeVisible();
  await expect
    .poll(async () => {
      const response = await table.dm.api.get(`/api/worlds/${table.worldId}/characters`);
      const [character] = (await response.json()) as { tickers: Record<string, number> }[];
      return character?.tickers.heat;
    })
    .toBe(2);

  await table.open(table.dm);
  const dmSheet = await openSheet(table.dm.page, "The Lampblacks");
  await dmSheet.getByRole("button", { name: "Lock" }).click();
  await expect(dmSheet.getByRole("button", { name: "Unlock" })).toBeVisible();

  // Locked: the player's sheet is read-only.
  await expect(sheet.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Set Heat to 5" }).click();
  await table.dm.page.waitForTimeout(500);
  const response = await table.dm.api.get(`/api/worlds/${table.worldId}/characters`);
  const [character] = (await response.json()) as { tickers: Record<string, number> }[];
  expect(character.tickers.heat).toBe(2);
});

test("an oracle roll shows the row the dice landed on", async ({ table }) => {
  await putType(table, {
    id: "oracle",
    name: "Oracle",
    fields: [{ key: "table", label: "Table", kind: "oracle", dice: "1d6" }],
  });
  await saveEntry(table, {
    typeId: "oracle",
    name: "Weather",
    tags: [],
    body: "",
    visibility: "public",
    fields: {
      table: [
        { min: 1, max: 2, text: "Clear skies" },
        { min: 3, max: 4, text: "Drizzle" },
        { min: 5, max: 6, text: "A storm rolls in" },
      ],
    },
  });

  const { page } = table.player;
  await table.open(table.player);
  await page.getByRole("tab", { name: "Compendium" }).click();
  const tools = page.locator("#world-tools");
  await tools.getByRole("listitem").filter({ hasText: "Weather" }).click();
  await tools.getByRole("button", { name: "Roll 1d6" }).click();
  const chat = page.locator("#world-chat");
  await expect(chat.getByText("Weather · Table")).toBeVisible();
  await expect(chat.getByText(/Clear skies|Drizzle|A storm rolls in/)).toBeVisible();
});

test("progress tracks mark ticks and bulky items take two slots", async ({ table }) => {
  const layout: SheetLayout = {
    system: "Starforged + Cairn",
    name: "Kit",
    pages: [
      {
        id: "main",
        title: "Main",
        blocks: [
          {
            id: "vows",
            type: "trackers",
            items: [{ key: "vow", label: "Vow", min: 0, max: 40, start: 0, display: "progress" }],
          },
          {
            id: "gear",
            type: "list",
            key: "gear",
            title: "Inventory",
            variant: "slots",
            slots: 10,
            slotSize: "size",
            columns: [
              { key: "name", label: "Item", kind: "text" },
              { key: "size", label: "Slots", kind: "number" },
            ],
          },
        ],
      },
    ],
  };
  const kit = await template(table, "Kit", layout);
  await table.saveCharacter({
    name: "Ash",
    templateId: kit.id,
    memberId: table.player.memberId,
    values: { gear: [{ name: "Rope" }, { name: "Plate armour", size: 2 }] },
  });

  const { page } = table.player;
  await table.open(table.player);
  const sheet = await openSheet(page, "Ash");
  await expect(sheet.getByText("3 / 10 slots")).toBeVisible();
  await expect(sheet.getByText("2–3")).toBeVisible();

  const vow = sheet.getByRole("group", { name: /Vow progress/ });
  await expect(vow).toHaveAccessibleName("Vow progress, 0 of 10");
  await sheet.getByRole("button", { name: "Fill Vow to box 3" }).click();
  await expect(vow).toHaveAccessibleName("Vow progress, 3 of 10");
  await sheet.getByRole("button", { name: "Increase Vow" }).click();
  await expect(vow).toHaveAccessibleName("Vow progress, 3 of 10");
});

test("a class shows its progression up to the character's level", async ({ table }) => {
  await putType(table, {
    id: "class",
    name: "Class",
    fields: [
      {
        key: "levels",
        label: "Features",
        kind: "progression",
        columns: [{ key: "features", label: "Features", kind: "text" }],
      },
    ],
  });
  const barbarian = await saveEntry(table, {
    typeId: "class",
    name: "Barbarian",
    tags: [],
    body: "",
    visibility: "public",
    fields: {
      levels: [
        { level: 1, features: "Rage" },
        { level: 2, features: "Reckless Attack" },
        { level: 3, features: "Primal Path" },
      ],
    },
  });
  const sheetTemplate = await template(table, "Adventurer", {
    system: "5e",
    name: "Adventurer",
    pages: [
      {
        id: "main",
        title: "Main",
        blocks: [
          { id: "lvl", type: "fields", columns: 1, items: [{ key: "level", label: "Level" }] },
          {
            id: "class",
            type: "entry",
            key: "class",
            entryType: "class",
            variant: "progression",
            progression: { field: "levels", level: "level" },
          },
        ],
      },
    ],
  });
  await table.saveCharacter({
    name: "Grog",
    templateId: sheetTemplate.id,
    memberId: table.player.memberId,
    values: { class: barbarian.id, level: 2 },
  });

  const { page } = table.player;
  await table.open(table.player);
  const sheet = await openSheet(page, "Grog");
  const features = sheet.getByRole("table", { name: "Features" });
  await expect(features).toContainText("Rage");
  await expect(features).toContainText("Reckless Attack");
  await expect(features).not.toContainText("Primal Path");
});
