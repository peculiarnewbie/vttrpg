import type { SheetLayout } from "../src/domain/sheet-layout";
import { expect, test, type Table } from "./fixtures";

/*
 * The budget tally: a live "Spent 7 of 10 · 3 left" over the character's
 * values. It only reads — opening it or rendering it never writes — and it
 * never blocks anything when the tally goes over.
 */

const layout: SheetLayout = {
  system: "Test",
  name: "Budget",
  pages: [
    {
      id: "main",
      title: "Main",
      blocks: [
        {
          id: "scores",
          type: "stats",
          items: [
            { key: "str", label: "STR" },
            { key: "dex", label: "DEX" },
          ],
        },
      ],
    },
  ],
  builder: {
    steps: [
      {
        id: "spend",
        title: "Spend",
        parts: [
          {
            type: "budget",
            label: "Points",
            spent: "@str + @dex",
            total: "10",
            items: [{ key: "str", cap: 5 }, { key: "dex" }],
          },
          { type: "blocks", blocks: ["scores"] },
        ],
      },
    ],
  },
};

const valuesOf = async (table: Table, name: string) => {
  const response = await table.dm.api.get(`/api/worlds/${table.worldId}/characters`);
  const characters = (await response.json()) as {
    name: string;
    values: Record<string, unknown>;
  }[];
  return characters.find((character) => character.name === name)?.values;
};

test("a budget tally follows the sheet live, writes nothing, and never blocks", async ({
  table,
}) => {
  const template = await table.saveTemplate({
    name: "Budget",
    fields: [],
    stats: [],
    tickers: [],
    rolls: [],
    layout,
  });
  await table.saveCharacter({
    name: "Pincher",
    templateId: template.id,
    memberId: table.player.memberId,
    values: { str: 3, dex: 4 },
  });
  const before = await valuesOf(table, "Pincher");
  const page = table.player.page;
  await table.open(table.player);
  const tools = page.locator("#world-tools");
  await expect(tools.getByRole("heading", { name: "Pincher" })).toBeVisible();
  await tools.getByRole("button", { name: "Builder" }).click();

  // Merely opening the builder renders the tally but writes nothing.
  const builder = tools.getByRole("region", { name: "Character builder" });
  const tally = builder.getByRole("group", { name: "Points" });
  await expect(tally.getByText("Spent 7 of 10")).toBeVisible();
  await expect(tally.getByText("3 left")).toBeVisible();
  await expect(tally.getByText("STR")).toBeVisible();
  await expect(tally.getByText("max 5")).toBeVisible();
  expect(await valuesOf(table, "Pincher")).toEqual(before);

  // Editing the scores through the blocks part moves the tally: exact, then over.
  const str = builder.getByLabel("STR");
  await str.fill("6");
  await str.press("Enter");
  await expect(tally.getByText("Spent 10 of 10")).toBeVisible();
  await expect(tally.getByText("0 left")).toBeVisible();
  const dex = builder.getByLabel("DEX");
  await dex.fill("6");
  await dex.press("Enter");
  await expect(tally.getByText("Spent 12 of 10")).toBeVisible();
  await expect(tally.getByText("2 over")).toBeVisible();

  // Only the explicit edits reached the sheet.
  await tools.getByRole("button", { name: "Done" }).click();
  await expect(builder).toHaveCount(0);
  await expect.poll(() => valuesOf(table, "Pincher")).toEqual({ str: 6, dex: 6 });
});

test("a DM adds a budget tally in the layout editor", async ({ table }) => {
  const template = await table.saveTemplate({
    name: "Budget",
    fields: [],
    stats: [],
    tickers: [],
    rolls: [],
    layout: {
      ...layout,
      builder: { steps: [{ id: "step-1", title: "First", parts: [] }] },
    },
  });
  const page = table.dm.page;
  await page.goto(`/worlds/${table.worldId}/settings?section=templates`);
  await page.getByRole("combobox", { name: "Template" }).selectOption({ label: "Budget" });
  const steps = page.getByRole("group", { name: "Character builder steps" });
  const step = steps.getByRole("group", { name: "Step 1" });
  await step
    .getByRole("combobox", { name: "Add to Step 1" })
    .selectOption({ label: "Budget tally" });
  await step.getByLabel("Label", { exact: true }).fill("Points");
  await step.getByLabel("Step 1 part 1 spent").fill("@str + @dex");
  await step.getByLabel("Step 1 part 1 total").fill("10");
  await step.getByRole("button", { name: "+ Add" }).click();
  await step.getByLabel("Step 1 part 1 items 1 Value").fill("str");
  await step.getByLabel("Step 1 part 1 items 1 Max").fill("5");
  await page.getByRole("button", { name: "Save template" }).click();
  await expect
    .poll(async () => {
      const response = await table.dm.api.get(`/api/worlds/${table.worldId}/templates`);
      const templates = (await response.json()) as {
        id: string;
        layout?: SheetLayout;
      }[];
      return templates.find((item) => item.id === template.id)?.layout?.builder?.steps[0].parts[0];
    })
    .toEqual({
      type: "budget",
      label: "Points",
      spent: "@str + @dex",
      total: "10",
      items: [{ key: "str", cap: 5 }],
    });
});
