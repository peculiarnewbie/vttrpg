import type { CompendiumEntry, EntryType, SaveEntryInput } from "../src/domain/compendium";
import type { SheetLayout } from "../src/domain/sheet-layout";
import { expect, test, type Table } from "./fixtures";

/*
 * The character builder: another frontend over the same character values.
 * It writes only what the player edits or explicitly accepts; its rolls go to
 * chat and never land on the sheet.
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

const entry = (typeId: string, name: string, fields: SaveEntryInput["fields"] = {}) => ({
  typeId,
  name,
  tags: [],
  body: "",
  fields,
  visibility: "public" as const,
});

const property = [
  { key: "name", label: "Item", kind: "text" as const },
  { key: "dmg", label: "Dmg", kind: "dice" as const },
];

/** A Knight whose moves and omen table the builder offers once the Knight is chosen. */
const setUp = async (table: Table) => {
  await putType(table, { id: "move", name: "Move", plural: "Moves", fields: [] });
  await putType(table, {
    id: "table",
    name: "Table",
    plural: "Tables",
    fields: [{ key: "table", label: "Table", kind: "oracle", dice: "1d6" }],
  });
  await putType(table, {
    id: "knight",
    name: "Knight",
    plural: "Knights",
    fields: [
      { key: "property", label: "Property", kind: "list", columns: property },
      {
        key: "moves",
        label: "Moves",
        kind: "reference",
        ref: { typeIds: ["move"], multiple: true },
      },
      { key: "omens", label: "Omens", kind: "reference", ref: { typeIds: ["table"] } },
    ],
  });
  const charge = await saveEntry(table, entry("move", "Charge"));
  const parry = await saveEntry(table, entry("move", "Parry"));
  await saveEntry(table, entry("move", "Retreat"));
  const omens = await saveEntry(
    table,
    entry("table", "Omens", {
      table: [{ min: 1, max: 6, text: "A crow" }],
    }),
  );
  await saveEntry(
    table,
    entry("knight", "The Test Knight", {
      property: [{ name: "Spear", dmg: "d8" }],
      moves: [charge.id, parry.id],
      omens: omens.id,
    }),
  );
  const layout: SheetLayout = {
    system: "Test",
    name: "Knight",
    pages: [
      {
        id: "main",
        title: "Main",
        blocks: [
          {
            id: "knight-entry",
            type: "entry",
            key: "knight",
            entryType: "knight",
            label: "Knight",
            fill: [{ from: "property", to: "property" }],
          },
          { id: "virtues", type: "stats", items: [{ key: "vig", label: "VIG" }] },
          { id: "property", type: "list", key: "property", title: "Property", columns: property },
          {
            id: "moves",
            type: "list",
            key: "moves",
            title: "Moves",
            source: { entryType: "move" },
            columns: [{ key: "name", label: "Move", kind: "text" }],
          },
        ],
      },
    ],
    builder: {
      steps: [
        { id: "knight", title: "Knight", parts: [{ type: "choose", key: "knight" }] },
        {
          id: "virtues",
          title: "Virtues",
          hint: "Roll, then write the result in.",
          parts: [
            { type: "rolls", items: [{ label: "Virtue", dice: "3d6" }] },
            { type: "blocks", blocks: ["virtues"] },
          ],
        },
        {
          id: "moves",
          title: "Moves",
          parts: [
            { type: "choose", key: "moves", from: { entry: "knight", field: "moves" }, pick: 1 },
            { type: "tables", from: { entry: "knight", field: "omens" } },
          ],
        },
      ],
    },
  };
  return table.saveTemplate({
    name: "Knight",
    fields: [],
    stats: [],
    tickers: [],
    rolls: [],
    layout,
  });
};

const valuesOf = async (table: Table, name: string) => {
  const response = await table.dm.api.get(`/api/worlds/${table.worldId}/characters`);
  const characters = (await response.json()) as {
    name: string;
    values: Record<string, unknown>;
  }[];
  return characters.find((character) => character.name === name)?.values;
};

