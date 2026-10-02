import type { SheetLayout } from "../src/domain/sheet-layout";
import { expect, test, type Table } from "./fixtures";

/*
 * The builder's text part: the DM's own longer guidance, rendered like a
 * note. It never writes to the character — its `[[r:…]]` rolls go to chat.
 */

const layout: SheetLayout = {
  system: "Test",
  name: "Oath",
  pages: [
    {
      id: "main",
      title: "Main",
      blocks: [{ id: "virtues", type: "stats", items: [{ key: "vig", label: "VIG" }] }],
    },
  ],
  builder: {
    steps: [
      {
        id: "oath",
        title: "Oath",
        parts: [
          {
            type: "text",
            markdown: "Say what your knight believes.\n\nRoll [[r:3d6|Virtue]] and write it in.",
          },
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

test("guidance renders like a note; its roll goes to chat and nothing reaches the sheet", async ({
  table,
}) => {
  const template = await table.saveTemplate({
    name: "Oath",
    fields: [],
    stats: [],
    tickers: [],
    rolls: [],
    layout,
  });
  await table.saveCharacter({
    name: "Ser Oath",
    templateId: template.id,
    memberId: table.player.memberId,
    values: { vig: 5 },
  });
  const before = await valuesOf(table, "Ser Oath");
  const page = table.player.page;
  await table.open(table.player);
  const tools = page.locator("#world-tools");
  await expect(tools.getByRole("heading", { name: "Ser Oath" })).toBeVisible();
  await tools.getByRole("button", { name: "Builder" }).click();
  const builder = tools.getByRole("region", { name: "Character builder" });
  // Merely opening and rendering writes nothing.
  const guidance = builder.getByRole("group", { name: "Guidance" });
  await expect(guidance).toContainText("Say what your knight believes.");
  expect(await valuesOf(table, "Ser Oath")).toEqual(before);
  // The inline roll posts to chat, like any roll — never to the sheet.
  await guidance.getByRole("button", { name: "Virtue" }).click();
  await expect(page.locator("#world-chat").getByText("3d6").first()).toBeVisible({
    timeout: 15_000,
  });
  await tools.getByRole("button", { name: "Cancel" }).click();
  await expect(builder).toHaveCount(0);
  expect(await valuesOf(table, "Ser Oath")).toEqual(before);
});

test("a DM adds guidance text in the layout editor", async ({ table }) => {
  const template = await table.saveTemplate({
    name: "Oath",
    fields: [],
    stats: [],
    tickers: [],
    rolls: [],
    layout: {
      system: "Test",
      name: "Oath",
      pages: [
        {
          id: "main",
          title: "Main",
          blocks: [{ id: "virtues", type: "stats", items: [{ key: "vig", label: "VIG" }] }],
        },
      ],
    },
  });
  const page = table.dm.page;
  await page.goto(`/worlds/${table.worldId}/settings?section=templates`);
  await page.getByRole("combobox", { name: "Template" }).selectOption({ label: "Oath" });
  const steps = page.getByRole("group", { name: "Character builder steps" });
  await steps.getByRole("button", { name: "+ Add a step" }).click();
  const step = steps.getByRole("group", { name: "Step 1" });
  await step.getByLabel("Title").fill("Oath");
  await step
    .getByRole("combobox", { name: "Add to Step 1" })
    .selectOption({ label: "Guidance text" });
  await step.getByLabel("Guidance").fill("Say what your knight believes.");
  await page.getByRole("button", { name: "Save template" }).click();
  await expect
    .poll(async () => {
      const response = await table.dm.api.get(`/api/worlds/${table.worldId}/templates`);
      const templates = (await response.json()) as {
        id: string;
        layout?: SheetLayout;
      }[];
      return templates.find((item) => item.id === template.id)?.layout?.builder?.steps[0];
    })
    .toEqual({
      id: "step-1",
      title: "Oath",
      parts: [{ type: "text", markdown: "Say what your knight believes." }],
    });
});
