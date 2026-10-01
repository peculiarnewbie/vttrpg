import type { SheetTemplate } from "../src/domain/schemas";
import { expect, test } from "./fixtures";

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
  await expect(chat.getByText("1d10", { exact: true })).toHaveCount(2);
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
