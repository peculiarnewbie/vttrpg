import type { SheetLayout } from "../src/domain/sheet-layout";
import { expect, test, type Table } from "./fixtures";

/*
 * Builder rolls with repeats and notes: a repeated roll posts one chat roll
 * with the groups kept apart, labelled "… ×N", with the note beside the
 * button. Rolls never write to the sheet.
 */

const valuesOf = async (table: Table, name: string) => {
  const response = await table.dm.api.get(`/api/worlds/${table.worldId}/characters`);
  const characters = (await response.json()) as {
    name: string;
    values: Record<string, unknown>;
  }[];
  return characters.find((character) => character.name === name)?.values;
};

const layout: SheetLayout = {
  system: "Test",
  name: "Repeats",
  pages: [
    {
      id: "main",
      title: "Main",
      blocks: [{ id: "vig", type: "stats", items: [{ key: "vig", label: "VIG" }] }],
    },
  ],
  builder: {
    steps: [
      {
        id: "scores",
        title: "Scores",
        parts: [
          {
            type: "rolls",
            items: [
              { label: "Ability scores", dice: "4d6kh3", times: 6, note: "Keep three" },
              { label: "Virtue", dice: "3d6" },
            ],
          },
        ],
      },
    ],
  },
};

test("a repeated roll posts one chat roll with its groups apart, and writes nothing", async ({
  table,
}) => {
  const template = await table.saveTemplate({
    name: "Repeats",
    fields: [],
    stats: [],
    tickers: [],
    rolls: [],
    layout,
  });
  await table.saveCharacter({
    name: "Ser Rolls",
    templateId: template.id,
    memberId: table.player.memberId,
    values: { vig: 7 },
  });
  const before = await valuesOf(table, "Ser Rolls");
  const page = table.player.page;
  await table.open(table.player);
  const tools = page.locator("#world-tools");
  await expect(tools.getByRole("heading", { name: "Ser Rolls" })).toBeVisible();
  await tools.getByRole("button", { name: "Builder" }).click();
  const builder = tools.getByRole("region", { name: "Character builder" });
  // Rendering the part writes nothing; the button shows the repeat and the note sits beside it.
  await expect(builder.getByRole("button", { name: /Ability scores/ })).toContainText("×6");
  await expect(builder.getByText("Keep three")).toBeVisible();
  expect(await valuesOf(table, "Ser Rolls")).toEqual(before);

  await builder.getByRole("button", { name: /Ability scores/ }).click();
  const chat = page.locator("#world-chat");
  await expect(chat.getByText("Ability scores ×6").first()).toBeVisible({ timeout: 15_000 });
  // One roll, six groups kept apart.
  await expect(chat.getByText("4d6kh3", { exact: true })).toHaveCount(6, { timeout: 15_000 });

  // A plain roll still posts its single group under its own label.
  await builder.getByRole("button", { name: /^Virtue/ }).click();
  await expect(chat.getByText("Virtue").first()).toBeVisible({ timeout: 15_000 });

  await tools.getByRole("button", { name: "Cancel" }).click();
  await expect(builder).toHaveCount(0);
  expect(await valuesOf(table, "Ser Rolls")).toEqual(before);
});

test("a DM adds a repeated roll with a note in the layout editor", async ({ table }) => {
  const template = await table.saveTemplate({
    name: "Repeats",
    fields: [],
    stats: [],
    tickers: [],
    rolls: [],
    layout: {
      system: "Test",
      name: "Repeats",
      pages: [{ id: "main", title: "Main", blocks: [] }],
      builder: { steps: [{ id: "s1", title: "Scores", parts: [] }] },
    },
  });
  const page = table.dm.page;
  await page.goto(`/worlds/${table.worldId}/settings?section=templates`);
  await page.getByRole("combobox", { name: "Template" }).selectOption({ label: "Repeats" });
  const steps = page.getByRole("group", { name: "Character builder steps" });
  const step = steps.getByRole("group", { name: "Step 1" });
  await step
    .getByRole("combobox", { name: "Add to Step 1" })
    .selectOption({ label: "Roll buttons" });
  await step.getByLabel(/rolls 1 Label/).fill("Ability scores");
  await step.getByLabel(/rolls 1 Dice/).fill("4d6kh3");
  await step.getByLabel(/rolls 1 ×/).fill("3");
  await step.getByLabel(/rolls 1 Note/).fill("Keep three");
  await page.getByRole("button", { name: "Save template" }).click();
  await expect
    .poll(async () => {
      const response = await table.dm.api.get(`/api/worlds/${table.worldId}/templates`);
      const templates = (await response.json()) as { id: string; layout?: SheetLayout }[];
      return templates.find((item) => item.id === template.id)?.layout?.builder?.steps[0].parts[0];
    })
    .toEqual({
      type: "rolls",
      items: [{ label: "Ability scores", dice: "4d6kh3", times: 3, note: "Keep three" }],
    });
});
