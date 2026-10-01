import type { CompendiumEntry, EntryType, SaveEntryInput } from "../src/domain/compendium";
import type { SheetLayout } from "../src/domain/sheet-layout";
import { expect, test, type Table } from "./fixtures";

/*
 * Phase 5: the compendium as a page — facets from the type's filters, compare
 * two entries side by side, add one to a character (the row remembers the
 * entry and its revision, so it can offer updates later).
 */

const spell: EntryType = {
  id: "spell",
  name: "Spell",
  plural: "Spells",
  fields: [
    { key: "level", label: "Level", kind: "number" },
    {
      key: "school",
      label: "School",
      kind: "select",
      options: ["Evocation", "Abjuration", "Illusion"],
    },
    { key: "range", label: "Range", kind: "text" },
  ],
  filters: [
    { key: "level", kind: "range" },
    { key: "school", kind: "set" },
  ],
};

const spells: [string, number, string][] = [
  ["Fire Bolt", 0, "Evocation"],
  ["Magic Missile", 1, "Evocation"],
  ["Shield", 1, "Abjuration"],
  ["Fireball", 3, "Evocation"],
  ["Invisibility", 2, "Illusion"],
];

const setup = async (table: Table) => {
  const put = await table.dm.api.put(`/api/worlds/${table.worldId}/compendium/types/spell`, {
    data: spell,
  });
  expect(put.ok(), await put.text()).toBe(true);
  for (const [name, level, school] of spells) {
    const input: SaveEntryInput = {
      typeId: "spell",
      name,
      tags: [],
      body: `${name} text.`,
      fields: { level, school, range: level ? "120 ft" : "60 ft" },
      visibility: "public",
    };
    const response = await table.dm.api.post(`/api/worlds/${table.worldId}/compendium/entries`, {
      data: input,
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
};

const layout: SheetLayout = {
  system: "E2E",
  name: "Caster",
  pages: [
    {
      id: "main",
      title: "Main",
      blocks: [
        {
          id: "spells",
          type: "list",
          key: "spells",
          title: "Spellbook",
          source: { entryType: "spell" },
          columns: [
            { key: "name", label: "Spell", kind: "text" },
            { key: "level", label: "Level", kind: "number" },
          ],
        },
      ],
    },
  ],
};

test("filter spells by level and school, compare two, add one to a character", async ({
  table,
}) => {
  await setup(table);
  const template = await table.saveTemplate({
    name: "Caster",
    fields: [],
    stats: [],
    tickers: [],
    rolls: [],
    layout,
  });
  const character = await table.saveCharacter({
    name: "Merlin",
    templateId: template.id,
    memberId: table.player.memberId,
    values: {},
  });

  const { page } = table.player;
  await table.open(table.player);
  await page
    .getByRole("navigation", { name: "View" })
    .getByRole("button", { name: "Compendium" })
    .click();
  await expect(page).toHaveURL(/\/compendium/);
  const browser = page.getByRole("region", { name: "Compendium browser" });
  const entries = browser.getByRole("list", { name: "Entries" });
  await expect(entries.getByRole("listitem")).toHaveCount(5);

  await browser.getByRole("button", { name: /^Spells/ }).click();
  const filters = browser.getByRole("navigation", { name: "Filters" });
  await filters.getByLabel("Level from").fill("1");
  await filters.getByLabel("Level to").fill("2");
  await expect(entries.getByRole("listitem")).toHaveCount(3);
  // Counts for one filter ignore its own choice, so the other schools stay visible.
  await filters.getByRole("checkbox", { name: /Evocation/ }).check();
  await expect(entries.getByRole("listitem")).toHaveCount(1);
  await expect(entries).toContainText("Magic Missile");
  await expect(filters.getByRole("group", { name: "School" })).toContainText("Abjuration");
  await filters.getByRole("checkbox", { name: /Evocation/ }).uncheck();

  // Compare: pin one, open another; both read side by side.
  await entries.getByRole("button", { name: /Shield/ }).click();
  const preview = browser.getByRole("complementary", { name: "Preview" });
  await expect(preview.getByText("Shield text.")).toBeVisible();
  await preview.getByRole("button", { name: "Pin to compare" }).click();
  await entries.getByRole("button", { name: /Magic Missile/ }).click();
  await expect(preview.getByRole("article", { name: "Pinned: Shield" })).toBeVisible();
  await expect(preview.getByText("Magic Missile text.")).toBeVisible();
  await expect(preview.getByText("Shield text.")).toBeVisible();

  // Add to character: the row copies the entry and remembers its id and revision.
  await preview.getByRole("button", { name: "Add to character" }).click();
  await page.getByRole("menuitem", { name: "Merlin · Spellbook" }).click();
  await expect(preview.getByRole("status")).toHaveText("Added to Merlin · Spellbook");
  await expect
    .poll(async () => {
      const response = await table.dm.api.get(`/api/worlds/${table.worldId}/characters`);
      const characters = (await response.json()) as {
        id: string;
        values: Record<string, unknown>;
      }[];
      return characters.find((item) => item.id === character.id)?.values.spells;
    })
    .toEqual([
      {
        name: "Magic Missile",
        level: 1,
        _entry: "world/spell/magic-missile",
        _rev: expect.any(Number),
      },
    ]);

  // The view is in the URL: a reload comes back to the same entry.
  await page.reload();
  await expect(
    page.getByRole("complementary", { name: "Preview" }).getByText("Magic Missile text."),
  ).toBeVisible();
});

test("DM-only entries show for the DM and never for players", async ({ table }) => {
  await setup(table);
  const secret: SaveEntryInput = {
    typeId: "spell",
    name: "Wish",
    tags: [],
    body: "Secret.",
    fields: { level: 9, school: "Illusion" },
    visibility: "dm",
  };
  const saved = (await (
    await table.dm.api.post(`/api/worlds/${table.worldId}/compendium/entries`, { data: secret })
  ).json()) as CompendiumEntry;

  await table.open(table.dm);
  await table.dm.page.goto(`/worlds/${table.worldId}/compendium?type=spell`);
  const dmBrowser = table.dm.page.getByRole("region", { name: "Compendium browser" });
  await expect(dmBrowser.getByRole("list", { name: "Entries" }).getByRole("listitem")).toHaveCount(
    6,
  );
  await expect(dmBrowser.getByRole("button", { name: /Wish/ })).toContainText("DM");

  await table.open(table.player);
  await table.player.page.goto(
    `/worlds/${table.worldId}/compendium?type=spell&entry=${encodeURIComponent(saved.id)}`,
  );
  const browser = table.player.page.getByRole("region", { name: "Compendium browser" });
  await expect(browser.getByRole("list", { name: "Entries" }).getByRole("listitem")).toHaveCount(5);
  await expect(browser.getByText("That entry isn't in the compendium any more.")).toBeVisible();
});
