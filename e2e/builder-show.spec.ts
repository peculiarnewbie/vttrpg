import type { SheetLayout } from "../src/domain/sheet-layout";
import { expect, test, type Table } from "./fixtures";

/*
 * The show part: labelled formula readouts in the builder. They display
 * values from the character and never write anything — opening the builder,
 * rendering them, or clicking them for their formula changes nothing.
 */

const layout: SheetLayout = {
  system: "Test",
  name: "Showcase",
  pages: [
    {
      id: "main",
      title: "Main",
      blocks: [
        {
          id: "attrs",
          type: "stats",
          items: [
            { key: "str", label: "STR" },
            { key: "level", label: "Level" },
          ],
        },
      ],
    },
  ],
  derived: [{ key: "str_mod", label: "STR mod", expr: "floor((@str - 10) / 2)" }],
  builder: {
    steps: [
      {
        id: "readouts",
        title: "Readouts",
        parts: [
          {
            type: "show",
            items: [
              { label: "STR mod", expr: "@str_mod" },
              { label: "Double STR", expr: "@str * 2" },
              { label: "Broken", expr: "@str +" },
            ],
          },
        ],
      },
    ],
  },
};

const setUp = (table: Table) =>
  table.saveTemplate({ name: "Showcase", fields: [], stats: [], tickers: [], rolls: [], layout });

const valuesOf = async (table: Table, name: string) => {
  const response = await table.dm.api.get(`/api/worlds/${table.worldId}/characters`);
  const characters = (await response.json()) as {
    name: string;
    values: Record<string, unknown>;
  }[];
  return characters.find((character) => character.name === name)?.values;
};

test("readouts show formulas and where they come from, and write nothing", async ({ table }) => {
  const template = await setUp(table);
  await table.saveCharacter({
    name: "Ser Show",
    templateId: template.id,
    memberId: table.player.memberId,
    values: { str: 14 },
  });
  const before = await valuesOf(table, "Ser Show");
  const page = table.player.page;
  await table.open(table.player);
  const tools = page.locator("#world-tools");
  await expect(tools.getByRole("heading", { name: "Ser Show" })).toBeVisible();
  await tools.getByRole("button", { name: "Builder" }).click();

  const builder = tools.getByRole("region", { name: "Character builder" });
  const readouts = builder.getByRole("group", { name: "Readouts" });
  await expect(readouts).toBeVisible();
  await expect(readouts.getByRole("note")).toHaveCount(0);
  // floor((14 - 10) / 2) is 2; a formula that doesn't parse shows "?".
  await expect(readouts.getByRole("button", { name: "2" })).toBeVisible();
  await expect(readouts.getByRole("button", { name: "28" })).toBeVisible();
  await expect(readouts.getByRole("button", { name: "?" })).toBeVisible();

  // Clicking a value shows the formula and each value it read, with labels.
  await readouts.getByRole("button", { name: "28" }).click();
  const note = readouts.getByRole("note");
  await expect(note).toContainText("@str * 2");
  await expect(note).toContainText("STR");
  await expect(note).toContainText("14");
  await page.keyboard.press("Escape");

  // "?" names the reason.
  await readouts.getByRole("button", { name: "?" }).click();
  await expect(readouts.getByRole("note")).toContainText("Expected an expression");
  await page.keyboard.press("Escape");

  await tools.getByRole("button", { name: "Cancel" }).click();
  await expect(builder).toHaveCount(0);
  expect(await valuesOf(table, "Ser Show")).toEqual(before);
});

test("a DM adds a readout in the layout editor", async ({ table }) => {
  const template = await setUp(table);
  const page = table.dm.page;
  await page.goto(`/worlds/${table.worldId}/settings?section=templates`);
  await page.getByRole("combobox", { name: "Template" }).selectOption({ label: "Showcase" });
  const steps = page.getByRole("group", { name: "Character builder steps" });
  await steps.getByRole("button", { name: "+ Add a step" }).click();
  const step = steps.getByRole("group", { name: "Step 2" });
  await step.getByLabel("Title").fill("More");
  await step.getByRole("combobox", { name: "Add to Step 2" }).selectOption({ label: "Readouts" });
  await step.getByLabel("Step 2 part 1 readouts 1 Formula").fill("@str * 2");
  await page.getByRole("button", { name: "Save template" }).click();
  await expect
    .poll(async () => {
      const response = await table.dm.api.get(`/api/worlds/${table.worldId}/templates`);
      const templates = (await response.json()) as {
        id: string;
        layout?: SheetLayout;
      }[];
      return templates.find((item) => item.id === template.id)?.layout?.builder?.steps[1];
    })
    .toEqual({
      id: "step-2",
      title: "More",
      parts: [{ type: "show", items: [{ label: "Value", expr: "@str * 2" }] }],
    });
});
