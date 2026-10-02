import type { SheetLayout } from "../src/domain/sheet-layout";
import type { Character } from "../src/domain/schemas";
import { expect, test, type Table } from "./fixtures";

/*
 * The scores part: set numbers — a tracker's current value and a plain stat.
 * With "Set the maximum too" a tracker also takes the number as its maximum,
 * as a draft like Edit's (saved with Done, dropped by Cancel). Merely opening
 * the builder writes nothing.
 */

const layout: SheetLayout = {
  system: "Test",
  name: "Scores",
  pages: [
    {
      id: "main",
      title: "Main",
      blocks: [
        { id: "health", type: "trackers", items: [{ key: "hp", label: "HP", min: 0, max: 20 }] },
        { id: "attrs", type: "stats", items: [{ key: "str", label: "STR" }] },
      ],
    },
  ],
  builder: {
    steps: [
      {
        id: "scores",
        title: "Scores",
        hint: "Write in what you rolled.",
        parts: [{ type: "scores", items: [{ key: "hp" }, { key: "str" }], max: true }],
      },
    ],
  },
};

const setUp = (table: Table) =>
  table.saveTemplate({ name: "Scores", fields: [], stats: [], tickers: [], rolls: [], layout });

const fullOf = async (table: Table, name: string) => {
  const response = await table.dm.api.get(`/api/worlds/${table.worldId}/characters`);
  const characters = (await response.json()) as Character[];
  return characters.find((character) => character.name === name);
};

const buildExisting = async (table: Table, name: string) => {
  const page = table.player.page;
  await table.open(table.player);
  await page.getByRole("tab", { name: "Characters" }).click();
  const tools = page.locator("#world-tools");
  await expect(tools.getByRole("heading", { name })).toBeVisible();
  await tools.getByRole("button", { name: "Builder" }).click();
  const builder = tools.getByRole("region", { name: "Character builder" });
  await expect(builder).toBeVisible();
  return { tools, builder };
};

test("a player sets a tracker and a stat; only committed numbers reach the sheet", async ({
  table,
}) => {
  const template = await setUp(table);
  await table.saveCharacter({
    name: "Scrappy",
    templateId: template.id,
    memberId: table.player.memberId,
    values: {},
  });
  const before = await fullOf(table, "Scrappy");

  const { tools, builder } = await buildExisting(table, "Scrappy");
  const scores = builder.getByRole("group", { name: "Scores" });
  await expect(scores).toBeVisible();
  await expect(scores.getByText("20/20")).toBeVisible();
  await expect(builder.getByText("Sets the maximum too (saved with Done)")).toBeVisible();
  // Rendering the part writes nothing.
  expect(await fullOf(table, "Scrappy")).toEqual(before);

  const hp = scores.getByLabel("HP");
  await hp.fill("12");
  await hp.press("Enter");
  const str = scores.getByLabel("STR");
  await str.fill("9");
  await str.press("Enter");
  await expect(scores.getByText("12/12")).toBeVisible();
  await expect
    .poll(() => fullOf(table, "Scrappy").then((character) => character?.tickers.hp))
    .toBe(12);

  await tools.getByRole("button", { name: "Done" }).click();
  await expect(builder).toHaveCount(0);
  await expect
    .poll(() => fullOf(table, "Scrappy"))
    .toMatchObject({
      values: { str: 9 },
      tickers: { hp: 12 },
      tickerMax: { hp: 12 },
    });
});

test("cancel drops the maximum but keeps the current value", async ({ table }) => {
  const template = await setUp(table);
  await table.saveCharacter({
    name: "Skippy",
    templateId: template.id,
    memberId: table.player.memberId,
    values: {},
  });

  const { tools, builder } = await buildExisting(table, "Skippy");
  const hp = builder.getByRole("group", { name: "Scores" }).getByLabel("HP");
  await hp.fill("8");
  await hp.press("Enter");
  await expect
    .poll(() => fullOf(table, "Skippy").then((character) => character?.tickers.hp))
    .toBe(8);

  await tools.getByRole("button", { name: "Cancel" }).click();
  await expect(builder).toHaveCount(0);
  // The current value was saved immediately, as on the sheet; the maximum was
  // a draft and Cancel dropped it.
  const after = await fullOf(table, "Skippy");
  expect(after?.tickers.hp).toBe(8);
  expect(after?.tickerMax?.hp).toBeUndefined();
});

test("a DM adds a scores part in the layout editor", async ({ table }) => {
  const template = await setUp(table);
  const withFirst = {
    ...layout,
    builder: { steps: [{ id: "first", title: "First", parts: [] }] },
  };
  await table.dm.api.post(`/api/worlds/${table.worldId}/templates`, {
    data: {
      id: template.id,
      name: "Scores",
      fields: [],
      stats: [],
      tickers: [],
      rolls: [],
      layout: withFirst,
    },
  });
  const page = table.dm.page;
  await page.goto(`/worlds/${table.worldId}/settings?section=templates`);
  await page.getByRole("combobox", { name: "Template" }).selectOption({ label: "Scores" });
  const steps = page.getByRole("group", { name: "Character builder steps" });
  await steps.getByRole("button", { name: "+ Add a step" }).click();
  const step = steps.getByRole("group", { name: "Step 2" });
  await step.getByLabel("Title").fill("Scores");
  await step.getByRole("combobox", { name: "Add to Step 2" }).selectOption({ label: "Scores" });
  // Checked in reverse; the part keeps the sheet's own order.
  await step.getByRole("checkbox", { name: "STR" }).check();
  await step.getByRole("checkbox", { name: "HP" }).check();
  await step.getByLabel("STR label").fill("Might");
  await step.getByRole("checkbox", { name: "Set the maximum too" }).check();
  await page.getByRole("button", { name: "Save template" }).click();
  await expect
    .poll(async () => {
      const response = await table.dm.api.get(`/api/worlds/${table.worldId}/templates`);
      const templates = (await response.json()) as { id: string; layout?: SheetLayout }[];
      return templates.find((item) => item.id === template.id)?.layout?.builder?.steps[1];
    })
    .toEqual({
      id: "step-2",
      title: "Scores",
      parts: [
        { type: "scores", items: [{ key: "hp" }, { key: "str", label: "Might" }], max: true },
      ],
    });
});
