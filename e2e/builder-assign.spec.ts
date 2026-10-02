import type { SheetLayout } from "../src/domain/sheet-layout";
import { expect, test, type Table } from "./fixtures";

/*
 * The place-values part: fixed values (a standard array) placed onto stats,
 * fields and trackers with a click (or drag). Used chips dim as a hint;
 * anything may still go anywhere, and rolls never enter the picture.
 */

const layout: SheetLayout = {
  system: "Test",
  name: "Array",
  pages: [
    {
      id: "main",
      title: "Main",
      blocks: [
        {
          id: "scores",
          type: "stats",
          items: [
            { key: "edge", label: "Edge" },
            { key: "iron", label: "Iron" },
            { key: "wits", label: "Wits" },
          ],
        },
        {
          id: "resolve",
          type: "trackers",
          items: [{ key: "resolve", label: "Resolve", min: 0, max: 6, start: 0 }],
        },
      ],
    },
  ],
  builder: {
    steps: [
      {
        id: "scores",
        title: "Scores",
        parts: [
          { type: "assign", label: "Place", values: [3, 2, 1], targets: ["edge", "iron", "wits"] },
        ],
      },
      {
        id: "resolve",
        title: "Resolve",
        parts: [{ type: "assign", values: [4], targets: ["resolve"], max: true }],
      },
    ],
  },
};

const characterOf = async (table: Table, name: string) => {
  const response = await table.dm.api.get(`/api/worlds/${table.worldId}/characters`);
  const characters = (await response.json()) as {
    name: string;
    values: Record<string, unknown>;
    tickers: Record<string, number>;
    tickerMax?: Record<string, number>;
  }[];
  return characters.find((character) => character.name === name);
};

const setUp = (table: Table) =>
  table.saveTemplate({ name: "Array", fields: [], stats: [], tickers: [], rolls: [], layout });

test("a player places fixed values onto stats and a tracker; opening writes nothing", async ({
  table,
}) => {
  const template = await setUp(table);
  await table.saveCharacter({
    name: "Rook",
    templateId: template.id,
    memberId: table.player.memberId,
    values: {},
  });
  const before = await characterOf(table, "Rook");
  const page = table.player.page;
  await table.open(table.player);
  const tools = page.locator("#world-tools");
  await expect(tools.getByRole("heading", { name: "Rook" })).toBeVisible();
  await tools.getByRole("button", { name: "Builder" }).click();

  const builder = tools.getByRole("region", { name: "Character builder" });
  const scores = builder.getByRole("group", { name: "Place" });
  await expect(scores.getByRole("button", { name: "Edge: —" })).toBeVisible();
  // Rendering the part writes nothing.
  expect(await characterOf(table, "Rook")).toEqual(before);

  await scores.getByRole("button", { name: "Place 3" }).click();
  await scores.getByRole("button", { name: "Edge: —" }).click();
  await expect(scores.getByRole("button", { name: "Edge: 3" })).toBeVisible();
  await expect
    .poll(() => characterOf(table, "Rook").then((character) => character?.values))
    .toEqual({ edge: 3 });

  // Nothing is enforced: the same chip may go anywhere twice.
  await scores.getByRole("button", { name: "Place 3" }).click();
  await scores.getByRole("button", { name: "Iron: —" }).click();
  await expect
    .poll(() => characterOf(table, "Rook").then((character) => character?.values))
    .toEqual({ edge: 3, iron: 3 });

  // Clearing a slot empties its value.
  await scores.getByRole("button", { name: "Clear Edge" }).click();
  await expect
    .poll(() => characterOf(table, "Rook").then((character) => character?.values))
    .toEqual({ edge: "", iron: 3 });

  // Trackers take the placed value, and the maximum too when the part says so.
  await builder
    .getByRole("navigation", { name: "Builder steps" })
    .getByRole("button", { name: /Resolve/ })
    .click();
  const resolve = builder.getByRole("group", { name: "Place values" });
  await resolve.getByRole("button", { name: "Place 4" }).click();
  await resolve.getByRole("button", { name: "Resolve: 0" }).click();
  await tools.getByRole("button", { name: "Done" }).click();
  await expect(builder).toHaveCount(0);
  await expect
    .poll(() => characterOf(table, "Rook"))
    .toMatchObject({
      values: { edge: "", iron: 3 },
      tickers: { resolve: 4 },
      tickerMax: { resolve: 4 },
    });
});

test("a DM adds a place-values part in the layout editor", async ({ table }) => {
  const template = await setUp(table);
  const page = table.dm.page;
  await page.goto(`/worlds/${table.worldId}/settings?section=templates`);
  await page.getByRole("combobox", { name: "Template" }).selectOption({ label: "Array" });
  const steps = page.getByRole("group", { name: "Character builder steps" });
  await steps.getByRole("button", { name: "+ Add a step" }).click();
  const step = steps.getByRole("group", { name: "Step 3" });
  await step.getByLabel("Title").fill("Spread");
  await step
    .getByRole("combobox", { name: "Add to Step 3" })
    .selectOption({ label: "Place values" });
  // Typed key by key: a comma stays put until the field is left.
  await step.getByLabel("Values (comma separated)").pressSequentially("15, 14, 13");
  await step.getByRole("checkbox", { name: "Edge" }).check();
  await step.getByRole("checkbox", { name: "Resolve" }).check();
  await step.getByRole("checkbox", { name: "Set tracker maximums too" }).check();
  await page.getByRole("button", { name: "Save template" }).click();
  await expect
    .poll(async () => {
      const response = await table.dm.api.get(`/api/worlds/${table.worldId}/templates`);
      const templates = (await response.json()) as { id: string; layout?: SheetLayout }[];
      return templates.find((item) => item.id === template.id)?.layout?.builder?.steps[2];
    })
    .toEqual({
      id: "step-3",
      title: "Spread",
      parts: [
        {
          type: "assign",
          values: [15, 14, 13],
          targets: ["edge", "resolve"],
          max: true,
        },
      ],
    });
});