test("a player builds a Knight step by step; only edits and accepted offers reach the sheet", async ({
  table,
}) => {
  await setUp(table);
  const page = table.player.page;
  await table.open(table.player);
  await page.getByRole("tab", { name: "Characters" }).click();
  const tools = page.locator("#world-tools");
  await tools.getByRole("button", { name: "New character" }).click();
  const dialog = page.getByRole("dialog", { name: "New character" });
  await dialog.getByPlaceholder("Character name").fill("Ser Test");
  await dialog.getByRole("combobox").first().selectOption({ label: "Knight" });
  await dialog.getByRole("button", { name: "Create and open builder" }).click();

  const builder = tools.getByRole("region", { name: "Character builder" });
  await expect(builder).toBeVisible();
  const knights = builder.getByRole("group", { name: "Knights" });
  await knights.getByRole("button", { name: "The Test Knight" }).click();
  await knights.getByRole("button", { name: "Choose The Test Knight" }).click();
  await expect(knights.getByRole("status")).toContainText("Add The Test Knight's Property (1)");
  await knights.getByRole("button", { name: "Add", exact: true }).click();

  await builder
    .getByRole("navigation", { name: "Builder steps" })
    .getByRole("button", { name: /Virtues/ })
    .click();
  await builder.getByRole("button", { name: /^Virtue/ }).click();
  const chat = page.locator("#world-chat");
  await expect(chat.getByText("3d6").first()).toBeVisible({ timeout: 15_000 });
  const vig = builder.getByLabel("VIG");
  await vig.fill("12");
  await vig.press("Enter");

  await builder.getByRole("button", { name: "Next →" }).click();
  const moves = builder.getByRole("group", { name: "Moves" });
  await expect(moves.getByText("Pick 1")).toBeVisible();
  const options = moves.getByRole("list", { name: "Options" });
  await expect(options.getByRole("button")).toHaveText(["Charge", "Parry"]);
  await options.getByRole("button", { name: "Charge" }).click();
  await moves.getByRole("button", { name: "Add Charge" }).click();
  await builder
    .getByRole("group", { name: "Tables" })
    .getByRole("button", { name: "Omens" })
    .click();
  await expect(chat.getByText("Omens · Table").first()).toBeVisible({ timeout: 15_000 });

  await tools.getByRole("button", { name: "Done" }).click();
  await expect(builder).toHaveCount(0);
  await expect
    .poll(() => valuesOf(table, "Ser Test"))
    .toEqual({
      knight: expect.stringMatching(/^world\/knight\//),
      property: [expect.objectContaining({ name: "Spear", dmg: "d8" })],
      vig: 12,
      moves: [expect.objectContaining({ name: "Charge" })],
    });
});

test("opening the builder on a finished character and rolling changes nothing", async ({
  table,
}) => {
  const template = await setUp(table);
  await table.saveCharacter({
    name: "Ser Done",
    templateId: template.id,
    memberId: table.player.memberId,
    values: { vig: 9, property: [{ name: "Axe", dmg: "d6" }] },
  });
  const before = await valuesOf(table, "Ser Done");
  const page = table.player.page;
  await table.open(table.player);
  const tools = page.locator("#world-tools");
  await expect(tools.getByRole("heading", { name: "Ser Done" })).toBeVisible();
  await tools.getByRole("button", { name: "Builder" }).click();
  const builder = tools.getByRole("region", { name: "Character builder" });
  await builder.getByRole("button", { name: /Virtues/ }).click();
  await builder.getByRole("button", { name: /^Virtue/ }).click();
  await expect(page.locator("#world-chat").getByText("3d6").first()).toBeVisible({
    timeout: 15_000,
  });
  // The Moves step waits for a Knight; nothing is offered or written meanwhile.
  await builder.getByRole("button", { name: /Moves/ }).click();
  await expect(builder.getByText("Choose a Knight first.")).toBeVisible();
  await tools.getByRole("button", { name: "Cancel" }).click();
  await expect(builder).toHaveCount(0);
  expect(await valuesOf(table, "Ser Done")).toEqual(before);
});

test("a DM adds a builder step in the layout editor", async ({ table }) => {
  const template = await setUp(table);
  const page = table.dm.page;
  await page.goto(`/worlds/${table.worldId}/settings?section=templates`);
  await page.getByRole("combobox", { name: "Template" }).selectOption({ label: "Knight" });
  const steps = page.getByRole("group", { name: "Character builder steps" });
  const third = steps.getByRole("group", { name: "Step 3" });
  // Existing steps show what they're set to.
  await expect(third.getByLabel("Into")).toHaveValue("moves");
  await expect(third.getByLabel("Options from")).toHaveValue("knight");
  await expect(third.getByLabel("Tables from")).toHaveValue("knight");
  await steps.getByRole("button", { name: "+ Add a step" }).click();
  const step = steps.getByRole("group", { name: "Step 4" });
  await step.getByLabel("Title").fill("Gear");
  await step
    .getByRole("combobox", { name: "Add to Step 4" })
    .selectOption({ label: "Sheet blocks" });
  await step.getByRole("checkbox", { name: /Property/ }).check();
  await page.getByRole("button", { name: "Save template" }).click();
  await expect
    .poll(async () => {
      const response = await table.dm.api.get(`/api/worlds/${table.worldId}/templates`);
      const templates = (await response.json()) as {
        id: string;
        layout?: SheetLayout;
      }[];
      return templates.find((item) => item.id === template.id)?.layout?.builder?.steps[3];
    })
    .toEqual({ id: "step-4", title: "Gear", parts: [{ type: "blocks", blocks: ["property"] }] });
});
