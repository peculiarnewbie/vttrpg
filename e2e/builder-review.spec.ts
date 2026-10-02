import type { SheetLayout } from "../src/domain/sheet-layout";
import { expect, test, type Table } from "./fixtures";

/*
 * The builder's review part: one row per other applying step with its done
 * tick and what's still blank. Rows only navigate; merely opening the
 * builder and looking writes nothing.
 */

const layout: SheetLayout = {
  system: "Test",
  name: "Review",
  pages: [
    {
      id: "main",
      title: "Main",
      blocks: [
        {
          id: "name-fields",
          type: "fields",
          columns: 1,
          items: [{ key: "name", label: "Name" }],
        },
        { id: "virtues", type: "stats", items: [{ key: "vig", label: "VIG" }] },
        { id: "notes", type: "text", key: "notes", label: "Notes" },
        {
          id: "gear",
          type: "list",
          key: "gear",
          title: "Gear",
          columns: [{ key: "name", label: "Item", kind: "text" }],
        },
        { id: "kin", type: "entry", key: "kin", entryType: "kin", label: "Kin" },
      ],
    },
  ],
  builder: {
    steps: [
      {
        id: "basics",
        title: "Basics",
        done: "@vig > 0",
        parts: [
          { type: "blocks", blocks: ["name-fields", "virtues"] },
          { type: "choose", key: "kin" },
        ],
      },
      {
        id: "extra",
        title: "Extra",
        when: "@vig >= 10",
        parts: [{ type: "blocks", blocks: ["notes", "gear"] }],
      },
      { id: "lookback", title: "Look back", parts: [{ type: "review" }] },
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

test("a player reviews what's still blank; opening and looking writes nothing", async ({
  table,
}) => {
  const template = await table.saveTemplate({
    name: "Review",
    fields: [],
    stats: [],
    tickers: [],
    rolls: [],
    layout,
  });
  await table.saveCharacter({
    name: "Reviewer",
    templateId: template.id,
    memberId: table.player.memberId,
    values: { vig: 5 },
  });
  const before = await valuesOf(table, "Reviewer");
  const page = table.player.page;
  await table.open(table.player);
  const tools = page.locator("#world-tools");
  await expect(tools.getByRole("heading", { name: "Reviewer" })).toBeVisible();
  await tools.getByRole("button", { name: "Builder" }).click();
  const builder = tools.getByRole("region", { name: "Character builder" });
  const steps = builder.getByRole("navigation", { name: "Builder steps" });
  await steps.getByRole("button", { name: /Look back/ }).click();
  await expect(builder.getByRole("heading", { name: "Look back" })).toBeVisible();

  // Extra doesn't apply at VIG 5, and the review's own step is skipped:
  // only Basics, ticked done with its blank names.
  const review = builder.getByRole("group", { name: "Review" });
  const basics = review.getByRole("button", { name: /Basics/ });
  await expect(basics).toContainText("✓");
  await expect(basics).toContainText("Name");
  await expect(basics).toContainText("Kin");
  await expect(basics).not.toContainText("VIG");
  await expect(review.getByRole("button", { name: /Extra/ })).toHaveCount(0);

  // Looking around wrote nothing: the row only navigates.
  await basics.click();
  await expect(builder.getByRole("heading", { name: "Basics" })).toBeVisible();
  expect(await valuesOf(table, "Reviewer")).toEqual(before);

  // Filling Name in and raising VIG updates the rows; Extra now applies.
  await builder.getByLabel("Name").fill("Ser Test");
  await builder.getByLabel("Name").press("Enter");
  const vig = builder.getByLabel("VIG");
  await vig.fill("12");
  await vig.press("Enter");
  await steps.getByRole("button", { name: /Look back/ }).click();
  await expect(review.getByRole("button", { name: /Basics/ })).toContainText("Kin");
  await expect(review.getByRole("button", { name: /Basics/ })).not.toContainText("Name");
  const extra = review.getByRole("button", { name: /Extra/ });
  await expect(extra).toContainText("Notes");
  await expect(extra).toContainText("Gear");
  await extra.click();
  await expect(builder.getByRole("heading", { name: "Extra" })).toBeVisible();

  await tools.getByRole("button", { name: "Done" }).click();
  await expect(builder).toHaveCount(0);
  await expect.poll(() => valuesOf(table, "Reviewer")).toEqual({ vig: 12, name: "Ser Test" });
});

test("a DM adds a review part in the layout editor", async ({ table }) => {
  const template = await table.saveTemplate({
    name: "Review",
    fields: [],
    stats: [],
    tickers: [],
    rolls: [],
    layout,
  });
  const page = table.dm.page;
  await page.goto(`/worlds/${table.worldId}/settings?section=templates`);
  await page.getByRole("combobox", { name: "Template" }).selectOption({ label: "Review" });
  const steps = page.getByRole("group", { name: "Character builder steps" });
  const step = steps.getByRole("group", { name: "Step 2" });
  await step
    .getByRole("combobox", { name: "Add to Step 2" })
    .selectOption({ label: "Review what's left" });
  await expect(step.getByText("Lists every other step that applies")).toBeVisible();
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
      id: "extra",
      title: "Extra",
      when: "@vig >= 10",
      parts: [{ type: "blocks", blocks: ["notes", "gear"] }, { type: "review" }],
    });
});
