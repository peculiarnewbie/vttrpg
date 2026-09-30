import { expect, test } from "./fixtures";
import type { SheetLayout } from "../src/domain/sheet-layout";

/*
 * Phase 1: derived values on the sheet and rolls that use them. The server
 * resolves `@refs`; the sheet only shows numbers and never writes them back.
 */
const layout: SheetLayout = {
  system: "E2E 5e",
  name: "Classic",
  derived: [
    { key: "str_mod", label: "STR mod", expr: "floor((@str - 10) / 2)" },
    { key: "prof", label: "Proficiency", expr: "ceil(@level / 4) + 1" },
  ],
  pages: [
    {
      id: "main",
      title: "Main",
      blocks: [
        {
          id: "abilities",
          type: "stats",
          items: [
            { key: "str", label: "STR" },
            { key: "str_mod", label: "STR mod", roll: "1d20 + @str_mod" },
            { key: "prof", label: "Proficiency" },
          ],
        },
        {
          id: "saves",
          type: "rolls",
          items: [{ label: "STR save", dice: "1d20 + @str_mod + @prof" }],
        },
        {
          id: "action",
          type: "trackers",
          items: [{ key: "hunt", label: "Hunt", min: 0, max: 4, start: 0, roll: "(@hunt)d6khz" }],
        },
        {
          id: "weapons",
          type: "list",
          key: "weapons",
          title: "Weapons",
          roll: "1d20 + @row.bonus + @str_mod",
          columns: [
            { key: "name", label: "Weapon", kind: "text" },
            { key: "bonus", label: "Bonus", kind: "number" },
            { key: "total", label: "To hit", kind: "derived", expr: "@row.bonus + @str_mod" },
          ],
        },
      ],
    },
  ],
};

test("derived values show on the sheet and rolls resolve them", async ({ table }) => {
  const template = await table.saveTemplate({
    name: "E2E 5e",
    fields: [],
    stats: [],
    tickers: [],
    rolls: [],
    layout,
  });
  const values = { str: 14, level: 5, weapons: [{ name: "Longsword", bonus: 1 }] };
  const character = await table.saveCharacter({
    name: "Brienne",
    templateId: template.id,
    memberId: table.player.memberId,
    values,
  });

  const { page } = table.player;
  await table.open(table.player);
  await page.getByRole("tab", { name: "Characters" }).click();
  await page.getByRole("button", { name: /Brienne/ }).click();

  const sheet = page.locator("#world-tools");
  // floor((14 - 10) / 2) = 2, ceil(5 / 4) + 1 = 3, and the row's 1 + 2.
  await expect(sheet.getByRole("button", { name: "STR mod" })).toBeVisible();
  await expect(sheet.getByText("3", { exact: true }).first()).toBeVisible();

  await sheet.getByRole("button", { name: "STR mod" }).click();
  await expect(page.getByText("(STR mod +2)").first()).toBeVisible({ timeout: 15_000 });

  await sheet.getByRole("button", { name: /STR save/ }).click();
  await expect(page.getByText("(STR mod +2, Proficiency +3)").first()).toBeVisible({
    timeout: 15_000,
  });

  await sheet.getByRole("button", { name: "Roll Longsword" }).click();
  await expect(page.getByText("(Bonus +1, STR mod +2)").first()).toBeVisible({ timeout: 15_000 });

  // Zero dots: two dice, the higher one dropped.
  await sheet.getByRole("button", { name: "Hunt" }).click();
  await expect(page.getByText("(0)d6khz").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTitle("Dropped").first()).toBeVisible();

  // The DM sees the same rolls; nothing was written to the character.
  await table.open(table.dm);
  await expect(table.dm.page.getByText("(STR mod +2)").first()).toBeVisible();
  const saved = await table.dm.api.get(`/api/worlds/${table.worldId}/characters`);
  const stored = ((await saved.json()) as { id: string; values: unknown }[]).find(
    (item) => item.id === character.id,
  );
  expect(stored?.values).toEqual(values);
});

test("a typo in a roll is reported instead of rolled", async ({ table }) => {
  const broken: SheetLayout = {
    ...layout,
    pages: [
      {
        id: "main",
        title: "Main",
        blocks: [{ id: "rolls", type: "rolls", items: [{ label: "Oops", dice: "1d20 + @wis" }] }],
      },
    ],
  };
  const template = await table.saveTemplate({
    name: "Broken",
    fields: [],
    stats: [],
    tickers: [],
    rolls: [],
    layout: broken,
  });
  await table.saveCharacter({
    name: "Typo",
    templateId: template.id,
    memberId: table.player.memberId,
    values: {},
  });
  const { page } = table.player;
  await table.open(table.player);
  await page.getByRole("tab", { name: "Characters" }).click();
  await page.getByRole("button", { name: /Typo/ }).click();
  await page.locator("#world-tools").getByRole("button", { name: /Oops/ }).click();
  await expect(page.getByText(/Unknown value @wis/)).toBeVisible();
});
