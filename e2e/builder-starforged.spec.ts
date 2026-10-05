import type { CompendiumEntry, SaveEntryInput } from "../src/domain/compendium";
import type { SheetTemplate } from "../src/domain/schemas";
import { expect, test, type Table } from "./fixtures";

/*
 * The Starforged character builder: paths, stats, a vow and a name, then a
 * last look. Only what the player types, picks or adds reaches the sheet;
 * name-oracle buttons appear once the Starforged library is published, and
 * rolls go to chat like any roll.
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
    .getByRole("article", { name: "Ironsworn: Starforged" })
    .getByRole("button", { name: "Use this system" })
    .click();
  await expect(page.getByRole("status")).toContainText("Ironsworn: Starforged — Character", {
    timeout: 30_000,
  });
  await saveEntry(table, {
    typeId: "asset",
    name: "Test Path Nova",
    tags: [],
    body: "",
    fields: {
      category: "Path",
      abilities: [{ enabled: true, text: "Test ability nova" }],
    },
    visibility: "public",
  });
  await saveEntry(table, {
    typeId: "asset",
    name: "Test Path Quill",
    tags: [],
    body: "",
    fields: {
      category: "Path",
      abilities: [{ enabled: true, text: "Test ability quill" }],
    },
    visibility: "public",
  });
  const templates = (await (
    await table.dm.api.get(`/api/worlds/${table.worldId}/templates`)
  ).json()) as SheetTemplate[];
  return templates.find((item) => item.name === "Ironsworn: Starforged — Character")!;
};

const valuesOf = async (table: Table, name: string) => {
  const response = await table.dm.api.get(`/api/worlds/${table.worldId}/characters`);
  const characters = (await response.json()) as {
    name: string;
    values: Record<string, unknown>;
  }[];
  return characters.find((character) => character.name === name)?.values;
};

const buildNew = async (table: Table, name: string) => {
  const page = table.player.page;
  await table.open(table.player);
  await page.getByRole("tab", { name: "Characters" }).click();
  const tools = page.locator("#world-tools");
  await tools.getByRole("button", { name: "New character" }).click();
  const dialog = page.getByRole("dialog", { name: "New character" });
  await dialog.getByPlaceholder("Character name").fill(name);
  await dialog
    .getByRole("combobox")
    .first()
    .selectOption({ label: "Ironsworn: Starforged — Character" });
  await dialog.getByRole("button", { name: "Create and open builder" }).click();
  return tools.getByRole("region", { name: "Character builder" });
};

test("a player builds a Starforged character; only picks and typed values reach the sheet", async ({
  table,
}) => {
  await setUp(table);
  const page = table.player.page;
  const builder = await buildNew(table, "Test Forgefinder");
  await expect(builder).toBeVisible();

  const committed = async (partial: Record<string, unknown>) =>
    await expect
      .poll(() => valuesOf(table, "Test Forgefinder"), { timeout: 15_000 })
      .toMatchObject(partial);

  const fill = async (label: string, value: string | number) => {
    const input = builder.getByLabel(label, { exact: true });
    await input.fill(String(value));
    await input.press("Enter");
  };

  const paths = builder.getByRole("group", { name: "Assets" });
  await expect(paths.getByText("Picked 0 of 3")).toBeVisible();
  await paths.getByRole("button", { name: "Test Path Nova" }).click();
  await paths.getByRole("button", { name: "Add Test Path Nova" }).click();
  await paths.getByRole("button", { name: "Test Path Quill" }).click();
  await paths.getByRole("button", { name: "Add Test Path Quill" }).click();
  await committed({ assets: [{ name: "Test Path Nova" }, { name: "Test Path Quill" }] });

  await builder
    .getByRole("navigation", { name: "Builder steps" })
    .getByRole("button", { name: /Stats/ })
    .click();
  // Pick a number, then a stat; a used number dims but can still be placed again.
  const stats = builder.getByRole("group", { name: "Stats" });
  for (const [label, value] of [
    ["Edge", 3],
    ["Heart", 2],
    ["Iron", 1],
    ["Shadow", 2],
    ["Wits", 1],
  ] as const) {
    await stats
      .getByRole("button", { name: `Place ${value}` })
      .first()
      .click();
    await stats.getByRole("button", { name: `${label}: —` }).click();
    await expect(stats.getByRole("button", { name: `${label}: ${value}` })).toBeVisible();
  }

  await builder.getByRole("button", { name: "Next →" }).click();
  await fill("Callsign", "Test Nova");
  await builder.getByRole("button", { name: "+ Add vows" }).click();
  await fill("Vows row 1 Vow", "Test vow");
  await builder.getByLabel("Vows row 1 Rank").selectOption("Dangerous");
  await committed({ vows: [{ name: "Test vow", rank: "Dangerous" }] });

  // The library's name oracles aren't published here, so this step has no table buttons.
  await builder.getByRole("button", { name: "Next →" }).click();
  const meters = builder.getByRole("button", { name: "Health", exact: true });
  await meters.click();
  const chat = page.locator("#world-chat");
  await expect(chat.getByText("Health").first()).toBeVisible({ timeout: 15_000 });

  await page.locator("#world-tools").getByRole("button", { name: "Done" }).click();
  await expect(builder).toHaveCount(0);
  await expect
    .poll(() => valuesOf(table, "Test Forgefinder"))
    .toEqual({
      assets: [
        expect.objectContaining({ name: "Test Path Nova" }),
        expect.objectContaining({ name: "Test Path Quill" }),
      ],
      edge: 3,
      heart: 2,
      iron: 1,
      shadow: 2,
      wits: 1,
      callsign: "Test Nova",
      vows: [expect.objectContaining({ name: "Test vow", rank: "Dangerous" })],
    });
});

test("opening the builder on a finished character and rolling changes nothing", async ({
  table,
}) => {
  const template = await setUp(table);
  await table.saveCharacter({
    name: "Test Done",
    templateId: template.id,
    memberId: table.player.memberId,
    values: { edge: 3, callsign: "Test Done" },
  });
  const before = await valuesOf(table, "Test Done");
  const page = table.player.page;
  await table.open(table.player);
  const tools = page.locator("#world-tools");
  await expect(tools.getByRole("heading", { name: "Test Done" })).toBeVisible();
  await tools.getByRole("button", { name: "Builder" }).click();
  const builder = tools.getByRole("region", { name: "Character builder" });
  await builder
    .getByRole("navigation", { name: "Builder steps" })
    .getByRole("button", { name: /Review/ })
    .click();
  await builder.getByRole("button", { name: "Health", exact: true }).click();
  await expect(page.locator("#world-chat").getByText("Health").first()).toBeVisible({
    timeout: 15_000,
  });
  await tools.getByRole("button", { name: "Cancel" }).click();
  await expect(builder).toHaveCount(0);
  expect(await valuesOf(table, "Test Done")).toEqual(before);
});
