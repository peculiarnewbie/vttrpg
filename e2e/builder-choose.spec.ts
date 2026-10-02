import type { CompendiumEntry, EntryType, SaveEntryInput } from "../src/domain/compendium";
import type { Character } from "../src/domain/schemas";
import type { SheetLayout } from "../src/domain/sheet-layout";
import { expect, test, type Table } from "./fixtures";

/*
 * The choose part's filters, "added" marks and removal: a filter over the
 * option's index row plus its tags decides what's offered, added rows show a
 * hinted count with an explicit Remove, and merely opening the builder writes
 * nothing. Rolls never reach the sheet — only picks and removals do.
 */

const putType = async (table: Table, type: EntryType) => {
  const response = await table.dm.api.put(
    `/api/worlds/${table.worldId}/compendium/types/${type.id}`,
    { data: type },
  );
  expect(response.ok(), await response.text()).toBe(true);
};

const saveEntry = async (table: Table, input: SaveEntryInput) => {
  const response = await table.dm.api.post(`/api/worlds/${table.worldId}/compendium/entries`, {
    data: input,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as CompendiumEntry;
};

const entry = (typeId: string, name: string, fields: SaveEntryInput["fields"], tags: string[]) => ({
  typeId,
  name,
  tags,
  body: "",
  fields,
  visibility: "public" as const,
});

/** Gear with a level and a kind: the filter reads the row, the tags read its tags. */
const setUp = async (table: Table) => {
  await putType(table, {
    id: "gear",
    name: "Gear",
    plural: "Gear",
    fields: [
      { key: "level", label: "Level", kind: "number" },
      { key: "kind", label: "Kind", kind: "select", options: ["Blade", "Plate", "Tool"] },
    ],
    filters: [
      { key: "level", kind: "range" },
      { key: "kind", kind: "set" },
    ],
  });
  const dagger = await saveEntry(
    table,
    entry("gear", "Dagger", { level: 1, kind: "Blade" }, ["light"]),
  );
  const torch = await saveEntry(table, entry("gear", "Torch", { level: 1, kind: "Tool" }, []));
  const plate = await saveEntry(
    table,
    entry("gear", "Plate", { level: 5, kind: "Plate" }, ["heavy"]),
  );
  const layout: SheetLayout = {
    system: "Test",
    name: "Kit",
    pages: [
      {
        id: "main",
        title: "Main",
        blocks: [
          { id: "max", type: "stats", items: [{ key: "max_level", label: "MAX" }] },
          {
            id: "kit",
            type: "list",
            key: "kit",
            title: "Kit",
            source: { entryType: "gear" },
            columns: [{ key: "name", label: "Item", kind: "text" }],
          },
        ],
      },
    ],
    builder: {
      steps: [
        {
          id: "kit",
          title: "Kit",
          parts: [
            {
              type: "choose",
              key: "kit",
              pick: 2,
              filter: "@level <= @max_level",
              tags: { none: ["heavy"] },
            },
          ],
        },
      ],
    },
  };
  const template = await table.saveTemplate({
    name: "Kit",
    fields: [],
    stats: [],
    tickers: [],
    rolls: [],
    layout,
  });
  return { template, dagger, torch, plate };
};

const characterOf = async (table: Table, name: string) => {
  const response = await table.dm.api.get(`/api/worlds/${table.worldId}/characters`);
  const characters = (await response.json()) as Character[];
  return characters.find((character) => character.name === name);
};

test("filters narrow the options; added rows show a count and remove explicitly", async ({
  table,
}) => {
  const { template, torch } = await setUp(table);
  await table.saveCharacter({
    name: "Kit Test",
    templateId: template.id,
    memberId: table.player.memberId,
    values: { max_level: 1 },
  });
  const page = table.player.page;
  await table.open(table.player);
  const tools = page.locator("#world-tools");
  await expect(tools.getByRole("heading", { name: "Kit Test" })).toBeVisible();
  await tools.getByRole("button", { name: "Builder" }).click();
  const builder = tools.getByRole("region", { name: "Character builder" });
  await expect(builder).toBeVisible();
  const kit = builder.getByRole("group", { name: "Gear" });

  // Plate needs level 5 and carries "heavy": only Dagger and Torch are offered.
  const options = kit.getByRole("list", { name: "Options" });
  await expect(options.getByRole("button")).toHaveText(["Dagger", "Torch"]);
  await expect(options.getByRole("button", { name: "Plate" })).toHaveCount(0);
  await expect(kit.getByText("Picked 0 of 2")).toBeVisible();
  // Rendering the filtered options wrote nothing.
  expect((await characterOf(table, "Kit Test"))?.values).toEqual({ max_level: 1 });

  await options.getByRole("button", { name: "Dagger" }).click();
  await kit.getByRole("button", { name: "Add Dagger" }).click();
  await expect(options.getByText("✓ added")).toBeVisible();
  await expect(kit.getByText("Picked 1 of 2")).toBeVisible();
  // The count is a hint, never a gate: adding Dagger again is still allowed.
  await kit.getByRole("button", { name: "Add Dagger" }).click();
  await expect(options.getByText("✓ added ×2")).toBeVisible();
  await expect(kit.getByText("Picked 2 of 2")).toBeVisible();

  // Remove drops every row copied from Dagger, and nothing else.
  await options.getByRole("button", { name: "Torch" }).click();
  await kit.getByRole("button", { name: "Add Torch" }).click();
  await expect(kit.getByText("Picked 3 of 2")).toBeVisible();
  await options.getByRole("button", { name: "Dagger" }).click();
  await kit.getByRole("button", { name: "Remove Dagger" }).click();
  await expect(options.getByRole("button", { name: "Dagger" })).toHaveText("Dagger");
  await expect(options.getByText("✓ added")).toHaveCount(1);
  await expect(kit.getByText("Picked 1 of 2")).toBeVisible();

  await tools.getByRole("button", { name: "Done" }).click();
  await expect(builder).toHaveCount(0);
  expect((await characterOf(table, "Kit Test"))?.values).toEqual({
    max_level: 1,
    kit: [expect.objectContaining({ name: "Torch", _entry: torch.id })],
  });
});

test("a DM adds a filtered choose part in the layout editor", async ({ table }) => {
  const { template } = await setUp(table);
  const page = table.dm.page;
  await page.goto(`/worlds/${table.worldId}/settings?section=templates`);
  await page.getByRole("combobox", { name: "Template" }).selectOption({ label: "Kit" });
  const steps = page.getByRole("group", { name: "Character builder steps" });
  // The saved step shows its filter and tags.
  const first = steps.getByRole("group", { name: "Step 1" });
  await expect(first.getByLabel("Into")).toHaveValue("kit");
  await expect(first.getByRole("combobox", { name: "Step 1 part 1 only offer while" })).toHaveValue(
    "@level <= @max_level",
  );
  await expect(first.getByLabel("Tags none")).toHaveValue("heavy");

  await steps.getByRole("button", { name: "+ Add a step" }).click();
  const step = steps.getByRole("group", { name: "Step 2" });
  await step.getByLabel("Title").fill("More");
  await step
    .getByRole("combobox", { name: "Add to Step 2" })
    .selectOption({ label: "Choose from the compendium" });
  await step.getByLabel("Pick (hint)").fill("1");
  await step
    .getByRole("combobox", { name: "Step 2 part 1 only offer while" })
    .fill('@kind == "Blade"');
  await step.getByLabel("Tags any").fill("light, sharp");
  await step.getByLabel("Tags any").press("Tab");
  await page.getByRole("button", { name: "Save template" }).click();
  await expect
    .poll(async () => {
      const response = await table.dm.api.get(`/api/worlds/${table.worldId}/templates`);
      const templates = (await response.json()) as { id: string; layout?: SheetLayout }[];
      return templates.find((item) => item.id === template.id)?.layout?.builder?.steps[1];
    })
    .toEqual({
      id: "step-2",
      title: "More",
      parts: [
        {
          type: "choose",
          key: "kit",
          pick: 1,
          filter: '@kind == "Blade"',
          tags: { any: ["light", "sharp"] },
        },
      ],
    });
});
