import type { SheetTemplate } from "../src/domain/schemas";
import { expect, test, type Table } from "./fixtures";

/*
 * Phase 6: the systems the app ships. A DM starts a world from one (its sheets,
 * and its library or entry types); its sheets roll the way the game does —
 * nothing evaluates the result.
 */

test("a DM sets up Starforged and its character rolls action against challenge dice", async ({
  table,
}) => {
  const page = table.dm.page;
  await page.goto(`/worlds/${table.worldId}/settings?section=system`);
  const card = page.getByRole("article", { name: "Ironsworn: Starforged" });
  await card.getByRole("button", { name: "Use this system" }).click();
  await expect(page.getByRole("status")).toContainText("Ironsworn: Starforged — Character");

  const templates = (await (
    await table.dm.api.get(`/api/worlds/${table.worldId}/templates`)
  ).json()) as SheetTemplate[];
  const character = templates.find(
    (template) => template.name === "Ironsworn: Starforged — Character",
  );
  expect(character).toBeDefined();
  expect(templates.some((template) => template.name === "Ironsworn: Starforged — Starship")).toBe(
    true,
  );
  // Setting up twice adds nothing new.
  await card.getByRole("button", { name: "Use this system" }).click();
  await expect(page.getByRole("status")).toContainText("sheets were already here");

  await table.saveCharacter({
    name: "Kira",
    templateId: character!.id,
    memberId: table.player.memberId,
    values: { edge: 2, heart: 1, iron: 1, shadow: 3, wits: 2 },
  });
  const player = table.player.page;
  await table.open(table.player);
  const sheet = player.locator("#world-tools");
  await expect(sheet.getByRole("heading", { name: "Kira" })).toBeVisible();
  await sheet.getByRole("button", { name: "Edge", exact: true }).click();
  // Three groups, never summed: the action die (+2 edge) and two challenge dice.
  const chat = player.locator("#world-chat");
  await expect(chat.getByText("(Edge +2)").first()).toBeVisible({ timeout: 15_000 });
  // Both challenge dice, each its own group (hidden measuring copies aside).
  await expect(chat.getByText("1d10", { exact: true }).first()).toBeVisible();
  await expect(chat.getByText("1d10", { exact: true }).nth(1)).toBeVisible();
});

test("the licences page credits every library's text", async ({ table }) => {
  const page = table.player.page;
  await page.goto("/legal");
  await expect(page.getByRole("heading", { name: "Licences and attribution" })).toBeVisible();
  for (const name of [
    "System Reference Document 5.2",
    "Ironsworn: Starforged",
    "Cairn Second Edition",
    "Blades in the Dark SRD",
  ])
    await expect(page.getByRole("region", { name })).toBeVisible();
  await expect(page.getByRole("region", { name: "Cairn Second Edition" })).toContainText(
    "ShareAlike",
  );
  await expect(page.getByText(/none of these publishers made, sponsors or endorses/)).toBeVisible();
});

/*
 * With the first-party libraries published to local dev state
 * (`pnpm bundles:build && pnpm corpus:publish <source> --local --yes`), each
 * system's text is in play. Without them these tests skip.
 */
const published = async (table: Table, sourceId: string) => {
  const response = await table.dm.api.get(`/api/worlds/${table.worldId}/libraries`);
  if (!response.ok()) return false;
  const libraries = (await response.json()) as { available: { id: string }[] };
  return libraries.available.some((source) => source.id === sourceId);
};

const setUp = async (table: Table, system: string) => {
  const page = table.dm.page;
  await page.goto(`/worlds/${table.worldId}/settings?section=system`);
  await page
    .getByRole("article", { name: system })
    .getByRole("button", { name: "Use this system" })
    .click();
  await expect(page.getByRole("status")).toContainText("Enabled the", { timeout: 30_000 });
  const templates = (await (
    await table.dm.api.get(`/api/worlds/${table.worldId}/templates`)
  ).json()) as SheetTemplate[];
  return templates;
};

test("Fifth Edition: rolls from derived modifiers, a spell from the SRD, features up to level", async ({
  table,
}) => {
  test.skip(!(await published(table, "srd52")), "SRD 5.2 library not published locally");
  const templates = await setUp(table, "Fifth Edition (SRD 5.2)");
  const template = templates.find((item) => item.name === "Fifth Edition (SRD 5.2) — Character")!;
  const character = await table.saveCharacter({
    name: "Elminster",
    templateId: template.id,
    memberId: table.player.memberId,
    values: {
      str: 8,
      dex: 14,
      con: 12,
      int: 17,
      wis: 12,
      cha: 10,
      level: 3,
      class: "srd52/class/wizard",
    },
  });
  const page = table.player.page;
  await table.open(table.player);
  const sheet = page.locator("#world-tools");
  await sheet.getByRole("button", { name: "INT mod", exact: true }).click();
  await expect(page.locator("#world-chat").getByText("(INT mod +3)").first()).toBeVisible({
    timeout: 15_000,
  });

  await sheet
    .getByRole("tab", { name: "Spells" })
    .or(sheet.getByRole("button", { name: "Spells", exact: true }))
    .first()
    .click();
  await sheet.getByRole("button", { name: "+ From compendium" }).click();
  await sheet.getByPlaceholder("Search spells…").fill("Fireball");
  await sheet
    .getByRole("option", { name: /^Fireball/ })
    .first()
    .click();
  await expect
    .poll(async () => {
      const characters = (await (
        await table.dm.api.get(`/api/worlds/${table.worldId}/characters`)
      ).json()) as { id: string; values: Record<string, unknown> }[];
      return characters.find((item) => item.id === character.id)?.values.spells;
    })
    .toEqual([
      expect.objectContaining({
        name: "Fireball",
        level: 3,
        _entry: "srd52/spell/fireball",
        _rev: expect.any(Number),
      }),
    ]);

  await sheet
    .getByRole("tab", { name: "Features & Gear" })
    .or(sheet.getByRole("button", { name: "Features & Gear" }))
    .first()
    .click();
  const features = sheet.getByRole("table", { name: "Class Features" });
  await expect(features).toContainText("Arcane Recovery");
  await expect(features).toContainText("Scholar");
  await expect(features).not.toContainText("Ability Score Improvement");

  // Words that only appear in an entry's text find it.
  await page.goto(`/worlds/${table.worldId}/compendium`);
  await page.getByRole("searchbox", { name: "Search the compendium" }).fill("guano");
  await expect(
    page.getByRole("list", { name: "Entries" }).getByRole("button", { name: /^Fireball/ }),
  ).toBeVisible({ timeout: 15_000 });
});

test("Starforged: an oracle roll shows the row the d100 landed on", async ({ table }) => {
  test.skip(!(await published(table, "starforged")), "Starforged library not published locally");
  await setUp(table, "Ironsworn: Starforged");
  const page = table.player.page;
  await table.open(table.player);
  await page.goto(`/worlds/${table.worldId}/compendium?type=oracle&q=Action`);
  const browser = page.getByRole("region", { name: "Compendium browser" });
  await browser
    .getByRole("list", { name: "Entries" })
    .getByRole("button", { name: /^Action/ })
    .first()
    .click();
  await browser.getByRole("button", { name: "Roll 1d100" }).click();
  const chat = page.locator("#world-chat");
  await expect(chat.getByText("Action · Table").first()).toBeVisible({ timeout: 15_000 });
});

test("Cairn: a background's table rolls the die its rows span", async ({ table }) => {
  test.skip(!(await published(table, "cairn2e")), "Cairn library not published locally");
  await setUp(table, "Cairn (2nd edition)");
  const page = table.player.page;
  await table.open(table.player);
  await page.goto(
    `/worlds/${table.worldId}/compendium?entry=${encodeURIComponent("cairn2e/background/aurifex")}`,
  );
  const preview = page.getByRole("complementary", { name: "Preview" });
  await preview.getByRole("button", { name: "What went horribly wrong?" }).click();
  await preview.getByRole("button", { name: "Roll 1d6" }).click();
  await expect(
    page.locator("#world-chat").getByText("What went horribly wrong? · Table").first(),
  ).toBeVisible({
    timeout: 15_000,
  });
});
